/**
 * @file Notification repository interface
 * Defines the contract for notification data persistence
 */
import { Notification, NotificationCreationResult } from '../models/notification';
/**
 * NotificationRepository interface
 * Defines the contract for notification database operations
 */
export interface NotificationRepository {
    /**
     * Create a single notification
     * @param notification - The notification to create
     * @returns The created notification with ID
     */
    createNotification(notification: Notification): Promise<Notification>;
    /**
     * Create multiple notifications in batch
     * @param notifications - Array of notifications to create
     * @returns Result with creation statistics
     */
    createNotifications(notifications: Notification[]): Promise<NotificationCreationResult>;
    /**
     * Find notifications by user ID
     * @param userId - The user ID to search for
     * @param options - Query options (pagination, filters)
     * @returns Array of notifications
     */
    findByUserId(userId: string, options?: {
        limit?: number;
        offset?: number;
        status?: string;
        entityType?: string;
    }): Promise<Notification[]>;
    /**
     * Find a notification by ID
     * @param id - The notification ID
     * @returns The notification or null if not found
     */
    findById(id: string): Promise<Notification | null>;
    /**
     * Count notifications by user ID with filters
     * @param userId - The user ID
     * @param filters - Optional filters
     * @returns Count of notifications
     */
    countByUserId(userId: string, filters?: {
        status?: string;
        entityType?: string;
        startDate?: Date;
        endDate?: Date;
    }): Promise<number>;
    /**
     * Update notification status
     * @param id - The notification ID
     * @param status - The new status
     * @param userId - The user ID (for RLS context)
     * @returns Success indicator
     */
    updateStatus(id: string, status: string, userId: string): Promise<boolean>;
    /**
     * Mark all notifications as read for a user
     * @param userId - The user ID
     * @returns The number of updated notifications
     */
    markAllAsRead(userId: string): Promise<number>;
}
