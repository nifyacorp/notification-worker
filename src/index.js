import { PubSub } from '@google-cloud/pubsub';
import { validateMessage } from './utils/validation.js';
import { processBOEMessage } from './processors/boe.js';
import { processRealEstateMessage } from './processors/real-estate.js';
import { logger } from './utils/logger.js';
import http from 'http';
import { db } from './database/client.js';

// Global service state
let serviceState = {
  dbConnected: false,
  pubsubConnected: false,
  subscriptionActive: false,
  errors: [],
  startTime: new Date().toISOString()
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
const server = http.createServer((req, res) => {
  // Simple health check that always returns 200 to keep the service warm
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'up',
      mode: serviceState.dbConnected && serviceState.pubsubConnected ? 'full' : 'limited',
      database: serviceState.dbConnected ? 'connected' : 'disconnected',
      pubsub: serviceState.pubsubConnected ? 'connected' : 'disconnected',
      subscription: serviceState.subscriptionActive ? 'active' : 'inactive',
      uptime: Math.floor((Date.now() - new Date(serviceState.startTime).getTime()) / 1000),
      errors: serviceState.errors.slice(-5) // Only show last 5 errors
    }));
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

const PROCESSOR_MAP = {
  'boe': processBOEMessage,
  'real-estate': processRealEstateMessage,
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

async function processMessage(message) {
  let data;
  let rawMessage;
  try {
    // Safely extract the message data
    try {
      rawMessage = message.data.toString();
      logger.debug('Received PubSub message', {
        messageId: message.id,
        publishTime: message.publishTime,
        attributes: message.attributes,
        data_length: rawMessage.length,
        subscription: process.env.PUBSUB_SUBSCRIPTION
      });
    } catch (extractError) {
      logger.error('Failed to extract message data', {
        error: extractError.message,
        message_id: message?.id
      });
      // Use empty object as fallback if message data can't be accessed
      rawMessage = "{}";
    }

    // Safely parse the message JSON
    try {
      data = JSON.parse(rawMessage);
    } catch (parseError) {
      logger.error('Failed to parse message JSON', {
        error: parseError.message,
        raw_data: rawMessage.substring(0, 200) + (rawMessage.length > 200 ? '...' : ''),
        message_id: message.id
      });
      throw parseError;
    }
    
    logger.debug('Parsed message data', {
      message_id: message.id,
      processor_type: data.processor_type,
      trace_id: data.trace_id,
      timestamp: data.timestamp
    });
    
    // Gracefully handle validation
    let validatedData;
    try {
      validatedData = validateMessage(data);
    } catch (validationError) {
      logger.error('Validation error, sending to DLQ', {
        error: validationError.message,
        processor_type: data.processor_type,
        trace_id: data.trace_id
      });
      await publishToDLQ(data, validationError);
      message.ack(); // Still ack the message to prevent redelivery of invalid message
      return;
    }
    
    const processor = PROCESSOR_MAP[validatedData.processor_type];
    if (!processor) {
      const error = new Error(`Unknown processor type: ${validatedData.processor_type}`);
      await publishToDLQ(validatedData, error);
      message.ack(); // Ack unknown processor type messages too
      logger.warn('Unknown processor type, message sent to DLQ', {
        processor_type: validatedData.processor_type,
        trace_id: validatedData.trace_id
      });
      return;
    }

    await processor(validatedData);
    message.ack();

    logger.info('Successfully processed message', {
      trace_id: validatedData.trace_id,
      processor_type: validatedData.processor_type
    });
  } catch (error) {
    logger.error('Failed to process message', {
      error: error.message,
      error_stack: error.stack,
      error_name: error.name,
      trace_id: data?.trace_id,
      message_id: message?.id,
      publish_time: message?.publishTime,
      processor_type: data?.processor_type
    });

    try {
      await publishToDLQ(data || { raw_message: rawMessage }, error);
      message.nack();
    } catch (dlqError) {
      logger.error('Critical error publishing to DLQ', {
        original_error: error.message,
        dlq_error: dlqError.message
      });
      // Still nack the message to prevent the worker from hanging
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
  
  // Test database connection with timeout and retry
  logger.info('Testing database connection');
  try {
    await Promise.race([
      db.testConnection(),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Database connection timeout')), 10000)
      )
    ]);
    logger.info('Database connection successful');
    serviceState.dbConnected = true;
  } catch (error) {
    logger.error('Database connection failed, continuing in limited mode', {
      error: error.message,
      stack: error.stack
    });
    serviceState.errors.push(`Database connection: ${error.message}`);
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
      }
    } catch (error) {
      logger.error('PubSub subscription verification failed, continuing in limited mode', {
        error: error.message,
        stack: error.stack,
        subscription: process.env.PUBSUB_SUBSCRIPTION,
        project: process.env.GOOGLE_CLOUD_PROJECT
      });
      serviceState.errors.push(`PubSub verification: ${error.message}`);
    }
  }
  
  // Report final initialization status
  const services = [];
  if (serviceState.dbConnected) services.push('database');
  if (serviceState.pubsubConnected) services.push('pubsub');
  if (serviceState.subscriptionActive) services.push('subscription');
  
  if (services.length > 0) {
    logger.info(`Service initialized successfully with: ${services.join(', ')}`);
    return true;
  } else {
    logger.warn('Service running in limited mode - only health endpoint available');
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