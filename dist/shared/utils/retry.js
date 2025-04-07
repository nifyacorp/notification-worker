/**
 * @file Retry utility
 * Provides retry functionality with exponential backoff
 */
import { logger } from '../logger/logger';
import { createErrorFromException } from '../errors/app-error';
/**
 * Default retry options
 */
const DEFAULT_RETRY_OPTIONS = {
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
export async function withRetry(fn, options = {}) {
    // Merge default options with provided options
    const opts = { ...DEFAULT_RETRY_OPTIONS, ...options };
    // Initialize attempt counter
    let attempt = 0;
    let lastError;
    // Create a function that determines if we should retry based on error
    const shouldRetry = options.retryOnError || (() => true);
    // Retry loop
    while (true) {
        try {
            // Execute the function
            return await fn();
        }
        catch (error) {
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
                const delay = Math.min(opts.initialDelay * Math.pow(opts.factor, attempt - 1), opts.maxDelay);
                logger.warn(`${opts.name} failed, retrying in ${delay}ms`, {
                    error: appError.message,
                    ...logContext
                });
                // Execute onRetry callback if provided
                if (opts.onRetry) {
                    try {
                        await Promise.resolve(opts.onRetry(appError, attempt));
                    }
                    catch (callbackError) {
                        logger.warn(`Error in retry callback: ${callbackError.message}`);
                        // Don't fail the retry because of a callback error
                    }
                }
                // Wait for the calculated delay
                await new Promise(resolve => setTimeout(resolve, delay));
            }
            else {
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
//# sourceMappingURL=retry.js.map