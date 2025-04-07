/**
 * @file Processor registry implementation
 * Manages message processors and routes messages to appropriate processor
 */
import { ProcessorError, ErrorCode } from '../../shared/errors/app-error';
/**
 * DefaultProcessorRegistry implementation
 * Default implementation of the processor registry
 */
export class DefaultProcessorRegistry {
    logger;
    processors = new Map();
    /**
     * Constructor
     * @param logger - Logger instance
     */
    constructor(logger) {
        this.logger = logger;
    }
    /**
     * Register a processor for a specific message type
     * @param processor - The processor to register
     * @returns Success indicator
     */
    register(processor) {
        if (!processor || !processor.processorType) {
            this.logger.warn('Attempted to register invalid processor', {
                processor: processor ? 'missing processorType' : 'null'
            });
            return false;
        }
        const processorType = processor.processorType;
        // Check if processor already exists
        if (this.processors.has(processorType)) {
            this.logger.warn(`Processor type "${processorType}" already registered`, {
                processorType
            });
            return false;
        }
        // Register processor
        this.processors.set(processorType, processor);
        this.logger.info(`Registered processor for "${processorType}"`, {
            processorType,
            requiresDatabase: processor.requiresDatabase
        });
        return true;
    }
    /**
     * Get a processor for a specific message type
     * @param processorType - The type of processor to get
     * @returns The processor or undefined if not found
     */
    getProcessor(processorType) {
        return this.processors.get(processorType);
    }
    /**
     * Get all registered processors
     * @returns Array of all registered processors
     */
    getAllProcessors() {
        return Array.from(this.processors.values());
    }
    /**
     * Check if a processor exists for a message type
     * @param processorType - The type of processor to check
     * @returns Whether a processor exists for this type
     */
    hasProcessor(processorType) {
        return this.processors.has(processorType);
    }
    /**
     * Process a message with the appropriate processor
     * @param message - The message to process
     * @returns Notification creation result
     * @throws Error if no processor is found
     */
    async processMessage(message) {
        const processorType = message.processor_type;
        const traceId = message.trace_id;
        // Log processing start
        this.logger.info(`Processing message of type "${processorType}"`, {
            trace_id: traceId,
            processor_type: processorType,
            user_id: message.request.user_id,
            subscription_id: message.request.subscription_id
        });
        // Get appropriate processor
        const processor = this.getProcessor(processorType);
        if (!processor) {
            const error = new ProcessorError(`No processor registered for type "${processorType}"`, ErrorCode.PROCESSOR_NOT_FOUND, {
                processorType,
                traceId,
                availableProcessors: Array.from(this.processors.keys())
            });
            this.logger.error(`No processor found for type "${processorType}"`, {
                trace_id: traceId,
                processor_type: processorType,
                available_processors: Array.from(this.processors.keys())
            });
            throw error;
        }
        try {
            // Validate message
            if (!processor.validate(message)) {
                throw new ProcessorError(`Message validation failed for processor "${processorType}"`, ErrorCode.PROCESSOR_VALIDATION, {
                    processorType,
                    traceId
                });
            }
            // Process message and track time
            const startTime = Date.now();
            const result = await processor.process(message);
            const processingTime = Date.now() - startTime;
            // Log processing result
            this.logger.info(`Successfully processed message of type "${processorType}"`, {
                trace_id: traceId,
                processor_type: processorType,
                processing_time_ms: processingTime,
                notifications_created: result.created,
                errors: result.errors
            });
            return result;
        }
        catch (error) {
            // Enhanced error logging
            this.logger.error(`Failed to process message of type "${processorType}"`, {
                trace_id: traceId,
                processor_type: processorType,
                error: error.message,
                error_name: error.name,
                stack: error.stack?.substring(0, 500)
            });
            // Re-throw error for upstream handling
            throw error;
        }
    }
}
//# sourceMappingURL=processor-registry-impl.js.map