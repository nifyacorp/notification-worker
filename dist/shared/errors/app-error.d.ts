/**
 * @file Application error classes
 * Standardized error handling with error codes
 */
/**
 * ErrorCode enum for categorizing errors
 */
export declare enum ErrorCode {
    UNKNOWN = "UNKNOWN",
    VALIDATION = "VALIDATION",
    NOT_FOUND = "NOT_FOUND",
    UNAUTHORIZED = "UNAUTHORIZED",
    FORBIDDEN = "FORBIDDEN",
    DB_CONNECTION = "DB_CONNECTION",
    DB_QUERY = "DB_QUERY",
    DB_TRANSACTION = "DB_TRANSACTION",
    DB_CONSTRAINT = "DB_CONSTRAINT",
    DB_PERMISSION = "DB_PERMISSION",
    PUBSUB_CONNECTION = "PUBSUB_CONNECTION",
    PUBSUB_PUBLISH = "PUBSUB_PUBLISH",
    PUBSUB_SUBSCRIBE = "PUBSUB_SUBSCRIBE",
    PUBSUB_MESSAGE = "PUBSUB_MESSAGE",
    PROCESSOR_NOT_FOUND = "PROCESSOR_NOT_FOUND",
    PROCESSOR_VALIDATION = "PROCESSOR_VALIDATION",
    PROCESSOR_EXECUTION = "PROCESSOR_EXECUTION",
    SERVICE_UNAVAILABLE = "SERVICE_UNAVAILABLE",
    SERVICE_TIMEOUT = "SERVICE_TIMEOUT",
    SERVICE_ERROR = "SERVICE_ERROR"
}
/**
 * Base application error class
 */
export declare class AppError extends Error {
    readonly code: ErrorCode;
    readonly statusCode: number;
    readonly context: Record<string, any>;
    readonly original?: Error;
    /**
     * Constructor
     * @param message - Error message
     * @param code - Error code
     * @param statusCode - HTTP status code
     * @param context - Additional context
     * @param original - Original error
     */
    constructor(message: string, code?: ErrorCode, statusCode?: number, context?: Record<string, any>, original?: Error);
    /**
     * Convert error to JSON representation
     * @returns JSON object
     */
    toJSON(): Record<string, any>;
}
/**
 * Validation error class
 */
export declare class ValidationError extends AppError {
    constructor(message: string, context?: Record<string, any>, original?: Error);
}
/**
 * Not found error class
 */
export declare class NotFoundError extends AppError {
    constructor(message: string, context?: Record<string, any>, original?: Error);
}
/**
 * Database error class
 */
export declare class DatabaseError extends AppError {
    constructor(message: string, code?: ErrorCode, context?: Record<string, any>, original?: Error);
}
/**
 * PubSub error class
 */
export declare class PubSubError extends AppError {
    constructor(message: string, code?: ErrorCode, context?: Record<string, any>, original?: Error);
}
/**
 * Processor error class
 */
export declare class ProcessorError extends AppError {
    constructor(message: string, code?: ErrorCode, context?: Record<string, any>, original?: Error);
}
/**
 * Create an error from any caught exception
 * @param error - The caught error
 * @param defaultMessage - Default message if error is not an Error instance
 * @returns Appropriate AppError instance
 */
export declare function createErrorFromException(error: unknown, defaultMessage?: string): AppError;
