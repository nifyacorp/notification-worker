import { User, NotificationPreferences } from '../../domain/entities/User.js';
import { UserRepository } from '../../domain/repositories/UserRepository.js';
import { AppError, ErrorCode } from '../../domain/errors/AppError.js';
import { PostgresClient } from '../database/PostgresClient.js';
import { Logger } from '../logging/Logger.js';

/**
 * PostgreSQL implementation of the user repository
 */
export class PostgresUserRepository implements UserRepository {
  constructor(
    private readonly db: PostgresClient,
    private readonly logger: Logger
  ) {}

  /**
   * Gets a user by ID
   * @param userId User ID to retrieve
   * @returns User entity or null if not found
   */
  async getUserById(userId: string): Promise<User | null> {
    try {
      const result = await this.db.query(`
        SELECT 
          id,
          email,
          notification_settings,
          email = 'nifyacorp@gmail.com' as is_test_user
        FROM users
        WHERE id = $1
      `, [userId]);

      if (result.rows.length === 0) {
        return null;
      }

      const row = result.rows[0];
      
      // Extract notification preferences with defaults
      const notificationSettings = row.notification_settings || {};
      const preferences: NotificationPreferences = {
        emailNotifications: notificationSettings.emailNotifications === true,
        instantNotifications: notificationSettings.instantNotifications === true,
        notificationEmail: notificationSettings.notificationEmail || row.email,
        digestFrequency: notificationSettings.digestFrequency || 'daily',
      };

      return new User(
        row.id,
        row.email,
        preferences,
        row.is_test_user
      );
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      throw new AppError(
        `Failed to get user: ${err.message}`,
        ErrorCode.DATABASE_ERROR,
        { userId },
        err
      );
    }
  }

  /**
   * Gets a user's notification email
   * @param userId User ID
   * @returns User's notification email or null if not found
   */
  async getUserNotificationEmail(userId: string): Promise<string | null> {
    try {
      const result = await this.db.query(`
        SELECT 
          email,
          notification_settings->>'notificationEmail' as notification_email
        FROM users
        WHERE id = $1
      `, [userId]);

      if (result.rows.length === 0) {
        return null;
      }

      const row = result.rows[0];
      return row.notification_email || row.email;
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.logger.error('Failed to get user notification email', {
        error: err.message,
        userId
      });
      return null;
    }
  }

  /**
   * Updates a user's notification preferences
   * @param userId User ID
   * @param preferences Updated preferences
   * @returns Updated user or null if not found
   */
  async updateNotificationPreferences(
    userId: string,
    preferences: Partial<NotificationPreferences>
  ): Promise<User | null> {
    try {
      // First get the current user to merge preferences
      const user = await this.getUserById(userId);
      if (!user) {
        return null;
      }

      // Merge current preferences with updates
      const updatedPreferences = {
        ...user.notificationPreferences,
        ...preferences,
      };

      // Update in database
      const result = await this.db.query(`
        UPDATE users
        SET 
          notification_settings = notification_settings || $1,
          updated_at = NOW()
        WHERE id = $2
        RETURNING 
          id,
          email,
          notification_settings,
          email = 'nifyacorp@gmail.com' as is_test_user
      `, [JSON.stringify(updatedPreferences), userId]);

      if (result.rows.length === 0) {
        return null;
      }

      const row = result.rows[0];
      
      // Extract notification preferences
      const notificationSettings = row.notification_settings || {};
      const newPreferences: NotificationPreferences = {
        emailNotifications: notificationSettings.emailNotifications === true,
        instantNotifications: notificationSettings.instantNotifications === true,
        notificationEmail: notificationSettings.notificationEmail || row.email,
        digestFrequency: notificationSettings.digestFrequency || 'daily',
      };

      return new User(
        row.id,
        row.email,
        newPreferences,
        row.is_test_user
      );
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      throw new AppError(
        `Failed to update notification preferences: ${err.message}`,
        ErrorCode.DATABASE_ERROR,
        { userId },
        err
      );
    }
  }
}