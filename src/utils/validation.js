import { BOEMessageSchema } from '../types/boe.js';
import { RealEstateMessageSchema } from '../types/real-estate.js';
import { logger } from './logger.js';
import { z } from 'zod';

// Schema map for different processor types
const SCHEMA_MAP = {
  'boe': BOEMessageSchema,
  'real-estate': RealEstateMessageSchema,
};

// Generic schema for unknown processor types (fallback)
const GenericMessageSchema = z.object({
  version: z.string(),
  processor_type: z.string(),
  timestamp: z.string().datetime(),
  trace_id: z.string(),
  request: z.object({
    subscription_id: z.string(),
    processing_id: z.string(),
    user_id: z.string(),
    prompts: z.array(z.string()),
  }),
  results: z.object({
    query_date: z.string(),
    matches: z.array(z.object({
      prompt: z.string(),
      documents: z.array(z.object({
        document_type: z.string(),
        title: z.string(),
        summary: z.string(),
        relevance_score: z.number(),
        links: z.object({
          html: z.string(),
          pdf: z.string().optional(),
        }).passthrough(),
      }).passthrough()),
    })),
  }),
  metadata: z.object({
    processing_time_ms: z.number(),
    total_matches: z.number(),
    status: z.enum(['success', 'error']),
    error: z.string().nullable(),
  }),
}).passthrough();

/**
 * Sanitize message data before validation
 * @param {Object} data - Message data to sanitize
 * @returns {Object} Sanitized message data
 */
function sanitizeMessageData(data) {
  if (!data) return null;
  
  try {
    // Clone the data to avoid modifying the original
    const sanitized = JSON.parse(JSON.stringify(data));
    
    // Function to sanitize a single document
    const sanitizeDocument = (doc) => {
      if (!doc) return doc;
      
      // Sanitize links
      if (doc.links) {
        // Ensure HTML and PDF links are valid URLs
        if (doc.links.html && typeof doc.links.html === 'string' && !doc.links.html.startsWith('http')) {
          doc.links.html = `https://example.com/${doc.links.html}`;
        }
        if (doc.links.pdf && typeof doc.links.pdf === 'string' && !doc.links.pdf.startsWith('http')) {
          doc.links.pdf = `https://example.com/${doc.links.pdf}`;
        }
      }
      
      // Better sanitize publication date
      if (doc.publication_date !== undefined) {
        let isValidDate = false;
        
        if (typeof doc.publication_date === 'string') {
          // Try to parse as ISO date
          const date = new Date(doc.publication_date);
          if (!isNaN(date.getTime())) {
            doc.publication_date = date.toISOString();
            isValidDate = true;
          }
        }
        
        if (!isValidDate) {
          // Use current date as fallback
          doc.publication_date = new Date().toISOString();
        }
      }
      
      // Ensure relevance_score is a number
      if (doc.relevance_score !== undefined && typeof doc.relevance_score !== 'number') {
        doc.relevance_score = parseFloat(doc.relevance_score) || 0.5;
      }
      
      return doc;
    };
    
    // Process all matches and their documents
    if (sanitized.results && sanitized.results.matches) {
      sanitized.results.matches.forEach(match => {
        if (match.documents && Array.isArray(match.documents)) {
          match.documents = match.documents.map(sanitizeDocument);
        }
      });
    }
    
    // Ensure metadata has required fields
    if (!sanitized.metadata) {
      sanitized.metadata = {
        processing_time_ms: 0,
        total_matches: sanitized.results?.matches?.length || 0,
        status: 'success',
        error: null
      };
    }
    
    return sanitized;
  } catch (error) {
    logger.error('Error sanitizing message data', {
      error: error.message,
      stack: error.stack
    });
    return data; // Return original data if sanitization fails
  }
}

/**
 * Validate a message using the appropriate schema
 * @param {Object} message - The message to validate
 * @returns {Object} Validation result with data, valid flag, and any errors
 */
export function validateMessage(message) {
  try {
    // First sanitize the data
    const sanitizedMessage = sanitizeMessageData(message);
    
    if (!sanitizedMessage) {
      throw new Error('Cannot validate null or undefined message');
    }
    
    const processorType = sanitizedMessage.processor_type;
    const schema = SCHEMA_MAP[processorType] || GenericMessageSchema;
    
    // Use safeParse instead of parse to get validation errors without throwing
    const result = schema.safeParse(sanitizedMessage);
    
    if (!result.success) {
      logger.warn('Message validation warning', {
        processor_type: processorType,
        trace_id: sanitizedMessage.trace_id,
        errors: result.error.format()
      });
      
      // Return sanitized data even with validation errors
      return {
        data: sanitizedMessage,
        valid: false,
        errors: result.error.format(),
        processorType
      };
    }
    
    return {
      data: result.data,
      valid: true,
      errors: null,
      processorType
    };
  } catch (error) {
    logger.error('Error in message validation', {
      error: error.message,
      stack: error.stack,
      processor_type: message?.processor_type
    });
    
    return {
      data: message,
      valid: false,
      errors: { message: error.message },
      processorType: message?.processor_type
    };
  }
}

/**
 * Legacy version of validateMessage that maintains previous behavior
 * This ensures backward compatibility
 * @param {Object} message - The message to validate
 * @returns {Object} Parsed message or throws error
 */
export function validateMessageStrict(message) {
  try {
    const sanitizedMessage = sanitizeMessageData(message);
    
    const processorType = sanitizedMessage.processor_type;
    const schema = SCHEMA_MAP[processorType];
    
    if (!schema) {
      throw new Error(`Unknown processor type: ${processorType}`);
    }
    
    return schema.parse(sanitizedMessage);
  } catch (error) {
    logger.error('Message validation failed', {
      error: error.message,
      processor_type: message?.processor_type,
      trace_id: message?.trace_id
    });
    throw error;
  }
}