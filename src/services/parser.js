import { logger } from '../utils/logger.js';
import { v4 as uuidv4 } from 'uuid';
import { MessageSchema } from '../types/parser.js';
import { createNotification } from './notification.js';
import { database } from './database.js';
import { validateBoeParserMessage } from '../utils/schemas/pubsubMessages.js';

/**
 * Validates and processes a PubSub message from any source
 * @param {Object} message - The parsed message data
 * @returns {Promise<Object>} - Stats about created notifications
 */
export async function processMessage(message) {
  // Generate trace ID if not present
  const traceId = message.trace_id || uuidv4();
  
  logger.info('Starting message processing', {
    trace_id: traceId,
    processor_type: message.processor_type || 'unknown'
  });
  
  try {
    // Validate and normalize message structure
    const validatedMessage = await validateAndNormalizeMessage(message, traceId);
    
    // Process the validated message and create notifications
    const result = await createNotificationsFromMessage(validatedMessage);
    
    logger.info('Message processing completed', {
      trace_id: traceId,
      user_id: validatedMessage.request.user_id,
      subscription_id: validatedMessage.request.subscription_id,
      notifications_created: result.created,
      errors: result.errors
    });
    
    return result;
  } catch (error) {
    logger.error('Failed to process message', {
      error: error.message,
      stack: error.stack,
      trace_id: traceId
    });
    throw error;
  }
}

/**
 * Validates and normalizes a message to ensure it matches the expected schema
 * @param {Object} message - The message to validate
 * @param {string} traceId - The trace ID for logging
 * @returns {Promise<Object>} - The validated and normalized message
 */
async function validateAndNormalizeMessage(message, traceId) {
  try {
    // Add trace ID if missing
    if (!message.trace_id) {
      message.trace_id = traceId;
    }
    
    // First, try to validate with the shared schema that matches the BOE parser
    try {
      validateBoeParserMessage(message);
      // If validation passes with the shared schema, proceed to Zod validation
      logger.info('Message validated successfully with shared schema', {
        trace_id: traceId
      });
    } catch (sharedSchemaError) {
      // Log the shared schema validation failure but continue with normalization
      logger.warn('Shared schema validation failed, will attempt normalization', {
        trace_id: traceId,
        error: sharedSchemaError.message
      });
    }
    
    // Try to validate against Zod schema
    const validationResult = MessageSchema.safeParse(message);
    
    if (validationResult.success) {
      const validatedMessage = validationResult.data;
      
      // Check for critical empty fields even if validation passed
      if (!validatedMessage.request.user_id) {
        logger.warn('Message passed validation but has empty user_id', { trace_id: traceId });
      }
      
      if (!validatedMessage.request.subscription_id) {
        logger.warn('Message passed validation but has empty subscription_id', { trace_id: traceId });
      }
      
      return validatedMessage;
    }
    
    // If validation fails, attempt to fix common issues
    logger.warn('Message validation failed, attempting to normalize structure', {
      trace_id: traceId,
      error_count: validationResult.error?.errors?.length || 0
    });
    
    // Extract user_id and subscription_id from various possible locations
    const user_id = message.request?.user_id || message.user_id || message.context?.user_id || 
                   message.userId || message.context?.userId || "";
    const subscription_id = message.request?.subscription_id || message.subscription_id || 
                           message.context?.subscription_id || message.subscriptionId || 
                           message.context?.subscriptionId || "";
    
    // Log warning if critical fields are empty
    if (!user_id) {
      logger.warn('Normalized message has empty user_id field', { trace_id: traceId });
    }
    
    if (!subscription_id) {
      logger.warn('Normalized message has empty subscription_id field', { trace_id: traceId });
    }
    
    // Create normalized message structure
    const normalizedMessage = {
      trace_id: traceId,
      request: {
        user_id: user_id,
        subscription_id: subscription_id,
        texts: message.request?.texts || message.request?.prompts || []
      },
      results: {
        query_date: message.results?.query_date || new Date().toISOString().split('T')[0],
        results: []
      },
      metadata: message.metadata || {
        processing_time_ms: 0,
        total_items_processed: 0,
        status: 'success'
      }
    };
    
    // Ensure boe_info is present even if empty
    if (!normalizedMessage.results.boe_info) {
      normalizedMessage.results.boe_info = {
        publication_date: normalizedMessage.results.query_date,
        source_url: ''
      };
    }
    
    // Attempt to normalize results structure
    if (Array.isArray(message.results?.results)) {
      // New format - already has results array
      normalizedMessage.results.results = message.results.results;
    } else if (Array.isArray(message.results?.matches)) {
      // Old format - convert matches to results format
      normalizedMessage.results.results = [{
        prompt: message.request?.texts?.[0] || "Default prompt",
        matches: message.results.matches
      }];
    }
    
    // Copy BOE info if present
    if (message.results?.boe_info) {
      normalizedMessage.results.boe_info = message.results.boe_info;
    }
    
    // First try to validate with the shared schema
    try {
      validateBoeParserMessage(normalizedMessage);
      logger.info('Normalized message validated successfully with shared schema', {
        trace_id: traceId
      });
    } catch (normalizedSharedSchemaError) {
      logger.warn('Normalized message failed shared schema validation', {
        trace_id: traceId,
        error: normalizedSharedSchemaError.message
      });
      // Continue to try Zod validation
    }
    
    // Validate the normalized message with Zod
    const revalidationResult = MessageSchema.safeParse(normalizedMessage);
    
    if (revalidationResult.success) {
      logger.info('Successfully normalized message structure', {
        trace_id: traceId
      });
      return revalidationResult.data;
    }
    
    // If still invalid, log detailed errors and throw exception
    logger.error('Failed to normalize message structure', {
      trace_id: traceId,
      errors: revalidationResult.error.errors
    });
    
    throw new Error('Invalid message format: ' + revalidationResult.error.errors[0]?.message);
  } catch (error) {
    logger.error('Error during message validation', {
      error: error.message,
      trace_id: traceId
    });
    throw error;
  }
}

/**
 * Creates notifications from a validated message
 * @param {Object} message - The validated message
 * @returns {Promise<Object>} - Stats about created notifications
 */
export async function createNotificationsFromMessage(message) {
  const { request, results } = message;
  const { user_id, subscription_id } = request;
  const traceId = message.trace_id;
  
  logger.info('Creating notifications from message', {
    trace_id: traceId,
    subscription_id,
    user_id,
    query_date: results.query_date,
    result_count: results.results.length
  });
  
  // Validate required fields
  if (!user_id) {
    logger.error('Missing required user_id in request', { trace_id: traceId });
    return { created: 0, errors: 1 };
  }
  
  if (!subscription_id) {
    logger.error('Missing required subscription_id in request', { trace_id: traceId });
    return { created: 0, errors: 1 };
  }
  
  let notificationsCreated = 0;
  let errors = 0;
  
  // Process each query result
  for (const queryResult of results.results) {
    const prompt = queryResult.prompt || 'Default prompt';
    
    // Skip if no matches
    if (!queryResult.matches || !Array.isArray(queryResult.matches) || queryResult.matches.length === 0) {
      logger.info(`No matches found for prompt "${prompt}"`, { trace_id: traceId });
      continue;
    }
    
    // Process each match
    for (const match of queryResult.matches) {
      try {
        // Create notification title from match
        const notificationTitle = match.notification_title || match.title || 'Notification';
        
        // Determine entity type from document type or default to generic
        const documentType = match.document_type?.toLowerCase() || 'document';
        const entityType = `notification:${documentType}`;
        
        // Determine source based on message or boe info
        const source = message.processor_type || 
                      (results.boe_info ? 'boe' : null) || 
                      'unknown';
        
        // Create data JSON with all relevant information
        const data = {
          trace_id: traceId,
          document_type: match.document_type,
          issuing_body: match.issuing_body,
          publication_date: results.boe_info?.publication_date || results.query_date,
          issue_number: results.boe_info?.issue_number,
          prompt: prompt,
          relevance_score: match.relevance_score
        };
        
        // Create the notification with RLS context
        await createNotification({
          // Pass both camelCase and snake_case versions for maximum compatibility
          userId: user_id,
          user_id: user_id,
          subscriptionId: subscription_id,
          subscription_id: subscription_id,
          title: notificationTitle,
          content: match.summary || 'No summary provided',
          sourceUrl: match.links?.html || '',
          source_url: match.links?.html || '',
          source: source,
          data: data,
          metadata: {
            prompt,
            query_date: results.query_date,
            document_type: match.document_type,
            issuing_body: match.issuing_body,
            relevance_score: match.relevance_score,
            boe_info: results.boe_info || {},
            trace_id: traceId,
            processing_info: message.metadata || {}
          },
          entity_type: entityType
        });
        
        notificationsCreated++;
      } catch (error) {
        logger.error('Failed to create notification from match', {
          error: error.message,
          trace_id: traceId,
          match_title: match.title || 'unknown'
        });
        errors++;
      }
    }
  }
  
  // If we successfully created notifications, remove the subscription processing record
  if (notificationsCreated > 0 && subscription_id) {
    try {
      // Delete completed subscription_processing record
      const deleteResult = await database.query(
        `DELETE FROM subscription_processing 
         WHERE subscription_id = $1 
         RETURNING id`,
        [subscription_id]
      );
      
      if (deleteResult.rowCount > 0) {
        logger.info('Deleted subscription processing record after completion', {
          trace_id: traceId,
          subscription_id,
          deleted_count: deleteResult.rowCount
        });
      } else {
        logger.info('No subscription processing record found to delete', {
          trace_id: traceId,
          subscription_id
        });
      }
    } catch (error) {
      logger.warn('Failed to delete subscription processing record', {
        error: error.message,
        trace_id: traceId,
        subscription_id
      });
      // Don't count this as an error that affects the overall result
    }
  }
  
  logger.info('Notification creation completed', {
    trace_id: traceId,
    subscription_id,
    user_id,
    notifications_created: notificationsCreated,
    errors
  });
  
  return { created: notificationsCreated, errors };
} 