import { PubSub } from '@google-cloud/pubsub';
import { validateMessage } from './utils/validation.js';
import { processBOEMessage } from './processors/boe.js';
import { processRealEstateMessage } from './processors/real-estate.js';
import { logger } from './utils/logger.js';
import http from 'http';
import { db } from './database/client.js';

// Initialize PubSub client
const pubsub = new PubSub({
  projectId: process.env.GOOGLE_CLOUD_PROJECT,
  maxMessages: 1 // Process one message at a time for better debugging
});

// Initialize subscription and DLQ topic
const subscription = pubsub.subscription(process.env.PUBSUB_SUBSCRIPTION);
const dlqTopic = pubsub.topic(process.env.DLQ_TOPIC);

// Create HTTP server for Cloud Run health checks
const server = http.createServer((req, res) => {
  res.writeHead(200);
  res.end('OK');
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
  try {
    const rawMessage = message.data.toString();
    logger.debug('Received PubSub message', {
      messageId: message.id,
      publishTime: message.publishTime,
      attributes: message.attributes,
      raw_data: rawMessage,
      data_length: rawMessage.length,
      subscription: process.env.PUBSUB_SUBSCRIPTION
    });

    try {
      data = JSON.parse(rawMessage);
    } catch (parseError) {
      logger.error('Failed to parse message JSON', {
        error: parseError.message,
        raw_data: rawMessage,
        message_id: message.id
      });
      throw parseError;
    }
    
    logger.debug('Parsed message data', {
      message_id: message.id,
      processor_type: data.processor_type,
      trace_id: data.trace_id,
      timestamp: data.timestamp,
      request: data.request,
      metadata: data.metadata
    });
    
    const validatedData = validateMessage(data);
    
    const processor = PROCESSOR_MAP[validatedData.processor_type];
    if (!processor) {
      throw new Error(`Unknown processor type: ${validatedData.processor_type}`);
    }

    await processor(validatedData);
    message.ack();

    logger.info('Successfully processed message', {
      trace_id: validatedData.trace_id,
      processor_type: validatedData.processor_type
    });
  } catch (error) {
    logger.error('Failed to process message', {
      error,
      error_stack: error.stack,
      error_name: error.name,
      trace_id: data?.trace_id,
      raw_message: rawMessage,
      message_id: message.id,
      publish_time: message.publishTime,
      processor_type: data?.processor_type
    });

    await publishToDLQ(data || { raw_message: message.data.toString() }, error);
    message.nack();
  }
}

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
});

// Initialize all services
async function initializeServices() {
  try {
    logger.info('Starting service initialization', {
      env: {
        GOOGLE_CLOUD_PROJECT: process.env.GOOGLE_CLOUD_PROJECT,
        PUBSUB_SUBSCRIPTION: process.env.PUBSUB_SUBSCRIPTION,
        DLQ_TOPIC: process.env.DLQ_TOPIC,
        NODE_ENV: process.env.NODE_ENV
      }
    });
    
    // Test database connection
    logger.info('Testing database connection');
    await db.testConnection();
    logger.info('Database connection successful');
    
    // Test PubSub subscription existence
    logger.info('Testing PubSub subscription existence', {
      subscription: process.env.PUBSUB_SUBSCRIPTION,
      project: process.env.GOOGLE_CLOUD_PROJECT
    });
    
    const [exists] = await subscription.exists();
    if (!exists) {
      throw new Error(`PubSub subscription '${process.env.PUBSUB_SUBSCRIPTION}' does not exist in project '${process.env.GOOGLE_CLOUD_PROJECT}'`);
    }
    
    logger.info('PubSub subscription verified', {
      subscription: process.env.PUBSUB_SUBSCRIPTION,
      project: process.env.GOOGLE_CLOUD_PROJECT
    });
    
    return true;
  } catch (error) {
    logger.error('Service initialization failed', {
      error: error.message,
      code: error.code,
      stack: error.stack,
      component: error.message?.includes('PubSub') ? 'pubsub' : 'database',
      subscription: process.env.PUBSUB_SUBSCRIPTION,
      project: process.env.GOOGLE_CLOUD_PROJECT
    });
    throw error;
  }
}

process.on('SIGTERM', async () => {
  logger.info('Received SIGTERM signal, shutting down gracefully');
  subscription.close();
  server.close();
  process.exit(0);
});

// Start everything up
try {
  await initializeServices();
  
  logger.info('Notification worker started successfully', {
    config: {
      subscription: process.env.PUBSUB_SUBSCRIPTION,
      project: process.env.GOOGLE_CLOUD_PROJECT,
      port: port
    }
  });
} catch (error) {
  logger.error('Failed to start notification worker', {
    error: error.message,
    stack: error.stack,
    code: error.code
  });
  process.exit(1);
}