import { Notification } from '../entities/Notification.js';

/**
 * Options for creating notifications
 */
export interface CreateNotificationOptions {
  setRlsContext?: boolean;
}

/**
 * Interface for notification repository operations
 */
export interface NotificationRepository {
  /**
   * Creates a new notification
   * @param notification Notification to create
   * @param options Creation options
   * @returns The created notification with ID
   */
  createNotification(
    notification: Notification,
    options?: CreateNotificationOptions
  ): Promise<Notification>;

  /**
   * Creates multiple notifications in a batch
   * @param notifications Array of notifications to create
   * @param options Creation options
   * @returns Array of created notifications with IDs
   */
  createNotifications(
    notifications: Notification[],
    options?: CreateNotificationOptions
  ): Promise<Notification[]>;

  /**
   * Marks a notification as read
   * @param notificationId ID of the notification
   * @param userId ID of the user (for security)
   * @returns The updated notification
   */
  markAsRead(notificationId: string, userId: string): Promise<Notification | null>;

  /**
   * Marks a notification as having email sent
   * @param notificationId ID of the notification
   * @returns The updated notification
   */
  markEmailSent(notificationId: string): Promise<Notification | null>;

  /**
   * Checks if a similar notification exists to prevent duplicates
   * @param userId User ID
   * @param content Content to check
   * @param timeWindowMinutes Time window to check in minutes (default: 1440 = 24 hours)
   * @returns True if a similar notification exists
   */
  checkDuplicate(
    userId: string,
    content: {
      title: string;
      sourceUrl?: string;
      entityType?: string;
      metadata?: Record<string, unknown>;
    },
    timeWindowMinutes?: number
  ): Promise<boolean>;
}