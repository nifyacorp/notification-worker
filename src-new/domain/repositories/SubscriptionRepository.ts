import { Subscription } from '../entities/Subscription.js';

/**
 * Interface for subscription repository operations
 */
export interface SubscriptionRepository {
  /**
   * Gets a subscription by ID
   * @param subscriptionId The ID of the subscription
   * @returns Subscription entity or null if not found
   */
  getSubscriptionById(subscriptionId: string): Promise<Subscription | null>;
  
  /**
   * Gets a subscription name by ID
   * @param subscriptionId The ID of the subscription
   * @returns Subscription name or null if not found
   */
  getSubscriptionName(subscriptionId: string): Promise<string | null>;
  
  /**
   * Gets all active subscriptions for a user
   * @param userId The ID of the user
   * @returns Array of subscription entities
   */
  getActiveSubscriptionsForUser(userId: string): Promise<Subscription[]>;
  
  /**
   * Verifies that a subscription belongs to a user
   * @param subscriptionId The ID of the subscription
   * @param userId The ID of the user
   * @returns True if the subscription belongs to the user
   */
  verifySubscriptionOwnership(subscriptionId: string, userId: string): Promise<boolean>;
}