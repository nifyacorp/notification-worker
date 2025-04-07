/**
 * @file Google PubSub service implementation
 * Implements PubSub operations using Google Cloud PubSub
 */
import { PubSub } from '@google-cloud/pubsub';
import { config } from '../../shared/config/config';
import { withRetry } from '../../shared/utils/retry';
import { PubSubError, ErrorCode } from '../../shared/errors/app-error';
/**
 * GooglePubSubService implementation
 * Implements PubSub operations using Google Cloud PubSub
 */
export class GooglePubSubService {
    logger;
    pubSubClient;
    mainSubscription;
    dlqTopic;
    topics = new Map();
    subscriptionStatus = {
        active: false,
        name: ''
    };
    /**
     * Constructor
     * @param logger - Logger instance
     */
    constructor(logger) {
        this.logger = logger;
        this.pubSubClient = new PubSub({
            projectId: config.projectId
        });
    }
    /**
     * Initialize the PubSub client and resources
     * @returns Promise resolving when initialization is complete
     */
    async initialize() {
        try {
            // Initialize main subscription
            if (config.pubsub.subscription) {
                this.subscriptionStatus.name = config.pubsub.subscription;
                this.logger.info('Initializing PubSub subscription', {
                    subscription: config.pubsub.subscription
                });
                this.mainSubscription = this.pubSubClient.subscription(config.pubsub.subscription);
                this.subscriptionStatus.active = true;
            }
            else {
                this.logger.warn('No main subscription configured');
            }
            // Initialize DLQ topic
            if (config.pubsub.dlqTopic) {
                this.logger.info('Initializing DLQ topic', { topic: config.pubsub.dlqTopic });
                this.dlqTopic = this.pubSubClient.topic(config.pubsub.dlqTopic);
                // Ensure DLQ topic exists
                const [exists] = await this.dlqTopic.exists();
                if (!exists) {
                    this.logger.warn('DLQ topic does not exist, creating it', {
                        topic: config.pubsub.dlqTopic
                    });
                    await this.dlqTopic.create();
                }
            }
            else {
                this.logger.warn('No DLQ topic configured');
            }
            // Initialize email topics
            await this.getOrCreateTopic(config.pubsub.emailImmediateTopic);
            await this.getOrCreateTopic(config.pubsub.emailDailyTopic);
            this.logger.info('PubSub service initialized', {
                subscription: config.pubsub.subscription,
                dlq_topic: config.pubsub.dlqTopic,
                email_immediate_topic: config.pubsub.emailImmediateTopic,
                email_daily_topic: config.pubsub.emailDailyTopic
            });
        }
        catch (error) {
            this.logger.error('Failed to initialize PubSub service', {
                error: error.message,
                stack: error.stack
            });
            throw new PubSubError(`Failed to initialize PubSub service: ${error.message}`, ErrorCode.PUBSUB_CONNECTION, { projectId: config.projectId }, error);
        }
    }
    /**
     * Get subscription status
     * @returns Current subscription status
     */
    getSubscriptionStatus() {
        return this.subscriptionStatus;
    }
    /**
     * Publish a message to a topic
     * @param topicName - The topic to publish to
     * @param data - The message data
     * @returns The message ID if successful
     */
    async publishTopic(topicName, data) {
        try {
            const topic = await this.getOrCreateTopic(topicName);
            // Convert data to JSON string if it's an object
            const dataBuffer = Buffer.from(typeof data === 'string' ? data : JSON.stringify(data));
            const messageId = await withRetry(() => topic.publish(dataBuffer), {
                name: 'pubsub.publish',
                maxRetries: config.retry.pubsub.maxRetries,
                initialDelay: config.retry.pubsub.initialDelay,
                context: { topic: topicName }
            });
            this.logger.debug('Published message to topic', {
                topic: topicName,
                message_id: messageId
            });
            return messageId;
        }
        catch (error) {
            this.logger.error('Failed to publish message to topic', {
                error: error.message,
                topic: topicName
            });
            throw new PubSubError(`Failed to publish to topic "${topicName}": ${error.message}`, ErrorCode.PUBSUB_PUBLISH, { topicName }, error);
        }
    }
    /**
     * Publish a message to the dead letter queue
     * @param data - The original message data
     * @param error - The error that caused the DLQ routing
     * @returns The message ID if successful
     */
    async publishToDLQ(data, error) {
        if (!this.dlqTopic) {
            this.logger.warn('DLQ topic not configured, cannot publish dead letter');
            return '';
        }
        try {
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
            const dataBuffer = Buffer.from(JSON.stringify(dlqMessage));
            const messageId = await withRetry(() => this.dlqTopic.publish(dataBuffer), {
                name: 'pubsub.publishDLQ',
                maxRetries: config.retry.pubsub.maxRetries,
                initialDelay: config.retry.pubsub.initialDelay,
                context: { topic: config.pubsub.dlqTopic }
            });
            this.logger.info('Published message to DLQ', {
                message_id: messageId,
                error: error.message
            });
            return messageId;
        }
        catch (dlqError) {
            this.logger.error('Failed to publish message to DLQ', {
                error: dlqError.message,
                original_error: error.message
            });
            // Don't throw here - this is a best-effort operation
            return '';
        }
    }
    /**
     * Subscribe to a topic
     * @param topicName - The topic to subscribe to
     * @param subscriptionName - The subscription name
     * @param messageHandler - Function to handle incoming messages
     * @param errorHandler - Function to handle subscription errors
     * @returns Promise resolving when subscription is established
     */
    async subscribe(topicName, subscriptionName, messageHandler, errorHandler) {
        try {
            const topic = await this.getOrCreateTopic(topicName);
            const subscription = topic.subscription(subscriptionName);
            // Check if subscription exists
            const [exists] = await subscription.exists();
            if (!exists) {
                this.logger.info('Subscription does not exist, creating it', {
                    topic: topicName,
                    subscription: subscriptionName
                });
                await subscription.create();
            }
            // Set up message handler
            subscription.on('message', async (message) => {
                const messageId = message.id;
                const publishTime = message.publishTime.toISOString();
                try {
                    // Parse message data
                    const data = JSON.parse(message.data.toString());
                    // Call handler
                    await messageHandler(data, messageId, publishTime);
                    // Acknowledge message
                    message.ack();
                }
                catch (error) {
                    this.logger.error('Error handling subscription message', {
                        error: error.message,
                        subscription: subscriptionName,
                        message_id: messageId
                    });
                    // Negative acknowledge to retry
                    message.nack();
                }
            });
            // Set up error handler
            subscription.on('error', (error) => {
                this.logger.error('Subscription error', {
                    error: error.message,
                    subscription: subscriptionName
                });
                errorHandler(error);
            });
            this.logger.info('Successfully subscribed to topic', {
                topic: topicName,
                subscription: subscriptionName
            });
        }
        catch (error) {
            this.logger.error('Failed to subscribe to topic', {
                error: error.message,
                topic: topicName,
                subscription: subscriptionName
            });
            throw new PubSubError(`Failed to subscribe to topic "${topicName}": ${error.message}`, ErrorCode.PUBSUB_SUBSCRIBE, { topicName, subscriptionName }, error);
        }
    }
    /**
     * Close all PubSub connections
     * @returns Promise resolving when connections are closed
     */
    async close() {
        // Close main subscription
        if (this.mainSubscription) {
            this.logger.info('Closing main subscription', {
                subscription: this.subscriptionStatus.name
            });
            this.mainSubscription.removeAllListeners();
            await this.mainSubscription.close();
            this.subscriptionStatus.active = false;
        }
        this.logger.info('Closed PubSub connections');
    }
    /**
     * Get or create a topic
     * @param topicName - The topic name
     * @returns The topic
     */
    async getOrCreateTopic(topicName) {
        // Check if topic exists in cache
        if (this.topics.has(topicName)) {
            return this.topics.get(topicName);
        }
        // Get or create topic
        try {
            const topic = this.pubSubClient.topic(topicName);
            // Check if topic exists
            const [exists] = await topic.exists();
            if (!exists) {
                this.logger.info('Topic does not exist, creating it', { topic: topicName });
                await topic.create();
            }
            // Cache topic
            this.topics.set(topicName, topic);
            return topic;
        }
        catch (error) {
            this.logger.error('Failed to get or create topic', {
                error: error.message,
                topic: topicName
            });
            throw new PubSubError(`Failed to get or create topic "${topicName}": ${error.message}`, ErrorCode.PUBSUB_CONNECTION, { topicName }, error);
        }
    }
}
//# sourceMappingURL=pubsub-service-impl.js.map