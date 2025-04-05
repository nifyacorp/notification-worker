import { createNotifications } from '../services/notification.js';
import { logger } from '../utils/logger.js';
import { database } from '../services/database.js';

/**
 * Process BOE-specific message data for creating notifications
 * @param {Object} message - The PubSub message data
 * @returns {Promise<Object>} - Notification creation stats
 */
export async function processBOEMessage(message) {
  // Safely access properties with error handling for undefined
  const traceId = message?.trace_id || 'unknown';
  const userId = message?.request?.user_id || message?.user_id || message?.context?.user_id || 'unknown';
  const subscriptionId = message?.request?.subscription_id || message?.subscription_id || message?.context?.subscription_id || 'unknown';
  
  // Initial log with safe property access
  logger.info('Processing BOE message', {
    trace_id: traceId,
    subscription_id: subscriptionId,
    user_id: userId,
    match_count: message?.results?.matches?.length || 0
  });

  try {
    // Ensure message is not null/undefined
    if (!message) {
      throw new Error('Message is null or undefined');
    }
    
    // Initialize the request object if missing
    if (!message.request) {
      message.request = {};
    }
    
    // Initialize the results object if missing
    if (!message.results) {
      message.results = {};
    }
    
    // Ensure we have a database connection before proceeding
    const connectionState = database.getConnectionState();
    if (!connectionState.isConnected) {
      logger.info('Establishing database connection before processing', {
        trace_id: traceId,
        connection_state: connectionState
      });
      
      await database.testConnection();
    }
    
    // Validate/fix user_id and subscription_id in request
    if (!message.request.user_id || !message.request.subscription_id) {
      // Try to find these fields in alternate locations
      message.request.user_id = userId;
      message.request.subscription_id = subscriptionId;
      
      logger.warn('Set required request fields', {
        trace_id: traceId,
        user_id: userId,
        subscription_id: subscriptionId
      });
      
      if (!message.request.user_id || !message.request.subscription_id) {
        throw new Error('Invalid message format: missing user_id or subscription_id');
      }
    }
    
    // Schema validation and recovery
    await validateAndFixMessageSchema(message, traceId);

    // Now create notifications
    const result = await createNotifications(message);
    
    logger.info('BOE message processing completed', {
      trace_id: traceId,
      subscription_id: message.request.subscription_id,
      user_id: message.request.user_id,
      notifications_created: result.created || 0,
      errors: result.errors || []
    });
    
    return result;
  } catch (error) {
    // Comprehensive error logging
    logger.error('Failed to process BOE message', {
      error: error.message,
      stack: error.stack?.substring(0, 500) || 'No stack trace',
      trace_id: traceId,
      subscription_id: subscriptionId,
      user_id: userId,
      message_structure: message ? Object.keys(message).join(',') : 'undefined',
      has_results: !!message?.results,
      has_matches: !!message?.results?.matches,
      has_request: !!message?.request
    });
    
    throw error; // Re-throw to trigger the retry mechanism
  }
}

/**
 * Validates and fixes the message schema structure
 * @param {Object} message - The message to validate and fix
 * @param {string} traceId - Trace ID for logging
 */
async function validateAndFixMessageSchema(message, traceId) {
  // Check if message.results.matches exists and is an array
  if (!message.results.matches || !Array.isArray(message.results.matches)) {
    // Log validation warnings for tracking
    logger.warn('Message validation warnings', {
      processor_type: message.processor_type || 'boe',
      trace_id: traceId,
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
    
    // RECOVERY STRATEGY 1: Try standard nested location
    if (Array.isArray(message.results?.results?.[0]?.matches)) {
      logger.warn('Found matches in legacy location: results.results[0].matches', {
        trace_id: traceId,
        match_count: message.results.results[0].matches.length
      });
      message.results.matches = message.results.results[0].matches;
    } 
    // RECOVERY STRATEGY 2: Check for multiple results objects
    else if (Array.isArray(message.results?.results)) {
      const extractedMatches = [];
      
      // Try to extract all matches from all results
      message.results.results.forEach((result, index) => {
        if (Array.isArray(result?.matches)) {
          logger.warn(`Found matches in results[${index}].matches`, {
            trace_id: traceId,
            count: result.matches.length
          });
          
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
        logger.warn('Merged matches from multiple results', {
          trace_id: traceId,
          total_matches: extractedMatches.length
        });
        message.results.matches = extractedMatches;
      }
    }
    // RECOVERY STRATEGY 3: Check if results is directly an array of matches
    else if (Array.isArray(message.results?.results)) {
      logger.warn('Treating results.results as direct matches array', {
        trace_id: traceId,
        items_count: message.results.results.length
      });
      message.results.matches = message.results.results;
    }
    // RECOVERY STRATEGY 4: Create empty matches array as last resort
    else {
      // If we couldn't find matches anywhere, create an empty array
      // This allows processing to continue with zero matches instead of failing
      logger.warn('Creating empty matches array as fallback', {
        trace_id: traceId
      });
      message.results.matches = [];
    }
  }
  
  // At this point we should have message.results.matches as an array
  // Check if we need to handle an empty array case
  if (message.results.matches.length === 0) {
    logger.warn('No matches found in message', {
      trace_id: traceId,
      subscription_id: message.request.subscription_id
    });
    
    // Create a placeholder match if needed for downstream processing
    // This is better than failing completely
    const prompt = message.request.prompts?.[0] || 'Default prompt';
    message.results.matches = [{
      prompt: prompt,
      documents: []
    }];
    
    logger.info('Created placeholder match structure', {
      trace_id: traceId,
      prompt: prompt
    });
  }
  
  // Ensure each match has a valid structure
  for (let i = 0; i < message.results.matches.length; i++) {
    const match = message.results.matches[i];
    
    // Ensure match has a prompt
    if (!match.prompt) {
      match.prompt = message.request.prompts?.[0] || 'Default prompt';
      logger.warn(`Added missing prompt to match[${i}]`, {
        trace_id: traceId,
        prompt: match.prompt
      });
    }
    
    // Ensure match has documents array
    if (!match.documents || !Array.isArray(match.documents)) {
      match.documents = [];
      logger.warn(`Created empty documents array for match[${i}]`, {
        trace_id: traceId
      });
    }
    
    // Validate and fix each document
    for (let j = 0; j < match.documents.length; j++) {
      const doc = match.documents[j];
      
      // Ensure document has required fields
      if (!doc.title && !doc.notification_title) {
        logger.warn(`Document[${j}] missing title`, {
          trace_id: traceId,
          document_id: doc.id || 'unknown'
        });
        doc.title = 'Notificación BOE';
        doc.notification_title = 'Notificación BOE';
      }
      
      // Ensure title is propagated to notification_title and vice versa
      if (!doc.title) doc.title = doc.notification_title;
      if (!doc.notification_title) doc.notification_title = doc.title;
      
      if (!doc.summary) {
        logger.warn(`Document[${j}] missing summary`, {
          trace_id: traceId,
          document_id: doc.id || 'unknown'
        });
        doc.summary = 'No hay resumen disponible para este documento.';
      } else if (doc.summary.length > 200) {
        // Ensure summary is truncated to 200 chars
        logger.warn(`Document[${j}] summary too long, truncating`, {
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
        logger.warn(`Document[${j}] missing publication_date, using current date`, {
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
}