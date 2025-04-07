import { Subscription } from '../../domain/entities/Subscription.js';
import { SubscriptionRepository } from '../../domain/repositories/SubscriptionRepository.js';
import { AppError, ErrorCode } from '../../domain/errors/AppError.js';
import { PostgresClient } from '../database/PostgresClient.js';
import { Logger } from '../logging/Logger.js';

/**
 * PostgreSQL implementation of the subscription repository
 */
export class PostgresSubscriptionRepository implements SubscriptionRepository {
  constructor(
    private readonly db: PostgresClient,
    private readonly logger: Logger
  ) {}

  /**
   * Gets a subscription by ID
   * @param subscriptionId The ID of the subscription
   * @returns Subscription entity or null if not found
   */
  async getSubscriptionById(subscriptionId: string): Promise<Subscription | null> {
    try {
      const result = await this.db.query(`
        SELECT 
          id,
          user_id,
          name,
          type,
          status,
          metadata,
          created_at,
          updated_at
        FROM subscriptions
        WHERE id = $1
      `, [subscriptionId]);

      if (result.rows.length === 0) {
        return null;
      }

      const row = result.rows[0];
      return this.mapRowToSubscription(row);
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      throw new AppError(
        `Failed to get subscription: ${err.message}`,
        ErrorCode.DATABASE_ERROR,
        { subscriptionId },
        err
      );
    }
  }

  /**
   * Gets a subscription name by ID
   * @param subscriptionId The ID of the subscription
   * @returns Subscription name or null if not found
   */
  async getSubscriptionName(subscriptionId: string): Promise<string | null> {
    try {
      const result = await this.db.query(`
        SELECT name
        FROM subscriptions
        WHERE id = $1
      `, [subscriptionId]);

      if (result.rows.length === 0) {
        return null;
      }

      return result.rows[0].name;
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.logger.warn('Failed to get subscription name', {
        error: err.message,
        subscriptionId
      });
      return null;
    }
  }

  /**
   * Gets all active subscriptions for a user
   * @param userId The ID of the user
   * @returns Array of subscription entities
   */
  async getActiveSubscriptionsForUser(userId: string): Promise<Subscription[]> {
    try {
      const result = await this.db.query(`
        SELECT 
          id,
          user_id,
          name,
          type,
          status,
          metadata,
          created_at,
          updated_at
        FROM subscriptions
        WHERE user_id = $1 AND status = 'active'
      `, [userId], { setContext: userId });

      return result.rows.map(row => this.mapRowToSubscription(row));
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      throw new AppError(
        `Failed to get active subscriptions: ${err.message}`,
        ErrorCode.DATABASE_ERROR,
        { userId },
        err
      );
    }
  }

  /**
   * Verifies that a subscription belongs to a user
   * @param subscriptionId The ID of the subscription
   * @param userId The ID of the user
   * @returns True if the subscription belongs to the user
   */
  async verifySubscriptionOwnership(subscriptionId: string, userId: string): Promise<boolean> {
    try {
      const result = await this.db.query(`
        SELECT EXISTS(
          SELECT 1
          FROM subscriptions
          WHERE id = $1 AND user_id = $2
        ) as exists
      `, [subscriptionId, userId], { setContext: userId });

      return result.rows[0]?.exists || false;
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.logger.warn('Failed to verify subscription ownership', {
        error: err.message,
        subscriptionId,
        userId
      });
      return false;
    }
  }

  /**
   * Maps a database row to a Subscription entity
   * @param row Database row
   * @returns Subscription entity
   */
  private mapRowToSubscription(row: any): Subscription {
    return new Subscription(
      row.id,
      row.user_id,
      row.name,
      row.type,
      row.status,
      row.metadata || {},
      row.created_at,
      row.updated_at
    );
  }
}