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

// Modify the existing processMessage function
Subscription.prototype.processMessage = async function(message) {
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

// Safely set up subscription listeners
function setupSubscriptionListeners() {
  if (!subscription) {
    logger.warn('Cannot set up subscription listeners - subscription not initialized');
    return false;
  }

  try {
    // Check if subscription exists
    subscription.on('message', processMessage);

    subscription.on('error', (error) => {
      logger.error('Subscription error', {
        error: error.message,
        stack: error.stack,
        code: error.code,
        details: error.details,
        subscription: process.env.PUBSUB_SUBSCRIPTION,
        project: process.env.GOOGLE_CLOUD_PROJECT
      });
      
      // Update service state
      serviceState.subscriptionActive = false;
      serviceState.errors.push(`Subscription error: ${error.message}`);
    });
    
    return true;
  } catch (error) {
    logger.error('Failed to set up subscription listeners', {
      error: error.message,
      stack: error.stack
    });
    serviceState.errors.push(`Subscription setup: ${error.message}`);
    return false;
  }
}

// Initialize all services with enhanced error handling
async function initializeServices() {
  logger.info('Starting service initialization', {
    env: {
      GOOGLE_CLOUD_PROJECT: process.env.GOOGLE_CLOUD_PROJECT,
      PUBSUB_SUBSCRIPTION: process.env.PUBSUB_SUBSCRIPTION,
      DLQ_TOPIC: process.env.DLQ_TOPIC,
      NODE_ENV: process.env.NODE_ENV
    }
  });
  
  // First update state to show we're initializing but operational
  serviceState.operatingMode = 'initializing';
  
  // Test database connection with timeout and retry
  logger.info('Testing database connection');
  try {
    await Promise.race([
      db.testConnection(),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Database connection timeout during initialization')), 10000)
      )
    ]);
    logger.info('Database connection successful');
    serviceState.dbConnected = true;
    serviceState.databaseActive = true;
  } catch (error) {
    logger.error('Database connection failed, continuing in limited mode', {
      error: error.message,
      stack: error.stack
    });
    serviceState.errors.push(`Database connection: ${error.message}`);
    serviceState.dbConnected = false;
    serviceState.databaseActive = false;
  }
  
  // Test PubSub subscription existence
  if (subscription) {
    logger.info('Testing PubSub subscription existence', {
      subscription: process.env.PUBSUB_SUBSCRIPTION,
      project: process.env.GOOGLE_CLOUD_PROJECT
    });
    
    try {
      const [exists] = await subscription.exists();
      if (!exists) {
        throw new Error(`PubSub subscription '${process.env.PUBSUB_SUBSCRIPTION}' does not exist in project '${process.env.GOOGLE_CLOUD_PROJECT}'`);
      }
      
      logger.info('PubSub subscription verified', {
        subscription: process.env.PUBSUB_SUBSCRIPTION,
        project: process.env.GOOGLE_CLOUD_PROJECT
      });
      
      // Set up subscription listeners only if the subscription exists
      if (setupSubscriptionListeners()) {
        serviceState.pubsubConnected = true;
        serviceState.subscriptionActive = true;
        serviceState.pubsubActive = true;
      }
    } catch (error) {
      logger.error('PubSub subscription verification failed, continuing in limited mode', {
        error: error.message,
        stack: error.stack,
        subscription: process.env.PUBSUB_SUBSCRIPTION,
        project: process.env.GOOGLE_CLOUD_PROJECT
      });
      serviceState.errors.push(`PubSub verification: ${error.message}`);
      serviceState.pubsubConnected = false;
      serviceState.subscriptionActive = false;
      serviceState.pubsubActive = false;
    }
  } else {
    logger.warn('PubSub subscription client not initialized, skipping verification');
    serviceState.pubsubConnected = false;
    serviceState.subscriptionActive = false;
    serviceState.pubsubActive = false;
  }
  
  // Report final initialization status
  const services = [];
  if (serviceState.dbConnected) services.push('database');
  if (serviceState.pubsubConnected) services.push('pubsub');
  if (serviceState.subscriptionActive) services.push('subscription');
  
  if (services.length > 0) {
    logger.info(`Service initialized successfully with: ${services.join(', ')}`);
    serviceState.ready = true;
    
    if (services.includes('database') && services.includes('pubsub')) {
      serviceState.operatingMode = 'full';
    } else if (services.includes('pubsub')) {
      serviceState.operatingMode = 'limited';
    } else if (services.includes('database')) {
      serviceState.operatingMode = 'database-only';
    } else {
      serviceState.operatingMode = 'health-only';
    }
    
    return true;
  } else {
    logger.warn('Service running in minimal mode - only health endpoint available');
    serviceState.operatingMode = 'health-only';
    serviceState.ready = false; // Not fully ready, but health endpoint works
    return false;
  }
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
    mode: serviceState.dbConnected && serviceState.pubsubConnected ? 'full' : 'limited',
    services_available: {
      database: serviceState.dbConnected,
      pubsub: serviceState.pubsubConnected,
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