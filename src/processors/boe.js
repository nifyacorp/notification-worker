import { createNotifications } from '../services/notification.js';
import { logger } from '../utils/logger.js';
import { db } from '../database/client.js';

// Process BOE-specific fields before creating notifications
export async function processBOEMessage(message) {
  logger.info('Processing BOE message', {
    trace_id: message.trace_id,
    subscription_id: message.request.subscription_id,
    user_id: message.request.user_id,
    match_count: message.results.matches?.length || 0
  });

  try {
    // Ensure we have a database connection before proceeding
    const connectionState = db.getConnectionState();
    if (!connectionState.isConnected) {
      logger.info('Establishing database connection before processing', {
        trace_id: message.trace_id,
        connection_state: connectionState
      });
      
      await db.testConnection();
    }
    
    // Validate the message structure with fallback support for different schemas
    if (!message.results?.matches || !Array.isArray(message.results.matches)) {
      logger.warn('Message validation warning', {
        processor_type: message.processor_type || 'boe',
        trace_id: message.trace_id,
        errors: {
          _errors: [],
          results: {
            _errors: [],
            matches: {
              _errors: ["Required"]
            }
          }
        }
      });
      
      // Try to recover by looking for matches in expected locations
      let matches = [];
      
      if (Array.isArray(message.results?.results?.[0]?.matches)) {
        // Handle legacy format where matches is nested under results.results[0]
        matches = message.results.results[0].matches;
        logger.warn('Found matches in legacy location: results.results[0].matches', {
          trace_id: message.trace_id,
          match_count: matches.length
        });
      } else if (message.results?.results) {
        // Try to extract matches from all results
        matches = message.results.results.flatMap(r => 
          Array.isArray(r.matches) ? r.matches.map(m => ({...m, prompt: r.prompt})) : []
        );
        logger.warn('Reconstructed matches from nested results structure', {
          trace_id: message.trace_id,
          match_count: matches.length
        });
      }
      
      if (matches.length > 0) {
        // Use the recovered matches
        message.results.matches = matches;
        logger.info('Successfully recovered matches from alternate schema', {
          trace_id: message.trace_id,
          match_count: matches.length
        });
      } else {
        throw new Error('Invalid message format: missing or invalid matches array');
      }
    }
    
    // Validate required request fields with fallbacks
    if (!message.request?.user_id || !message.request?.subscription_id) {
      // Try to find these fields in alternate locations
      const userId = message.request?.user_id || message.user_id || message.context?.user_id;
      const subscriptionId = message.request?.subscription_id || message.subscription_id || message.context?.subscription_id;
      
      if (userId && subscriptionId) {
        // Create request object if missing
        if (!message.request) {
          message.request = {};
        }
        
        // Set the fields
        message.request.user_id = userId;
        message.request.subscription_id = subscriptionId;
        
        logger.warn('Recovered required request fields from alternate locations', {
          trace_id: message.trace_id,
          user_id: userId,
          subscription_id: subscriptionId
        });
      } else {
        throw new Error('Invalid message format: missing user_id or subscription_id');
      }
    }

    // Enrich notifications with BOE-specific data
    for (const match of message.results.matches) {
      for (const doc of match.documents) {
        // Ensure document has required fields
        if (!doc.title && !doc.notification_title) {
          logger.warn('Document missing title', {
            trace_id: message.trace_id,
            document_id: doc.id || 'unknown'
          });
          doc.title = 'Notificación BOE';
        }
        
        if (!doc.summary) {
          logger.warn('Document missing summary', {
            trace_id: message.trace_id,
            document_id: doc.id || 'unknown'
          });
          doc.summary = 'No hay resumen disponible para este documento.';
        } else if (doc.summary.length > 200) {
          // Ensure summary is truncated to 200 chars in case it wasn't already
          // by the BOE parser validation
          logger.warn('Document summary too long, truncating', {
            trace_id: message.trace_id,
            document_id: doc.id || 'unknown',
            original_length: doc.summary.length
          });
          doc.summary = doc.summary.substring(0, 197) + '...';
        }
        
        // Ensure links is an object
        if (!doc.links || typeof doc.links !== 'object') {
          doc.links = { html: '' };
        }
        
        doc.metadata = {
          ...doc.metadata,
          publication_date: doc.publication_date,
          section: doc.section,
          bulletin_type: doc.bulletin_type
        };
      }
    }

    const result = await createNotifications(message);
    
    logger.info('BOE message processing completed', {
      trace_id: message.trace_id,
      subscription_id: message.request.subscription_id,
      user_id: message.request.user_id,
      notifications_created: result.created,
      errors: result.errors
    });
    
    return result;
  } catch (error) {
    logger.error('Failed to process BOE message', {
      error: error.message,
      stack: error.stack?.substring(0, 500) || 'No stack trace',
      trace_id: message.trace_id,
      subscription_id: message.request.subscription_id,
      user_id: message.request.user_id
    });
    
    throw error; // Re-throw to trigger the PubSub retry mechanism
  }
}