import { describe, it, expect } from 'vitest';
import { Notification } from '../../../../src-new/domain/entities/Notification';

describe('Notification Entity', () => {
  // Test data
  const testData = {
    id: '123e4567-e89b-12d3-a456-426614174000',
    userId: '123e4567-e89b-12d3-a456-426614174001',
    subscriptionId: '123e4567-e89b-12d3-a456-426614174002',
    title: 'Test Notification',
    content: 'This is a test notification',
    sourceUrl: 'https://example.com',
    entityType: 'test:notification',
    metadata: { test: 'data' },
    createdAt: new Date('2023-01-01T12:00:00Z'),
    updatedAt: new Date('2023-01-01T12:00:00Z')
  };

  it('should create a notification with the correct properties', () => {
    const notification = new Notification(
      testData.id,
      testData.userId,
      testData.subscriptionId,
      testData.title,
      testData.content,
      testData.sourceUrl,
      testData.entityType,
      testData.metadata,
      false,
      null,
      false,
      null,
      testData.createdAt,
      testData.updatedAt
    );

    expect(notification.id).toBe(testData.id);
    expect(notification.userId).toBe(testData.userId);
    expect(notification.subscriptionId).toBe(testData.subscriptionId);
    expect(notification.title).toBe(testData.title);
    expect(notification.content).toBe(testData.content);
    expect(notification.sourceUrl).toBe(testData.sourceUrl);
    expect(notification.entityType).toBe(testData.entityType);
    expect(notification.metadata).toEqual(testData.metadata);
    expect(notification.read).toBe(false);
    expect(notification.readAt).toBeNull();
    expect(notification.emailSent).toBe(false);
    expect(notification.emailSentAt).toBeNull();
    expect(notification.createdAt).toEqual(testData.createdAt);
    expect(notification.updatedAt).toEqual(testData.updatedAt);
  });

  it('should mark a notification as read', () => {
    const notification = new Notification(
      testData.id,
      testData.userId,
      testData.subscriptionId,
      testData.title,
      testData.content,
      testData.sourceUrl,
      testData.entityType,
      testData.metadata,
      false,
      null,
      false,
      null,
      testData.createdAt,
      testData.updatedAt
    );

    const readNotification = notification.markAsRead();

    // Original notification should be unchanged (immutability)
    expect(notification.read).toBe(false);
    expect(notification.readAt).toBeNull();

    // New notification should be marked as read
    expect(readNotification.read).toBe(true);
    expect(readNotification.readAt).not.toBeNull();
    expect(readNotification.updatedAt.getTime()).toBeGreaterThan(notification.updatedAt.getTime());
  });

  it('should mark a notification as having email sent', () => {
    const notification = new Notification(
      testData.id,
      testData.userId,
      testData.subscriptionId,
      testData.title,
      testData.content,
      testData.sourceUrl,
      testData.entityType,
      testData.metadata,
      false,
      null,
      false,
      null,
      testData.createdAt,
      testData.updatedAt
    );

    const emailSentNotification = notification.markEmailSent();

    // Original notification should be unchanged (immutability)
    expect(notification.emailSent).toBe(false);
    expect(notification.emailSentAt).toBeNull();

    // New notification should be marked as having email sent
    expect(emailSentNotification.emailSent).toBe(true);
    expect(emailSentNotification.emailSentAt).not.toBeNull();
    expect(emailSentNotification.updatedAt.getTime()).toBeGreaterThan(notification.updatedAt.getTime());
  });

  it('should update metadata', () => {
    const notification = new Notification(
      testData.id,
      testData.userId,
      testData.subscriptionId,
      testData.title,
      testData.content,
      testData.sourceUrl,
      testData.entityType,
      { initial: 'value' },
      false,
      null,
      false,
      null,
      testData.createdAt,
      testData.updatedAt
    );

    const updatedNotification = notification.updateMetadata({ new: 'data' });

    // Original notification should be unchanged (immutability)
    expect(notification.metadata).toEqual({ initial: 'value' });

    // New notification should have merged metadata
    expect(updatedNotification.metadata).toEqual({ initial: 'value', new: 'data' });
    expect(updatedNotification.updatedAt.getTime()).toBeGreaterThan(notification.updatedAt.getTime());
  });

  it('should convert to JSON correctly', () => {
    const notification = new Notification(
      testData.id,
      testData.userId,
      testData.subscriptionId,
      testData.title,
      testData.content,
      testData.sourceUrl,
      testData.entityType,
      testData.metadata,
      false,
      null,
      false,
      null,
      testData.createdAt,
      testData.updatedAt
    );

    const json = notification.toJSON();

    expect(json).toEqual({
      id: testData.id,
      user_id: testData.userId,
      subscription_id: testData.subscriptionId,
      title: testData.title,
      content: testData.content,
      source_url: testData.sourceUrl,
      entity_type: testData.entityType,
      metadata: testData.metadata,
      read: false,
      read_at: null,
      email_sent: false,
      email_sent_at: null,
      created_at: testData.createdAt,
      updated_at: testData.updatedAt
    });
  });
});