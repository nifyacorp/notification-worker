import { SubscriptionResult } from '../valueObjects/SubscriptionResult.js';

/**
 * Interface for message processors
 */
export interface ProcessorService {
  /**
   * The type of processor (e.g., 'boe', 'real-estate')
   */
  readonly processorType: string;
  
  /**
   * Whether this processor requires database access
   */
  readonly requiresDatabase: boolean;
  
  /**
   * Validates and transforms a raw message into a structured SubscriptionResult
   * @param message Raw message data
   * @returns Validated and transformed SubscriptionResult
   */
  validateAndTransform(message: unknown): Promise<SubscriptionResult>;
  
  /**
   * Processes a subscription result message
   * @param result Subscription result to process
   * @returns Processing statistics
   */
  process(result: SubscriptionResult): Promise<{
    created: number;
    errors: number;
    duplicates: number;
    emailsSent: number;
  }>;
}