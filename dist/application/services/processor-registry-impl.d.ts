/**
 * @file Processor registry implementation
 * Manages message processors and routes messages to appropriate processor
 */
import { MessageProcessor } from '../../domain/services/message-processor';
import { ProcessorRegistry } from '../../domain/services/processor-registry';
import { ProcessorMessage } from '../../domain/models/message';
import { Logger } from '../../shared/logger/logger';
import { NotificationCreationResult } from '../../domain/models/notification';
/**
 * DefaultProcessorRegistry implementation
 * Default implementation of the processor registry
 */
export declare class DefaultProcessorRegistry implements ProcessorRegistry {
    private readonly logger;
    private processors;
    /**
     * Constructor
     * @param logger - Logger instance
     */
    constructor(logger: Logger);
    /**
     * Register a processor for a specific message type
     * @param processor - The processor to register
     * @returns Success indicator
     */
    register(processor: MessageProcessor): boolean;
    /**
     * Get a processor for a specific message type
     * @param processorType - The type of processor to get
     * @returns The processor or undefined if not found
     */
    getProcessor(processorType: string): MessageProcessor | undefined;
    /**
     * Get all registered processors
     * @returns Array of all registered processors
     */
    getAllProcessors(): MessageProcessor[];
    /**
     * Check if a processor exists for a message type
     * @param processorType - The type of processor to check
     * @returns Whether a processor exists for this type
     */
    hasProcessor(processorType: string): boolean;
    /**
     * Process a message with the appropriate processor
     * @param message - The message to process
     * @returns Notification creation result
     * @throws Error if no processor is found
     */
    processMessage(message: ProcessorMessage): Promise<NotificationCreationResult>;
}
