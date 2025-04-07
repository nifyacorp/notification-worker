/**
 * @file Processor Registry interface
 * Defines the registry for managing message processors
 */
import { MessageProcessor } from './message-processor';
import { ProcessorMessage } from '../models/message';
/**
 * ProcessorRegistry interface
 * Manages the registry of available message processors
 */
export interface ProcessorRegistry {
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
     * @returns Promise resolving when processing is complete
     * @throws Error if no processor is found
     */
    processMessage(message: ProcessorMessage): Promise<any>;
}
