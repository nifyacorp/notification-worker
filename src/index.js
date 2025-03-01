import { PubSub } from '@google-cloud/pubsub';
import { validateMessage } from './utils/validation.js';
import { processBOEMessage } from './processors/boe.js';
import { processRealEstateMessage } from './processors/real-estate.js';
import { logger } from './utils/logger.js';
import http from 'http';
import { db } from './database/client.js';
import { v4 as uuidv4 } from 'uuid';

// Global service state
let serviceState = {
  dbConnected: false,
  pubsubConnected: false,
  subscriptionActive: false,
  errors: [],
  startTime: new Date().toISOString(),
  ready: false,
  databaseActive: true,
  pubsubActive: true,
  operatingMode: 'initializing',
  messageCount: 0,
  validationErrors: 0,
  unknownProcessorErrors: 0,
  dbUnavailableErrors: 0,
  successfulMessages: 0,
  processingErrors: 0,
  lastActivity: new Date().toISOString()
};

// Initialize PubSub client
const pubsub = new PubSub({
  projectId: process.env.GOOGLE_CLOUD_PROJECT,
  maxMessages: 1 // Process one message at a time for better debugging
});

// Initialize subscription and DLQ topic
let subscription;
let dlqTopic;

try {
  subscription = pubsub.subscription(process.env.PUBSUB_SUBSCRIPTION);
  dlqTopic = pubsub.topic(process.env.DLQ_TOPIC);
} catch (error) {
  logger.error('Failed to initialize PubSub resources', {
    error: error.message,
    stack: error.stack
  });
  serviceState.errors.push(`PubSub initialization: ${error.message}`);
}

// Create HTTP server for Cloud Run health checks with enhanced status reporting
const server = http.createServer(async (req, res) => {
  // Health check endpoint with enhanced diagnostics
  if (req.url === '/health') {
    try {
      const dbState = db.getConnectionState();
      const uptime = process.uptime();
      const memoryUsage = process.memoryUsage();
      
      // More detailed health status
      const healthStatus = {
        status: serviceState.ready ? 'ready' : 'initializing',
        uptime: uptime,
        uptime_formatted: `${Math.floor(uptime / 3600)}h ${Math.floor((uptime % 3600) / 60)}m ${Math.floor(uptime % 60)}s`,
        memory: {
          rss: Math.round(memoryUsage.rss / 1024 / 1024),
          heapTotal: Math.round(memoryUsage.heapTotal / 1024 / 1024),
          heapUsed: Math.round(memoryUsage.heapUsed / 1024 / 1024),
          external: Math.round(memoryUsage.external / 1024 / 1024)
        },
        services: {
          database: {
            connected: serviceState.databaseActive,
            last_error: dbState.lastErrorMessage,
            init_count: dbState.initCount,
            last_init: dbState.lastInitTime,
            pool_stats: dbState.poolStats
          },
          pubsub: {
            connected: serviceState.pubsubActive,
            subscription: {
              exists: serviceState.subscriptionActive,
              name: process.env.PUBSUB_SUBSCRIPTION
            }
          }
        },
        operating_mode: serviceState.operatingMode,
        initialization_errors: serviceState.errors,
        has_recent_activity: serviceState.lastActivity ? 
          (Date.now() - new Date(serviceState.lastActivity).getTime() < 300000) : false,
        last_activity: serviceState.lastActivity,
        env: process.env.NODE_ENV,
        version: process.env.VERSION || 'unknown'
      };
    
      // Choose status code based on health state
      let statusCode = 200;
      
      // Still return 200 even if database is down, as long as worker is ready for messages
      if (!serviceState.ready && !serviceState.pubsubActive) {
        statusCode = 503; // Service Unavailable
      }
      
      res.writeHead(statusCode, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(healthStatus));
    } catch (error) {
      // Fallback health response in case of error
      logger.error('Error generating health status', {
        error: error.message,
        stack: error.stack
      });
      
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: 'up',
        mode: 'limited',
        error: error.message,
        uptime: process.uptime()
      }));
    }
    return;
  }
  
  // For other routes, return normal response
  res.writeHead(200);
  res.end('Notification Worker');
});

const port = process.env.PORT || 8080;
server.listen(port, () => {
  logger.info(`HTTP server listening on port ${port}`);
});

// Update the processor map to indicate which processors require database access
const PROCESSOR_MAP = {
  'boe': Object.assign(processBOEMessage, { requiresDatabase: true }),
  'real-estate': Object.assign(processRealEstateMessage, { requiresDatabase: true }),
};

async function publishToDLQ(message, error) {
  try {
    const messageData = {
      original_message: message,
      error: error.message,
      timestamp: new Date().toISOString(),
    };

    await dlqTopic.publish(Buffer.from(JSON.stringify(messageData)));
    logger.info('Message published to DLQ', {
      trace_id: message.trace_id,
      error: error.message
    });
  } catch (dlqError) {
    logger.error('Failed to publish to DLQ', {
      error: dlqError,
      original_error: error,
      trace_id: message.trace_id
    });
  }
}

// Add a new utility function for retry mechanism
async function withRetry(operation, options = {}) {
  const {
    maxRetries = 3,
    initialDelay = 1000,
    maxDelay = 10000,
    factor = 2,
    retryOnError = (err) => true,
    onRetry = () => {}
  } = options;
  
  let attempt = 0;
  let lastError = null;
  
  while (attempt <= maxRetries) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      attempt++;
      
      if (attempt > maxRetries || !retryOnError(error)) {
        throw error;
      }
      
      const delay = Math.min(initialDelay * Math.pow(factor, attempt - 1), maxDelay);
      
      logger.info(`Retry attempt ${attempt}/${maxRetries} after ${delay}ms`, {
        error: error.message,
        error_type: error.name
      });
      
      if (onRetry) {
        await onRetry(error, attempt);
      }
      
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  
  throw lastError;
}

// Define the processMessage function correctly instead of trying to extend Subscription.prototype
async function processMessage(message) {
  const rawMessage = message.data.toString();
  let data;
  
  // Track processing start time
  const processingStart = Date.now();
  
  try {
    // Parse message data
    try {
      data = JSON.parse(rawMessage);
    } catch (parseError) {
      logger.error('Failed to parse message', {
        error: parseError.message,
        message_id: message.id,
        publish_time: message.publishTime
      });
      
      await publishToDLQ({ raw_message: rawMessage }, parseError);
      message.ack(); // Ack invalid messages to prevent redelivery
      return;
    }
    
    // Add trace ID if not present
    if (!data.trace_id) {
      data.trace_id = uuidv4();
      logger.info('Generated missing trace ID', { trace_id: data.trace_id });
    }
    
    // Validate message data
    const validatedData = await validateMessage(data);
    
    // Get processor for this message type
    const processor = PROCESSOR_MAP[validatedData.processor_type];
    if (!processor) {
      const error = new Error(`Unknown processor type: ${validatedData.processor_type}`);
      await publishToDLQ(validatedData, error);
      message.ack(); // Ack unknown processor messages to prevent redelivery
      
      logger.warn('Unknown processor type, message sent to DLQ', {
        processor_type: validatedData.processor_type,
        trace_id: validatedData.trace_id
      });
      
      return;
    }
    
    // Check database connection for processors that need it
    if (processor.requiresDatabase && !serviceState.databaseActive) {
      logger.warn('Database connection not established, attempting to connect', {
        processor_type: validatedData.processor_type,
        connection_state: db.getConnectionState()
      });
      
      try {
        // Retry database connection with backoff
        await withRetry(
          () => db.testConnection(), 
          {
            maxRetries: 3,
            initialDelay: 1000,
            onRetry: (error, attempt) => {
              logger.info(`Database connection retry ${attempt}`, {
                error: error.message,
                trace_id: validatedData.trace_id
              });
            }
          }
        );
        
        logger.info('Database connection restored during message processing');
      } catch (dbError) {
        // After retries failed, send to DLQ
        const error = new Error(`Database unavailable: ${dbError.message}`);
        await publishToDLQ(validatedData, error);
        message.ack(); // Ack to prevent redelivery until DB is fixed
        
        logger.warn('Message requires database but connection unavailable, sent to DLQ', {
          processor_type: validatedData.processor_type,
          trace_id: validatedData.trace_id,
          error: dbError.message
        });
        
        // Track DB unavailable errors
        serviceState.dbUnavailableErrors = (serviceState.dbUnavailableErrors || 0) + 1;
        
        return;
      }
    }

    // Process the message with retries for transient errors
    await withRetry(
      () => processor(validatedData),
      {
        maxRetries: 2,
        initialDelay: 2000,
        retryOnError: (err) => {
          // Only retry on database connection errors
          const isRetryable = 
            err.code === 'ECONNREFUSED' || 
            err.code === '57P01' || // admin_shutdown
            err.code === '57P03' || // cannot_connect_now
            err.message.includes('timeout') ||
            err.message.includes('Connection terminated');
            
          return isRetryable;
        },
        onRetry: (error, attempt) => {
          logger.warn(`Message processing retry ${attempt}`, {
            error: error.message,
            trace_id: validatedData.trace_id,
            processor_type: validatedData.processor_type
          });
        }
      }
    );
    
    message.ack();

    // Track successful processing
    serviceState.successfulMessages = (serviceState.successfulMessages || 0) + 1;
    
    logger.info('Successfully processed message', {
      trace_id: validatedData.trace_id,
      processor_type: validatedData.processor_type,
      processing_time_ms: Date.now() - processingStart
    });
  } catch (error) {
    // Update error tracking
    serviceState.processingErrors++;
    serviceState.errors.push({
      time: new Date().toISOString(),
      message: error.message,
      type: 'message_processing'
    });
    
    logger.error('Failed to process message', {
      error: error.message,
      error_stack: error.stack,
      error_name: error.name,
      trace_id: data?.trace_id,
      message_id: message?.id,
      publish_time: message?.publishTime,
      processor_type: data?.processor_type,
      processing_time_ms: Date.now() - processingStart
    });
    
    try {
      await publishToDLQ(data || { raw_message: rawMessage }, error);
      message.nack(); // Changed from nack to ack to prevent immediate retries (PubSub will retry)
    } catch (dlqError) {
      logger.error('Critical error publishing to DLQ', {
        original_error: error.message,
        dlq_error: dlqError.message
      });
      message.nack();
    }
  }
}

/**
 * Sets up PubSub subscription event listeners
 */
async function setupSubscriptionListeners() {
  if (!subscription) {
    logger.warn('Cannot set up subscription listeners - subscription is not initialized');
    return false;
  }
  
  try {
    logger.info('Setting up PubSub subscription listeners', {
      subscription_name: subscription.name
    });
    
    // Remove any existing listeners to prevent duplicates
    subscription.removeAllListeners('message');
    subscription.removeAllListeners('error');
    
    // Set up message handler
    subscription.on('message', processMessage);
    
    // Set up error handler
    subscription.on('error', (error) => {
      logger.error('PubSub subscription error', {
        error: error.message,
        code: error.code,
        details: error.details,
        stack: error.stack
      });
      
      // Update service state
      serviceState.subscriptionActive = false;
      
      // Try to recover by reinitializing after a delay
      setTimeout(async () => {
        logger.info('Attempting to recover from PubSub subscription error');
        try {
          // Check if subscription still exists
          const [exists] = await subscription.exists();
          if (exists) {
            // Reinitialize subscription listeners
            const result = await setupSubscriptionListeners();
            if (result) {
              logger.info('Successfully recovered from PubSub subscription error');
              serviceState.subscriptionActive = true;
              return;
            }
          }
          
          // If we reach here, recovery failed
          logger.warn('Failed to recover from PubSub subscription error, will retry');
        } catch (recoverError) {
          logger.error('Error during PubSub subscription recovery', {
            error: recoverError.message,
            stack: recoverError.stack
          });
        }
      }, 30000); // Wait 30 seconds before retrying
    });
    
    logger.info('PubSub subscription listeners set up successfully');
    serviceState.subscriptionActive = true;
    return true;
  } catch (error) {
    logger.error('Failed to set up PubSub subscription listeners', {
      error: error.message,
      stack: error.stack
    });
    serviceState.subscriptionActive = false;
    return false;
  }
}

// Initialize all services with enhanced error handling
async function initializeServices() {
  logger.info('Initializing services for notification-worker', {
    environment: process.env.NODE_ENV,
    version: process.env.npm_package_version || 'unknown',
    pubsub_project: process.env.GOOGLE_CLOUD_PROJECT,
    pubsub_subscription: process.env.PUBSUB_SUBSCRIPTION,
    operating_mode: serviceState.operatingMode
  });

  // Test database connection first with timeout
  logger.info('Testing database connection');
  let dbConnected = false;
  
  try {
    const connectionResult = await Promise.race([
      db.testConnection(),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Database connection test timeout')), 15000)
      )
    ]);
    
    logger.info('Database connection successful', { result: connectionResult });
    dbConnected = true;
    serviceState.databaseActive = true;
  } catch (error) {
    logger.error('Database connection failed', {
      error: error.message,
      stack: error.stack
    });
    serviceState.databaseActive = false;
    
    // Retry database connection one more time after a delay
    logger.info('Retrying database connection after 5 second delay');
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    try {
      const retryResult = await Promise.race([
        db.testConnection(),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Database retry connection test timeout')), 15000)
        )
      ]);
      
      logger.info('Database retry connection successful', { result: retryResult });
      dbConnected = true;
      serviceState.databaseActive = true;
    } catch (retryError) {
      logger.error('Database retry connection failed, proceeding in limited mode', {
        error: retryError.message,
        stack: retryError.stack
      });
      serviceState.databaseActive = false;
    }
  }

  // Check subscription existence
  let subscriptionExists = false;
  try {
    if (!pubsub) {
      logger.info('Initializing PubSub client');
      pubsub = new PubSub({
        projectId: process.env.GOOGLE_CLOUD_PROJECT,
      });
    }

    logger.info('Verifying PubSub subscription existence', {
      subscription: process.env.PUBSUB_SUBSCRIPTION,
      project: process.env.GOOGLE_CLOUD_PROJECT
    });

    // Verify the subscription exists
    const [subscriptions] = await pubsub.getSubscriptions();
    const subscriptionNames = subscriptions.map(s => s.name);
    const fullSubscriptionName = `projects/${process.env.GOOGLE_CLOUD_PROJECT}/subscriptions/${process.env.PUBSUB_SUBSCRIPTION}`;
    
    subscriptionExists = subscriptionNames.includes(fullSubscriptionName);
    
    if (subscriptionExists) {
      logger.info('PubSub subscription exists', { subscription: process.env.PUBSUB_SUBSCRIPTION });
      
      // Initialize the subscription client
      subscription = pubsub.subscription(process.env.PUBSUB_SUBSCRIPTION);
      
      // Set up subscription listeners
      const listenersSetup = await setupSubscriptionListeners();
      
      if (listenersSetup) {
        logger.info('PubSub subscription listeners set up successfully');
        serviceState.pubsubActive = true;
      } else {
        logger.error('Failed to set up PubSub subscription listeners');
        serviceState.pubsubActive = false;
      }
    } else {
      logger.error('PubSub subscription does not exist', {
        subscription: process.env.PUBSUB_SUBSCRIPTION,
        available_subscriptions: subscriptionNames
      });
      serviceState.pubsubActive = false;
    }
  } catch (error) {
    logger.error('Error verifying PubSub subscription', {
      error: error.message,
      stack: error.stack
    });
    serviceState.pubsubActive = false;
  }

  // Pubsub client available but subscription not initialized
  if (!subscription) {
    logger.warn('PubSub subscription client not initialized');
    serviceState.subscriptionActive = false;
  }

  // Determine operating mode based on what's connected
  if (serviceState.databaseActive && serviceState.pubsubActive && serviceState.subscriptionActive) {
    serviceState.operatingMode = 'full';
    logger.info('Notification worker operating in FULL mode - all services connected');
  } else if (serviceState.databaseActive || (serviceState.pubsubActive && serviceState.subscriptionActive)) {
    serviceState.operatingMode = 'limited';
    logger.warn('Notification worker operating in LIMITED mode', {
      database_connected: serviceState.databaseActive,
      pubsub_connected: serviceState.pubsubActive,
      subscription_active: serviceState.subscriptionActive
    });
  } else {
    serviceState.operatingMode = 'minimal';
    logger.error('Notification worker operating in MINIMAL mode - only health endpoint available');
  }

  return serviceState;
}

process.on('SIGTERM', async () => {
  logger.info('Received SIGTERM signal, shutting down gracefully');
  if (subscription) subscription.close();
  server.close();
  process.exit(0);
});

// Start everything up
try {
  // Start the HTTP server immediately to handle health checks
  // even if other services fail to initialize
  await initializeServices();
  
  logger.info('Notification worker started', {
    mode: serviceState.databaseActive && serviceState.pubsubActive ? 'full' : 'limited',
    services_available: {
      database: serviceState.databaseActive,
      pubsub: serviceState.pubsubActive,
      subscription: serviceState.subscriptionActive
    },
    config: {
      subscription: process.env.PUBSUB_SUBSCRIPTION,
      project: process.env.GOOGLE_CLOUD_PROJECT,
      port: port
    }
  });
} catch (error) {
  logger.error('Errors during initialization, but health endpoint still available', {
    error: error.message,
    stack: error.stack
  });
}