import { v4 as uuidv4 } from 'uuid';
import { logger } from '../../utils/logger.js';
import { publishToDLQ } from './client.js';
import { withRetry } from '../../utils/retry.js';
// Import the new unified parser service
import { processMessage as processParserMessage } from '../parser.js';

// Tracking metrics
export const processorMetrics = {
  messageCount: 0,
  successfulMessages: 0,
  validationErrors: 0,
  processingErrors: 0,
  lastActivity: new Date().toISOString()
};

/**
 * Processes a PubSub message
 * @param {Object} message - The PubSub message
 * @returns {Promise<void>}
 */
export async function processMessage(message) {
  const rawMessage = message.data.toString();
  let messageData;
  
  // Track processing start time
  const processingStart = Date.now();
  processorMetrics.messageCount++;
  processorMetrics.lastActivity = new Date().toISOString();
  
  try {
    // Parse message data
    try {
      messageData = JSON.parse(rawMessage);
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
    if (!messageData.trace_id) {
      messageData.trace_id = uuidv4();
      logger.info('Generated missing trace ID', { trace_id: messageData.trace_id });
    }
    
    // Basic validation of required fields - more detailed validation in parser
    if (!messageData.request) {
      logger.error('Missing request object in message', {
        message_id: message.id,
        trace_id: messageData.trace_id || 'unknown'
      });
      
      await publishToDLQ(messageData, new Error('Missing request object'));
      message.ack();
      return;
    }
    
    // Process message with the unified parser service
    await withRetry(
      () => processParserMessage(messageData),
      {
        name: 'processParserMessage',
        maxRetries: 2,
        initialDelay: 2000,
        // Only retry on connection errors
        retryOnError: (err) => {
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
            trace_id: messageData.trace_id
          });
        },
        context: {
          trace_id: messageData.trace_id
        }
      }
    );
    
    // Acknowledge the message
    message.ack();
    processorMetrics.successfulMessages++;
    
    logger.info('Successfully processed message', {
      trace_id: messageData.trace_id,
      subscription_id: messageData.request?.subscription_id,
      user_id: messageData.request?.user_id,
      processing_time_ms: Date.now() - processingStart
    });
  } catch (error) {
    // Update error tracking
    processorMetrics.processingErrors++;
    
    logger.error('Failed to process message', {
      error: error.message,
      stack: error.stack,
      trace_id: messageData?.trace_id,
      message_id: message?.id,
      publish_time: message?.publishTime,
      processing_time_ms: Date.now() - processingStart
    });
    
    try {
      await publishToDLQ(messageData || { raw_message: rawMessage }, error);
      message.ack(); // Ack to prevent immediate retries
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
 * @param {Object} subscription - The PubSub subscription
 * @param {Function} onError - Error callback
 * @returns {Promise<boolean>} - Whether setup was successful
 */
export async function setupSubscriptionListeners(subscription, onError) {
  if (!subscription) {
    logger.warn('Cannot set up subscription listeners - subscription is not initialized');
    return false;
  }
  
  try {
    logger.info('Setting up PubSub subscription listeners');
    
    // Remove any existing listeners to prevent duplicates
    subscription.removeAllListeners('message');
    subscription.removeAllListeners('error');
    
    // Set up message handler with the unified processor
    subscription.on('message', processMessage);
    
    // Set up error handler
    subscription.on('error', (error) => {
      logger.error('PubSub subscription error', {
        error: error.message,
        code: error.code,
        details: error.details
      });
      
      if (onError) {
        onError(error);
      }
    });
    
    logger.info('PubSub subscription listeners set up successfully');
    return true;
  } catch (error) {
    logger.error('Failed to set up PubSub subscription listeners', {
      error: error.message,
      stack: error.stack
    });
    return false;
  }
}