import { Notification } from '../../domain/entities/Notification.js';
import { 
  CreateNotificationOptions, 
  NotificationRepository 
} from '../../domain/repositories/NotificationRepository.js';
import { AppError, ErrorCode } from '../../domain/errors/AppError.js';
import { PostgresClient } from '../database/PostgresClient.js';
import { Logger } from '../logging/Logger.js';
import { Config } from '../config/Config.js';

/**
 * PostgreSQL implementation of the notification repository
 */
export class PostgresNotificationRepository implements NotificationRepository {
  constructor(
    private readonly db: PostgresClient,
    private readonly logger: Logger,
    private readonly config: Config
  ) {}

  /**
   * Creates a new notification
   * @param notification Notification to create
   * @param options Creation options
   * @returns Created notification with ID
   */
  async createNotification(
    notification: Notification,
    options: CreateNotificationOptions = {}
  ): Promise<Notification> {
    try {
      // If setRlsContext is true, use withRLSContext
      if (options.setRlsContext) {
        return await this.db.withRLSContext(notification.userId, async (client) => {
          const result = await client.query(
            `INSERT INTO notifications (
              user_id,
              subscription_id,
              title,
              content,
              source_url,
              entity_type,
              metadata,
              created_at,
              updated_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            RETURNING id`,
            [
              notification.userId,
              notification.subscriptionId,
              notification.title,
              notification.content,
              notification.sourceUrl,
              notification.entityType,
              JSON.stringify(notification.metadata),
              notification.createdAt,
              notification.updatedAt
            ]
          );

          const id = result.rows[0]?.id;
          if (!id) {
            throw new AppError(
              'Failed to create notification: no ID returned',
              ErrorCode.NOTIFICATION_CREATION_ERROR,
              { userId: notification.userId }
            );
          }

          this.logger.info('Created notification with RLS context', {
            user_id: notification.userId,
            subscription_id: notification.subscriptionId,
            notification_id: id,
            entity_type: notification.entityType
          });

          // Return a new notification with the ID
          return new Notification(
            id,
            notification.userId,
            notification.subscriptionId,
            notification.title,
            notification.content,
            notification.sourceUrl,
            notification.entityType,
            notification.metadata,
            notification.read,
            notification.readAt,
            notification.emailSent,
            notification.emailSentAt,
            notification.createdAt,
            notification.updatedAt
          );
        });
      } else {
        // Set RLS manually with query options
        const result = await this.db.query(
          `INSERT INTO notifications (
            user_id,
            subscription_id,
            title,
            content,
            source_url,
            entity_type,
            metadata,
            created_at,
            updated_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
          RETURNING id`,
          [
            notification.userId,
            notification.subscriptionId,
            notification.title,
            notification.content,
            notification.sourceUrl,
            notification.entityType,
            JSON.stringify(notification.metadata),
            notification.createdAt,
            notification.updatedAt
          ],
          { setContext: notification.userId }
        );

        const id = result.rows[0]?.id;
        if (!id) {
          throw new AppError(
            'Failed to create notification: no ID returned',
            ErrorCode.NOTIFICATION_CREATION_ERROR,
            { userId: notification.userId }
          );
        }

        this.logger.info('Created notification', {
          user_id: notification.userId,
          subscription_id: notification.subscriptionId,
          notification_id: id,
          entity_type: notification.entityType
        });

        // Return a new notification with the ID
        return new Notification(
          id,
          notification.userId,
          notification.subscriptionId,
          notification.title,
          notification.content,
          notification.sourceUrl,
          notification.entityType,
          notification.metadata,
          notification.read,
          notification.readAt,
          notification.emailSent,
          notification.emailSentAt,
          notification.createdAt,
          notification.updatedAt
        );
      }
    } catch (error) {
      // Check if this is an RLS error
      const err = error instanceof Error ? error : new Error(String(error));
      const isRLSError = 
        err.message.includes('permission denied') || 
        err.message.includes('insufficient privilege');

      if (isRLSError) {
        throw new AppError(
          'Permission denied when creating notification: RLS context issue',
          ErrorCode.RLS_CONTEXT_ERROR,
          { userId: notification.userId },
          err
        );
      }

      throw new AppError(
        `Failed to create notification: ${err.message}`,
        ErrorCode.NOTIFICATION_CREATION_ERROR,
        { userId: notification.userId },
        err
      );
    }
  }

  /**
   * Creates multiple notifications in a batch
   * @param notifications Array of notifications to create
   * @param options Creation options
   * @returns Array of created notifications with IDs
   */
  async createNotifications(
    notifications: Notification[],
    options: CreateNotificationOptions = {}
  ): Promise<Notification[]> {
    if (notifications.length === 0) {
      return [];
    }

    // For a single notification, use createNotification
    if (notifications.length === 1) {
      const created = await this.createNotification(notifications[0], options);
      return [created];
    }

    // Check if all notifications have the same user ID
    const userId = notifications[0].userId;
    const allSameUser = notifications.every(n => n.userId === userId);

    if (!allSameUser) {
      // If different users, create each notification individually
      const results: Notification[] = [];
      for (const notification of notifications) {
        try {
          const created = await this.createNotification(notification, options);
          results.push(created);
        } catch (error) {
          this.logger.error('Failed to create notification in batch', {
            user_id: notification.userId,
            subscription_id: notification.subscriptionId,
            error: error instanceof Error ? error.message : String(error)
          });
          // Continue with other notifications
        }
      }
      return results;
    }

    // All notifications have the same user ID, use batch insert
    try {
      if (options.setRlsContext) {
        return await this.db.withRLSContext(userId, async (client) => {
          // Start a transaction
          await client.query('BEGIN');

          try {
            const createdNotifications: Notification[] = [];

            // Create each notification within the transaction
            for (const notification of notifications) {
              const result = await client.query(
                `INSERT INTO notifications (
                  user_id,
                  subscription_id,
                  title,
                  content,
                  source_url,
                  entity_type,
                  metadata,
                  created_at,
                  updated_at
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
                RETURNING id`,
                [
                  notification.userId,
                  notification.subscriptionId,
                  notification.title,
                  notification.content,
                  notification.sourceUrl,
                  notification.entityType,
                  JSON.stringify(notification.metadata),
                  notification.createdAt,
                  notification.updatedAt
                ]
              );

              const id = result.rows[0]?.id;
              if (id) {
                createdNotifications.push(
                  new Notification(
                    id,
                    notification.userId,
                    notification.subscriptionId,
                    notification.title,
                    notification.content,
                    notification.sourceUrl,
                    notification.entityType,
                    notification.metadata,
                    notification.read,
                    notification.readAt,
                    notification.emailSent,
                    notification.emailSentAt,
                    notification.createdAt,
                    notification.updatedAt
                  )
                );
              }
            }

            // Commit the transaction
            await client.query('COMMIT');

            this.logger.info('Created notifications batch with RLS context', {
              user_id: userId,
              count: createdNotifications.length
            });

            return createdNotifications;
          } catch (error) {
            // Rollback on error
            await client.query('ROLLBACK');
            throw error;
          }
        });
      } else {
        // Use a transaction without RLS context helper
        return await this.db.withTransaction(async (client) => {
          // Set RLS context for the transaction
          await client.query('SELECT set_config(\'app.current_user_id\', $1, true)', [userId]);

          const createdNotifications: Notification[] = [];

          // Create each notification
          for (const notification of notifications) {
            const result = await client.query(
              `INSERT INTO notifications (
                user_id,
                subscription_id,
                title,
                content,
                source_url,
                entity_type,
                metadata,
                created_at,
                updated_at
              ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
              RETURNING id`,
              [
                notification.userId,
                notification.subscriptionId,
                notification.title,
                notification.content,
                notification.sourceUrl,
                notification.entityType,
                JSON.stringify(notification.metadata),
                notification.createdAt,
                notification.updatedAt
              ]
            );

            const id = result.rows[0]?.id;
            if (id) {
              createdNotifications.push(
                new Notification(
                  id,
                  notification.userId,
                  notification.subscriptionId,
                  notification.title,
                  notification.content,
                  notification.sourceUrl,
                  notification.entityType,
                  notification.metadata,
                  notification.read,
                  notification.readAt,
                  notification.emailSent,
                  notification.emailSentAt,
                  notification.createdAt,
                  notification.updatedAt
                )
              );
            }
          }

          this.logger.info('Created notifications batch', {
            user_id: userId,
            count: createdNotifications.length
          });

          return createdNotifications;
        });
      }
    } catch (error) {
      // Check if this is an RLS error
      const err = error instanceof Error ? error : new Error(String(error));
      const isRLSError = 
        err.message.includes('permission denied') || 
        err.message.includes('insufficient privilege');

      if (isRLSError) {
        throw new AppError(
          'Permission denied when creating notifications batch: RLS context issue',
          ErrorCode.RLS_CONTEXT_ERROR,
          { userId },
          err
        );
      }

      throw new AppError(
        `Failed to create notifications batch: ${err.message}`,
        ErrorCode.NOTIFICATION_CREATION_ERROR,
        { userId, count: notifications.length },
        err
      );
    }
  }

  /**
   * Marks a notification as read
   * @param notificationId ID of the notification
   * @param userId ID of the user (for security)
   * @returns The updated notification
   */
  async markAsRead(notificationId: string, userId: string): Promise<Notification | null> {
    try {
      const result = await this.db.query(
        `UPDATE notifications
        SET read = true, read_at = $1, updated_at = $1
        WHERE id = $2 AND user_id = $3
        RETURNING *`,
        [new Date(), notificationId, userId],
        { setContext: userId }
      );

      if (result.rows.length === 0) {
        return null;
      }

      const row = result.rows[0];
      return this.mapRowToNotification(row);
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      throw new AppError(
        `Failed to mark notification as read: ${err.message}`,
        ErrorCode.DATABASE_ERROR,
        { notificationId, userId },
        err
      );
    }
  }

  /**
   * Marks a notification as having email sent
   * @param notificationId ID of the notification
   * @returns The updated notification
   */
  async markEmailSent(notificationId: string): Promise<Notification | null> {
    try {
      const result = await this.db.query(
        `UPDATE notifications
        SET email_sent = true, email_sent_at = $1, updated_at = $1
        WHERE id = $2
        RETURNING *`,
        [new Date(), notificationId]
      );

      if (result.rows.length === 0) {
        return null;
      }

      const row = result.rows[0];
      return this.mapRowToNotification(row);
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      throw new AppError(
        `Failed to mark notification email as sent: ${err.message}`,
        ErrorCode.DATABASE_ERROR,
        { notificationId },
        err
      );
    }
  }

  /**
   * Checks if a similar notification exists to prevent duplicates
   * @param userId User ID
   * @param content Content to check
   * @param timeWindowMinutes Time window to check in minutes (default: from config)
   * @returns True if a similar notification exists
   */
  async checkDuplicate(
    userId: string,
    content: {
      title: string;
      sourceUrl?: string;
      entityType?: string;
      metadata?: Record<string, unknown>;
    },
    timeWindowMinutes?: number
  ): Promise<boolean> {
    try {
      const window = timeWindowMinutes || this.config.deduplicationWindowMinutes;
      
      // Perform the duplicate check
      let query = `
        SELECT EXISTS (
          SELECT 1 FROM notifications
          WHERE user_id = $1
            AND title = $2
            AND created_at > NOW() - INTERVAL '${window} minutes'
      `;

      const params: any[] = [userId, content.title];
      let paramIndex = 3;

      // Add source URL condition if provided
      if (content.sourceUrl) {
        query += ` AND source_url = $${paramIndex}`;
        params.push(content.sourceUrl);
        paramIndex++;
      }

      // Add entity type condition if provided
      if (content.entityType) {
        query += ` AND entity_type = $${paramIndex}`;
        params.push(content.entityType);
        paramIndex++;
      }

      // Close the query
      query += `)`;

      const result = await this.db.query(query, params, { setContext: userId });
      return result.rows[0]?.exists || false;
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.logger.warn('Error checking for duplicate notification', {
        error: err.message,
        userId,
        title: content.title
      });
      
      // In case of error, assume it's not a duplicate to ensure delivery
      return false;
    }
  }

  /**
   * Maps a database row to a Notification entity
   * @param row Database row
   * @returns Notification entity
   */
  private mapRowToNotification(row: any): Notification {
    return new Notification(
      row.id,
      row.user_id,
      row.subscription_id,
      row.title,
      row.content,
      row.source_url,
      row.entity_type,
      row.metadata || {},
      row.read,
      row.read_at,
      row.email_sent,
      row.email_sent_at,
      row.created_at,
      row.updated_at
    );
  }
}