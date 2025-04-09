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
  const { request, results } = message;
  const { user_id, subscription_id } = request;
  const traceId = message.trace_id || 'unknown';
  
  logger.info('Processing notification message', {
    trace_id: traceId,
    subscription_id,
    user_id,
    match_count: results?.matches?.length || 0
  });
  
  // Ensure we have matches
  if (!results?.matches || !Array.isArray(results.matches)) {
    logger.warn('No matches found in message', {
      trace_id: traceId,
      subscription_id
    });
    return { created: 0, errors: 0 };
  }
  
  let notificationsCreated = 0;
  let errors = 0;
  
  // Process each match
  for (const match of results.matches) {
    const prompt = match.prompt || 'Default prompt';
    
    // Process each document in the match
    for (const doc of match.documents || []) {
      try {
        // Create notification title from document
        const notificationTitle = doc.notification_title || doc.title || 'Notification';
        
        // Create the notification
        await createNotification({
          userId: user_id,
          subscriptionId: subscription_id,
          title: notificationTitle,
          content: doc.summary || 'No content provided',
          sourceUrl: doc.links?.html || '',
          metadata: {
            prompt,
            document_type: doc.document_type,
            publication_date: doc.publication_date,
            trace_id: traceId,
            processor_type: message.processor_type || 'unknown'
          },
          entity_type: `${message.processor_type || 'notification'}:document`
        });
        
        notificationsCreated++;
      } catch (error) {
        logger.error('Failed to create notification from document', {
          error: error.message,
          trace_id: traceId,
          document_title: doc.title || 'unknown'
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