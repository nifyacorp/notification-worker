import { EmailNotification } from '../valueObjects/EmailNotification.js';

/**
 * Interface for messaging service operations
 */
export interface MessagingService {
  /**
   * Publishes an email notification message
   * @param emailNotification The email notification to publish
   * @returns Message ID if successful, null otherwise
   */
  publishEmailNotification(emailNotification: EmailNotification): Promise<string | null>;
  
  /**
   * Publishes a message to the dead-letter queue
   * @param message The original message that failed
   * @param error The error that occurred
   * @returns Message ID if successful, null otherwise
   */
  publishToDLQ(message: unknown, error: Error): Promise<string | null>;
  
  /**
   * Publishes a realtime notification
   * @param userId The ID of the user to notify
   * @param notification Notification data to publish
   * @returns Message ID if successful, null otherwise
   */
  publishRealtimeNotification(
    userId: string, 
    notification: Record<string, unknown>
  ): Promise<string | null>;
}