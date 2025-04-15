import { logger } from '../utils/logger.js';
import { createNotificationsFromMessage as processMessage } from './parser.js';

/**
 * @deprecated Use the parser.js module instead
 * Legacy adapter for backward compatibility
 */
export async function createNotificationsFromMessage(message) {
  logger.warn('notification-processor.js is deprecated, use parser.js instead');
  return processMessage(message);
} 