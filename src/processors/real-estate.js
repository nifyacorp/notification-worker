import { createNotifications } from '../services/notification.js';
import { logger } from '../utils/logger.js';

export async function processRealEstateMessage(message) {
  logger.info('Processing Real Estate message', {
    trace_id: message.trace_id,
    subscription_id: message.request.subscription_id
  });

  // Additional Real Estate-specific processing could be added here
  await createNotifications(message);
}