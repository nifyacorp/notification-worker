/**
 * @file Message processor interface
 * Defines the contract for processor-specific message handling
 */
import { ProcessorMessage } from '../models/message';
import { NotificationCreationResult } from '../models/notification';
/**
 * MessageProcessor interface
 * Interface for processor-specific message handling
 */
export interface MessageProcessor {
    /**
     * Process type - identifies which processor type this handles
     */
    readonly processorType: string;
    /**
     * Whether this processor requires database access
     */
    readonly requiresDatabase: boolean;
    /**
     * Process a message according to processor-specific logic
     * @param message - The message to process
     * @returns Result with notification creation statistics
     */
    process(message: ProcessorMessage): Promise<NotificationCreationResult>;
    /**
     * Validate a message for this processor type
     * @param message - The message to validate
     * @returns Whether the message is valid for this processor
     */
    validate(message: ProcessorMessage): boolean;
    /**
     * Transform a message to standardize its format if needed
     * @param message - The message to transform
     * @returns The transformed message
     */
    transform(message: ProcessorMessage): Promise<ProcessorMessage>;
}
