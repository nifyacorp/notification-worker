import { db } from '../database/client.js';
import { logger } from '../utils/logger.js';

export async function createNotifications(message) {
  const { user_id, subscription_id } = message.request;
  
  for (const match of message.results.matches) {
    for (const doc of match.documents) {
      try {
        await db.query(
          `INSERT INTO notifications (
            user_id,
            subscription_id,
            title,
            content,
            source_url,
            metadata
          ) VALUES ($1, $2, $3, $4, $5, $6)
          RETURNING id`,
          [
            user_id,
            subscription_id,
            doc.title,
            doc.summary,
            doc.links.html,
            JSON.stringify({
              prompt: match.prompt,
              relevance: doc.relevance_score,
              document_type: doc.document_type,
              processor_type: message.processor_type,
              trace_id: message.trace_id
            })
          ]
        );

        logger.info('Created notification', {
          user_id,
          subscription_id,
          trace_id: message.trace_id,
          document_type: doc.document_type
        });
      } catch (error) {
        logger.error('Failed to create notification', {
          error,
          user_id,
          subscription_id,
          trace_id: message.trace_id
        });
        throw error;
      }
    }
  }
}