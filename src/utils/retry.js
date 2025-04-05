import { logger } from './logger.js';

/**
 * Executes an operation with retry logic using exponential backoff
 * @param {Function} operation - The async operation to execute
 * @param {Object} options - Retry options
 * @returns {Promise<any>} - Result of the operation
 */
export async function withRetry(operation, options = {}) {
  const {
    name = 'operation',
    maxRetries = 3,
    initialDelay = 1000,
    maxDelay = 10000,
    factor = 2,
    retryOnError = (err) => true,
    onRetry = () => {},
    context = {}
  } = options;
  
  let attempt = 0;
  let lastError = null;
  
  while (attempt <= maxRetries) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      attempt++;
      
      if (attempt > maxRetries || !retryOnError(error)) {
        logger.error(`${name} failed after ${attempt} attempts`, {
          error: error.message,
          error_code: error.code,
          stack: error.stack?.substring(0, 300),
          ...context
        });
        throw error;
      }
      
      const delay = Math.min(initialDelay * Math.pow(factor, attempt - 1), maxDelay);
      
      logger.info(`Retry attempt ${attempt}/${maxRetries} for ${name} after ${delay}ms`, {
        error: error.message,
        error_type: error.name,
        ...context
      });
      
      if (onRetry) {
        await onRetry(error, attempt);
      }
      
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  
  throw lastError;
}

/**
 * Determines if an error is a database connection error
 * @param {Error} error - The error to check
 * @returns {boolean} - Whether the error is a connection error
 */
export function isDatabaseConnectionError(error) {
  return (
    error.code === 'ECONNREFUSED' || 
    error.code === 'ETIMEDOUT' || 
    error.code === 'ENOTFOUND' ||
    error.code === '08003' || // Connection does not exist
    error.code === '08006' || // Connection failure
    error.code === '57P01' || // Admin shutdown
    error.code === '08001' || // Unable to establish connection
    error.code === '08004' || // Rejected connection
    error.message.includes('timeout') ||
    error.message.includes('Connection terminated')
  );
}

/**
 * Determines if an error is a database resource error
 * @param {Error} error - The error to check
 * @returns {boolean} - Whether the error is a resource error
 */
export function isDatabaseResourceError(error) {
  return (
    error.code === '53300' || // Too many connections
    error.code === '53400' || // Configuration limit exceeded
    error.code === '40P01' || // Deadlock detected
    error.code === '55P03'    // Lock not available
  );
}