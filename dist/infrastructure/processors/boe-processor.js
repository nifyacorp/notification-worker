/**
 * @file BOE message processor
 * Processor for BOE-specific messages
 */
import { ProcessorType } from '../../domain/models/message';
import { EntityType } from '../../domain/models/notification';
import { ProcessorError, ErrorCode } from '../../shared/errors/app-error';
import { withRetry } from '../../shared/utils/retry';
/**
 * BOEProcessor class for processing BOE messages
 */
export class BOEProcessor {
    notificationRepository;
    logger;
    processorType = ProcessorType.BOE;
    requiresDatabase = true;
    /**
     * Constructor
     * @param notificationRepository - Repository for notification operations
     * @param logger - Logger instance
     */
    constructor(notificationRepository, logger) {
        this.notificationRepository = notificationRepository;
        this.logger = logger;
    }
    /**
     * Process a BOE message
     * @param message - The message to process
     * @returns Result with notification creation statistics
     */
    async process(message) {
        const traceId = message.trace_id;
        const userId = message.request.user_id;
        const subscriptionId = message.request.subscription_id;
        this.logger.info('Processing BOE message', {
            trace_id: traceId,
            subscription_id: subscriptionId,
            user_id: userId,
            match_count: message.results.matches?.length || 0
        });
        try {
            // First validate and transform the message
            const validatedMessage = await this.transform(message);
            // Create notifications from the message
            const notifications = [];
            // Process each match and document
            for (const match of validatedMessage.results.matches) {
                for (const doc of match.documents) {
                    // Cast to BOEDocument for better type safety
                    const boeDoc = doc;
                    // Create entity_type for metadata
                    const entityType = this.determineEntityType(boeDoc);
                    // ENHANCED TITLE GENERATION - Generate a more meaningful title
                    const notificationTitle = this.generateNotificationTitle(boeDoc, match.prompt);
                    notifications.push({
                        userId,
                        subscriptionId,
                        title: notificationTitle,
                        content: boeDoc.summary,
                        sourceUrl: boeDoc.links.html,
                        metadata: {
                            prompt: match.prompt,
                            relevance: boeDoc.relevance_score,
                            documentType: boeDoc.document_type,
                            originalTitle: boeDoc.title,
                            processorType: validatedMessage.processor_type,
                            publicationDate: boeDoc.publication_date,
                            issuingBody: boeDoc.issuing_body,
                            section: boeDoc.section,
                            department: boeDoc.department,
                            traceId
                        },
                        entityType
                    });
                }
            }
            if (notifications.length === 0) {
                this.logger.warn('No notifications created from BOE message', {
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
            const result = await withRetry(() => this.notificationRepository.createNotifications(notifications), {
                name: 'createBOENotifications',
                maxRetries: 2,
                initialDelay: 1000,
                context: {
                    user_id: userId,
                    subscription_id: subscriptionId,
                    notification_count: notifications.length,
                    trace_id: traceId
                }
            });
            this.logger.info('BOE message processing completed', {
                trace_id: traceId,
                subscription_id: subscriptionId,
                user_id: userId,
                notifications_created: result.created,
                errors: result.errors
            });
            return result;
        }
        catch (error) {
            // Comprehensive error logging
            this.logger.error('Failed to process BOE message', {
                error: error.message,
                stack: error.stack?.substring(0, 500) || 'No stack trace',
                trace_id: traceId,
                subscription_id: subscriptionId,
                user_id: userId,
                message_structure: message ? Object.keys(message).join(',') : 'undefined',
                has_results: !!message?.results,
                has_matches: !!message?.results?.matches
            });
            throw new ProcessorError(`Failed to process BOE message: ${error.message}`, ErrorCode.PROCESSOR_EXECUTION, {
                processorType: this.processorType,
                traceId,
                userId,
                subscriptionId
            }, error);
        }
    }
    /**
     * Validate a BOE message
     * @param message - The message to validate
     * @returns Whether the message is valid
     */
    validate(message) {
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
    async transform(message) {
        // Clone the message to avoid modifying the original
        const transformedMessage = JSON.parse(JSON.stringify(message));
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
            // RECOVERY STRATEGY 1: Try standard nested location
            if (Array.isArray(transformedMessage.results?.results?.[0]?.matches)) {
                this.logger.warn('Found matches in legacy location: results.results[0].matches', {
                    trace_id: traceId,
                    match_count: transformedMessage.results.results[0].matches.length
                });
                transformedMessage.results.matches = transformedMessage.results.results[0].matches;
            }
            // RECOVERY STRATEGY 2: Check for multiple results objects
            else if (Array.isArray(transformedMessage.results?.results)) {
                const extractedMatches = [];
                // Try to extract all matches from all results
                transformedMessage.results.results.forEach((result, index) => {
                    if (Array.isArray(result?.matches)) {
                        this.logger.warn(`Found matches in results[${index}].matches`, {
                            trace_id: traceId,
                            count: result.matches.length
                        });
                        // Add prompt from parent if available
                        result.matches.forEach((match) => {
                            extractedMatches.push({
                                ...match,
                                prompt: match.prompt || result.prompt || transformedMessage.request?.prompts?.[0] || 'Default prompt'
                            });
                        });
                    }
                });
                if (extractedMatches.length > 0) {
                    this.logger.warn('Merged matches from multiple results', {
                        trace_id: traceId,
                        total_matches: extractedMatches.length
                    });
                    transformedMessage.results.matches = extractedMatches;
                }
            }
            // RECOVERY STRATEGY 3: Check if results is directly an array of matches
            else if (Array.isArray(transformedMessage.results?.results)) {
                this.logger.warn('Treating results.results as direct matches array', {
                    trace_id: traceId,
                    items_count: transformedMessage.results.results.length
                });
                transformedMessage.results.matches = transformedMessage.results.results;
            }
            // RECOVERY STRATEGY 4: Create empty matches array as last resort
            else {
                this.logger.warn('Creating empty matches array as fallback', {
                    trace_id: traceId
                });
                transformedMessage.results.matches = [];
            }
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
                const doc = match.documents[j];
                // Ensure document has required fields
                if (!doc.title && !doc.notification_title) {
                    this.logger.warn(`Document[${j}] missing title`, {
                        trace_id: traceId,
                        document_id: doc.id || 'unknown'
                    });
                    doc.title = 'Notificación BOE';
                    doc.notification_title = 'Notificación BOE';
                }
                // Ensure title is propagated to notification_title and vice versa
                if (!doc.title)
                    doc.title = doc.notification_title;
                if (!doc.notification_title)
                    doc.notification_title = doc.title;
                if (!doc.summary) {
                    this.logger.warn(`Document[${j}] missing summary`, {
                        trace_id: traceId,
                        document_id: doc.id || 'unknown'
                    });
                    doc.summary = 'No hay resumen disponible para este documento.';
                }
                else if (doc.summary.length > 200) {
                    // Ensure summary is truncated to 200 chars
                    this.logger.warn(`Document[${j}] summary too long, truncating`, {
                        trace_id: traceId,
                        document_id: doc.id || 'unknown',
                        original_length: doc.summary.length
                    });
                    doc.summary = doc.summary.substring(0, 197) + '...';
                }
                // Ensure links is an object
                if (!doc.links || typeof doc.links !== 'object') {
                    doc.links = { html: 'https://www.boe.es', pdf: '' };
                }
                // Ensure publication_date exists
                if (!doc.publication_date) {
                    doc.publication_date = new Date().toISOString();
                    this.logger.warn(`Document[${j}] missing publication_date, using current date`, {
                        trace_id: traceId,
                        document_id: doc.id || 'unknown'
                    });
                }
                // Set metadata with defaults for missing fields
                doc.metadata = {
                    ...doc.metadata || {},
                    publication_date: doc.publication_date,
                    section: doc.section || 'general',
                    bulletin_type: doc.bulletin_type || 'BOE'
                };
            }
        }
        return transformedMessage;
    }
    /**
     * Determine the entity type based on the document
     * @param doc - The document
     * @returns The entity type
     */
    determineEntityType(doc) {
        // Default to generic BOE document
        let entityType = EntityType.BOE_DOCUMENT;
        // Look for keywords in various fields to categorize
        const docType = doc.document_type?.toLowerCase() || '';
        const title = doc.title?.toLowerCase() || '';
        const summary = doc.summary?.toLowerCase() || '';
        if (docType.includes('resolucion') ||
            title.includes('resolucion') ||
            title.includes('resolución')) {
            entityType = EntityType.BOE_RESOLUTION;
        }
        else if (docType.includes('anuncio') ||
            title.includes('anuncio') ||
            title.includes('convocatoria')) {
            entityType = EntityType.BOE_ANNOUNCEMENT;
        }
        return entityType;
    }
    /**
     * Generate a notification title based on document data
     * @param doc - The document
     * @param prompt - The query prompt
     * @returns Generated notification title
     */
    generateNotificationTitle(doc, prompt) {
        let notificationTitle = '';
        // First try to use notification_title field which is optimized for display
        if (doc.notification_title &&
            doc.notification_title.length > 3 &&
            doc.notification_title !== 'string' &&
            !doc.notification_title.includes('notification')) {
            notificationTitle = doc.notification_title;
        }
        // Otherwise try the original title
        else if (doc.title &&
            doc.title.length > 3 &&
            doc.title !== 'string' &&
            !doc.title.includes('notification')) {
            // Truncate long titles to 80 chars for consistency with notification_title
            notificationTitle = doc.title.length > 80
                ? doc.title.substring(0, 77) + '...'
                : doc.title;
        }
        // If both are missing, construct a descriptive title from available fields
        else if (doc.document_type) {
            // Construct a descriptive title based on available metadata
            const docType = doc.document_type || 'Documento';
            const issuer = doc.issuing_body || doc.department || '';
            const date = doc.publication_date ? ` (${new Date(doc.publication_date).toLocaleDateString('es-ES')})` : '';
            notificationTitle = `${docType}${issuer ? ' de ' + issuer : ''}${date}`;
        }
        else {
            // Enhanced last resort - use relevant context from match data
            const promptContext = prompt && prompt.length > 5 ?
                `: "${prompt.substring(0, 30)}${prompt.length > 30 ? '...' : ''}"` : '';
            notificationTitle = `Alerta BOE${promptContext}`;
        }
        return notificationTitle;
    }
}
//# sourceMappingURL=boe-processor.js.map