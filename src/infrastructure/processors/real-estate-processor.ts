/**
 * @file Real Estate message processor
 * Processor for real estate-specific messages
 */

import { MessageProcessor } from '../../domain/services/message-processor';
import { ProcessorMessage, ProcessorType, RealEstateDocument } from '../../domain/models/message';
import { 
  Notification, 
  NotificationCreationResult, 
  EntityType 
} from '../../domain/models/notification';
import { NotificationRepository } from '../../domain/repositories/notification-repository';
import { Logger } from '../../shared/logger/logger';
import { ProcessorError, ErrorCode } from '../../shared/errors/app-error';
import { withRetry } from '../../shared/utils/retry';

/**
 * RealEstateProcessor class for processing real estate messages
 */
export class RealEstateProcessor implements MessageProcessor {
  public readonly processorType = ProcessorType.REAL_ESTATE;
  public readonly requiresDatabase = true;
  
  /**
   * Constructor
   * @param notificationRepository - Repository for notification operations
   * @param logger - Logger instance
   */
  constructor(
    private readonly notificationRepository: NotificationRepository,
    private readonly logger: Logger
  ) {}
  
  /**
   * Process a real estate message
   * @param message - The message to process
   * @returns Result with notification creation statistics
   */
  public async process(message: ProcessorMessage): Promise<NotificationCreationResult> {
    const traceId = message.trace_id;
    const userId = message.request.user_id;
    const subscriptionId = message.request.subscription_id;
    
    this.logger.info('Processing Real Estate message', {
      trace_id: traceId,
      subscription_id: subscriptionId,
      user_id: userId,
      match_count: message.results.matches?.length || 0
    });
    
    try {
      // First validate and transform the message
      const validatedMessage = await this.transform(message);
      
      // Create notifications from the message
      const notifications: Notification[] = [];
      
      // Process each match and document
      for (const match of validatedMessage.results.matches) {
        for (const doc of match.documents) {
          // Cast to RealEstateDocument for better type safety
          const realEstateDoc = doc as RealEstateDocument;
          
          // Create entity_type for metadata
          const entityType = 'real-estate:listing';
          
          // Format price for display
          const formattedPrice = new Intl.NumberFormat('es-ES', {
            style: 'currency',
            currency: 'EUR',
            maximumFractionDigits: 0
          }).format(realEstateDoc.price);
          
          // Generate title with price and location
          const title = `${formattedPrice} - ${realEstateDoc.property_type} en ${realEstateDoc.location.city}`;
          
          // Generate content with property details
          let content = realEstateDoc.summary;
          if (realEstateDoc.size_sqm) {
            content += ` Superficie: ${realEstateDoc.size_sqm} m².`;
          }
          if (realEstateDoc.rooms) {
            content += ` Habitaciones: ${realEstateDoc.rooms}.`;
          }
          
          notifications.push({
            userId,
            subscriptionId,
            title,
            content,
            sourceUrl: realEstateDoc.links.html,
            metadata: {
              prompt: match.prompt,
              relevance: realEstateDoc.relevance_score,
              documentType: realEstateDoc.document_type,
              originalTitle: realEstateDoc.title,
              processorType: validatedMessage.processor_type,
              price: realEstateDoc.price,
              location: realEstateDoc.location,
              propertyType: realEstateDoc.property_type,
              sizeSqm: realEstateDoc.size_sqm,
              rooms: realEstateDoc.rooms,
              traceId
            },
            entityType
          });
        }
      }
      
      if (notifications.length === 0) {
        this.logger.warn('No notifications created from Real Estate message', {
          trace_id: traceId,
          subscription_id: subscriptionId,
          user_id: userId
        });
        
        return {
          created: 0,
          errors: 0
        };
      }
      
      // Create notifications with retry for transient errors
      const result = await withRetry(
        () => this.notificationRepository.createNotifications(notifications),
        {
          name: 'createRealEstateNotifications',
          maxRetries: 2,
          initialDelay: 1000,
          context: {
            user_id: userId,
            subscription_id: subscriptionId,
            notification_count: notifications.length,
            trace_id: traceId
          }
        }
      );
      
      this.logger.info('Real Estate message processing completed', {
        trace_id: traceId,
        subscription_id: subscriptionId,
        user_id: userId,
        notifications_created: result.created,
        errors: result.errors
      });
      
      return result;
    } catch (error) {
      // Comprehensive error logging
      this.logger.error('Failed to process Real Estate message', {
        error: (error as Error).message,
        stack: (error as Error).stack?.substring(0, 500) || 'No stack trace',
        trace_id: traceId,
        subscription_id: subscriptionId,
        user_id: userId,
        message_structure: message ? Object.keys(message).join(',') : 'undefined',
        has_results: !!message?.results,
        has_matches: !!message?.results?.matches
      });
      
      throw new ProcessorError(
        `Failed to process Real Estate message: ${(error as Error).message}`,
        ErrorCode.PROCESSOR_EXECUTION,
        {
          processorType: this.processorType,
          traceId,
          userId,
          subscriptionId
        },
        error as Error
      );
    }
  }
  
  /**
   * Validate a Real Estate message
   * @param message - The message to validate
   * @returns Whether the message is valid
   */
  public validate(message: ProcessorMessage): boolean {
    // Check processor type
    if (message.processor_type !== this.processorType) {
      return false;
    }
    
    // Check required fields
    if (!message.request?.user_id || !message.request?.subscription_id) {
      return false;
    }
    
    // Check results structure
    if (!message.results?.matches || !Array.isArray(message.results.matches)) {
      return false;
    }
    
    return true;
  }
  
  /**
   * Transform a message to standardize its format
   * @param message - The message to transform
   * @returns The transformed message
   */
  public async transform(message: ProcessorMessage): Promise<ProcessorMessage> {
    // Clone the message to avoid modifying the original
    const transformedMessage = JSON.parse(JSON.stringify(message)) as ProcessorMessage;
    const traceId = transformedMessage.trace_id || 'unknown';
    
    // Check if message.results.matches exists and is an array
    if (!transformedMessage.results.matches || !Array.isArray(transformedMessage.results.matches)) {
      this.logger.warn('Message validation warnings', {
        processor_type: transformedMessage.processor_type,
        trace_id: traceId,
        errors: {
          results: {
            matches: {
              _errors: ["Required"]
            }
          }
        }
      });
      
      // RECOVERY STRATEGY: Create empty matches array as fallback
      this.logger.warn('Creating empty matches array as fallback', {
        trace_id: traceId
      });
      transformedMessage.results.matches = [];
    }
    
    // At this point we should have transformedMessage.results.matches as an array
    // Check if we need to handle an empty array case
    if (transformedMessage.results.matches.length === 0) {
      this.logger.warn('No matches found in message', {
        trace_id: traceId,
        subscription_id: transformedMessage.request.subscription_id
      });
      
      // Create a placeholder match if needed for downstream processing
      const prompt = Array.isArray(transformedMessage.request.prompts) && transformedMessage.request.prompts.length > 0
        ? transformedMessage.request.prompts[0]
        : 'Default prompt';
        
      transformedMessage.results.matches = [{
        prompt: prompt,
        documents: []
      }];
      
      this.logger.info('Created placeholder match structure', {
        trace_id: traceId,
        prompt
      });
    }
    
    // Ensure each match has a valid structure
    for (let i = 0; i < transformedMessage.results.matches.length; i++) {
      const match = transformedMessage.results.matches[i];
      
      // Ensure match has a prompt
      if (!match.prompt) {
        match.prompt = Array.isArray(transformedMessage.request.prompts) && transformedMessage.request.prompts.length > 0
          ? transformedMessage.request.prompts[0]
          : 'Default prompt';
          
        this.logger.warn(`Added missing prompt to match[${i}]`, {
          trace_id: traceId,
          prompt: match.prompt
        });
      }
      
      // Ensure match has documents array
      if (!match.documents || !Array.isArray(match.documents)) {
        match.documents = [];
        this.logger.warn(`Created empty documents array for match[${i}]`, {
          trace_id: traceId
        });
      }
      
      // Validate and fix each document
      for (let j = 0; j < match.documents.length; j++) {
        const doc = match.documents[j] as any;
        
        // Ensure document has required fields
        if (!doc.title) {
          this.logger.warn(`Document[${j}] missing title`, {
            trace_id: traceId,
            document_id: doc.id || 'unknown'
          });
          doc.title = 'Inmueble';
        }
        
        if (!doc.summary) {
          this.logger.warn(`Document[${j}] missing summary`, {
            trace_id: traceId,
            document_id: doc.id || 'unknown'
          });
          doc.summary = 'No hay descripción disponible para este inmueble.';
        }
        
        // Ensure links is an object
        if (!doc.links || typeof doc.links !== 'object') {
          doc.links = { html: 'https://example.com', pdf: '' };
        }
        
        // Ensure location is valid
        if (!doc.location || typeof doc.location !== 'object') {
          doc.location = {
            city: 'Unknown',
            region: 'Unknown'
          };
        }
        
        // Ensure price is a number
        if (typeof doc.price !== 'number') {
          doc.price = parseFloat(doc.price) || 0;
        }
        
        // Ensure property_type exists
        if (!doc.property_type) {
          doc.property_type = 'Inmueble';
        }
      }
    }
    
    return transformedMessage;
  }
}