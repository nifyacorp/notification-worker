import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import { ProcessorService } from '../../domain/services/ProcessorService.js';
import { NotificationService } from '../../domain/services/NotificationService.js';
import { SubscriptionResult, MatchSet, DocumentMatch } from '../../domain/valueObjects/SubscriptionResult.js';
import { SubscriptionResultDto } from '../../application/dtos/SubscriptionResultDto.js';
import { Logger } from '../../infrastructure/logging/Logger.js';
import { AppError, ErrorCode } from '../../domain/errors/AppError.js';

// Schema for validating BOE document match
const BOEDocumentSchema = z.object({
  id: z.string().optional(),
  title: z.string().optional().default('Notificación BOE'),
  notification_title: z.string().optional(),
  summary: z.string().optional().default('No hay resumen disponible para este documento.'),
  relevance_score: z.number().optional(),
  document_type: z.string().optional(),
  links: z.object({
    html: z.string().optional().default('https://www.boe.es'),
    pdf: z.string().optional().default(''),
  }).optional().default({}),
  publication_date: z.string().optional(),
  section: z.string().optional(),
  bulletin_type: z.string().optional(),
  issuing_body: z.string().optional(),
  department: z.string().optional(),
});

// Schema for validating BOE match set
const BOEMatchSchema = z.object({
  prompt: z.string().optional().default(''),
  documents: z.array(BOEDocumentSchema).optional().default([]),
});

/**
 * Processor for handling BOE subscription results
 */
export class BOEProcessor implements ProcessorService {
  readonly processorType = 'boe';
  readonly requiresDatabase = true;

  /**
   * Creates a new BOE processor
   * @param notificationService Service for creating notifications
   * @param logger Logger service
   */
  constructor(
    private readonly notificationService: NotificationService,
    private readonly logger: Logger
  ) {}

  /**
   * Validates and transforms a raw message into a structured SubscriptionResult
   * @param message Raw message data
   * @returns Validated and transformed SubscriptionResult
   */
  async validateAndTransform(message: unknown): Promise<SubscriptionResult> {
    try {
      // Basic validation that message is an object
      if (!message || typeof message !== 'object') {
        throw new AppError(
          'Invalid message format: message must be an object',
          ErrorCode.INVALID_MESSAGE_FORMAT,
          { receivedType: typeof message }
        );
      }

      // Cast to DTO type
      const messageData = message as SubscriptionResultDto;
      
      // Extract essential fields with fallbacks
      const traceId = messageData.trace_id || uuidv4();
      const userId = this.extractUserId(messageData);
      const subscriptionId = this.extractSubscriptionId(messageData);
      
      if (!userId || !subscriptionId) {
        throw new AppError(
          'Missing required fields: user_id and subscription_id',
          ErrorCode.VALIDATION_ERROR,
          { 
            user_id: userId || 'missing',
            subscription_id: subscriptionId || 'missing',
            trace_id: traceId
          }
        );
      }

      // Extract and validate matches
      const matches = await this.extractMatches(messageData);
      
      this.logger.info('Validated BOE message', {
        trace_id: traceId,
        user_id: userId,
        subscription_id: subscriptionId,
        match_count: matches.length,
        total_documents: matches.reduce((count, match) => count + match.documents.length, 0)
      });

      return new SubscriptionResult(
        userId,
        subscriptionId,
        this.processorType,
        matches,
        traceId
      );
    } catch (error) {
      // Re-throw AppErrors
      if (error instanceof AppError) {
        throw error;
      }
      
      // Wrap other errors
      throw new AppError(
        error instanceof Error ? error.message : 'Invalid message format',
        ErrorCode.VALIDATION_ERROR,
        { message_type: typeof message },
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Processes a subscription result message
   * @param result Subscription result to process
   * @returns Processing statistics
   */
  async process(result: SubscriptionResult): Promise<{
    created: number;
    errors: number;
    duplicates: number;
    emailsSent: number;
  }> {
    this.logger.info('Processing BOE subscription result', {
      trace_id: result.traceId,
      user_id: result.userId,
      subscription_id: result.subscriptionId,
      match_count: result.matches.length,
      total_documents: result.getTotalDocumentCount()
    });

    return await this.notificationService.processSubscriptionResult(result);
  }

  /**
   * Extracts the user ID from various locations in the message
   * @param message The message data
   * @returns The extracted user ID or undefined
   */
  private extractUserId(message: SubscriptionResultDto): string | undefined {
    return message.request?.user_id || 
           message.user_id || 
           message.context?.user_id;
  }

  /**
   * Extracts the subscription ID from various locations in the message
   * @param message The message data
   * @returns The extracted subscription ID or undefined
   */
  private extractSubscriptionId(message: SubscriptionResultDto): string | undefined {
    return message.request?.subscription_id || 
           message.subscription_id || 
           message.context?.subscription_id;
  }

  /**
   * Extracts and validates match data from the message
   * @param message The message data
   * @returns Array of validated match sets
   */
  private async extractMatches(message: SubscriptionResultDto): Promise<MatchSet[]> {
    // Ensure results object exists
    if (!message.results) {
      message.results = { matches: [] };
    }

    // Check if message.results.matches exists and is an array
    if (!message.results.matches || !Array.isArray(message.results.matches)) {
      // RECOVERY STRATEGY 1: Try standard nested location
      if (Array.isArray(message.results?.results?.[0]?.matches)) {
        this.logger.warn('Found matches in legacy location: results.results[0].matches', {
          match_count: message.results.results[0].matches.length
        });
        message.results.matches = message.results.results[0].matches;
      } 
      // RECOVERY STRATEGY 2: Check for multiple results objects
      else if (Array.isArray(message.results?.results)) {
        const extractedMatches: SubscriptionResultDto['results']['matches'] = [];
        
        // Try to extract all matches from all results
        message.results.results.forEach((result, index) => {
          if (Array.isArray(result?.matches)) {
            this.logger.warn(`Found matches in results[${index}].matches`);
            
            // Add prompt from parent if available
            result.matches.forEach(match => {
              extractedMatches.push({
                ...match,
                prompt: match.prompt || result.prompt || message?.request?.prompts?.[0] || 'Default prompt'
              });
            });
          }
        });
        
        if (extractedMatches.length > 0) {
          this.logger.warn('Merged matches from multiple results', {
            total_matches: extractedMatches.length
          });
          message.results.matches = extractedMatches;
        }
      }
      // RECOVERY STRATEGY 3: Check if results is directly an array of matches
      else if (Array.isArray(message.results?.results)) {
        this.logger.warn('Treating results.results as direct matches array');
        message.results.matches = message.results.results;
      }
      // RECOVERY STRATEGY 4: Create empty matches array as last resort
      else {
        this.logger.warn('Creating empty matches array as fallback');
        message.results.matches = [];
      }
    }
    
    // Validate and transform each match
    const validatedMatches: MatchSet[] = [];
    
    // Process each match through the schema
    for (const match of message.results.matches || []) {
      try {
        const validatedMatch = await BOEMatchSchema.parseAsync(match);
        
        // Process each document through its schema
        const validatedDocuments: DocumentMatch[] = [];
        
        for (const doc of validatedMatch.documents) {
          try {
            // Validate with zod schema
            const validDoc = await BOEDocumentSchema.parseAsync(doc);
            
            // Ensure title is propagated to notification_title and vice versa
            if (!validDoc.title && validDoc.notification_title) {
              validDoc.title = validDoc.notification_title;
            }
            if (!validDoc.notification_title && validDoc.title) {
              validDoc.notification_title = validDoc.title;
            }
            
            // Truncate long summaries
            if (validDoc.summary && validDoc.summary.length > 200) {
              validDoc.summary = validDoc.summary.substring(0, 197) + '...';
            }
            
            // Only add valid documents
            validatedDocuments.push(validDoc);
          } catch (docError) {
            this.logger.warn('Invalid document data, using default values', {
              error: docError instanceof Error ? docError.message : String(docError),
              document_id: doc.id
            });
            
            // Add with default values from schema
            validatedDocuments.push(BOEDocumentSchema.parse({}));
          }
        }
        
        // Only add match if it has documents
        if (validatedDocuments.length > 0) {
          validatedMatches.push({
            prompt: validatedMatch.prompt,
            documents: validatedDocuments
          });
        }
      } catch (matchError) {
        this.logger.warn('Invalid match data, skipping', {
          error: matchError instanceof Error ? matchError.message : String(matchError)
        });
        // Skip invalid matches
      }
    }
    
    // If no valid matches found, create a placeholder with empty documents
    if (validatedMatches.length === 0) {
      this.logger.warn('No valid matches found, creating placeholder');
      
      const prompt = message.request?.prompts?.[0] || 'Default prompt';
      validatedMatches.push({
        prompt,
        documents: [] // Empty documents array
      });
    }
    
    return validatedMatches;
  }
}