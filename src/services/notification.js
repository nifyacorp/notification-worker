import { db } from '../database/client.js';
import { logger } from '../utils/logger.js';

export async function createNotifications(message) {
  const { user_id, subscription_id } = message.request;
  
  for (const match of message.results.matches) {
    for (const doc of match.documents) {
      try {
        // Determine the best title to use for the notification
        const notificationTitle = doc.notification_title || doc.title || 'Notification';
        
        await db.query(
          `INSERT INTO notifications (
            user_id,
            subscription_id,
            title,
            content,
            source_url,
            entity_type,
            metadata,
            created_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
          RETURNING id`,
          [
            user_id,
            subscription_id,
            notificationTitle,
            doc.summary,
            doc.links.html,
            `boe:${doc.document_type?.toLowerCase() || 'document'}`,
            JSON.stringify({
              prompt: match.prompt,
              relevance: doc.relevance_score,
              document_type: doc.document_type,
              original_title: doc.title,
              processor_type: message.processor_type,
              publication_date: doc.dates?.publication_date,
              issuing_body: doc.issuing_body,
              section: doc.section,
              department: doc.department,
              trace_id: message.trace_id
            }),
            new Date()
          ]
        );

        logger.info('Created notification', {
          user_id,
          subscription_id,
          title: notificationTitle,
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