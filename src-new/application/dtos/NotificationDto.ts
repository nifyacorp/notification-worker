/**
 * DTO for creating a notification
 */
export interface CreateNotificationDto {
  userId: string;
  subscriptionId: string;
  title: string;
  content: string;
  sourceUrl?: string;
  entityType?: string;
  metadata?: Record<string, unknown>;
}

/**
 * DTO for notification response
 */
export interface NotificationResponseDto {
  id: string;
  userId: string;
  subscriptionId: string;
  title: string;
  content: string;
  sourceUrl: string;
  entityType: string;
  metadata: Record<string, unknown>;
  read: boolean;
  readAt: string | null;
  emailSent: boolean;
  emailSentAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * DTO for processing result statistics
 */
export interface ProcessingResultDto {
  created: number;
  errors: number;
  duplicates: number;
  emailsSent: number;
  successRate: string;
  processingTimeMs: number;
}