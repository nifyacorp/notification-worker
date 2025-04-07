/**
 * @file Mock notification repository implementation
 * Provides a mock repository for testing without a database
 */

import { 
  Notification, 
  NotificationCreationResult,
  NotificationStatus
} from '../../domain/models/notification';
import { NotificationRepository } from '../../domain/repositories/notification-repository';
import { Logger } from '../../shared/logger/logger';
import { v4 as uuidv4 } from 'uuid';

/**
 * Mock implementation of NotificationRepository for testing
 */
export class MockNotificationRepository implements NotificationRepository {
  private notifications: Notification[] = [];
  
  /**
   * Constructor
   * @param logger - Logger instance
   */
  constructor(private readonly logger: Logger) {}
  
  /**
   * Create a single notification
   * @param notification - The notification to create
   * @returns The created notification with ID
   */
  public async createNotification(notification: Notification): Promise<Notification> {
    // Generate an ID if not provided
    const newNotification = {
      ...notification,
      id: notification.id || uuidv4(),
      status: NotificationStatus.UNREAD,
      createdAt: new Date(),
      updatedAt: new Date()
    };
    
    // Store notification
    this.notifications.push(newNotification);
    
    this.logger.info('Created notification in mock repository', {
      notification_id: newNotification.id,
      user_id: newNotification.userId,
      subscription_id: newNotification.subscriptionId
    });
    
    return newNotification;
  }
  
  /**
   * Create multiple notifications in batch
   * @param notifications - Array of notifications to create
   * @returns Result with creation statistics
   */
  public async createNotifications(notifications: Notification[]): Promise<NotificationCreationResult> {
    const result: NotificationCreationResult = {
      created: 0,
      errors: 0,
      details: []
    };
    
    // Process each notification
    for (const notification of notifications) {
      try {
        const created = await this.createNotification(notification);
        
        result.created++;
        result.details?.push({
          success: true,
          id: created.id
        });
      } catch (error) {
        result.errors++;
        result.details?.push({
          success: false,
          error: (error as Error).message
        });
        
        this.logger.error('Failed to create notification in mock repository', {
          error: (error as Error).message,
          user_id: notification.userId,
          subscription_id: notification.subscriptionId
        });
      }
    }
    
    this.logger.info('Notification batch creation completed in mock repository', {
      total: notifications.length,
      created: result.created,
      errors: result.errors
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
    // Filter notifications by user ID
    let result = this.notifications.filter(n => n.userId === userId);
    
    // Apply filters
    if (options.status) {
      result = result.filter(n => n.status === options.status);
    }
    
    if (options.entityType) {
      result = result.filter(n => n.entityType === options.entityType);
    }
    
    // Sort by createdAt in descending order
    result.sort((a, b) => {
      const dateA = a.createdAt instanceof Date ? a.createdAt : new Date(a.createdAt as any);
      const dateB = b.createdAt instanceof Date ? b.createdAt : new Date(b.createdAt as any);
      return dateB.getTime() - dateA.getTime();
    });
    
    // Apply pagination
    if (options.offset !== undefined) {
      result = result.slice(options.offset);
    }
    
    if (options.limit !== undefined) {
      result = result.slice(0, options.limit);
    }
    
    return result;
  }
  
  /**
   * Find a notification by ID
   * @param id - The notification ID
   * @returns The notification or null if not found
   */
  public async findById(id: string): Promise<Notification | null> {
    const notification = this.notifications.find(n => n.id === id);
    return notification || null;
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
    // Filter notifications by user ID
    let count = this.notifications.filter(n => n.userId === userId);
    
    // Apply filters
    if (filters.status) {
      count = count.filter(n => n.status === filters.status);
    }
    
    if (filters.entityType) {
      count = count.filter(n => n.entityType === filters.entityType);
    }
    
    if (filters.startDate) {
      count = count.filter(n => {
        const createdAt = n.createdAt instanceof Date ? n.createdAt : new Date(n.createdAt as any);
        return createdAt >= filters.startDate!;
      });
    }
    
    if (filters.endDate) {
      count = count.filter(n => {
        const createdAt = n.createdAt instanceof Date ? n.createdAt : new Date(n.createdAt as any);
        return createdAt <= filters.endDate!;
      });
    }
    
    return count.length;
  }
  
  /**
   * Update notification status
   * @param id - The notification ID
   * @param status - The new status
   * @param userId - The user ID (for RLS context)
   * @returns Success indicator
   */
  public async updateStatus(id: string, status: string, userId: string): Promise<boolean> {
    const index = this.notifications.findIndex(n => n.id === id && n.userId === userId);
    
    if (index === -1) {
      return false;
    }
    
    // Update status
    this.notifications[index] = {
      ...this.notifications[index],
      status,
      updatedAt: new Date()
    };
    
    return true;
  }
  
  /**
   * Mark all notifications as read for a user
   * @param userId - The user ID
   * @returns The number of updated notifications
   */
  public async markAllAsRead(userId: string): Promise<number> {
    const unreadNotifications = this.notifications.filter(
      n => n.userId === userId && n.status === NotificationStatus.UNREAD
    );
    
    for (const notification of unreadNotifications) {
      await this.updateStatus(notification.id!, NotificationStatus.READ, userId);
    }
    
    return unreadNotifications.length;
  }
}