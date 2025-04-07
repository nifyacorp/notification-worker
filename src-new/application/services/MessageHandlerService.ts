import { Message } from '@google-cloud/pubsub';
import { v4 as uuidv4 } from 'uuid';
import { ProcessSubscriptionResultUseCase } from '../useCases/ProcessSubscriptionResultUseCase.js';
import { MessagingService } from '../../domain/services/MessagingService.js';
import { Logger } from '../../infrastructure/logging/Logger.js';
import { AppError, ErrorCode } from '../../domain/errors/AppError.js';

/**
 * Metrics for message processing
 */
export interface ProcessingMetrics {
  messageCount: number;
  successfulMessages: number;
  validationErrors: number;
  unknownProcessorErrors: number;
  dbUnavailableErrors: number;
  processingErrors: number;
  lastActivity: Date;
  avgProcessingTimeMs: number;
}

/**
 * Service for handling PubSub messages
 */
export class MessageHandlerService {
  private metrics: ProcessingMetrics = {
    messageCount: 0,
    successfulMessages: 0,
    validationErrors: 0,
    unknownProcessorErrors: 0,
    dbUnavailableErrors: 0,
    processingErrors: 0,
    lastActivity: new Date(),
    avgProcessingTimeMs: 0
  };

  /**
   * Creates a new message handler service
   * @param processUseCase Use case for processing messages
   * @param messagingService Service for messaging operations
   * @param logger Logger service
   */
  constructor(
    private readonly processUseCase: ProcessSubscriptionResultUseCase,
    private readonly messagingService: MessagingService,
    private readonly logger: Logger
  ) {}

  /**
   * Handler for PubSub messages
   * @param message PubSub message
   */
  async handleMessage(message: Message): Promise<void> {
    const startTime = Date.now();
    let data: unknown;
    
    // Update metrics
    this.metrics.messageCount++;
    this.metrics.lastActivity = new Date();
    
    try {
      // Parse message data
      try {
        data = JSON.parse(message.data.toString());
      } catch (parseError) {
        this.metrics.validationErrors++;
        const err = parseError instanceof Error ? parseError : new Error(String(parseError));
        
        this.logger.error('Failed to parse message', {
          error: err.message,
          message_id: message.id,
          publish_time: message.publishTime
        });
        
        await this.messagingService.publishToDLQ(
          { raw_message: message.data.toString() }, 
          err
        );
        
        message.ack(); // Ack invalid messages to prevent redelivery
        return;
      }
      
      // Add trace ID if not present
      if (data && typeof data === 'object' && !('trace_id' in (data as object))) {
        const newTraceId = uuidv4();
        (data as Record<string, unknown>).trace_id = newTraceId;
        this.logger.info('Generated missing trace ID', { trace_id: newTraceId });
      }
      
      // Process the message with the use case
      const result = await this.processUseCase.execute(data);
      
      // Update metrics
      this.metrics.successfulMessages++;
      
      // Update rolling average processing time
      const processingTime = Date.now() - startTime;
      this.metrics.avgProcessingTimeMs = 
        (this.metrics.avgProcessingTimeMs * (this.metrics.successfulMessages - 1) + processingTime) / 
        this.metrics.successfulMessages;
      
      this.logger.info('Successfully processed message', {
        message_id: message.id,
        processing_time_ms: processingTime,
        created: result.created,
        errors: result.errors,
        duplicates: result.duplicates || 0,
        success_rate: result.successRate
      });
      
      // Acknowledge the message
      message.ack();
    } catch (error) {
      // Update metrics based on error type
      if (error instanceof AppError) {
        switch (error.code) {
          case ErrorCode.VALIDATION_ERROR:
            this.metrics.validationErrors++;
            break;
          case ErrorCode.UNKNOWN_PROCESSOR_TYPE:
            this.metrics.unknownProcessorErrors++;
            break;
          case ErrorCode.DATABASE_CONNECTION_ERROR:
          case ErrorCode.DATABASE_ERROR:
            this.metrics.dbUnavailableErrors++;
            break;
          default:
            this.metrics.processingErrors++;
        }
      } else {
        this.metrics.processingErrors++;
      }
      
      const err = error instanceof Error ? error : new Error(String(error));
      this.logger.error('Failed to process message', {
        error: err.message,
        code: error instanceof AppError ? error.code : 'UNKNOWN_ERROR',
        stack: err.stack,
        message_id: message.id,
        processing_time_ms: Date.now() - startTime
      });
      
      try {
        // Send to dead-letter queue
        await this.messagingService.publishToDLQ(data || { raw_message: message.data.toString() }, err);
        
        // Ack the message since we've handled the error
        message.ack(); 
      } catch (dlqError) {
        const dlqErr = dlqError instanceof Error ? dlqError : new Error(String(dlqError));
        this.logger.error('Critical error publishing to DLQ', {
          original_error: err.message,
          dlq_error: dlqErr.message
        });
        
        // Negative acknowledgement to allow retry later
        message.nack();
      }
    }
  }

  /**
   * Gets the current processing metrics
   * @returns Current metrics
   */
  getMetrics(): ProcessingMetrics {
    return { ...this.metrics };
  }
}