/**
 * @file Notification service interface
 * Defines the core domain service for notification business logic
 */

import { ProcessorMessage } from '../models/message';
import { Notification, NotificationCreationResult, EmailNotification } from '../models/notification';

/**
 * NotificationService interface
 * Core domain service for notification creation and management
 */
export interface NotificationService {
  /**
   * Process a message to create notifications
   * @param message - The processor message
   * @returns Result with notification creation statistics
   */
  processMessage(message: ProcessorMessage): Promise<NotificationCreationResult>;
  
  /**
   * Create a single notification
   * @param notification - The notification to create
   * @returns The created notification with ID
   */
  createNotification(notification: Notification): Promise<Notification>;
  
  /**
   * Create multiple notifications in batch
   * @param userId - The user ID
   * @param subscriptionId - The subscription ID
   * @param notifications - Array of notification data
   * @returns Result with creation statistics
   */
  createNotifications(
    userId: string,
    subscriptionId: string,
    notifications: Array<{
      title: string;
      content: string;
      sourceUrl: string;
      metadata: any;
      entityType: string;
    }>
  ): Promise<NotificationCreationResult>;
  
  /**
   * Publish email notification
   * @param notification - The notification to publish
   * @param email - The recipient email
   * @param immediate - Whether to send immediately or in digest
   * @returns The message ID if successful, null otherwise
   */
  publishEmailNotification(
    notification: Notification,
    email: string,
    immediate: boolean
  ): Promise<string | null>;
  
  /**
   * Check if a user should receive immediate email notifications
   * @param userId - The user ID to check
   * @returns Whether immediate notification should be sent and the user's email
   */
  shouldSendImmediateEmail(userId: string): Promise<{
    shouldSend: boolean;
    email: string | null;
  }>;
  
  /**
   * Trigger a realtime notification via WebSocket
   * @param notification - The notification to send
   * @returns Whether the notification was sent successfully
   */
  triggerRealtimeNotification(notification: Notification): Promise<boolean>;
}