/**
 * @file PubSub service interface
 * Defines the contract for PubSub operations
 */

/**
 * PubSub message handler function type
 */
export type MessageHandler = (message: any, messageId: string, publishTime: string) => Promise<void>;

/**
 * PubSub error handler function type
 */
export type ErrorHandler = (error: Error) => void;

/**
 * Subscription status
 */
export interface SubscriptionStatus {
  active: boolean;
  name: string;
}

/**
 * Message processor interface
 */
export interface PubSubService {
  /**
   * Initialize the PubSub client and resources
   * @returns Promise resolving when initialization is complete
   */
  initialize(): Promise<void>;
  
  /**
   * Get subscription status
   * @returns Current subscription status
   */
  getSubscriptionStatus(): SubscriptionStatus;
  
  /**
   * Publish a message to a topic
   * @param topicName - The topic to publish to
   * @param data - The message data
   * @returns The message ID if successful
   */
  publishTopic(topicName: string, data: any): Promise<string>;
  
  /**
   * Publish a message to the dead letter queue
   * @param data - The original message data
   * @param error - The error that caused the DLQ routing
   * @returns The message ID if successful
   */
  publishToDLQ(data: any, error: Error): Promise<string>;
  
  /**
   * Subscribe to a topic
   * @param topicName - The topic to subscribe to
   * @param subscriptionName - The subscription name
   * @param messageHandler - Function to handle incoming messages
   * @param errorHandler - Function to handle subscription errors
   * @returns Promise resolving when subscription is established
   */
  subscribe(
    topicName: string,
    subscriptionName: string,
    messageHandler: MessageHandler,
    errorHandler: ErrorHandler
  ): Promise<void>;
  
  /**
   * Close all PubSub connections
   * @returns Promise resolving when connections are closed
   */
  close(): Promise<void>;
}