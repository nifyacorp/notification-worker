/**
 * @file Retry utility
 * Provides retry functionality with exponential backoff
 */

import { logger } from '../logger/logger';
import { createErrorFromException } from '../errors/app-error';

/**
 * RetryOptions interface for configuring retry behavior
 */
export interface RetryOptions {
  /** Operation name for logging */
  name?: string;
  
  /** Maximum number of retry attempts */
  maxRetries?: number;
  
  /** Initial delay in milliseconds */
  initialDelay?: number;
  
  /** Maximum delay in milliseconds */
  maxDelay?: number;
  
  /** Exponential backoff factor */
  factor?: number;
  
  /** Function to determine if an error should trigger a retry */
  retryOnError?: (error: Error) => boolean;
  
  /** Callback function to execute before retry */
  onRetry?: (error: Error, attempt: number) => void | Promise<void>;
  
  /** Context data to include in logs */
  context?: Record<string, any>;
}

/**
 * Default retry options
 */
const DEFAULT_RETRY_OPTIONS: Required<Omit<RetryOptions, 'onRetry' | 'retryOnError' | 'context'>> = {
  name: 'operation',
  maxRetries: 3,
  initialDelay: 1000,
  maxDelay: 10000,
  factor: 2,
};

/**
 * Execute a function with retry logic
 * 
 * @param fn - The function to execute with retry
 * @param options - Retry configuration options
 * @returns The result of the function
 * @throws The last error encountered if all retries fail
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  // Merge default options with provided options
  const opts = { ...DEFAULT_RETRY_OPTIONS, ...options };
  
  // Initialize attempt counter
  let attempt = 0;
  let lastError: Error | undefined;
  
  // Create a function that determines if we should retry based on error
  const shouldRetry = options.retryOnError || (() => true);
  
  // Retry loop
  while (true) {
    try {
      // Execute the function
      return await fn();
    } catch (error) {
      // Create standardized error
      const appError = createErrorFromException(error);
      lastError = appError;
      
      // Increment attempt counter
      attempt++;
      
      // Log the error
      const logContext = {
        attempt,
        maxRetries: opts.maxRetries,
        operation: opts.name,
        ...(opts.context || {})
      };
      
      // Check if we should retry
      if (attempt <= opts.maxRetries && shouldRetry(appError)) {
        // Calculate delay with exponential backoff
        const delay = Math.min(
          opts.initialDelay * Math.pow(opts.factor, attempt - 1),
          opts.maxDelay
        );
        
        logger.warn(`${opts.name} failed, retrying in ${delay}ms`, {
          error: appError.message,
          ...logContext
        });
        
        // Execute onRetry callback if provided
        if (opts.onRetry) {
          try {
            await Promise.resolve(opts.onRetry(appError, attempt));
          } catch (callbackError) {
            logger.warn(`Error in retry callback: ${(callbackError as Error).message}`);
            // Don't fail the retry because of a callback error
          }
        }
        
        // Wait for the calculated delay
        await new Promise(resolve => setTimeout(resolve, delay));
      } else {
        // Log final failure
        logger.error(`${opts.name} failed after ${attempt} attempts`, {
          error: appError.message,
          code: appError.code,
          ...logContext
        });
        
        // Re-throw the last error
        throw appError;
      }
    }
  }
}