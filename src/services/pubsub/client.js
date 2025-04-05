import { PubSub } from '@google-cloud/pubsub';
import { logger } from '../../utils/logger.js';
import { config } from '../../config/index.js';
import { withRetry } from '../../utils/retry.js';

// Initialize PubSub client
const pubsub = new PubSub({
  projectId: config.projectId,
  maxMessages: 1 // Process one message at a time for better debugging
});

// Track PubSub state
export const pubsubState = {
  isConnected: false,
  subscriptionActive: false,
  lastErrorTime: null,
  lastErrorMessage: null,
  lastSuccessTime: null
};

/**
 * Initialize PubSub resources
 * @returns {Promise<{subscription: object, dlqTopic: object}>}
 */
export async function initializePubSub() {
  try {
    logger.info('Initializing PubSub resources', {
      projectId: config.projectId,
      subscription: config.pubsubSubscription,
      dlqTopic: config.dlqTopic
    });

    // Initialize subscription and DLQ topic
    const subscription = pubsub.subscription(config.pubsubSubscription);
    const dlqTopic = pubsub.topic(config.dlqTopic);
    
    // Verify the subscription exists
    const [exists] = await subscription.exists();
    if (!exists) {
      throw new Error(`Subscription ${config.pubsubSubscription} does not exist`);
    }
    
    // Update state
    pubsubState.isConnected = true;
    pubsubState.lastSuccessTime = new Date().toISOString();
    pubsubState.lastErrorMessage = null;
    
    return { subscription, dlqTopic };
  } catch (error) {
    pubsubState.isConnected = false;
    pubsubState.lastErrorTime = new Date().toISOString();
    pubsubState.lastErrorMessage = error.message;
    
    logger.error('Failed to initialize PubSub resources', {
      error: error.message,
      stack: error.stack
    });
    
    throw error;
  }
}

/**
 * Publishes a message to the DLQ topic
 * @param {Object} originalMessage - The original message that failed
 * @param {Error} error - The error that caused the failure
 * @returns {Promise<string>} - The message ID
 */
export async function publishToDLQ(originalMessage, error) {
  return withRetry(
    async () => {
      const dlqTopic = pubsub.topic(config.dlqTopic);
      
      const messageData = {
        original_message: originalMessage,
        error: error.message,
        stack: error.stack,
        timestamp: new Date().toISOString(),
      };

      const messageId = await dlqTopic.publish(Buffer.from(JSON.stringify(messageData)));
      
      logger.info('Message published to DLQ', {
        trace_id: originalMessage.trace_id,
        error: error.message,
        message_id: messageId
      });
      
      return messageId;
    },
    {
      name: 'publishToDLQ',
      maxRetries: 2,
      initialDelay: 1000,
      context: {
        trace_id: originalMessage.trace_id,
        error_message: error.message
      }
    }
  );
}

/**
 * Publishes a message to a topic
 * @param {string} topicName - Name of the topic
 * @param {Object} message - Message to publish
 * @returns {Promise<string>} - The message ID
 */
export async function publishToTopic(topicName, message) {
  return withRetry(
    async () => {
      const topic = pubsub.topic(topicName);
      const messageBuffer = Buffer.from(JSON.stringify(message));
      
      const messageId = await topic.publish(messageBuffer);
      
      logger.info(`Published message to ${topicName}`, {
        message_id: messageId,
        topic: topicName
      });
      
      return messageId;
    },
    {
      name: `publishTo${topicName}`,
      maxRetries: 2,
      initialDelay: 1000,
      context: {
        topic: topicName
      }
    }
  );
}

/**
 * Get the email topics for notifications
 * @returns {Object} - The email topics
 */
export function getEmailTopics() {
  return {
    immediate: pubsub.topic(config.emailImmediateTopic),
    daily: pubsub.topic(config.emailDailyTopic)
  };
}

export default pubsub;