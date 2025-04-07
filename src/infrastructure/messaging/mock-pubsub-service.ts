/**
 * @file Mock PubSub service implementation
 * Provides a mock implementation for local testing
 */

import { 
  PubSubService, 
  MessageHandler, 
  ErrorHandler, 
  SubscriptionStatus 
} from '../../domain/services/pubsub-service';
import { Logger } from '../../shared/logger/logger';
import { v4 as uuidv4 } from 'uuid';

/**
 * MockPubSubService implementation
 * Provides a mock implementation for local testing
 */
export class MockPubSubService implements PubSubService {
  private topics: Map<string, any[]> = new Map();
  private subscriptionStatus: SubscriptionStatus = {
    active: false,
    name: 'mock-subscription'
  };
  
  /**
   * Constructor
   * @param logger - Logger instance
   */
  constructor(private readonly logger: Logger) {}
  
  /**
   * Initialize the PubSub client and resources
   * @returns Promise resolving when initialization is complete
   */
  public async initialize(): Promise<void> {
    this.subscriptionStatus.active = true;
    this.logger.info('Mock PubSub service initialized');
  }
  
  /**
   * Get subscription status
   * @returns Current subscription status
   */
  public getSubscriptionStatus(): SubscriptionStatus {
    return this.subscriptionStatus;
  }
  
  /**
   * Publish a message to a topic
   * @param topicName - The topic to publish to
   * @param data - The message data
   * @returns The message ID if successful
   */
  public async publishTopic(topicName: string, data: any): Promise<string> {
    // Initialize topic if it doesn't exist
    if (!this.topics.has(topicName)) {
      this.topics.set(topicName, []);
    }
    
    // Generate message ID
    const messageId = uuidv4();
    
    // Add message to topic
    this.topics.get(topicName)?.push({
      id: messageId,
      data,
      publishTime: new Date().toISOString()
    });
    
    this.logger.info(`Published message to mock topic "${topicName}"`, {
      message_id: messageId,
      topic: topicName
    });
    
    return messageId;
  }
  
  /**
   * Publish a message to the dead letter queue
   * @param data - The original message data
   * @param error - The error that caused the DLQ routing
   * @returns The message ID if successful
   */
  public async publishToDLQ(data: any, error: Error): Promise<string> {
    const topicName = 'dead-letter-queue';
    
    // Create DLQ message with error details
    const dlqMessage = {
      original_data: data,
      error: {
        message: error.message,
        name: error.name,
        stack: error.stack
      },
      timestamp: new Date().toISOString()
    };
    
    const messageId = await this.publishTopic(topicName, dlqMessage);
    
    this.logger.info('Published message to mock DLQ', {
      message_id: messageId,
      error: error.message
    });
    
    return messageId;
  }
  
  /**
   * Subscribe to a topic
   * @param topicName - The topic to subscribe to
   * @param subscriptionName - The subscription name
   * @param messageHandler - Function to handle incoming messages
   * @param errorHandler - Function to handle subscription errors
   * @returns Promise resolving when subscription is established
   */
  public async subscribe(
    topicName: string,
    subscriptionName: string,
    messageHandler: MessageHandler,
    errorHandler: ErrorHandler
  ): Promise<void> {
    this.logger.info(`Subscribed to mock topic "${topicName}" with "${subscriptionName}"`, {
      topic: topicName,
      subscription: subscriptionName
    });
    
    // Update subscription status
    this.subscriptionStatus.name = subscriptionName;
    this.subscriptionStatus.active = true;
  }
  
  /**
   * Close all PubSub connections
   * @returns Promise resolving when connections are closed
   */
  public async close(): Promise<void> {
    this.logger.info('Closed mock PubSub connections');
    this.subscriptionStatus.active = false;
  }
}