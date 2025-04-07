/**
 * Error codes for application errors
 */
export enum ErrorCode {
  // General errors
  UNKNOWN_ERROR = 'UNKNOWN_ERROR',
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  NOT_FOUND = 'NOT_FOUND',
  UNAUTHORIZED = 'UNAUTHORIZED',
  
  // Message processing errors
  INVALID_MESSAGE_FORMAT = 'INVALID_MESSAGE_FORMAT',
  UNKNOWN_PROCESSOR_TYPE = 'UNKNOWN_PROCESSOR_TYPE',
  PROCESSING_ERROR = 'PROCESSING_ERROR',
  
  // Database errors
  DATABASE_ERROR = 'DATABASE_ERROR',
  DATABASE_CONNECTION_ERROR = 'DATABASE_CONNECTION_ERROR',
  RLS_CONTEXT_ERROR = 'RLS_CONTEXT_ERROR',
  
  // Notification errors
  NOTIFICATION_CREATION_ERROR = 'NOTIFICATION_CREATION_ERROR',
  DUPLICATE_NOTIFICATION = 'DUPLICATE_NOTIFICATION',
  
  // Messaging errors
  PUBSUB_ERROR = 'PUBSUB_ERROR',
  EMAIL_NOTIFICATION_ERROR = 'EMAIL_NOTIFICATION_ERROR',
  REALTIME_NOTIFICATION_ERROR = 'REALTIME_NOTIFICATION_ERROR',
}

/**
 * Custom application error class
 */
export class AppError extends Error {
  /**
   * Creates a new application error
   * @param message Error message
   * @param code Error code
   * @param context Additional context for the error
   * @param cause Original error that caused this one
   */
  constructor(
    message: string,
    public readonly code: ErrorCode,
    public readonly context: Record<string, unknown> = {},
    public readonly cause?: Error
  ) {
    super(message);
    this.name = 'AppError';
    
    // Maintain proper stack trace in Node.js
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, AppError);
    }
  }

  /**
   * Creates a JSON representation of the error
   * @returns Plain object representation
   */
  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      message: this.message,
      code: this.code,
      context: this.context,
      cause: this.cause ? {
        name: this.cause.name,
        message: this.cause.message,
      } : undefined,
    };
  }
}