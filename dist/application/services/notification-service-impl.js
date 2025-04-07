/**
 * @file Notification service implementation
 * Core service for notification creation and management
 */
import { EntityType } from '../../domain/models/notification';
import { withRetry } from '../../shared/utils/retry';
/**
 * DefaultNotificationService implementation
 * Core service for notification creation and delivery
 */
export class DefaultNotificationService {
    notificationRepository;
    processorRegistry;
    dbConnection;
    pubSubService;
    logger;
    /**
     * Constructor
     * @param notificationRepository - Repository for notification operations
     * @param processorRegistry - Registry for message processors
     * @param dbConnection - Database connection
     * @param pubSubService - PubSub service for publishing
     * @param logger - Logger instance
     */
    constructor(notificationRepository, processorRegistry, dbConnection, pubSubService, logger) {
        this.notificationRepository = notificationRepository;
        this.processorRegistry = processorRegistry;
        this.dbConnection = dbConnection;
        this.pubSubService = pubSubService;
        this.logger = logger;
    }
    /**
     * Process a message to create notifications
     * @param message - The processor message
     * @returns Result with notification creation statistics
     */
    async processMessage(message) {
        const traceId = message.trace_id;
        const startTime = Date.now();
        try {
            // Process message using processor registry
            const result = await this.processorRegistry.processMessage(message);
            this.logger.info('Message processing completed', {
                trace_id: traceId,
                processing_time_ms: Date.now() - startTime,
                notifications_created: result.created,
                errors: result.errors,
                processor_type: message.processor_type
            });
            return result;
        }
        catch (error) {
            this.logger.error('Failed to process message', {
                trace_id: traceId,
                error: error.message,
                processor_type: message.processor_type,
                processing_time_ms: Date.now() - startTime
            });
            throw error;
        }
    }
    /**
     * Create a single notification
     * @param notification - The notification to create
     * @returns The created notification with ID
     */
    async createNotification(notification) {
        try {
            // Create notification
            const createdNotification = await this.notificationRepository.createNotification(notification);
            // Check if user should receive immediate email
            const { shouldSend, email } = await this.shouldSendImmediateEmail(notification.userId);
            if (shouldSend && email) {
                // Get subscription name for better email context
                let subscriptionName = 'NIFYA Alert';
                try {
                    const result = await this.dbConnection.query('SELECT name FROM subscriptions WHERE id = $1', [notification.subscriptionId]);
                    if (result.rows.length > 0) {
                        subscriptionName = result.rows[0].name;
                    }
                }
                catch (error) {
                    this.logger.warn('Could not retrieve subscription name for email', {
                        error: error.message,
                        subscription_id: notification.subscriptionId
                    });
                }
                const notificationWithName = {
                    ...createdNotification,
                    subscriptionName
                };
                // Send immediate notification
                await this.publishEmailNotification(notificationWithName, email, true);
            }
            else {
                // Always add to daily digest queue if user has email notifications enabled
                try {
                    const userResult = await this.dbConnection.query(`SELECT 
              (notification_settings->>'emailNotifications')::boolean as email_notifications,
              notification_settings->>'notificationEmail' as notification_email,
              email
            FROM users
            WHERE id = $1`, [notification.userId]);
                    if (userResult.rows.length > 0 && userResult.rows[0].email_notifications) {
                        const userEmail = userResult.rows[0].notification_email || userResult.rows[0].email;
                        if (userEmail) {
                            // Get subscription name for better email context
                            let subscriptionName = 'NIFYA Alert';
                            try {
                                const result = await this.dbConnection.query('SELECT name FROM subscriptions WHERE id = $1', [notification.subscriptionId]);
                                if (result.rows.length > 0) {
                                    subscriptionName = result.rows[0].name;
                                }
                            }
                            catch (error) {
                                this.logger.warn('Could not retrieve subscription name for email', {
                                    error: error.message,
                                    subscription_id: notification.subscriptionId
                                });
                            }
                            const notificationWithName = {
                                ...createdNotification,
                                subscriptionName
                            };
                            // Add to daily digest
                            await this.publishEmailNotification(notificationWithName, userEmail, false);
                        }
                    }
                }
                catch (error) {
                    this.logger.error('Error checking user email notification preferences', {
                        error: error.message,
                        user_id: notification.userId
                    });
                }
            }
            // Trigger realtime notification via WebSocket (regardless of email preferences)
            try {
                await this.triggerRealtimeNotification(createdNotification);
            }
            catch (error) {
                // Non-blocking - we continue even if WebSocket notification fails
                this.logger.warn('Failed to trigger realtime notification', {
                    error: error.message,
                    notification_id: createdNotification.id,
                    user_id: notification.userId
                });
            }
            return createdNotification;
        }
        catch (error) {
            this.logger.error('Failed to create notification', {
                error: error.message,
                user_id: notification.userId,
                subscription_id: notification.subscriptionId
            });
            throw error;
        }
    }
    /**
     * Create multiple notifications in batch
     * @param userId - The user ID
     * @param subscriptionId - The subscription ID
     * @param notifications - Array of notification data
     * @returns Result with creation statistics
     */
    async createNotifications(userId, subscriptionId, notifications) {
        try {
            // Map to domain model
            const notificationEntities = notifications.map(notification => ({
                userId,
                subscriptionId,
                title: notification.title,
                content: notification.content,
                sourceUrl: notification.sourceUrl,
                metadata: notification.metadata,
                entityType: notification.entityType || EntityType.GENERIC
            }));
            // Create notifications
            const result = await this.notificationRepository.createNotifications(notificationEntities);
            // Check email preferences and trigger realtime notifications
            if (result.created > 0) {
                // Queue for async processing to avoid blocking
                setTimeout(async () => {
                    try {
                        // Check email preferences
                        const { shouldSend, email } = await this.shouldSendImmediateEmail(userId);
                        if (shouldSend && email) {
                            // Handle immediate email notification for first notification only
                            if (result.details && result.details.length > 0) {
                                const firstSuccessful = result.details.find(detail => detail.success);
                                if (firstSuccessful && firstSuccessful.id) {
                                    const notification = await this.notificationRepository.findById(firstSuccessful.id);
                                    if (notification) {
                                        // Get subscription name
                                        let subscriptionName = 'NIFYA Alert';
                                        try {
                                            const result = await this.dbConnection.query('SELECT name FROM subscriptions WHERE id = $1', [subscriptionId]);
                                            if (result.rows.length > 0) {
                                                subscriptionName = result.rows[0].name;
                                            }
                                        }
                                        catch (error) {
                                            this.logger.warn('Could not retrieve subscription name for email', {
                                                error: error.message,
                                                subscription_id: subscriptionId
                                            });
                                        }
                                        // Send immediate notification
                                        await this.publishEmailNotification({ ...notification, subscriptionName }, email, true);
                                    }
                                }
                            }
                        }
                    }
                    catch (error) {
                        this.logger.error('Error processing email preferences for batch', {
                            error: error.message,
                            user_id: userId
                        });
                    }
                }, 0);
            }
            return result;
        }
        catch (error) {
            this.logger.error('Failed to create notifications in batch', {
                error: error.message,
                user_id: userId,
                subscription_id: subscriptionId,
                count: notifications.length
            });
            throw error;
        }
    }
    /**
     * Publish email notification
     * @param notification - The notification to publish
     * @param email - The recipient email
     * @param immediate - Whether to send immediately or in digest
     * @returns The message ID if successful, null otherwise
     */
    async publishEmailNotification(notification, email, immediate) {
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
            // Publish with retry for transient errors
            const messageId = await withRetry(() => this.pubSubService.publishTopic(topicName, messageData), {
                name: 'publishEmailNotification',
                maxRetries: 2,
                initialDelay: 1000,
                context: {
                    topic: topicName,
                    user_id: notification.userId,
                    notification_id: notification.id
                }
            });
            this.logger.info(`Published notification to ${immediate ? 'immediate' : 'daily'} email topic`, {
                notification_id: notification.id,
                user_id: notification.userId,
                message_id: messageId
            });
            return messageId;
        }
        catch (error) {
            this.logger.error(`Failed to publish to ${immediate ? 'immediate' : 'daily'} email topic`, {
                error: error.message,
                notification_id: notification.id,
                user_id: notification.userId
            });
            return null;
        }
    }
    /**
     * Check if a user should receive immediate email notifications
     * @param userId - The user ID to check
     * @returns Whether immediate notification should be sent and the user's email
     */
    async shouldSendImmediateEmail(userId) {
        try {
            const result = await this.dbConnection.query(`SELECT 
          email,
          notification_settings->>'notificationEmail' as notification_email,
          (notification_settings->>'instantNotifications')::boolean as instant_notifications,
          email = 'nifyacorp@gmail.com' as is_test_user
        FROM users
        WHERE id = $1`, [userId]);
            if (result.rows.length === 0) {
                return { shouldSend: false, email: null };
            }
            const user = result.rows[0];
            const shouldSend = user.instant_notifications || user.is_test_user;
            const email = user.notification_email || user.email;
            return { shouldSend, email };
        }
        catch (error) {
            this.logger.error('Error checking if user should receive instant email', {
                error: error.message,
                userId
            });
            return { shouldSend: false, email: null };
        }
    }
    /**
     * Trigger a realtime notification via WebSocket
     * @param notification - The notification to send
     * @returns Whether the notification was sent successfully
     */
    async triggerRealtimeNotification(notification) {
        try {
            // Publish to realtime topic
            const messageData = {
                userId: notification.userId,
                notification: {
                    id: notification.id,
                    title: notification.title,
                    content: notification.content,
                    sourceUrl: notification.sourceUrl,
                    entityType: notification.entityType,
                    createdAt: notification.createdAt || new Date().toISOString()
                },
                type: 'notification'
            };
            const messageId = await this.pubSubService.publishTopic('realtime-notifications', messageData);
            this.logger.info('Triggered realtime notification via pubsub', {
                notification_id: notification.id,
                user_id: notification.userId,
                message_id: messageId
            });
            return true;
        }
        catch (error) {
            this.logger.warn('Failed to trigger realtime notification', {
                error: error.message,
                notification_id: notification.id,
                user_id: notification.userId
            });
            return false;
        }
    }
}
//# sourceMappingURL=notification-service-impl.js.map