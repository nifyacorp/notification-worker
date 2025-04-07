/**
 * @file Enhanced logger implementation
 * Provides structured logging with context and correlation IDs
 */
/**
 * LogLevel enum for log level configuration
 */
export declare enum LogLevel {
    ERROR = 0,
    WARN = 1,
    INFO = 2,
    DEBUG = 3
}
/**
 * LogContext interface for structured logging
 */
export interface LogContext {
    [key: string]: any;
    service?: string;
    correlationId?: string;
    requestId?: string;
    userId?: string;
    subscriptionId?: string;
    traceId?: string;
}
/**
 * Logger interface
 */
export interface Logger {
    error(message: string, context?: LogContext): void;
    warn(message: string, context?: LogContext): void;
    info(message: string, context?: LogContext): void;
    debug(message: string, context?: LogContext): void;
    withContext(context: LogContext): Logger;
}
/**
 * Default Logger implementation
 * Provides structured logging with context and correlation IDs
 */
export declare class DefaultLogger implements Logger {
    private level;
    private defaultContext;
    /**
     * Constructor
     * @param level - The log level
     * @param defaultContext - Default context added to all logs
     */
    constructor(level?: LogLevel, defaultContext?: LogContext);
    /**
     * Log an error message
     * @param message - The message to log
     * @param context - Additional context
     */
    error(message: string, context?: LogContext): void;
    /**
     * Log a warning message
     * @param message - The message to log
     * @param context - Additional context
     */
    warn(message: string, context?: LogContext): void;
    /**
     * Log an info message
     * @param message - The message to log
     * @param context - Additional context
     */
    info(message: string, context?: LogContext): void;
    /**
     * Log a debug message
     * @param message - The message to log
     * @param context - Additional context
     */
    debug(message: string, context?: LogContext): void;
    /**
     * Create a new logger with additional context
     * @param context - Context to add to all log messages
     * @returns New logger instance with combined context
     */
    withContext(context: LogContext): Logger;
    /**
     * Format a log message with timestamp and context
     * @param level - The log level
     * @param message - The message to format
     * @param context - Log context
     * @returns Formatted log message
     */
    private formatMessage;
    /**
     * Filter sensitive data from log context
     * @param context - The context object
     * @param sensitiveFields - Array of sensitive field names
     * @returns Filtered context
     */
    private filterSensitiveData;
}
export declare const logger: DefaultLogger;
