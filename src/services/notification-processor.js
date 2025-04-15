import { logger } from '../utils/logger.js';
import { database } from './database.js';
import { triggerRealtimeNotification } from './realtime-notification.js';
import { createNotification } from './notification.js';

/**
 * Creates notifications from a PubSub message
 * @param {Object} message - The parsed message data
 * @returns {Promise<Object>} - Stats about created notifications
 */
export async function createNotificationsFromMessage(message) {
  const traceId = message.trace_id || 'unknown';
  
  // Basic validation
  if (!message.request || !message.request.user_id || !message.request.subscription_id) {
    logger.error('Missing required fields in message', {
      trace_id: traceId
    });
    throw new Error('Missing required fields: user_id and subscription_id in request');
  }
  
  const { request, results } = message;
  const { user_id, subscription_id } = request;
  
  logger.info('Processing notification message', {
    trace_id: traceId,
    subscription_id,
    user_id,
    query_date: results?.query_date,
    text_count: request?.texts?.length || 0
  });
  
  // Ensure we have results
  if (!results?.results || !Array.isArray(results.results)) {
    logger.warn('No results found in message', {
      trace_id: traceId,
      subscription_id
    });
    return { created: 0, errors: 0 };
  }
  
  let notificationsCreated = 0;
  let errors = 0;
  
  // Process each query result
  for (const queryResult of results.results) {
    const prompt = queryResult.prompt || 'Default prompt';
    
    // Process each match for this query
    if (!queryResult.matches || !Array.isArray(queryResult.matches)) {
      logger.warn(`No matches found for prompt "${prompt}"`, {
        trace_id: traceId
      });
      continue;
    }
    
    // Process each match in this query result
    for (const match of queryResult.matches) {
      try {
        // Create notification title from match
        const notificationTitle = match.notification_title || match.title || 'Notification';
        
        // Create the notification
        await createNotification({
          userId: user_id,
          subscriptionId: subscription_id,
          title: notificationTitle,
          content: match.summary || 'No content provided',
          sourceUrl: match.links?.html || '',
          metadata: {
            prompt,
            boe_info: results?.boe_info || {},
            document_type: match.document_type,
            issuing_body: match.issuing_body,
            relevance_score: match.relevance_score,
            query_date: results.query_date,
            trace_id: traceId,
            processor_type: 'boe-parser'
          },
          entity_type: `boe:${match.document_type?.toLowerCase() || 'document'}`
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
  
  logger.info('Notification processing completed', {
    trace_id: traceId,
    subscription_id,
    user_id,
    notifications_created: notificationsCreated,
    errors
  });
  
  return { created: notificationsCreated, errors };
} 