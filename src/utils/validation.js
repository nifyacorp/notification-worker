import { BOEMessageSchema } from '../types/boe.js';
import { RealEstateMessageSchema } from '../types/real-estate.js';
import { logger } from './logger.js';

const SCHEMA_MAP = {
  'boe': BOEMessageSchema,
  'real-estate': RealEstateMessageSchema,
};

export function validateMessage(message) {
  try {
    const processorType = message.processor_type;
    const schema = SCHEMA_MAP[processorType];
    
    if (!schema) {
      throw new Error(`Unknown processor type: ${processorType}`);
    }
    
    return schema.parse(message);
  } catch (error) {
    logger.error('Message validation failed', {
      error: error.message,
      processor_type: message?.processor_type,
      trace_id: message?.trace_id
    });
    throw error;
  }
}