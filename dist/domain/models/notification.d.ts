/**
 * @file Notification domain model
 * Contains the core notification entity and related types
 */
/**
 * EntityType enum for categorizing notifications
 */
export declare enum EntityType {
    GENERIC = "notification:generic",
    BOE_DOCUMENT = "boe:document",
    BOE_RESOLUTION = "boe:resolution",
    BOE_ANNOUNCEMENT = "boe:announcement",
    REAL_ESTATE_LISTING = "real-estate:listing",
    REAL_ESTATE_PRICE_CHANGE = "real-estate:price-change"
}
/**
 * NotificationMetadata interface for structured metadata
 */
export interface NotificationMetadata {
    prompt?: string;
    relevance?: number;
    documentType?: string;
    originalTitle?: string;
    processorType?: string;
    publicationDate?: string;
    issuingBody?: string;
    section?: string;
    department?: string;
    traceId?: string;
    [key: string]: any;
}
/**
 * NotificationStatus enum for tracking notification state
 */
export declare enum NotificationStatus {
    UNREAD = "unread",
    READ = "read",
    ARCHIVED = "archived"
}
/**
 * Core Notification domain entity
 */
export interface Notification {
    id?: string;
    userId: string;
    subscriptionId: string;
    title: string;
    content: string;
    sourceUrl: string;
    metadata: NotificationMetadata;
    entityType: EntityType | string;
    status?: NotificationStatus;
    createdAt?: Date;
    updatedAt?: Date;
}
/**
 * NotificationCreationResult interface for tracking creation results
 */
export interface NotificationCreationResult {
    created: number;
    errors: number;
    details?: Array<{
        success: boolean;
        id?: string;
        error?: string;
    }>;
}
/**
 * EmailNotification interface for notifications sent via email
 */
export interface EmailNotification {
    userId: string;
    email: string;
    notification: {
        id: string;
        title: string;
        content: string;
        sourceUrl: string;
        subscriptionName: string;
    };
    timestamp: string;
}
