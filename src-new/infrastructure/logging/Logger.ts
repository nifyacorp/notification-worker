import winston from 'winston';
import { Config } from '../config/Config.js';

/**
 * Create a logger service for consistent logging
 */
export class Logger {
  private logger: winston.Logger;

  /**
   * Creates a new logger instance
   * @param config Application configuration
   */
  constructor(config: Config) {
    // Define log format
    const logFormat = winston.format.combine(
      winston.format.timestamp(),
      winston.format.errors({ stack: true }),
      winston.format.json()
    );

    // Create logger
    this.logger = winston.createLogger({
      level: config.logLevel,
      format: logFormat,
      defaultMeta: {
        service: config.serviceName,
        env: config.environment,
      },
      transports: [
        new winston.transports.Console({
          format: winston.format.combine(
            winston.format.colorize(),
            winston.format.timestamp(),
            winston.format.printf(({ timestamp, level, message, ...meta }) => {
              // Format stack traces specially
              const stack = meta.stack ? `\n${meta.stack}` : '';
              // Remove stack from meta to avoid duplication
              if (meta.stack) {
                delete meta.stack;
              }
              
              // Clean up metadata for display
              const metaString = Object.keys(meta).length > 0 
                ? ` ${JSON.stringify(meta)}` 
                : '';
              
              return `${timestamp} [${level}]: ${message}${metaString}${stack}`;
            })
          ),
        }),
      ],
    });
  }

  /**
   * Log an error message
   * @param message Log message
   * @param meta Additional metadata
   */
  error(message: string, meta: Record<string, unknown> = {}): void {
    this.logger.error(message, this.sanitizeMetadata(meta));
  }

  /**
   * Log a warning message
   * @param message Log message
   * @param meta Additional metadata
   */
  warn(message: string, meta: Record<string, unknown> = {}): void {
    this.logger.warn(message, this.sanitizeMetadata(meta));
  }

  /**
   * Log an info message
   * @param message Log message
   * @param meta Additional metadata
   */
  info(message: string, meta: Record<string, unknown> = {}): void {
    this.logger.info(message, this.sanitizeMetadata(meta));
  }

  /**
   * Log a debug message
   * @param message Log message
   * @param meta Additional metadata
   */
  debug(message: string, meta: Record<string, unknown> = {}): void {
    this.logger.debug(message, this.sanitizeMetadata(meta));
  }

  /**
   * Sanitizes metadata to prevent sensitive data leakage
   * @param meta Metadata to sanitize
   * @returns Sanitized metadata
   */
  private sanitizeMetadata(meta: Record<string, unknown>): Record<string, unknown> {
    const sanitized = { ...meta };
    
    // List of sensitive field names to redact
    const sensitiveFields = ['password', 'token', 'secret', 'key', 'credential'];
    
    // Redact sensitive fields
    for (const key of Object.keys(sanitized)) {
      // Check if this field name contains any sensitive terms
      if (sensitiveFields.some(term => key.toLowerCase().includes(term))) {
        sanitized[key] = '******';
      }
      
      // Recursively sanitize nested objects
      if (sanitized[key] && typeof sanitized[key] === 'object') {
        sanitized[key] = this.sanitizeMetadata(sanitized[key] as Record<string, unknown>);
      }
    }
    
    return sanitized;
  }
}