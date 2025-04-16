import { database } from './database.js';
import { logger } from '../utils/logger.js';
import { publishToTopic, getEmailTopics } from './pubsub/client.js';
import { triggerRealtimeNotification } from './realtime-notification.js';
import { withRetry } from '../utils/retry.js';

// Get email topics
const emailTopics = getEmailTopics();

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

    await database.setRLSContext(userId);
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
    const result = await database.query(`
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

    const topicName = immediate ? 'email-notifications-immediate' : 'email-notifications-daily';
    
    const messageId = await publishToTopic(topicName, messageData);
    
    logger.info(`Published notification to ${immediate ? 'immediate' : 'daily'} email topic`, {
      notification_id: notification.id,
      user_id: notification.userId,
      message_id: messageId
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
    const { 
      userId, user_id,
      subscriptionId, subscription_id,
      title, 
      content, 
      sourceUrl = '', source_url = '',
      source = null,
      data: notificationData = {},
      metadata = {}, 
      entity_type = 'notification:generic' 
    } = data;
    
    // Support both camelCase and snake_case parameter names
    const effectiveUserId = userId || user_id;
    const effectiveSubscriptionId = subscriptionId || subscription_id;
    const effectiveSourceUrl = sourceUrl || source_url;
    
    if (!effectiveUserId || !effectiveSubscriptionId) {
      throw new Error('Missing required fields: userId and subscriptionId');
    }
    
    // Use the withRLSContext method to handle the transaction with proper RLS context
    const result = await database.withRLSContext(effectiveUserId, async (client) => {
      const insertResult = await client.query(
        `INSERT INTO notifications (
          user_id,
          subscription_id,
          title,
          content,
          source_url,
          source,
          data,
          metadata,
          entity_type,
          created_at,
          updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10)
        RETURNING id`,
        [
          effectiveUserId,
          effectiveSubscriptionId,
          title || 'Notification',
          content || '',
          effectiveSourceUrl,
          source,
          JSON.stringify(notificationData),
          JSON.stringify(metadata),
          entity_type,
          new Date()
        ]
      );
      
      return insertResult;
    });
    
    logger.info('Created notification with RLS context', {
      user_id: effectiveUserId,
      subscription_id: effectiveSubscriptionId,
      notification_id: result.rows[0]?.id,
      entity_type,
      source
    });
    
    const notification = {
      id: result.rows[0]?.id,
      userId: effectiveUserId,
      subscriptionId: effectiveSubscriptionId,
      title,
      content,
      sourceUrl: effectiveSourceUrl,
      source,
      entity_type,
      created_at: new Date().toISOString()
    };

    // Check if user should receive instant email notification
    const { shouldSend, email } = await shouldSendInstantEmail(effectiveUserId);
    
    if (shouldSend && email) {
      // Get subscription name for better email context
      try {
        const subResult = await database.query('SELECT name FROM subscriptions WHERE id = $1', [effectiveSubscriptionId]);
        if (subResult.rows.length > 0) {
          notification.subscriptionName = subResult.rows[0].name;
        }
      } catch (error) {
        logger.warn('Could not retrieve subscription name for email', {
          error: error.message,
          subscription_id: effectiveSubscriptionId
        });
      }
      
      // Send immediate notification
      await publishEmailNotification(notification, email, true);
    } else {
      // Always add to daily digest queue if user has email notifications enabled
      try {
        const userResult = await database.query(`
          SELECT 
            (notification_settings->>'emailNotifications')::boolean as email_notifications,
            notification_settings->>'notificationEmail' as notification_email,
            email
          FROM users
          WHERE id = $1
        `, [effectiveUserId]);
        
        if (userResult.rows.length > 0 && userResult.rows[0].email_notifications) {
          const userEmail = userResult.rows[0].notification_email || userResult.rows[0].email;
          if (userEmail) {
            // Get subscription name for better email context
            try {
              const subResult = await database.query('SELECT name FROM subscriptions WHERE id = $1', [effectiveSubscriptionId]);
              if (subResult.rows.length > 0) {
                notification.subscriptionName = subResult.rows[0].name;
              }
            } catch (error) {
              logger.warn('Could not retrieve subscription name for email', {
                error: error.message,
                subscription_id: effectiveSubscriptionId
              });
            }
            
            // Add to daily digest
            await publishEmailNotification(notification, userEmail, false);
          }
        }
      } catch (error) {
        logger.error('Error checking user email notification preferences', {
          error: error.message,
          user_id: effectiveUserId
        });
      }
    }
    
    // Trigger realtime notification via WebSocket (regardless of email preferences)
    try {
      await triggerRealtimeNotification(notification);
      logger.info('Triggered realtime notification via WebSocket', {
        notification_id: notification.id,
        user_id: effectiveUserId
      });
    } catch (error) {
      // Non-blocking - we continue even if WebSocket notification fails
      logger.warn('Failed to trigger realtime notification', {
        error: error.message,
        notification_id: notification.id,
        user_id: effectiveUserId
      });
    }

    return notification;
  } catch (error) {
    logger.error('Failed to create notification', {
      error: error.message,
      code: error.code,
      user_id: data.userId || data.user_id
    });
    throw error;
  }
}

/**
 * Creates a batch of notifications from results data
 * @param {Object} message - Message with user, subscription and results data
 * @returns {Promise<Object>} - Created notification stats
 */
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
        // Process this document with retry logic
        await withRetry(
          async () => {
            // ENHANCED TITLE GENERATION - Generate a more meaningful title
            let notificationTitle = '';
            
            // First try to use notification_title field which is optimized for display
            if (doc.notification_title && doc.notification_title.length > 3 && 
                doc.notification_title !== 'string' && !doc.notification_title.includes('notification')) {
              notificationTitle = doc.notification_title;
            }
            // Otherwise try the original title
            else if (doc.title && doc.title.length > 3 && 
                    doc.title !== 'string' && !doc.title.includes('notification')) {
              // Truncate long titles to 80 chars for consistency with notification_title
              notificationTitle = doc.title.length > 80 
                ? doc.title.substring(0, 77) + '...' 
                : doc.title;
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
              // Enhanced last resort - use relevant context from match data
              const subscription = message.processor_type || '';
              const promptContext = match.prompt && match.prompt.length > 5 ? 
                `: "${match.prompt.substring(0, 30)}${match.prompt.length > 30 ? '...' : ''}"` : '';
                
              notificationTitle = subscription 
                ? `Alerta ${subscription}${promptContext}` 
                : `Alerta BOE${promptContext}`;
            }
            
            // Create entity_type for metadata
            const entityType = `boe:${doc.document_type?.toLowerCase() || 'document'}`;
            
            const result = await database.query(
              `INSERT INTO notifications (
                user_id,
                subscription_id,
                title,
                content,
                source_url,
                metadata,
                entity_type,
                created_at
              ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
              RETURNING id`,
              [
                user_id,
                subscription_id,
                notificationTitle,
                doc.summary,
                doc.links?.html || '',
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
                entityType,
                new Date()
              ],
              { maxRetries: 2 }
            );

            logger.info('Created notification', {
              user_id,
              subscription_id,
              notification_id: result.rows[0]?.id,
              title: notificationTitle,
              document_type: doc.document_type,
              entity_type: entityType,
              trace_id: message.trace_id
            });
            
            notificationsCreated++;
          },
          {
            name: 'createNotification',
            maxRetries: 2,
            initialDelay: 1000,
            onRetry: async (error, attempt) => {
              // Check if this might be an RLS error
              const isRLSError = 
                error.message.includes('permission denied') || 
                error.message.includes('insufficient privilege');
                
              // If it looks like an RLS error, try to set the context again
              if (isRLSError) {
                logger.warn('Possible RLS error, attempting to set context again', {
                  error: error.message,
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
            },
            context: {
              user_id,
              subscription_id,
              document_type: doc.document_type,
              trace_id: message.trace_id
            }
          }
        );
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