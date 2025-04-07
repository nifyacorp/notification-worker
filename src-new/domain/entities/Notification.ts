/**
 * Represents a user notification
 */
export class Notification {
  constructor(
    public readonly id: string | null,
    public readonly userId: string,
    public readonly subscriptionId: string,
    public readonly title: string,
    public readonly content: string,
    public readonly sourceUrl: string,
    public readonly entityType: string,
    public readonly metadata: Record<string, unknown>,
    public readonly read: boolean = false,
    public readonly readAt: Date | null = null,
    public readonly emailSent: boolean = false,
    public readonly emailSentAt: Date | null = null,
    public readonly createdAt: Date = new Date(),
    public readonly updatedAt: Date = new Date()
  ) {}

  /**
   * Marks the notification as read
   * @returns A new notification instance with read status
   */
  markAsRead(): Notification {
    return new Notification(
      this.id,
      this.userId,
      this.subscriptionId,
      this.title,
      this.content,
      this.sourceUrl,
      this.entityType,
      this.metadata,
      true, // read
      new Date(), // readAt
      this.emailSent,
      this.emailSentAt,
      this.createdAt,
      new Date() // updatedAt
    );
  }

  /**
   * Marks the notification as having email sent
   * @returns A new notification instance with email sent status
   */
  markEmailSent(): Notification {
    return new Notification(
      this.id,
      this.userId,
      this.subscriptionId,
      this.title,
      this.content,
      this.sourceUrl,
      this.entityType,
      this.metadata,
      this.read,
      this.readAt,
      true, // emailSent
      new Date(), // emailSentAt
      this.createdAt,
      new Date() // updatedAt
    );
  }

  /**
   * Updates the notification metadata
   * @param metadata Additional metadata to merge with existing metadata
   * @returns A new notification instance with updated metadata
   */
  updateMetadata(metadata: Record<string, unknown>): Notification {
    return new Notification(
      this.id,
      this.userId,
      this.subscriptionId,
      this.title,
      this.content,
      this.sourceUrl,
      this.entityType,
      { ...this.metadata, ...metadata },
      this.read,
      this.readAt,
      this.emailSent,
      this.emailSentAt,
      this.createdAt,
      new Date() // updatedAt
    );
  }

  /**
   * Creates a plain object representation of the notification
   * @returns Plain object representation
   */
  toJSON(): Record<string, unknown> {
    return {
      id: this.id,
      user_id: this.userId,
      subscription_id: this.subscriptionId,
      title: this.title,
      content: this.content,
      source_url: this.sourceUrl,
      entity_type: this.entityType,
      metadata: this.metadata,
      read: this.read,
      read_at: this.readAt,
      email_sent: this.emailSent,
      email_sent_at: this.emailSentAt,
      created_at: this.createdAt,
      updated_at: this.updatedAt,
    };
  }
}