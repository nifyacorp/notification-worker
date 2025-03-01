import { db } from '../database/client.js';
import { logger } from '../utils/logger.js';

export async function createNotifications(message) {
  const { user_id, subscription_id } = message.request;
  let notificationsCreated = 0;
  let errors = 0;
  
  logger.info('Starting to create notifications', {
    user_id,
    subscription_id,
    match_count: message.results.matches.length,
    total_documents: message.results.matches.reduce((acc, match) => acc + match.documents.length, 0),
    trace_id: message.trace_id
  });
  
  for (const match of message.results.matches) {
    for (const doc of match.documents) {
      try {
        // Determine the best title to use for the notification
        const notificationTitle = doc.notification_title || doc.title || 'Notification';
        
        // Retry up to 3 times with exponential backoff
        let attempt = 0;
        const maxAttempts = 3;
        let lastError = null;
        
        while (attempt < maxAttempts) {
          try {
            const result = await db.query(
              `INSERT INTO notifications (
                user_id,
                subscription_id,
                title,
                content,
                source_url,
                entity_type,
                metadata,
                created_at
              ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
              RETURNING id`,
              [
                user_id,
                subscription_id,
                notificationTitle,
                doc.summary,
                doc.links?.html || '',
                `boe:${doc.document_type?.toLowerCase() || 'document'}`,
                JSON.stringify({
                  prompt: match.prompt,
                  relevance: doc.relevance_score,
                  document_type: doc.document_type,
                  original_title: doc.title,
                  processor_type: message.processor_type,
                  publication_date: doc.dates?.publication_date,
                  issuing_body: doc.issuing_body,
                  section: doc.section,
                  department: doc.department,
                  trace_id: message.trace_id
                }),
                new Date()
              ],
              { maxRetries: 2 } // Use the database client's built-in retry mechanism
            );

            logger.info('Created notification', {
              user_id,
              subscription_id,
              notification_id: result.rows[0]?.id,
              title: notificationTitle,
              document_type: doc.document_type,
              attempt: attempt + 1,
              trace_id: message.trace_id
            });
            
            notificationsCreated++;
            break; // Exit retry loop on success
          } catch (dbError) {
            attempt++;
            lastError = dbError;
            
            // Only retry on connection-related errors
            const isConnectionError = 
              dbError.code === 'ECONNREFUSED' || 
              dbError.code === '57P01' || // admin_shutdown
              dbError.code === '57P03' || // cannot_connect_now
              dbError.message.includes('timeout') ||
              dbError.message.includes('Connection terminated');
              
            if (!isConnectionError || attempt >= maxAttempts) {
              throw dbError; // Rethrow for outer catch if not retryable or max attempts reached
            }
            
            const delay = Math.pow(2, attempt) * 1000; // 1s, 2s, 4s
            logger.warn(`Retrying notification creation in ${delay}ms`, {
              user_id, 
              subscription_id,
              attempt,
              max_attempts: maxAttempts,
              error: dbError.message,
              trace_id: message.trace_id
            });
            
            await new Promise(resolve => setTimeout(resolve, delay));
          }
        }
      } catch (error) {
        errors++;
        logger.error('Failed to create notification', {
          user_id,
          subscription_id,
          error: error.message,
          error_code: error.code,
          stack: error.stack?.substring(0, 500) || 'No stack trace',
          title: doc.notification_title || doc.title,
          trace_id: message.trace_id
        });
        // Continue processing other notifications
      }
    }
  }
  
  logger.info('Notification creation completed', {
    user_id,
    subscription_id,
    notifications_created: notificationsCreated,
    errors,
    success_rate: notificationsCreated > 0 ? 
      `${Math.round((notificationsCreated / (notificationsCreated + errors)) * 100)}%` : '0%',
    trace_id: message.trace_id
  });
  
  return { created: notificationsCreated, errors };
}