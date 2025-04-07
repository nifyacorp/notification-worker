import { PubSub, Subscription, Topic, Message } from '@google-cloud/pubsub';
import { MessagingService } from '../../domain/services/MessagingService.js';
import { EmailNotification } from '../../domain/valueObjects/EmailNotification.js';
import { Config } from '../config/Config.js';
import { Logger } from '../logging/Logger.js';
import { AppError, ErrorCode } from '../../domain/errors/AppError.js';

/**
 * PubSub service for handling messaging
 */
export class PubSubService implements MessagingService {
  private pubsub: PubSub;
  private emailTopics: {
    immediate: Topic;
    daily: Topic;
  } | null = null;
  private dlqTopic: Topic | null = null;
  private realtimeTopic: Topic | null = null;
  private subscription: Subscription | null = null;

  /**
   * Creates a new PubSub service
   * @param config Application configuration
   * @param logger Logger service
   */
  constructor(
    private readonly config: Config,
    private readonly logger: Logger
  ) {
    this.pubsub = new PubSub({
      projectId: this.config.pubsub.projectId,
    });
  }

  /**
   * Initializes PubSub resources
   */
  async initialize(): Promise<void> {
    try {
      // Initialize topics
      this.emailTopics = {
        immediate: this.pubsub.topic(this.config.pubsub.emailTopics.immediate),
        daily: this.pubsub.topic(this.config.pubsub.emailTopics.daily),
      };
      
      this.dlqTopic = this.pubsub.topic(this.config.pubsub.deadLetterTopicName);
      this.realtimeTopic = this.pubsub.topic(this.config.pubsub.realtimeTopicName);
      
      // Get subscription
      this.subscription = this.pubsub.subscription(this.config.pubsub.subscriptionName);
      
      // Check if subscription exists
      const [exists] = await this.subscription.exists();
      if (!exists) {
        throw new AppError(
          `Subscription not found: ${this.config.pubsub.subscriptionName}`,
          ErrorCode.PUBSUB_ERROR,
          { subscriptionName: this.config.pubsub.subscriptionName }
        );
      }
      
      this.logger.info('PubSub resources initialized successfully', {
        subscription: this.config.pubsub.subscriptionName,
        project: this.config.pubsub.projectId,
        emailTopics: this.config.pubsub.emailTopics,
      });
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      throw new AppError(
        `Failed to initialize PubSub: ${err.message}`,
        ErrorCode.PUBSUB_ERROR,
        {
          projectId: this.config.pubsub.projectId,
          subscription: this.config.pubsub.subscriptionName,
        },
        err
      );
    }
  }

  /**
   * Gets the PubSub subscription
   * @returns PubSub subscription
   */
  getSubscription(): Subscription | null {
    return this.subscription;
  }

  /**
   * Publishes an email notification
   * @param emailNotification Email notification to publish
   * @returns Message ID if successful
   */
  async publishEmailNotification(emailNotification: EmailNotification): Promise<string | null> {
    try {
      if (!this.emailTopics) {
        throw new AppError(
          'Email topics not initialized',
          ErrorCode.PUBSUB_ERROR
        );
      }
      
      const topic = emailNotification.type === 'immediate' 
        ? this.emailTopics.immediate
        : this.emailTopics.daily;
      
      const messageData = JSON.stringify(emailNotification.toJSON());
      const dataBuffer = Buffer.from(messageData);
      
      const messageId = await topic.publish(dataBuffer);
      
      this.logger.info(`Published notification to ${emailNotification.type} email topic`, {
        user_id: emailNotification.userId,
        email_type: emailNotification.type,
        message_id: messageId,
        notification_count: emailNotification.notifications.length,
      });
      
      return messageId;
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.logger.error(`Failed to publish to ${emailNotification.type} email topic`, {
        error: err.message,
        user_id: emailNotification.userId,
        email_type: emailNotification.type,
      });
      
      return null;
    }
  }

  /**
   * Publishes a message to the dead-letter queue
   * @param message Original message that failed
   * @param error Error that occurred
   * @returns Message ID if successful
   */
  async publishToDLQ(message: unknown, error: Error): Promise<string | null> {
    try {
      if (!this.dlqTopic) {
        this.logger.warn('DLQ topic not initialized, skipping message');
        return null;
      }
      
      const dlqMessage = {
        original_message: message,
        error: {
          name: error.name,
          message: error.message,
          stack: error.stack,
        },
        timestamp: new Date().toISOString(),
      };
      
      const dataBuffer = Buffer.from(JSON.stringify(dlqMessage));
      const messageId = await this.dlqTopic.publish(dataBuffer);
      
      this.logger.info('Published message to DLQ', {
        message_id: messageId,
        error_type: error.name,
      });
      
      return messageId;
    } catch (dlqError) {
      const err = dlqError instanceof Error ? dlqError : new Error(String(dlqError));
      this.logger.error('Failed to publish to DLQ', {
        error: err.message,
        original_error: error.message,
      });
      
      return null;
    }
  }

  /**
   * Publishes a realtime notification
   * @param userId ID of the user to notify
   * @param notification Notification data
   * @returns Message ID if successful
   */
  async publishRealtimeNotification(
    userId: string,
    notification: Record<string, unknown>
  ): Promise<string | null> {
    try {
      if (!this.realtimeTopic) {
        this.logger.warn('Realtime topic not initialized, skipping message');
        return null;
      }
      
      const message = {
        user_id: userId,
        notification,
        timestamp: new Date().toISOString(),
      };
      
      const dataBuffer = Buffer.from(JSON.stringify(message));
      const messageId = await this.realtimeTopic.publish(dataBuffer);
      
      this.logger.info('Published realtime notification', {
        user_id: userId,
        message_id: messageId,
        notification_id: notification.id,
      });
      
      return messageId;
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.logger.error('Failed to publish realtime notification', {
        error: err.message,
        user_id: userId,
        notification_id: notification.id,
      });
      
      return null;
    }
  }

  /**
   * Setups up subscription message handler
   * @param messageHandler Function to handle incoming messages
   * @param errorHandler Function to handle subscription errors
   */
  setupSubscriptionHandler(
    messageHandler: (message: Message) => Promise<void>,
    errorHandler: (error: Error) => void
  ): void {
    if (!this.subscription) {
      throw new AppError(
        'Cannot set up subscription handler: subscription not initialized',
        ErrorCode.PUBSUB_ERROR
      );
    }
    
    // Remove any existing listeners
    this.subscription.removeAllListeners('message');
    this.subscription.removeAllListeners('error');
    
    // Add new listeners
    this.subscription.on('message', messageHandler);
    this.subscription.on('error', errorHandler);
    
    this.logger.info('Subscription message handler set up', {
      subscription_name: this.subscription.name,
    });
  }

  /**
   * Closes PubSub resources
   */
  async close(): Promise<void> {
    if (this.subscription) {
      this.subscription.removeAllListeners();
      await this.subscription.close();
    }
  }
}