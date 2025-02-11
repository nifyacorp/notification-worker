import { PubSub } from '@google-cloud/pubsub';
import { validateMessage } from './utils/validation.js';
import { processBOEMessage } from './processors/boe.js';
import { processRealEstateMessage } from './processors/real-estate.js';
import { logger } from './utils/logger.js';

const pubsub = new PubSub({
  projectId: process.env.GOOGLE_CLOUD_PROJECT,
});

const subscription = pubsub.subscription(process.env.PUBSUB_SUBSCRIPTION);
const dlqTopic = pubsub.topic(process.env.DLQ_TOPIC);

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
  logger.error('Subscription error', { error });
});

process.on('SIGTERM', async () => {
  logger.info('Received SIGTERM signal, shutting down gracefully');
  subscription.close();
  process.exit(0);
});

logger.info('Notification worker started', {
  subscription: process.env.PUBSUB_SUBSCRIPTION,
  project: process.env.GOOGLE_CLOUD_PROJECT
});