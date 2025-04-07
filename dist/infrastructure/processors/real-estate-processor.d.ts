/**
 * @file Real Estate message processor
 * Processor for real estate-specific messages
 */
import { MessageProcessor } from '../../domain/services/message-processor';
import { ProcessorMessage } from '../../domain/models/message';
import { NotificationCreationResult } from '../../domain/models/notification';
import { NotificationRepository } from '../../domain/repositories/notification-repository';
import { Logger } from '../../shared/logger/logger';
/**
 * RealEstateProcessor class for processing real estate messages
 */
export declare class RealEstateProcessor implements MessageProcessor {
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
     * Process a real estate message
     * @param message - The message to process
     * @returns Result with notification creation statistics
     */
    process(message: ProcessorMessage): Promise<NotificationCreationResult>;
    /**
     * Validate a Real Estate message
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
}
