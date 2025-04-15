import { logger } from '../utils/logger.js';
import { processMessage as parseMessage } from '../services/parser.js';

/**
 * Unified message processor that handles messages of any format
 * @param {Object} message - The PubSub message data
 * @returns {Promise<Object>} - Notification creation stats
 */
export async function processMessage(message) {
  const traceId = message.trace_id || 'unknown';
  const processorType = message.processor_type || message.source || 'unknown';
  
  logger.info('Processing message', {
    trace_id: traceId,
    processor_type: processorType,
    has_request: !!message.request,
    has_results: !!message.results
  });
  
  try {
    // Use the unified parser service to process the message
    const result = await parseMessage(message);
    
    logger.info('Message processing completed', {
      trace_id: traceId,
      processor_type: processorType,
      notifications_created: result.created,
      errors: result.errors
    });
    
    return result;
  } catch (error) {
    logger.error('Failed to process message', {
      error: error.message,
      stack: error.stack,
      trace_id: traceId,
      processor_type: processorType
    });
    throw error;
  }
} 