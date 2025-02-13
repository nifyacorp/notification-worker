import { PubSub } from '@google-cloud/pubsub';
import { validateMessage } from './utils/validation.js';
import { processBOEMessage } from './processors/boe.js';
import { processRealEstateMessage } from './processors/real-estate.js';
import { logger } from './utils/logger.js';
import http from 'http';

logger.info('Initializing PubSub client', {
  project: process.env.GOOGLE_CLOUD_PROJECT
});

const pubsub = new PubSub({
  projectId: process.env.GOOGLE_CLOUD_PROJECT,
});

// Create HTTP server for Cloud Run health checks
const server = http.createServer((req, res) => {
  res.writeHead(200);
  res.end('OK');
});

const port = process.env.PORT || 8080;
server.listen(port, () => {
  logger.info(`HTTP server listening on port ${port}`);
});

const subscription = pubsub.subscription(process.env.PUBSUB_SUBSCRIPTION);
const dlqTopic = pubsub.topic(process.env.DLQ_TOPIC);

logger.info('PubSub configuration', {
  subscription: process.env.PUBSUB_SUBSCRIPTION,
  dlq_topic: process.env.DLQ_TOPIC
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
  try {
    const data = JSON.parse(message.data.toString());
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
      trace_id: data?.trace_id
    });

    await publishToDLQ(data, error);
    message.nack();
  }
}

subscription.on('message', processMessage);

subscription.on('error', (error) => {
  logger.error('Subscription error', {
    error: error.message,
    code: error.code,
    details: error.details,
    subscription: process.env.PUBSUB_SUBSCRIPTION,
    project: process.env.GOOGLE_CLOUD_PROJECT
  });
});

// Initialize all services
async function initializeServices() {
  try {
    // Test database connection
    await db.testConnection();
    
    // Test PubSub subscription existence
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
      component: error.message.includes('PubSub') ? 'pubsub' : 'database',
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
    subscription: process.env.PUBSUB_SUBSCRIPTION,
    project: process.env.GOOGLE_CLOUD_PROJECT,
    port: port
  });
} catch (error) {
  logger.error('Failed to start notification worker', { error });
  process.exit(1);
}