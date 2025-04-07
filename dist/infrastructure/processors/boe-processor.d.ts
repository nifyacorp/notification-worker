/**
 * @file BOE message processor
 * Processor for BOE-specific messages
 */
import { MessageProcessor } from '../../domain/services/message-processor';
import { ProcessorMessage } from '../../domain/models/message';
import { NotificationCreationResult } from '../../domain/models/notification';
import { NotificationRepository } from '../../domain/repositories/notification-repository';
import { Logger } from '../../shared/logger/logger';
/**
 * BOEProcessor class for processing BOE messages
 */
export declare class BOEProcessor implements MessageProcessor {
    private readonly notificationRepository;
    private readonly logger;
    readonly processorType: any;
    readonly requiresDatabase = true;
    /**
     * Constructor
     * @param notificationRepository - Repository for notification operations
     * @param logger - Logger instance
     */
    constructor(notificationRepository: NotificationRepository, logger: Logger);
    /**
     * Process a BOE message
     * @param message - The message to process
     * @returns Result with notification creation statistics
     */
    process(message: ProcessorMessage): Promise<NotificationCreationResult>;
    /**
     * Validate a BOE message
     * @param message - The message to validate
     * @returns Whether the message is valid
     */
    validate(message: ProcessorMessage): boolean;
    /**
     * Transform a message to standardize its format
     * @param message - The message to transform
     * @returns The transformed message
     */
    transform(message: ProcessorMessage): Promise<ProcessorMessage>;
    /**
     * Determine the entity type based on the document
     * @param doc - The document
     * @returns The entity type
     */
    private determineEntityType;
    /**
     * Generate a notification title based on document data
     * @param doc - The document
     * @param prompt - The query prompt
     * @returns Generated notification title
     */
    private generateNotificationTitle;
}
