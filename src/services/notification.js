import { db } from '../database/client.js';
import { logger } from '../utils/logger.js';

/**
 * Sets the app.current_user_id session variable to bypass RLS policies
 * @param {string} userId - The user ID to set for RLS context
 * @returns {Promise<boolean>} - Whether the operation was successful
 */
export async function setRLSContext(userId) {
  try {
    if (!userId) {
      logger.warn('Cannot set RLS context: missing userId');
      return false;
    }
    
    await db.query('SET LOCAL app.current_user_id = $1', [userId]);
    logger.debug('Set RLS context for user', { userId });
    return true;
  } catch (error) {
    logger.warn('Failed to set RLS context', {
      error: error.message,
      userId
    });
    return false;
  }
}

/**
 * Creates a single notification with proper RLS context
 * @param {Object} data - Notification data
 * @returns {Promise<Object>} - Created notification ID
 */
export async function createNotification(data) {
  try {
    const { userId, subscriptionId, title, content, sourceUrl = '', metadata = {} } = data;
    
    if (!userId || !subscriptionId) {
      throw new Error('Missing required fields: userId and subscriptionId');
    }
    
    // Use the withRLSContext method to handle the transaction with proper RLS context
    const result = await db.withRLSContext(userId, async (client) => {
      const insertResult = await client.query(
        `INSERT INTO notifications (
          user_id,
          subscription_id,
          title,
          content,
          source_url,
          metadata,
          created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING id`,
        [
          userId,
          subscriptionId,
          title || 'Notification',
          content || '',
          sourceUrl,
          JSON.stringify(metadata),
          new Date()
        ]
      );
      
      return insertResult;
    });
    
    logger.info('Created notification with RLS context', {
      user_id: userId,
      subscription_id: subscriptionId,
      notification_id: result.rows[0]?.id
    });
    
    return {
      id: result.rows[0]?.id,
      userId,
      subscriptionId,
      title,
      created_at: new Date().toISOString()
    };
  } catch (error) {
    logger.error('Failed to create notification', {
      error: error.message,
      code: error.code,
      user_id: data.userId
    });
    throw error;
  }
}

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
  
  // Set RLS context for the user to bypass RLS policies
  try {
    await setRLSContext(user_id);
    logger.debug('Set RLS context for batch notifications', { user_id });
  } catch (rlsError) {
    logger.warn('Failed to set RLS context for batch notifications', {
      error: rlsError.message,
      user_id,
      trace_id: message.trace_id
    });
    // Continue anyway, as the service role might have direct table access
  }
  
  for (const match of message.results.matches) {
    for (const doc of match.documents) {
      try {
        // Determine the best title to use for the notification
        const notificationTitle = doc.notification_title || doc.title || 'Notification';
        
        // Create entity_type for metadata
        const entityType = `boe:${doc.document_type?.toLowerCase() || 'document'}`;
        
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
                metadata,
                created_at
              ) VALUES ($1, $2, $3, $4, $5, $6, $7)
              RETURNING id`,
              [
                user_id,
                subscription_id,
                notificationTitle,
                doc.summary,
                doc.links?.html || '',
                JSON.stringify({
                  entity_type: entityType,
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
              entity_type: entityType,
              attempt: attempt + 1,
              trace_id: message.trace_id
            });
            
            notificationsCreated++;
            break; // Exit retry loop on success
          } catch (dbError) {
            attempt++;
            lastError = dbError;
            
            // Check if this might be an RLS error
            const isRLSError = 
              dbError.message.includes('permission denied') || 
              dbError.message.includes('insufficient privilege');
              
            // If it looks like an RLS error, try to set the context again
            if (isRLSError) {
              logger.warn('Possible RLS error, attempting to set context again', {
                error: dbError.message,
                user_id,
                attempt
              });
              
              try {
                await setRLSContext(user_id);
              } catch (rlsError) {
                logger.warn('Failed to reset RLS context during retry', {
                  error: rlsError.message
                });
              }
            }
            
            // Only retry on connection-related errors or RLS errors
            const isConnectionError = 
              dbError.code === 'ECONNREFUSED' || 
              dbError.code === '57P01' || // admin_shutdown
              dbError.code === '57P03' || // cannot_connect_now
              dbError.message.includes('timeout') ||
              dbError.message.includes('Connection terminated');
              
            if ((!isConnectionError && !isRLSError) || attempt >= maxAttempts) {
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