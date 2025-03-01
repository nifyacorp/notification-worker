import { PubSub } from '@google-cloud/pubsub';
import { validateMessage } from './utils/validation.js';
import { processBOEMessage } from './processors/boe.js';
import { processRealEstateMessage } from './processors/real-estate.js';
import { logger } from './utils/logger.js';
import http from 'http';
import { db, connectionState, query } from './database/client.js';
import { v4 as uuidv4 } from 'uuid';
import { createNotification, createNotifications } from './services/notification.js';
import url from 'url';

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

// Create HTTP server for Cloud Run health checks
const server = http.createServer(async (req, res) => {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  // Handle preflight requests
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // Parse the URL to get the path
  const parsedUrl = url.parse(req.url, true);
  const path = parsedUrl.pathname;
  
  // Basic health check endpoint
  if (path === '/health') {
    const memoryUsage = process.memoryUsage();
    
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'OK',
      service: 'notification-worker',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      memory: {
        rss: `${Math.round(memoryUsage.rss / 1024 / 1024)} MB`,
        heapTotal: `${Math.round(memoryUsage.heapTotal / 1024 / 1024)} MB`,
        heapUsed: `${Math.round(memoryUsage.heapUsed / 1024 / 1024)} MB`
      },
      database: {
        connected: connectionState.isConnected,
        lastConnectAttempt: connectionState.lastConnectAttempt,
        failedAttempts: connectionState.failedAttempts
      }
    }));
    return;
  }
  
  // Database diagnostics endpoint
  if (path === '/diagnostics/database') {
    try {
      // Parse query parameters
      const queryParams = parsedUrl.query;
      const userId = queryParams.userId || '8bf705b5-2423-4257-92bd-ab0df1ee3218'; // Default test user ID
      
      // Check database connection
      const dbConnectionStatus = {
        isConnected: connectionState.isConnected,
        lastConnectAttempt: connectionState.lastConnectAttempt,
        failedAttempts: connectionState.failedAttempts,
        connectionHistory: connectionState.connectionHistory?.slice(-5) || [] // Last 5 connection events
      };
      
      // Diagnostic queries
      let notificationCount = null;
      let databaseRole = null;
      let testNotificationResult = null;
      let rlsPolicies = null;
      let rlsEnabled = null;
      let appUserIdSetting = null;
      
      // Only run these if we're connected
      if (connectionState.isConnected) {
        try {
          // Check current database role
          const roleResult = await query('SELECT current_user, current_database()');
          databaseRole = roleResult.rows[0];
          
          // Check if RLS is enabled on notifications table
          const rlsResult = await query(`
            SELECT relname, relrowsecurity 
            FROM pg_class 
            WHERE relname = 'notifications'
          `);
          rlsEnabled = rlsResult.rows[0]?.relrowsecurity === true;
          
          // Get RLS policies on notifications table
          const policiesResult = await query(`
            SELECT * FROM pg_policies 
            WHERE tablename = 'notifications'
          `);
          rlsPolicies = policiesResult.rows;
          
          // Check app.current_user_id setting
          try {
            const settingResult = await query(`SELECT current_setting('app.current_user_id', TRUE) as app_user_id`);
            appUserIdSetting = settingResult.rows[0]?.app_user_id;
          } catch (settingError) {
            appUserIdSetting = null;
          }
          
          // Try to set the user ID for RLS
          try {
            await query('SET LOCAL app.current_user_id = $1', [userId]);
            logger.info('Set app.current_user_id for RLS', { userId });
          } catch (setError) {
            logger.warn('Failed to set app.current_user_id', { error: setError.message });
          }
          
          // Try to count notifications for user
          const countResult = await query('SELECT COUNT(*) FROM notifications WHERE user_id = $1', [userId]);
          notificationCount = parseInt(countResult.rows[0].count, 10);
          
          // Try to create a test notification
          const testNotification = {
            user_id: userId,
            subscription_id: '00000000-0000-0000-0000-000000000000', // Test subscription ID
            title: 'Database Diagnostic Test',
            content: 'This is a test notification from the diagnostics endpoint',
            source_url: '',
            metadata: JSON.stringify({
              diagnostic: true,
              timestamp: new Date().toISOString(),
              source: 'diagnostics-endpoint'
            })
          };
          
          try {
            // Direct database insertion to test database access
            const insertResult = await query(
              `INSERT INTO notifications (
                user_id, subscription_id, title, content, source_url, metadata, created_at
              ) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
              [
                testNotification.user_id,
                testNotification.subscription_id,
                testNotification.title,
                testNotification.content,
                testNotification.source_url,
                testNotification.metadata,
                new Date()
              ]
            );
            
            testNotificationResult = {
              success: true,
              notification_id: insertResult.rows[0].id
            };
            
            // Try to read back the notification we just created to test RLS
            const readBackResult = await query(
              `SELECT * FROM notifications WHERE id = $1`,
              [insertResult.rows[0].id]
            );
            
            testNotificationResult.read_back_success = readBackResult.rowCount > 0;
            testNotificationResult.read_back_count = readBackResult.rowCount;
            
          } catch (insertError) {
            testNotificationResult = {
              success: false,
              error: insertError.message,
              code: insertError.code
            };
          }
        } catch (queryError) {
          console.error('Diagnostic query error:', queryError);
        }
      }
      
      // Get environment variables (redact sensitive values)
      const envVars = {};
      for (const [key, value] of Object.entries(process.env)) {
        // Redact sensitive values
        if (key.includes('PASSWORD') || key.includes('KEY') || key.includes('SECRET')) {
          envVars[key] = '[REDACTED]';
        } else {
          envVars[key] = value;
        }
      }
      
      // Send diagnostics response
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        timestamp: new Date().toISOString(),
        service: 'notification-worker',
        database: dbConnectionStatus,
        diagnostics: {
          user_id: userId,
          notification_count: notificationCount,
          database_role: databaseRole,
          rls_enabled: rlsEnabled,
          rls_policies: rlsPolicies,
          app_user_id_setting: appUserIdSetting,
          test_notification: testNotificationResult
        },
        environment: envVars
      }, null, 2));
    } catch (error) {
      console.error('Diagnostics endpoint error:', error);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        error: 'Diagnostics failed',
        message: error.message,
        stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
      }));
    }
    return;
  }
  
  // Add endpoint to test notification creation through the service
  if (path === '/diagnostics/create-notification' && req.method === 'POST') {
    try {
      // Read request body
      let body = '';
      req.on('data', chunk => {
        body += chunk.toString();
      });
      
      req.on('end', async () => {
        try {
          const data = JSON.parse(body);
          const { userId, title, content, subscriptionId } = data;
          
          if (!userId || !subscriptionId) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              error: 'Missing required fields',
              message: 'userId and subscriptionId are required'
            }));
            return;
          }
          
          // Create test notification using the service with RLS context
          const testNotificationData = {
            userId,
            subscriptionId,
            title: title || 'Service Diagnostic Test',
            content: content || 'This is a test notification created via the service layer',
            sourceUrl: '',
            metadata: {
              diagnostic: true,
              source: 'diagnostics-service-endpoint',
              timestamp: new Date().toISOString()
            }
          };
          
          // Use the notification service to create the notification with RLS context
          const result = await createNotification(testNotificationData);
          
          // Try to read back the notification to verify RLS is working
          let readBackResult = null;
          try {
            const readResult = await db.withRLSContext(userId, async (client) => {
              return client.query('SELECT * FROM notifications WHERE id = $1', [result.id]);
            });
            
            if (readResult.rowCount > 0) {
              readBackResult = {
                success: true,
                notification_id: readResult.rows[0].id,
                title: readResult.rows[0].title,
                created_at: readResult.rows[0].created_at
              };
            } else {
              readBackResult = {
                success: false,
                message: 'Notification created but could not be read back with RLS context'
              };
            }
          } catch (readError) {
            readBackResult = {
              success: false,
              error: readError.message
            };
          }
          
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            success: true,
            notification: result,
            read_back_test: readBackResult,
            timestamp: new Date().toISOString()
          }));
        } catch (parseError) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            error: 'Invalid request body',
            message: parseError.message
          }));
        }
      });
    } catch (error) {
      console.error('Create notification diagnostics error:', error);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        error: 'Failed to create test notification',
        message: error.message
      }));
    }
    return;
  }
  
  // Default response for unknown routes
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    error: 'Not Found',
    message: `Route ${path} not found`
  }));
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
        connection_state: connectionState.isConnected
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