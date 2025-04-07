/**
 * @file Retry utility
 * Provides retry functionality with exponential backoff
 */
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
 * Execute a function with retry logic
 *
 * @param fn - The function to execute with retry
 * @param options - Retry configuration options
 * @returns The result of the function
 * @throws The last error encountered if all retries fail
 */
export declare function withRetry<T>(fn: () => Promise<T>, options?: RetryOptions): Promise<T>;
