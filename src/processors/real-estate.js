import { createNotifications } from '../services/notification.js';
import { logger } from '../utils/logger.js';

// Process Real Estate specific fields before creating notifications
export async function processRealEstateMessage(message) {
  logger.info('Processing Real Estate message', {
    trace_id: message.trace_id,
    subscription_id: message.request.subscription_id
  });

  // Enrich notifications with Real Estate specific data
  for (const match of message.results.matches) {
    for (const doc of match.documents) {
      doc.metadata = {
        ...doc.metadata,
        price: doc.price,
        location: doc.location,
        property_type: doc.property_type,
        size_sqm: doc.size_sqm,
        rooms: doc.rooms
      };
    }
  }

  await createNotifications(message);
}