import fetch from 'node-fetch';
import { logger } from '../utils/logger.js';

/**
 * Triggers a realtime notification via backend service using WebSockets
 * @param {Object} notification - The notification object
 * @returns {Promise<boolean>} - Whether the operation was successful
 */
export async function triggerRealtimeNotification(notification) {
  try {
    // The backend URL is defined in environment variables or uses a default
    const backendUrl = process.env.BACKEND_URL || 'http://localhost:3000';
    const url = `${backendUrl}/api/notifications/realtime`;
    
    logger.info('Triggering realtime notification via backend WebSocket service', {
      notification_id: notification.id,
      user_id: notification.userId,
      backend_url: backendUrl
    });
    
    // Use fetch API to make HTTP request to backend service
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': process.env.BACKEND_API_KEY || 'notification-worker-key'
      },
      body: JSON.stringify({
        userId: notification.userId,
        notificationId: notification.id,
        notification: {
          id: notification.id,
          title: notification.title,
          content: notification.content,
          sourceUrl: notification.sourceUrl || '',
          entity_type: notification.metadata?.entity_type || 'notification',
          subscription_id: notification.subscriptionId,
          created_at: notification.created_at || new Date().toISOString()
        }
      })
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Backend service returned ${response.status}: ${errorText}`);
    }
    
    logger.info('Successfully triggered realtime notification', {
      notification_id: notification.id,
      user_id: notification.userId,
      status: response.status
    });
    
    return true;
  } catch (error) {
    logger.error('Failed to trigger realtime notification', {
      error: error.message,
      notification_id: notification.id,
      user_id: notification.userId
    });
    return false;
  }
}