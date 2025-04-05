import http from 'http';
import { logger } from './utils/logger.js';
import { config, logConfig } from './config/index.js';
import { database } from './services/database.js';
import { initializePubSub, pubsubState } from './services/pubsub/client.js';
import { setupSubscriptionListeners } from './services/pubsub/processor.js';
import { serviceStatus } from './services/status.js';
import { routeRequest } from './routes/index.js';

// Log configuration on startup
logConfig();

// Create HTTP server for Cloud Run health checks and API endpoints
export const server = http.createServer((req, res) => {
  routeRequest(req, res);
});

// Handle graceful shutdown
process.on('SIGTERM', async () => {
  logger.info('Received SIGTERM signal, shutting down gracefully');
  
  // Close HTTP server first (stop accepting new requests)
  server.close(() => {
    logger.info('HTTP server closed');
  });
  
  // Close PubSub subscription if active
  if (global.subscription) {
    global.subscription.removeAllListeners();
    global.subscription.close();
    logger.info('PubSub subscription closed');
  }
  
  // Close database connections
  try {
    await database.end();
    logger.info('Database connections closed');
  } catch (error) {
    logger.error('Error closing database connections', {
      error: error.message
    });
  }
  
  // Exit process
  process.exit(0);
});

/**
 * Initialize all services
 * @returns {Promise<void>}
 */
async function initializeServices() {
  logger.info('Initializing services for notification-worker', {
    environment: config.environment,
    pubsub_project: config.projectId,
    pubsub_subscription: config.pubsubSubscription
  });

  // Test database connection first
  logger.info('Testing database connection');
  try {
    await database.testConnection();
    logger.info('Database connection successful');
    serviceStatus.databaseActive = true;
  } catch (error) {
    logger.error('Database connection failed', {
      error: error.message,
      stack: error.stack
    });
    serviceStatus.databaseActive = false;
    serviceStatus.addError('database', error.message);
    
    // Retry database connection after a delay
    logger.info('Retrying database connection after 5 second delay');
    setTimeout(async () => {
      try {
        await database.testConnection();
        logger.info('Database retry connection successful');
        serviceStatus.databaseActive = true;
        serviceStatus.updateOperatingMode();
      } catch (retryError) {
        logger.error('Database retry connection failed, continuing in limited mode', {
          error: retryError.message
        });
      }
    }, 5000);
  }

  // Initialize PubSub
  try {
    const { subscription, dlqTopic } = await initializePubSub();
    
    // Store resources in global for shutdown
    global.subscription = subscription;
    global.dlqTopic = dlqTopic;
    
    logger.info('PubSub resources initialized successfully');
    serviceStatus.pubsubActive = true;
    
    // Set up subscription listeners
    const listenersSetup = await setupSubscriptionListeners(subscription, (error) => {
      // Subscription error callback
      serviceStatus.subscriptionActive = false;
      serviceStatus.addError('pubsub', error.message);
      serviceStatus.updateOperatingMode();
      
      // Try to recover by reinitializing after a delay
      setTimeout(async () => {
        try {
          const { subscription } = await initializePubSub();
          global.subscription = subscription;
          
          const result = await setupSubscriptionListeners(subscription);
          if (result) {
            logger.info('Successfully recovered from PubSub subscription error');
            serviceStatus.subscriptionActive = true;
            serviceStatus.updateOperatingMode();
          }
        } catch (recoveryError) {
          logger.error('Failed to recover from PubSub subscription error', {
            error: recoveryError.message
          });
        }
      }, 30000);
    });
    
    if (listenersSetup) {
      logger.info('PubSub subscription listeners set up successfully');
      serviceStatus.subscriptionActive = true;
    } else {
      logger.error('Failed to set up PubSub subscription listeners');
      serviceStatus.subscriptionActive = false;
      serviceStatus.addError('pubsub', 'Failed to set up subscription listeners');
    }
  } catch (error) {
    logger.error('Failed to initialize PubSub resources', {
      error: error.message,
      stack: error.stack
    });
    serviceStatus.pubsubActive = false;
    serviceStatus.subscriptionActive = false;
    serviceStatus.addError('pubsub', error.message);
  }

  // Update overall service status
  serviceStatus.updateOperatingMode();
}

// Start the service
async function startService() {
  // Start the HTTP server first to handle health checks
  const port = config.port;
  server.listen(port, () => {
    logger.info(`HTTP server listening on port ${port}`);
  });
  
  // Initialize services
  try {
    await initializeServices();
    
    logger.info('Notification worker started', {
      mode: serviceStatus.operatingMode,
      services_available: {
        database: serviceStatus.databaseActive,
        pubsub: serviceStatus.pubsubActive,
        subscription: serviceStatus.subscriptionActive
      },
      config: {
        subscription: config.pubsubSubscription,
        project: config.projectId,
        port: port
      }
    });
  } catch (error) {
    logger.error('Errors during initialization, but health endpoint still available', {
      error: error.message,
      stack: error.stack
    });
    serviceStatus.addError('initialization', error.message);
    serviceStatus.updateOperatingMode();
  }
}

// Start the service
startService();