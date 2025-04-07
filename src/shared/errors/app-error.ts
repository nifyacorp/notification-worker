/**
 * @file Application error classes
 * Standardized error handling with error codes
 */

/**
 * ErrorCode enum for categorizing errors
 */
export enum ErrorCode {
  // General errors
  UNKNOWN = 'UNKNOWN',
  VALIDATION = 'VALIDATION',
  NOT_FOUND = 'NOT_FOUND',
  UNAUTHORIZED = 'UNAUTHORIZED',
  FORBIDDEN = 'FORBIDDEN',
  
  // Database errors
  DB_CONNECTION = 'DB_CONNECTION',
  DB_QUERY = 'DB_QUERY',
  DB_TRANSACTION = 'DB_TRANSACTION',
  DB_CONSTRAINT = 'DB_CONSTRAINT',
  DB_PERMISSION = 'DB_PERMISSION',
  
  // PubSub errors
  PUBSUB_CONNECTION = 'PUBSUB_CONNECTION',
  PUBSUB_PUBLISH = 'PUBSUB_PUBLISH',
  PUBSUB_SUBSCRIBE = 'PUBSUB_SUBSCRIBE',
  PUBSUB_MESSAGE = 'PUBSUB_MESSAGE',
  
  // Processing errors
  PROCESSOR_NOT_FOUND = 'PROCESSOR_NOT_FOUND',
  PROCESSOR_VALIDATION = 'PROCESSOR_VALIDATION',
  PROCESSOR_EXECUTION = 'PROCESSOR_EXECUTION',
  
  // External service errors
  SERVICE_UNAVAILABLE = 'SERVICE_UNAVAILABLE',
  SERVICE_TIMEOUT = 'SERVICE_TIMEOUT',
  SERVICE_ERROR = 'SERVICE_ERROR',
}

/**
 * Base application error class
 */
export class AppError extends Error {
  public readonly code: ErrorCode;
  public readonly statusCode: number;
  public readonly context: Record<string, any>;
  public readonly original?: Error;
  
  /**
   * Constructor
   * @param message - Error message
   * @param code - Error code
   * @param statusCode - HTTP status code
   * @param context - Additional context
   * @param original - Original error
   */
  constructor(
    message: string,
    code: ErrorCode = ErrorCode.UNKNOWN,
    statusCode: number = 500,
    context: Record<string, any> = {},
    original?: Error
  ) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.statusCode = statusCode;
    this.context = context;
    this.original = original;
    
    // Maintain proper stack trace
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }
  
  /**
   * Convert error to JSON representation
   * @returns JSON object
   */
  toJSON(): Record<string, any> {
    return {
      message: this.message,
      code: this.code,
      statusCode: this.statusCode,
      context: this.context,
      stack: this.stack,
      original: this.original ? {
        message: this.original.message,
        name: this.original.name,
        stack: this.original.stack,
      } : undefined,
    };
  }
}

/**
 * Validation error class
 */
export class ValidationError extends AppError {
  constructor(
    message: string,
    context: Record<string, any> = {},
    original?: Error
  ) {
    super(message, ErrorCode.VALIDATION, 400, context, original);
  }
}

/**
 * Not found error class
 */
export class NotFoundError extends AppError {
  constructor(
    message: string,
    context: Record<string, any> = {},
    original?: Error
  ) {
    super(message, ErrorCode.NOT_FOUND, 404, context, original);
  }
}

/**
 * Database error class
 */
export class DatabaseError extends AppError {
  constructor(
    message: string,
    code: ErrorCode = ErrorCode.DB_CONNECTION,
    context: Record<string, any> = {},
    original?: Error
  ) {
    super(message, code, 500, context, original);
  }
}

/**
 * PubSub error class
 */
export class PubSubError extends AppError {
  constructor(
    message: string,
    code: ErrorCode = ErrorCode.PUBSUB_CONNECTION,
    context: Record<string, any> = {},
    original?: Error
  ) {
    super(message, code, 500, context, original);
  }
}

/**
 * Processor error class
 */
export class ProcessorError extends AppError {
  constructor(
    message: string,
    code: ErrorCode = ErrorCode.PROCESSOR_EXECUTION,
    context: Record<string, any> = {},
    original?: Error
  ) {
    super(message, code, 500, context, original);
  }
}

/**
 * Create an error from any caught exception
 * @param error - The caught error
 * @param defaultMessage - Default message if error is not an Error instance
 * @returns Appropriate AppError instance
 */
export function createErrorFromException(error: unknown, defaultMessage = 'Unknown error occurred'): AppError {
  if (error instanceof AppError) {
    return error;
  }
  
  if (error instanceof Error) {
    // Determine error type from properties or message
    const errorMessage = error.message;
    
    // Database errors
    if (
      'code' in error &&
      typeof (error as any).code === 'string' &&
      [
        'ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND',
        '08003', '08006', '57P01', '08001', '08004'
      ].includes((error as any).code)
    ) {
      return new DatabaseError(
        `Database connection error: ${errorMessage}`,
        ErrorCode.DB_CONNECTION,
        { originalCode: (error as any).code },
        error
      );
    }
    
    if (errorMessage.includes('database') || 
        errorMessage.includes('sql') || 
        errorMessage.includes('query') ||
        errorMessage.includes('connection')) {
      return new DatabaseError(errorMessage, ErrorCode.DB_QUERY, {}, error);
    }
    
    // Validation errors
    if (errorMessage.includes('validation') || 
        errorMessage.includes('invalid') || 
        errorMessage.includes('required') ||
        error.name === 'ValidationError' ||
        error.name === 'ZodError') {
      return new ValidationError(errorMessage, {}, error);
    }
    
    // PubSub errors
    if (errorMessage.includes('pubsub') || 
        errorMessage.includes('topic') || 
        errorMessage.includes('subscription')) {
      return new PubSubError(errorMessage, ErrorCode.PUBSUB_CONNECTION, {}, error);
    }
    
    // Generic AppError
    return new AppError(errorMessage, ErrorCode.UNKNOWN, 500, {}, error);
  }
  
  // For non-Error objects
  return new AppError(
    typeof error === 'string' ? error : defaultMessage,
    ErrorCode.UNKNOWN,
    500,
    { originalError: error }
  );
}