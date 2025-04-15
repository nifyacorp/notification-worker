import { logger } from '../utils/logger.js';
import { processMessage } from './message-processor.js';

/**
 * Legacy adapter for BOE processor
 * @deprecated Use message-processor.js instead
 */
export async function processBOEMessage(message) {
  logger.warn('processBOEMessage is deprecated, use processMessage instead');
  
  // Add BOE-specific metadata if not present
  if (!message.processor_type) {
    message.processor_type = 'boe';
  }
  
  return processMessage(message);
}

/**
 * Legacy adapter for Real Estate processor
 * @deprecated Use message-processor.js instead
 */
export async function processRealEstateMessage(message) {
  logger.warn('processRealEstateMessage is deprecated, use processMessage instead');
  
  // Add Real Estate-specific metadata if not present
  if (!message.processor_type) {
    message.processor_type = 'real-estate';
  }
  
  return processMessage(message);
}

// Export the unified processor as the default
export { processMessage }; 