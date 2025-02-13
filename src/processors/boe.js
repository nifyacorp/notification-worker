import { createNotifications } from '../services/notification.js';
import { logger } from '../utils/logger.js';

// Process BOE-specific fields before creating notifications
export async function processBOEMessage(message) {
  logger.info('Processing BOE message', {
    trace_id: message.trace_id,
    subscription_id: message.request.subscription_id
  });

  // Enrich notifications with BOE-specific data
  for (const match of message.results.matches) {
    for (const doc of match.documents) {
      doc.metadata = {
        ...doc.metadata,
        publication_date: doc.publication_date,
        section: doc.section,
        bulletin_type: doc.bulletin_type
      };
    }
  }

  await createNotifications(message);
}