import { Notification } from '../../domain/entities/Notification.js';
import { NotificationService as NotificationServiceInterface, ProcessingResult } from '../../domain/services/NotificationService.js';
import { SubscriptionResult, DocumentMatch } from '../../domain/valueObjects/SubscriptionResult.js';
import { NotificationRepository } from '../../domain/repositories/NotificationRepository.js';
import { UserRepository } from '../../domain/repositories/UserRepository.js';
import { SubscriptionRepository } from '../../domain/repositories/SubscriptionRepository.js';
import { MessagingService } from '../../domain/services/MessagingService.js';
import { EmailNotification, EmailType } from '../../domain/valueObjects/EmailNotification.js';
import { Logger } from '../../infrastructure/logging/Logger.js';
import { AppError, ErrorCode } from '../../domain/errors/AppError.js';

/**
 * Service for processing and creating notifications
 */
export class NotificationService implements NotificationServiceInterface {
  constructor(
    private readonly notificationRepository: NotificationRepository,
    private readonly userRepository: UserRepository,
    private readonly subscriptionRepository: SubscriptionRepository,
    private readonly messagingService: MessagingService,
    private readonly logger: Logger
  ) {}

  /**
   * Processes subscription results to create notifications
   * @param result Subscription processing result
   * @returns Processing statistics
   */
  async processSubscriptionResult(result: SubscriptionResult): Promise<ProcessingResult> {
    const startTime = Date.now();
    let created = 0;
    let errors = 0;
    let duplicates = 0;
    let emailsSent = 0;

    this.logger.info('Processing subscription result', {
      trace_id: result.traceId,
      user_id: result.userId,
      subscription_id: result.subscriptionId,
      processor_type: result.processorType,
      match_count: result.matches.length,
      total_docs: result.getTotalDocumentCount()
    });

    try {
      // Verify subscription ownership
      const isOwner = await this.subscriptionRepository.verifySubscriptionOwnership(
        result.subscriptionId,
        result.userId
      );

      if (!isOwner) {
        throw new AppError(
          'User does not own this subscription',
          ErrorCode.UNAUTHORIZED,
          {
            user_id: result.userId,
            subscription_id: result.subscriptionId,
            trace_id: result.traceId
          }
        );
      }

      // Get subscription for name
      const subscription = await this.subscriptionRepository.getSubscriptionById(result.subscriptionId);
      if (!subscription) {
        throw new AppError(
          'Subscription not found',
          ErrorCode.NOT_FOUND,
          {
            subscription_id: result.subscriptionId,
            trace_id: result.traceId
          }
        );
      }

      // Get user for email preferences
      const user = await this.userRepository.getUserById(result.userId);
      if (!user) {
        throw new AppError(
          'User not found',
          ErrorCode.NOT_FOUND,
          {
            user_id: result.userId,
            trace_id: result.traceId
          }
        );
      }

      // Process each match and its documents
      for (const match of result.matches) {
        for (const doc of match.documents) {
          try {
            // Check for duplicates
            const isDuplicate = await this.notificationRepository.checkDuplicate(
              result.userId,
              {
                title: doc.notification_title || doc.title,
                sourceUrl: doc.links.html,
                entityType: `${result.processorType}:${doc.document_type || 'document'}`,
                metadata: {
                  document_id: doc.id,
                  bulletin_type: doc.bulletin_type
                }
              }
            );

            if (isDuplicate) {
              this.logger.info('Skipping duplicate notification', {
                trace_id: result.traceId,
                title: doc.title,
                document_id: doc.id
              });
              duplicates++;
              continue;
            }

            // Create notification
            const notification = await this.createNotificationFromDocument(
              result.userId,
              result.subscriptionId,
              match.prompt,
              doc,
              result.processorType,
              result.traceId
            );

            created++;

            // Handle email if needed
            if (user.shouldReceiveInstantEmails()) {
              // Create email notification
              const emailNotification = EmailNotification.fromNotification(
                notification,
                user.getNotificationEmail(),
                subscription.name,
                'immediate' as EmailType
              );

              // Send email
              const messageId = await this.messagingService.publishEmailNotification(emailNotification);
              if (messageId) {
                await this.notificationRepository.markEmailSent(notification.id as string);
                emailsSent++;
              }
            } else if (user.shouldReceiveDigestEmails()) {
              // Add to digest
              const emailNotification = EmailNotification.fromNotification(
                notification,
                user.getNotificationEmail(),
                subscription.name,
                'digest' as EmailType
              );

              await this.messagingService.publishEmailNotification(emailNotification);
            }

            // Send realtime notification
            await this.messagingService.publishRealtimeNotification(
              result.userId,
              notification.toJSON()
            );
          } catch (error) {
            errors++;
            const err = error instanceof Error ? error : new Error(String(error));
            this.logger.error('Error processing document', {
              error: err.message,
              trace_id: result.traceId,
              document_id: doc.id,
              title: doc.title,
              user_id: result.userId,
              subscription_id: result.subscriptionId
            });

            // Continue processing other documents
          }
        }
      }

      const processingTime = Date.now() - startTime;
      this.logger.info('Subscription result processing completed', {
        trace_id: result.traceId,
        user_id: result.userId,
        subscription_id: result.subscriptionId,
        created,
        errors,
        duplicates,
        emails_sent: emailsSent,
        processing_time_ms: processingTime
      });

      return {
        created,
        errors,
        duplicates,
        emailsSent
      };
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.logger.error('Failed to process subscription result', {
        error: err.message,
        trace_id: result.traceId,
        user_id: result.userId,
        subscription_id: result.subscriptionId,
        processor_type: result.processorType
      });

      // Re-throw AppErrors
      if (error instanceof AppError) {
        throw error;
      }

      // Wrap other errors
      throw new AppError(
        `Failed to process subscription result: ${err.message}`,
        ErrorCode.PROCESSING_ERROR,
        {
          trace_id: result.traceId,
          user_id: result.userId,
          subscription_id: result.subscriptionId
        },
        err
      );
    }
  }

  /**
   * Creates a notification and handles email/realtime delivery
   * @param notification Notification to create
   * @returns Created notification with ID
   */
  async createAndDeliverNotification(notification: Notification): Promise<Notification> {
    try {
      // Create the notification
      const createdNotification = await this.notificationRepository.createNotification(
        notification,
        { setRlsContext: true }
      );

      // Get user and subscription for email preferences
      const user = await this.userRepository.getUserById(notification.userId);
      if (!user) {
        throw new AppError(
          'User not found',
          ErrorCode.NOT_FOUND,
          { userId: notification.userId }
        );
      }

      const subscriptionName = await this.subscriptionRepository.getSubscriptionName(
        notification.subscriptionId
      );

      // Handle email if needed
      if (user.shouldReceiveInstantEmails()) {
        // Create email notification
        const emailNotification = EmailNotification.fromNotification(
          createdNotification,
          user.getNotificationEmail(),
          subscriptionName || 'NIFYA Alert',
          'immediate' as EmailType
        );

        // Send email
        const messageId = await this.messagingService.publishEmailNotification(emailNotification);
        if (messageId) {
          await this.notificationRepository.markEmailSent(createdNotification.id as string);
        }
      } else if (user.shouldReceiveDigestEmails()) {
        // Add to digest
        const emailNotification = EmailNotification.fromNotification(
          createdNotification,
          user.getNotificationEmail(),
          subscriptionName || 'NIFYA Alert',
          'digest' as EmailType
        );

        await this.messagingService.publishEmailNotification(emailNotification);
      }

      // Send realtime notification
      await this.messagingService.publishRealtimeNotification(
        notification.userId,
        createdNotification.toJSON()
      );

      return createdNotification;
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.logger.error('Failed to create and deliver notification', {
        error: err.message,
        user_id: notification.userId,
        subscription_id: notification.subscriptionId
      });

      // Re-throw AppErrors
      if (error instanceof AppError) {
        throw error;
      }

      // Wrap other errors
      throw new AppError(
        `Failed to create and deliver notification: ${err.message}`,
        ErrorCode.NOTIFICATION_CREATION_ERROR,
        {
          userId: notification.userId,
          subscriptionId: notification.subscriptionId
        },
        err
      );
    }
  }

  /**
   * Sends an email notification for a specific notification
   * @param notificationId Notification ID to send email for
   * @returns True if email was sent successfully
   */
  async sendEmailForNotification(notificationId: string): Promise<boolean> {
    try {
      // This is a placeholder implementation
      // In a real implementation, we would:
      // 1. Get the notification
      // 2. Get the user's email
      // 3. Get the subscription name
      // 4. Create and send the email notification
      // 5. Mark the notification as having email sent
      
      return false;
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.logger.error('Failed to send email for notification', {
        error: err.message,
        notification_id: notificationId
      });
      return false;
    }
  }

  /**
   * Creates a notification from a document
   * @param userId User ID
   * @param subscriptionId Subscription ID
   * @param prompt Subscription prompt
   * @param doc Document data
   * @param processorType Processor type
   * @param traceId Trace ID for logging
   * @returns Created notification
   */
  private async createNotificationFromDocument(
    userId: string,
    subscriptionId: string,
    prompt: string,
    doc: DocumentMatch,
    processorType: string,
    traceId: string
  ): Promise<Notification> {
    // Generate a meaningful title
    let title: string;
    
    // Try to use notification_title first
    if (doc.notification_title && doc.notification_title.length > 3 && 
        doc.notification_title !== 'string' && !doc.notification_title.includes('notification')) {
      title = doc.notification_title;
    }
    // Next try the original title
    else if (doc.title && doc.title.length > 3 && 
            doc.title !== 'string' && !doc.title.includes('notification')) {
      // Truncate long titles
      title = doc.title.length > 80 
        ? doc.title.substring(0, 77) + '...' 
        : doc.title;
    }
    // If both are missing, construct a descriptive title
    else if (doc.document_type) {
      const docType = doc.document_type || 'Documento';
      const issuer = doc.issuing_body || doc.department || '';
      const date = doc.publication_date ? ` (${doc.publication_date})` : '';
      
      title = `${docType}${issuer ? ' de ' + issuer : ''}${date}`;
    }
    else {
      // Last resort - use processor type and prompt context
      const promptContext = prompt && prompt.length > 5 ? 
        `: "${prompt.substring(0, 30)}${prompt.length > 30 ? '...' : ''}"` : '';
        
      title = processorType 
        ? `Alerta ${processorType}${promptContext}` 
        : `Alerta${promptContext}`;
    }

    // Create entity type
    const entityType = `${processorType}:${doc.document_type?.toLowerCase() || 'document'}`;
    
    // Create metadata
    const metadata: Record<string, unknown> = {
      prompt,
      relevance: doc.relevance_score,
      document_type: doc.document_type,
      original_title: doc.title,
      processor_type: processorType,
      publication_date: doc.publication_date,
      issuing_body: doc.issuing_body,
      section: doc.section,
      department: doc.department,
      trace_id: traceId
    };

    // Create and save notification
    const notification = new Notification(
      null, // ID will be assigned by repository
      userId,
      subscriptionId,
      title,
      doc.summary || '',
      doc.links.html || '',
      entityType,
      metadata
    );

    return await this.notificationRepository.createNotification(notification, { setRlsContext: true });
  }
}