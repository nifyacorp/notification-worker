import { db } from '../database/client.js';
import { logger } from '../utils/logger.js';
import { PubSub } from '@google-cloud/pubsub';
import { triggerRealtimeNotification } from './realtime-notification.js';

// Initialize PubSub client for email notifications
const pubsub = new PubSub({
  projectId: process.env.GOOGLE_CLOUD_PROJECT
});

// Email notification topics
const EMAIL_IMMEDIATE_TOPIC = process.env.EMAIL_IMMEDIATE_TOPIC || 'email-notifications-immediate';
const EMAIL_DAILY_TOPIC = process.env.EMAIL_DAILY_TOPIC || 'email-notifications-daily';

// Get topic references
const immediateEmailTopic = pubsub.topic(EMAIL_IMMEDIATE_TOPIC);
const dailyEmailTopic = pubsub.topic(EMAIL_DAILY_TOPIC);

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
    
    // Validate that userId is a valid UUID to prevent SQL injection
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(userId)) {
      logger.warn('Invalid UUID format for RLS context', { userId });
      return false;
    }

    // Use parameterized query to prevent SQL injection
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
 * Checks if a user should receive instant email notifications
 * @param {string} userId - The user ID to check
 * @returns {Promise<{shouldSend: boolean, email: string|null}>} - Whether to send instant notification and user's email
 */
async function shouldSendInstantEmail(userId) {
  try {
    const result = await db.query(`
      SELECT 
        email,
        notification_settings->>'notificationEmail' as notification_email,
        (notification_settings->>'instantNotifications')::boolean as instant_notifications,
        email = 'nifyacorp@gmail.com' as is_test_user
      FROM users
      WHERE id = $1
    `, [userId]);

    if (result.rows.length === 0) {
      return { shouldSend: false, email: null };
    }

    const user = result.rows[0];
    const shouldSend = user.instant_notifications || user.is_test_user;
    const email = user.notification_email || user.email;

    return { shouldSend, email };
  } catch (error) {
    logger.error('Error checking if user should receive instant email', {
      error: error.message,
      userId
    });
    return { shouldSend: false, email: null };
  }
}

/**
 * Publishes a notification to the appropriate email notification topic
 * @param {Object} notification - The notification data
 * @param {string} email - The user's email address
 * @param {boolean} immediate - Whether to send immediately or add to daily digest
 */
async function publishEmailNotification(notification, email, immediate) {
  try {
    const messageData = {
      userId: notification.userId,
      email: email,
      notification: {
        id: notification.id,
        title: notification.title,
        content: notification.content || '',
        sourceUrl: notification.sourceUrl || '',
        subscriptionName: notification.subscriptionName || 'NIFYA Alert',
      },
      timestamp: new Date().toISOString()
    };

    const topic = immediate ? immediateEmailTopic : dailyEmailTopic;
    const messageBuffer = Buffer.from(JSON.stringify(messageData));
    
    const messageId = await topic.publish(messageBuffer);
    
    logger.info(`Published notification to ${immediate ? 'immediate' : 'daily'} email topic`, {
      notification_id: notification.id,
      user_id: notification.userId,
      message_id: messageId,
      email_topic: immediate ? EMAIL_IMMEDIATE_TOPIC : EMAIL_DAILY_TOPIC
    });
    
    return messageId;
  } catch (error) {
    logger.error(`Failed to publish to ${immediate ? 'immediate' : 'daily'} email topic`, {
      error: error.message,
      notification_id: notification.id,
      user_id: notification.userId
    });
    return null;
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
    
    const notification = {
      id: result.rows[0]?.id,
      userId,
      subscriptionId,
      title,
      content,
      sourceUrl,
      created_at: new Date().toISOString()
    };

    // Check if user should receive instant email notification
    const { shouldSend, email } = await shouldSendInstantEmail(userId);
    
    if (shouldSend && email) {
      // Get subscription name for better email context
      try {
        const subResult = await db.query('SELECT name FROM subscriptions WHERE id = $1', [subscriptionId]);
        if (subResult.rows.length > 0) {
          notification.subscriptionName = subResult.rows[0].name;
        }
      } catch (error) {
        logger.warn('Could not retrieve subscription name for email', {
          error: error.message,
          subscription_id: subscriptionId
        });
      }
      
      // Send immediate notification
      await publishEmailNotification(notification, email, true);
    } else {
      // Always add to daily digest queue if user has email notifications enabled
      try {
        const userResult = await db.query(`
          SELECT 
            (notification_settings->>'emailNotifications')::boolean as email_notifications,
            notification_settings->>'notificationEmail' as notification_email,
            email
          FROM users
          WHERE id = $1
        `, [userId]);
        
        if (userResult.rows.length > 0 && userResult.rows[0].email_notifications) {
          const userEmail = userResult.rows[0].notification_email || userResult.rows[0].email;
          if (userEmail) {
            // Get subscription name for better email context
            try {
              const subResult = await db.query('SELECT name FROM subscriptions WHERE id = $1', [subscriptionId]);
              if (subResult.rows.length > 0) {
                notification.subscriptionName = subResult.rows[0].name;
              }
            } catch (error) {
              logger.warn('Could not retrieve subscription name for email', {
                error: error.message,
                subscription_id: subscriptionId
              });
            }
            
            // Add to daily digest
            await publishEmailNotification(notification, userEmail, false);
          }
        }
      } catch (error) {
        logger.error('Error checking user email notification preferences', {
          error: error.message,
          user_id: userId
        });
      }
    }
    // Trigger realtime notification via WebSocket (regardless of email preferences)
    try {
      await triggerRealtimeNotification(notification);
      logger.info('Triggered realtime notification via WebSocket', {
        notification_id: notification.id,
        user_id: userId
      });
    } catch (error) {
      // Non-blocking - we continue even if WebSocket notification fails
      logger.warn('Failed to trigger realtime notification', {
        error: error.message,
        notification_id: notification.id,
        user_id: userId
      });
    }


    return notification;
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
        // IMPROVED TITLE GENERATION - Generate a more meaningful title
        let notificationTitle = '';
        
        // First try to use notification_title field which should be optimized for display
        if (doc.notification_title && doc.notification_title.length > 3) {
          notificationTitle = doc.notification_title;
        }
        // Otherwise try the original title
        else if (doc.title && doc.title.length > 3) {
          notificationTitle = doc.title;
        }
        // If both are missing, construct a descriptive title from available fields
        else if (doc.document_type) {
          // Construct a descriptive title based on available metadata
          const docType = doc.document_type || 'Documento';
          const issuer = doc.issuing_body || doc.department || '';
          const date = doc.dates?.publication_date ? ` (${doc.dates.publication_date})` : '';
          
          notificationTitle = `${docType}${issuer ? ' de ' + issuer : ''}${date}`;
        }
        else {
          // Last resort - use a generic title but with subscription context
          const subscription = message.processor_type || '';
          notificationTitle = subscription 
            ? `Nueva notificación de ${subscription}` 
            : 'Nueva notificación BOE';
        }
        
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