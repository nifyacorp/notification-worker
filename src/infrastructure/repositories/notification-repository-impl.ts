/**
 * @file Notification repository implementation
 * Implements database operations for notifications
 */

import { 
  Notification, 
  NotificationCreationResult,
  NotificationStatus,
  EntityType
} from '../../domain/models/notification';
import { NotificationRepository } from '../../domain/repositories/notification-repository';
import { DatabaseConnection } from '../database/connection';
import { Logger } from '../../shared/logger/logger';
import { DatabaseError, ErrorCode } from '../../shared/errors/app-error';

/**
 * PostgreSQL implementation of NotificationRepository
 */
export class PostgresNotificationRepository implements NotificationRepository {
  /**
   * Constructor
   * @param db - Database connection
   * @param logger - Logger instance
   */
  constructor(
    private readonly db: DatabaseConnection,
    private readonly logger: Logger
  ) {}
  
  /**
   * Create a single notification
   * @param notification - The notification to create
   * @returns The created notification with ID
   */
  public async createNotification(notification: Notification): Promise<Notification> {
    try {
      // Set RLS context for the user to bypass RLS policies
      await this.db.setRLSContext(notification.userId);
      
      // Convert metadata to string if it's an object
      const metadata = typeof notification.metadata === 'object'
        ? JSON.stringify(notification.metadata)
        : notification.metadata;
      
      const result = await this.db.query<{ id: string }>(
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
          notification.userId,
          notification.subscriptionId,
          notification.title || 'Notification',
          notification.content || '',
          notification.sourceUrl || '',
          metadata,
          notification.entityType || EntityType.GENERIC,
          notification.createdAt || new Date()
        ]
      );
      
      this.logger.info('Created notification with RLS context', {
        user_id: notification.userId,
        subscription_id: notification.subscriptionId,
        notification_id: result.rows[0]?.id,
        entity_type: notification.entityType
      });
      
      return {
        ...notification,
        id: result.rows[0]?.id,
        status: NotificationStatus.UNREAD,
        createdAt: notification.createdAt || new Date(),
        updatedAt: notification.createdAt || new Date()
      };
    } catch (error) {
      this.logger.error('Failed to create notification', {
        error: (error as Error).message,
        user_id: notification.userId,
        subscription_id: notification.subscriptionId
      });
      
      throw new DatabaseError(
        'Failed to create notification',
        ErrorCode.DB_QUERY,
        {
          userId: notification.userId,
          subscriptionId: notification.subscriptionId
        },
        error as Error
      );
    }
  }
  
  /**
   * Create multiple notifications in batch
   * @param notifications - Array of notifications to create
   * @returns Result with creation statistics
   */
  public async createNotifications(notifications: Notification[]): Promise<NotificationCreationResult> {
    // If the array is empty, return early
    if (!notifications.length) {
      return { created: 0, errors: 0, details: [] };
    }
    
    const result: NotificationCreationResult = {
      created: 0,
      errors: 0,
      details: []
    };
    
    // Get the user ID from the first notification
    const userId = notifications[0].userId;
    
    // Set RLS context for the user to bypass RLS policies
    try {
      await this.db.setRLSContext(userId);
      this.logger.debug('Set RLS context for batch notifications', { user_id: userId });
    } catch (rlsError) {
      this.logger.warn('Failed to set RLS context for batch notifications', {
        error: (rlsError as Error).message,
        user_id: userId
      });
      // Continue anyway, as the service role might have direct table access
    }
    
    // Process each notification
    for (const notification of notifications) {
      try {
        // Convert metadata to string if it's an object
        const metadata = typeof notification.metadata === 'object'
          ? JSON.stringify(notification.metadata)
          : notification.metadata;
          
        const insertResult = await this.db.query<{ id: string }>(
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
            notification.userId,
            notification.subscriptionId,
            notification.title || 'Notification',
            notification.content || '',
            notification.sourceUrl || '',
            metadata,
            notification.entityType || EntityType.GENERIC,
            notification.createdAt || new Date()
          ]
        );
        
        result.created++;
        result.details?.push({
          success: true,
          id: insertResult.rows[0]?.id
        });
        
        this.logger.info('Created notification in batch', {
          notification_id: insertResult.rows[0]?.id,
          user_id: notification.userId,
          subscription_id: notification.subscriptionId,
          entity_type: notification.entityType
        });
      } catch (error) {
        result.errors++;
        result.details?.push({
          success: false,
          error: (error as Error).message
        });
        
        this.logger.error('Failed to create notification in batch', {
          error: (error as Error).message,
          user_id: notification.userId,
          subscription_id: notification.subscriptionId,
          title: notification.title
        });
        
        // Continue processing other notifications
      }
    }
    
    this.logger.info('Notification batch creation completed', {
      total: notifications.length,
      created: result.created,
      errors: result.errors,
      success_rate: notifications.length > 0 
        ? `${Math.round((result.created / notifications.length) * 100)}%` 
        : '0%'
    });
    
    return result;
  }
  
  /**
   * Find notifications by user ID
   * @param userId - The user ID to search for
   * @param options - Query options (pagination, filters)
   * @returns Array of notifications
   */
  public async findByUserId(
    userId: string, 
    options: { 
      limit?: number; 
      offset?: number; 
      status?: string;
      entityType?: string;
    } = {}
  ): Promise<Notification[]> {
    try {
      // Set RLS context
      await this.db.setRLSContext(userId);
      
      // Build query
      let query = `
        SELECT 
          id, user_id, subscription_id, title, content, source_url, 
          metadata, entity_type, status, created_at, updated_at
        FROM notifications
        WHERE user_id = $1
      `;
      
      const queryParams: any[] = [userId];
      let paramIndex = 2;
      
      // Add filters
      if (options.status) {
        query += ` AND status = $${paramIndex++}`;
        queryParams.push(options.status);
      }
      
      if (options.entityType) {
        query += ` AND entity_type = $${paramIndex++}`;
        queryParams.push(options.entityType);
      }
      
      // Add order by
      query += ' ORDER BY created_at DESC';
      
      // Add pagination
      if (options.limit) {
        query += ` LIMIT $${paramIndex++}`;
        queryParams.push(options.limit);
      }
      
      if (options.offset) {
        query += ` OFFSET $${paramIndex++}`;
        queryParams.push(options.offset);
      }
      
      // Execute query
      const result = await this.db.query<any>(query, queryParams);
      
      // Map results to domain model
      return result.rows.map(row => ({
        id: row.id,
        userId: row.user_id,
        subscriptionId: row.subscription_id,
        title: row.title,
        content: row.content,
        sourceUrl: row.source_url,
        metadata: typeof row.metadata === 'string' 
          ? JSON.parse(row.metadata) 
          : row.metadata,
        entityType: row.entity_type,
        status: row.status,
        createdAt: row.created_at,
        updatedAt: row.updated_at
      }));
    } catch (error) {
      this.logger.error('Failed to find notifications by user ID', {
        error: (error as Error).message,
        user_id: userId
      });
      
      throw new DatabaseError(
        'Failed to find notifications by user ID',
        ErrorCode.DB_QUERY,
        { userId },
        error as Error
      );
    }
  }
  
  /**
   * Find a notification by ID
   * @param id - The notification ID
   * @returns The notification or null if not found
   */
  public async findById(id: string): Promise<Notification | null> {
    try {
      const result = await this.db.query<any>(
        `SELECT 
          id, user_id, subscription_id, title, content, source_url, 
          metadata, entity_type, status, created_at, updated_at
        FROM notifications
        WHERE id = $1`,
        [id]
      );
      
      if (result.rows.length === 0) {
        return null;
      }
      
      const row = result.rows[0];
      
      // Set RLS context for the user ID
      await this.db.setRLSContext(row.user_id);
      
      // Re-check with RLS context
      const withRlsResult = await this.db.query<any>(
        `SELECT id FROM notifications WHERE id = $1`,
        [id]
      );
      
      // If not found with RLS, user doesn't have access
      if (withRlsResult.rows.length === 0) {
        return null;
      }
      
      // Map to domain model
      return {
        id: row.id,
        userId: row.user_id,
        subscriptionId: row.subscription_id,
        title: row.title,
        content: row.content,
        sourceUrl: row.source_url,
        metadata: typeof row.metadata === 'string' 
          ? JSON.parse(row.metadata) 
          : row.metadata,
        entityType: row.entity_type,
        status: row.status,
        createdAt: row.created_at,
        updatedAt: row.updated_at
      };
    } catch (error) {
      this.logger.error('Failed to find notification by ID', {
        error: (error as Error).message,
        notification_id: id
      });
      
      throw new DatabaseError(
        'Failed to find notification by ID',
        ErrorCode.DB_QUERY,
        { notificationId: id },
        error as Error
      );
    }
  }
  
  /**
   * Count notifications by user ID with filters
   * @param userId - The user ID
   * @param filters - Optional filters
   * @returns Count of notifications
   */
  public async countByUserId(
    userId: string, 
    filters: { 
      status?: string;
      entityType?: string;
      startDate?: Date;
      endDate?: Date;
    } = {}
  ): Promise<number> {
    try {
      // Set RLS context
      await this.db.setRLSContext(userId);
      
      // Build query
      let query = `
        SELECT COUNT(*) as count
        FROM notifications
        WHERE user_id = $1
      `;
      
      const queryParams: any[] = [userId];
      let paramIndex = 2;
      
      // Add filters
      if (filters.status) {
        query += ` AND status = $${paramIndex++}`;
        queryParams.push(filters.status);
      }
      
      if (filters.entityType) {
        query += ` AND entity_type = $${paramIndex++}`;
        queryParams.push(filters.entityType);
      }
      
      if (filters.startDate) {
        query += ` AND created_at >= $${paramIndex++}`;
        queryParams.push(filters.startDate);
      }
      
      if (filters.endDate) {
        query += ` AND created_at <= $${paramIndex++}`;
        queryParams.push(filters.endDate);
      }
      
      // Execute query
      const result = await this.db.query<{ count: string }>(query, queryParams);
      
      return parseInt(result.rows[0]?.count || '0', 10);
    } catch (error) {
      this.logger.error('Failed to count notifications by user ID', {
        error: (error as Error).message,
        user_id: userId
      });
      
      throw new DatabaseError(
        'Failed to count notifications by user ID',
        ErrorCode.DB_QUERY,
        { userId },
        error as Error
      );
    }
  }
  
  /**
   * Update notification status
   * @param id - The notification ID
   * @param status - The new status
   * @param userId - The user ID (for RLS context)
   * @returns Success indicator
   */
  public async updateStatus(id: string, status: string, userId: string): Promise<boolean> {
    try {
      // Set RLS context
      await this.db.setRLSContext(userId);
      
      const result = await this.db.query(
        `UPDATE notifications
        SET status = $1, updated_at = NOW()
        WHERE id = $2 AND user_id = $3
        RETURNING id`,
        [status, id, userId]
      );
      
      return result.rowCount > 0;
    } catch (error) {
      this.logger.error('Failed to update notification status', {
        error: (error as Error).message,
        notification_id: id,
        user_id: userId,
        status
      });
      
      throw new DatabaseError(
        'Failed to update notification status',
        ErrorCode.DB_QUERY,
        { notificationId: id, userId, status },
        error as Error
      );
    }
  }
  
  /**
   * Mark all notifications as read for a user
   * @param userId - The user ID
   * @returns The number of updated notifications
   */
  public async markAllAsRead(userId: string): Promise<number> {
    try {
      // Set RLS context
      await this.db.setRLSContext(userId);
      
      const result = await this.db.query(
        `UPDATE notifications
        SET status = $1, updated_at = NOW()
        WHERE user_id = $2 AND status = $3
        RETURNING id`,
        [NotificationStatus.READ, userId, NotificationStatus.UNREAD]
      );
      
      this.logger.info('Marked all notifications as read', {
        user_id: userId,
        count: result.rowCount
      });
      
      return result.rowCount;
    } catch (error) {
      this.logger.error('Failed to mark all notifications as read', {
        error: (error as Error).message,
        user_id: userId
      });
      
      throw new DatabaseError(
        'Failed to mark all notifications as read',
        ErrorCode.DB_QUERY,
        { userId },
        error as Error
      );
    }
  }
}