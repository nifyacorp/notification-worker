import { User } from '../entities/User.js';

/**
 * Interface for user repository operations
 */
export interface UserRepository {
  /**
   * Gets a user by ID
   * @param userId The ID of the user to retrieve
   * @returns User entity or null if not found
   */
  getUserById(userId: string): Promise<User | null>;
  
  /**
   * Gets a user's notification email
   * @param userId The ID of the user
   * @returns User's notification email or null if not found
   */
  getUserNotificationEmail(userId: string): Promise<string | null>;
  
  /**
   * Updates a user's notification preferences
   * @param userId The ID of the user
   * @param preferences Updated preferences
   * @returns Updated user entity or null if not found
   */
  updateNotificationPreferences(
    userId: string, 
    preferences: Partial<User['notificationPreferences']>
  ): Promise<User | null>;
}