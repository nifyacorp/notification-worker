import { Notification } from '../../domain/entities/Notification.js';
import { NotificationRepository } from '../../domain/repositories/NotificationRepository.js';
import { SubscriptionRepository } from '../../domain/repositories/SubscriptionRepository.js';
import { UserRepository } from '../../domain/repositories/UserRepository.js';
import { MessagingService } from '../../domain/services/MessagingService.js';
import { EmailNotification, EmailType } from '../../domain/valueObjects/EmailNotification.js';
import { CreateNotificationDto, NotificationResponseDto } from '../dtos/NotificationDto.js';
import { AppError, ErrorCode } from '../../domain/errors/AppError.js';

/**
 * Use case for creating notifications
 */
export class CreateNotificationUseCase {
  constructor(
    private readonly notificationRepository: NotificationRepository,
    private readonly userRepository: UserRepository,
    private readonly subscriptionRepository: SubscriptionRepository,
    private readonly messagingService: MessagingService
  ) {}

  /**
   * Creates a notification and handles delivery
   * @param data Notification data
   * @returns Created notification
   */
  async execute(data: CreateNotificationDto): Promise<NotificationResponseDto> {
    // Validate required fields
    if (!data.userId || !data.subscriptionId) {
      throw new AppError(
        'Missing required fields: userId and subscriptionId',
        ErrorCode.VALIDATION_ERROR,
        { providedData: data }
      );
    }

    try {
      // Check for duplicates
      const isDuplicate = await this.notificationRepository.checkDuplicate(
        data.userId,
        {
          title: data.title,
          sourceUrl: data.sourceUrl,
          entityType: data.entityType,
          metadata: data.metadata,
        }
      );

      if (isDuplicate) {
        throw new AppError(
          'Duplicate notification detected',
          ErrorCode.DUPLICATE_NOTIFICATION,
          {
            userId: data.userId,
            title: data.title,
          }
        );
      }

      // Create notification entity
      const notification = new Notification(
        null, // ID will be assigned by database
        data.userId,
        data.subscriptionId,
        data.title,
        data.content,
        data.sourceUrl || '',
        data.entityType || 'notification:generic',
        data.metadata || {},
        false, // not read
        null, // readAt
        false, // emailSent
        null, // emailSentAt
      );

      // Store notification
      const createdNotification = await this.notificationRepository.createNotification(notification, {
        setRlsContext: true,
      });

      // Get user email preferences
      const user = await this.userRepository.getUserById(data.userId);
      if (!user) {
        throw new AppError(
          `User not found: ${data.userId}`,
          ErrorCode.NOT_FOUND,
          { userId: data.userId }
        );
      }

      // Get subscription name for better context
      const subscriptionName = await this.subscriptionRepository.getSubscriptionName(data.subscriptionId);

      // Check if immediate email should be sent
      if (user.shouldReceiveInstantEmails()) {
        const emailNotification = EmailNotification.fromNotification(
          createdNotification,
          user.getNotificationEmail(),
          subscriptionName || 'NIFYA Alert',
          'immediate' as EmailType
        );

        // Send immediate email notification
        const messageId = await this.messagingService.publishEmailNotification(emailNotification);
        
        if (messageId) {
          // Mark notification as having email sent
          await this.notificationRepository.markEmailSent(createdNotification.id as string);
        }
      } else if (user.shouldReceiveDigestEmails()) {
        // Add to digest queue
        const emailNotification = EmailNotification.fromNotification(
          createdNotification,
          user.getNotificationEmail(),
          subscriptionName || 'NIFYA Alert',
          'digest' as EmailType
        );

        await this.messagingService.publishEmailNotification(emailNotification);
      }

      // Send realtime notification regardless of email preferences
      await this.messagingService.publishRealtimeNotification(
        data.userId,
        createdNotification.toJSON()
      );

      // Return response DTO
      return {
        id: createdNotification.id as string,
        userId: createdNotification.userId,
        subscriptionId: createdNotification.subscriptionId,
        title: createdNotification.title,
        content: createdNotification.content,
        sourceUrl: createdNotification.sourceUrl,
        entityType: createdNotification.entityType,
        metadata: createdNotification.metadata,
        read: createdNotification.read,
        readAt: createdNotification.readAt?.toISOString() || null,
        emailSent: createdNotification.emailSent,
        emailSentAt: createdNotification.emailSentAt?.toISOString() || null,
        createdAt: createdNotification.createdAt.toISOString(),
        updatedAt: createdNotification.updatedAt.toISOString(),
      };
    } catch (error) {
      // Re-throw AppErrors
      if (error instanceof AppError) {
        throw error;
      }

      // Wrap other errors
      throw new AppError(
        error instanceof Error ? error.message : 'Error creating notification',
        ErrorCode.NOTIFICATION_CREATION_ERROR,
        {
          userId: data.userId,
          subscriptionId: data.subscriptionId,
        },
        error instanceof Error ? error : undefined
      );
    }
  }
}