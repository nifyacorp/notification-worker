/**
 * @file Notification service implementation
 * Core service for notification creation and management
 */
import { Notification, NotificationCreationResult } from '../../domain/models/notification';
import { ProcessorMessage } from '../../domain/models/message';
import { NotificationService } from '../../domain/services/notification-service';
import { NotificationRepository } from '../../domain/repositories/notification-repository';
import { ProcessorRegistry } from '../../domain/services/processor-registry';
import { Logger } from '../../shared/logger/logger';
import { DatabaseConnection } from '../../infrastructure/database/connection';
import { PubSubService } from '../../domain/services/pubsub-service';
/**
 * DefaultNotificationService implementation
 * Core service for notification creation and delivery
 */
export declare class DefaultNotificationService implements NotificationService {
    private readonly notificationRepository;
    private readonly processorRegistry;
    private readonly dbConnection;
    private readonly pubSubService;
    private readonly logger;
    /**
     * Constructor
     * @param notificationRepository - Repository for notification operations
     * @param processorRegistry - Registry for message processors
     * @param dbConnection - Database connection
     * @param pubSubService - PubSub service for publishing
     * @param logger - Logger instance
     */
    constructor(notificationRepository: NotificationRepository, processorRegistry: ProcessorRegistry, dbConnection: DatabaseConnection, pubSubService: PubSubService, logger: Logger);
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
    createNotifications(userId: string, subscriptionId: string, notifications: Array<{
        title: string;
        content: string;
        sourceUrl: string;
        metadata: any;
        entityType: string;
    }>): Promise<NotificationCreationResult>;
    /**
     * Publish email notification
     * @param notification - The notification to publish
     * @param email - The recipient email
     * @param immediate - Whether to send immediately or in digest
     * @returns The message ID if successful, null otherwise
     */
    publishEmailNotification(notification: Notification & {
        subscriptionName?: string;
    }, email: string, immediate: boolean): Promise<string | null>;
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
