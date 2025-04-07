/**
 * @file Enhanced logger implementation
 * Provides structured logging with context and correlation IDs
 */

/**
 * LogLevel enum for log level configuration
 */
export enum LogLevel {
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
export class DefaultLogger implements Logger {
  private level: LogLevel;
  private defaultContext: LogContext;
  
  /**
   * Constructor
   * @param level - The log level
   * @param defaultContext - Default context added to all logs
   */
  constructor(level: LogLevel = LogLevel.INFO, defaultContext: LogContext = {}) {
    this.level = level;
    this.defaultContext = {
      service: 'notification-worker',
      ...defaultContext
    };
  }
  
  /**
   * Log an error message
   * @param message - The message to log
   * @param context - Additional context
   */
  public error(message: string, context: LogContext = {}): void {
    if (this.level >= LogLevel.ERROR) {
      console.error(this.formatMessage('ERROR', message, {
        ...this.defaultContext,
        ...context
      }));
    }
  }
  
  /**
   * Log a warning message
   * @param message - The message to log
   * @param context - Additional context
   */
  public warn(message: string, context: LogContext = {}): void {
    if (this.level >= LogLevel.WARN) {
      console.warn(this.formatMessage('WARN', message, {
        ...this.defaultContext,
        ...context
      }));
    }
  }
  
  /**
   * Log an info message
   * @param message - The message to log
   * @param context - Additional context
   */
  public info(message: string, context: LogContext = {}): void {
    if (this.level >= LogLevel.INFO) {
      console.info(this.formatMessage('INFO', message, {
        ...this.defaultContext,
        ...context
      }));
    }
  }
  
  /**
   * Log a debug message
   * @param message - The message to log
   * @param context - Additional context
   */
  public debug(message: string, context: LogContext = {}): void {
    if (this.level >= LogLevel.DEBUG) {
      console.debug(this.formatMessage('DEBUG', message, {
        ...this.defaultContext,
        ...context
      }));
    }
  }
  
  /**
   * Create a new logger with additional context
   * @param context - Context to add to all log messages
   * @returns New logger instance with combined context
   */
  public withContext(context: LogContext): Logger {
    return new DefaultLogger(this.level, {
      ...this.defaultContext,
      ...context
    });
  }
  
  /**
   * Format a log message with timestamp and context
   * @param level - The log level
   * @param message - The message to format
   * @param context - Log context
   * @returns Formatted log message
   */
  private formatMessage(level: string, message: string, context: LogContext): string {
    const timestamp = new Date().toISOString();
    
    // Extract sensitive fields to filter
    const sensitiveFields = ['password', 'token', 'secret', 'key', 'auth'];
    const safeContext = this.filterSensitiveData(context, sensitiveFields);
    
    // Format as JSON for structured logging
    const contextString = Object.keys(safeContext).length 
      ? ` ${JSON.stringify(safeContext)}`
      : '';
      
    return `${timestamp} ${level}: ${message}${contextString}`;
  }
  
  /**
   * Filter sensitive data from log context
   * @param context - The context object
   * @param sensitiveFields - Array of sensitive field names
   * @returns Filtered context
   */
  private filterSensitiveData(context: LogContext, sensitiveFields: string[]): LogContext {
    const filtered = { ...context };
    
    for (const key of Object.keys(filtered)) {
      // Check if this is a sensitive field
      const isSensitive = sensitiveFields.some(field => 
        key.toLowerCase().includes(field.toLowerCase())
      );
      
      if (isSensitive && typeof filtered[key] === 'string') {
        filtered[key] = '[FILTERED]';
      } else if (typeof filtered[key] === 'object' && filtered[key] !== null) {
        // Recursively filter nested objects
        filtered[key] = this.filterSensitiveData(filtered[key], sensitiveFields);
      }
    }
    
    return filtered;
  }
}

/**
 * Create a global logger instance
 */
const currentLevel = getLogLevelFromEnv();
export const logger = new DefaultLogger(currentLevel);

/**
 * Get log level from environment variable
 * @returns The log level
 */
function getLogLevelFromEnv(): LogLevel {
  const envLevel = process.env.LOG_LEVEL?.toLowerCase();
  
  if (envLevel === 'debug') return LogLevel.DEBUG;
  if (envLevel === 'info') return LogLevel.INFO;
  if (envLevel === 'warn') return LogLevel.WARN;
  if (envLevel === 'error') return LogLevel.ERROR;
  
  // Default to INFO
  return LogLevel.INFO;
}