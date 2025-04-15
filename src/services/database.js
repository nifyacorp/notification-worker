import { db } from '../database/client.js';
import { logger } from '../utils/logger.js';

// Re-export the database client to maintain backward compatibility
export const database = db;

// Log a warning about using the deprecated module
logger.warn('services/database.js is deprecated, use database/client.js directly');

// Export other functions for backward compatibility
export const { 
  query, 
  setRLSContext, 
  withRLSContext, 
  testConnection, 
  getConnectionState, 
  end 
} = db;