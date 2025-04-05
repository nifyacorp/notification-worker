import { v4 as uuidv4 } from 'uuid';
import { logger } from '../../utils/logger.js';
import { publishToDLQ } from './client.js';
import { withRetry } from '../../utils/retry.js';
import { processBOEMessage } from '../../processors/boe.js';
import { processRealEstateMessage } from '../../processors/real-estate.js';
import { validateMessage } from '../../utils/validation.js';
import { database } from '../database.js';

// Define the processor map to indicate which processors require database access
const PROCESSOR_MAP = {
  'boe': Object.assign(processBOEMessage, { requiresDatabase: true }),
  'real-estate': Object.assign(processRealEstateMessage, { requiresDatabase: true }),
};

// Tracking metrics
export const processorMetrics = {
  messageCount: 0,
  successfulMessages: 0,
  validationErrors: 0,
  unknownProcessorErrors: 0,
  dbUnavailableErrors: 0,
  processingErrors: 0,
  lastActivity: new Date().toISOString()
};

/**
 * Processes a PubSub message
 * @param {Object} message - The PubSub message
 * @param {Function} onDatabaseUnavailable - Callback for database unavailability
 * @returns {Promise<void>}
 */
export async function processMessage(message, onDatabaseUnavailable) {
  const rawMessage = message.data.toString();
  let data;
  
  // Track processing start time
  const processingStart = Date.now();
  processorMetrics.messageCount++;
  processorMetrics.lastActivity = new Date().toISOString();
  
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
    
    // Validate message data with enhanced validation
    const validation = await validateMessage(data);
    
    // If validation has warnings but data is still usable, log the warnings
    if (!validation.valid) {
      logger.warn('Message validation warnings', {
        processor_type: validation.processorType,
        trace_id: data.trace_id,
        errors: validation.errors
      });
      
      // Increment validation error counter
      processorMetrics.validationErrors++;
    }
    
    // Use the validated/sanitized data
    const validatedData = validation.data;
    
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
      
      // Increment unknown processor counter
      processorMetrics.unknownProcessorErrors++;
      
      return;
    }
    
    // Check database connection for processors that need it
    if (processor.requiresDatabase) {
      const connectionState = database.getConnectionState();
      if (!connectionState.isConnected) {
        logger.warn('Database connection not established, attempting to connect', {
          processor_type: validatedData.processor_type,
          connection_state: connectionState
        });
        
        try {
          // Retry database connection with backoff
          await withRetry(
            () => database.testConnection(), 
            {
              name: 'database.testConnection',
              maxRetries: 3,
              initialDelay: 1000,
              onRetry: (error, attempt) => {
                logger.info(`Database connection retry ${attempt}`, {
                  error: error.message,
                  trace_id: validatedData.trace_id
                });
              },
              context: {
                trace_id: validatedData.trace_id
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
          processorMetrics.dbUnavailableErrors++;
          
          // Notify about database unavailability
          if (onDatabaseUnavailable) {
            onDatabaseUnavailable(dbError);
          }
          
          return;
        }
      }
    }

    // Process the message with retries for transient errors
    await withRetry(
      () => processor(validatedData),
      {
        name: `process${validatedData.processor_type}Message`,
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
            trace_id: validatedData.trace_id,
            processor_type: validatedData.processor_type
          });
        },
        context: {
          trace_id: validatedData.trace_id,
          processor_type: validatedData.processor_type
        }
      }
    );
    
    message.ack();

    // Track successful processing
    processorMetrics.successfulMessages++;
    
    logger.info('Successfully processed message', {
      trace_id: validatedData.trace_id,
      processor_type: validatedData.processor_type,
      processing_time_ms: Date.now() - processingStart
    });
  } catch (error) {
    // Update error tracking
    processorMetrics.processingErrors++;
    
    logger.error('Failed to process message', {
      error: error.message,
      stack: error.stack,
      error_name: error.name,
      trace_id: data?.trace_id,
      message_id: message?.id,
      publish_time: message?.publishTime,
      processor_type: data?.processor_type,
      processing_time_ms: Date.now() - processingStart
    });
    
    try {
      await publishToDLQ(data || { raw_message: rawMessage }, error);
      message.ack(); // Changed to ack to prevent immediate retries
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
    logger.info('Setting up PubSub subscription listeners', {
      subscription_name: subscription.name
    });
    
    // Remove any existing listeners to prevent duplicates
    subscription.removeAllListeners('message');
    subscription.removeAllListeners('error');
    
    // Set up message handler
    subscription.on('message', (message) => processMessage(message, () => {
      // Database unavailable callback
    }));
    
    // Set up error handler
    subscription.on('error', (error) => {
      logger.error('PubSub subscription error', {
        error: error.message,
        code: error.code,
        details: error.details,
        stack: error.stack
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