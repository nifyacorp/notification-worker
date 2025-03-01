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
    
    // Validate the message structure
    if (!message.results?.matches || !Array.isArray(message.results.matches)) {
      throw new Error('Invalid message format: missing or invalid matches array');
    }
    
    if (!message.request?.user_id || !message.request?.subscription_id) {
      throw new Error('Invalid message format: missing user_id or subscription_id');
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