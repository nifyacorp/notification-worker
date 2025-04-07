import { Notification } from '../entities/Notification.js';

/**
 * Types of email notifications
 */
export type EmailType = 'immediate' | 'digest';

/**
 * Notification content for email
 */
export interface EmailNotificationContent {
  id: string;
  title: string;
  content: string;
  sourceUrl: string;
  subscriptionName: string;
  createdAt: string;
}

/**
 * Represents an email notification to be sent
 */
export class EmailNotification {
  constructor(
    public readonly userId: string,
    public readonly email: string,
    public readonly type: EmailType,
    public readonly notifications: EmailNotificationContent[],
    public readonly timestamp: Date = new Date()
  ) {}

  /**
   * Creates an email notification from a notification and user data
   * @param notification The notification entity
   * @param email The user's email address
   * @param subscriptionName The subscription name
   * @param type The email type (immediate or digest)
   * @returns A new EmailNotification instance
   */
  static fromNotification(
    notification: Notification,
    email: string,
    subscriptionName: string,
    type: EmailType
  ): EmailNotification {
    const content: EmailNotificationContent = {
      id: notification.id || '',
      title: notification.title,
      content: notification.content,
      sourceUrl: notification.sourceUrl,
      subscriptionName: subscriptionName || 'NIFYA Alert',
      createdAt: notification.createdAt.toISOString(),
    };

    return new EmailNotification(notification.userId, email, type, [content]);
  }

  /**
   * Creates a JSON representation of the email notification
   * @returns Plain object representation for PubSub
   */
  toJSON(): Record<string, unknown> {
    return {
      user_id: this.userId,
      email: this.email,
      type: this.type,
      notifications: this.notifications,
      timestamp: this.timestamp.toISOString(),
    };
  }
}