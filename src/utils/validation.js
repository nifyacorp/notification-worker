import { BOEMessageSchema } from '../types/boe.js';
import { RealEstateMessageSchema } from '../types/real-estate.js';
import { logger } from './logger.js';

const SCHEMA_MAP = {
  'boe': BOEMessageSchema,
  'real-estate': RealEstateMessageSchema,
};

// Add this utility function to sanitize data before validation
function sanitizeMessageData(data) {
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
  
  return sanitized;
}

// Update the validateMessage function to use sanitization
export function validateMessage(message) {
  try {
    // First sanitize the data
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
      processor_type: sanitizedMessage?.processor_type,
      trace_id: sanitizedMessage?.trace_id
    });
    throw error;
  }
}