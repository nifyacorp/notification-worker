import { createNotifications } from '../services/notification.js';
import { logger } from '../utils/logger.js';

export async function processBOEMessage(message) {
  logger.info('Processing BOE message', {
    trace_id: message.trace_id,
    subscription_id: message.request.subscription_id
  });

  // Additional BOE-specific processing could be added here
  await createNotifications(message);
}