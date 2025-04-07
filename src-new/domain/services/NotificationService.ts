import { Notification } from '../entities/Notification.js';
import { SubscriptionResult } from '../valueObjects/SubscriptionResult.js';

/**
 * Result of processing subscription results
 */
export interface ProcessingResult {
  created: number;
  errors: number;
  duplicates: number;
  emailsSent: number;
}

/**
 * Interface for domain notification service
 */
export interface NotificationService {
  /**
   * Processes subscription results to create notifications
   * @param result Subscription processing result
   * @returns Processing statistics
   */
  processSubscriptionResult(result: SubscriptionResult): Promise<ProcessingResult>;
  
  /**
   * Creates a notification and handles email/realtime delivery
   * @param notification Notification to create
   * @returns Created notification with ID
   */
  createAndDeliverNotification(notification: Notification): Promise<Notification>;
  
  /**
   * Sends an email notification for a specific notification
   * @param notificationId Notification ID to send email for
   * @returns True if email was sent successfully
   */
  sendEmailForNotification(notificationId: string): Promise<boolean>;
}