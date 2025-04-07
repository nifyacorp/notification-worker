import { ProcessorService } from '../../domain/services/ProcessorService.js';
import { NotificationService } from '../../domain/services/NotificationService.js';
import { SubscriptionResultDto } from '../dtos/SubscriptionResultDto.js';
import { ProcessingResultDto } from '../dtos/NotificationDto.js';
import { AppError, ErrorCode } from '../../domain/errors/AppError.js';

/**
 * Use case for processing subscription results
 */
export class ProcessSubscriptionResultUseCase {
  constructor(
    private readonly processors: Map<string, ProcessorService>,
    private readonly notificationService: NotificationService
  ) {}

  /**
   * Processes a subscription result message
   * @param message Raw message data
   * @returns Processing statistics
   */
  async execute(message: unknown): Promise<ProcessingResultDto> {
    const startTime = Date.now();
    
    try {
      // Validate that message is an object
      if (!message || typeof message !== 'object') {
        throw new AppError(
          'Invalid message format: message must be an object',
          ErrorCode.INVALID_MESSAGE_FORMAT,
          { receivedType: typeof message }
        );
      }
      
      // Try to parse as SubscriptionResultDto
      const messageData = message as SubscriptionResultDto;
      
      // Determine processor type
      const processorType = messageData.processor_type;
      if (!processorType) {
        throw new AppError(
          'Missing processor_type in message',
          ErrorCode.UNKNOWN_PROCESSOR_TYPE,
          { message: messageData }
        );
      }
      
      // Get the appropriate processor
      const processor = this.processors.get(processorType);
      if (!processor) {
        throw new AppError(
          `Unknown processor type: ${processorType}`,
          ErrorCode.UNKNOWN_PROCESSOR_TYPE,
          { processorType, availableProcessors: Array.from(this.processors.keys()) }
        );
      }
      
      // Validate and transform the message
      const result = await processor.validateAndTransform(messageData);
      
      // Process the validated result
      const processingResult = await processor.process(result);
      
      // Calculate success rate
      const total = processingResult.created + processingResult.errors;
      const successRate = total > 0 
        ? `${Math.round((processingResult.created / total) * 100)}%` 
        : '0%';
      
      return {
        ...processingResult,
        successRate,
        processingTimeMs: Date.now() - startTime
      };
    } catch (error) {
      // Re-throw AppErrors as is
      if (error instanceof AppError) {
        throw error;
      }
      
      // Wrap other errors
      throw new AppError(
        error instanceof Error ? error.message : 'Unknown error during processing',
        ErrorCode.PROCESSING_ERROR,
        { 
          messageType: typeof message,
          processingTime: Date.now() - startTime 
        },
        error instanceof Error ? error : undefined
      );
    }
  }
}