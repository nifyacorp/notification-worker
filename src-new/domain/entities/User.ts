/**
 * Represents a user's notification preferences
 */
export interface NotificationPreferences {
  emailNotifications: boolean;
  instantNotifications: boolean;
  notificationEmail?: string;
  digestFrequency: 'daily' | 'weekly' | 'never';
}

/**
 * Represents a user in the system
 */
export class User {
  constructor(
    public readonly id: string,
    public readonly email: string,
    public readonly notificationPreferences: NotificationPreferences,
    public readonly isTestUser: boolean = false
  ) {}

  /**
   * Checks if the user should receive instant email notifications
   * @returns Boolean indicating if user should receive instant emails
   */
  shouldReceiveInstantEmails(): boolean {
    // Test users always receive instant emails
    if (this.isTestUser) {
      return true;
    }

    // Check user preferences
    return this.notificationPreferences.instantNotifications && this.hasValidEmailAddress();
  }

  /**
   * Checks if the user should receive digest email notifications
   * @returns Boolean indicating if user should receive digest emails
   */
  shouldReceiveDigestEmails(): boolean {
    return (
      this.notificationPreferences.emailNotifications &&
      this.notificationPreferences.digestFrequency !== 'never' &&
      this.hasValidEmailAddress()
    );
  }

  /**
   * Gets the user's email address for notifications
   * @returns The email address to use for notifications
   */
  getNotificationEmail(): string {
    return this.notificationPreferences.notificationEmail || this.email;
  }

  /**
   * Checks if the user has a valid email address for notifications
   * @returns Boolean indicating if there's a valid email
   */
  private hasValidEmailAddress(): boolean {
    const email = this.getNotificationEmail();
    return !!email && email.includes('@') && email.includes('.');
  }
}