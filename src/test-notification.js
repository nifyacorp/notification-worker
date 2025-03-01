import { createNotification } from './services/notification.js';
import { db } from './database/client.js';
import { logger } from './utils/logger.js';

// Test user ID - use the same one from diagnostics
const TEST_USER_ID = '8bf705b5-2423-4257-92bd-ab0df1ee3218';
const TEST_SUBSCRIPTION_ID = '00000000-0000-0000-0000-000000000000';

async function runTest() {
  try {
    logger.info('Starting notification test');
    
    // Test database connection
    logger.info('Testing database connection');
    await db.testConnection();
    
    // Create a test notification
    const notificationData = {
      userId: TEST_USER_ID,
      subscriptionId: TEST_SUBSCRIPTION_ID,
      title: 'Test Notification with RLS Context',
      content: 'This is a test notification created with proper RLS context',
      metadata: {
        test: true,
        timestamp: new Date().toISOString()
      }
    };
    
    logger.info('Creating test notification', { userId: TEST_USER_ID });
    const result = await createNotification(notificationData);
    
    logger.info('Test notification created successfully', { result });
    
    // Try to read back the notification to verify RLS is working
    logger.info('Attempting to read back the notification with RLS context');
    const readResult = await db.withRLSContext(TEST_USER_ID, async (client) => {
      return client.query('SELECT * FROM notifications WHERE id = $1', [result.id]);
    });
    
    if (readResult.rowCount > 0) {
      logger.info('Successfully read back notification with RLS context', {
        notification: {
          id: readResult.rows[0].id,
          title: readResult.rows[0].title,
          created_at: readResult.rows[0].created_at
        }
      });
    } else {
      logger.error('Failed to read back notification with RLS context');
    }
    
    // Try to read without RLS context (should fail or return no rows)
    try {
      logger.info('Attempting to read notification without RLS context');
      const directResult = await db.query('SELECT * FROM notifications WHERE id = $1', [result.id]);
      
      if (directResult.rowCount > 0) {
        logger.warn('Successfully read notification without RLS context - RLS might not be enforced', {
          row_count: directResult.rowCount
        });
      } else {
        logger.info('Could not read notification without RLS context - RLS is working correctly');
      }
    } catch (error) {
      logger.info('Error reading notification without RLS context - RLS is working correctly', {
        error: error.message
      });
    }
    
    logger.info('Test completed successfully');
  } catch (error) {
    logger.error('Test failed', {
      error: error.message,
      stack: error.stack
    });
  } finally {
    // Close the database connection
    await db.end();
  }
}

// Run the test
runTest().catch(error => {
  console.error('Unhandled error in test:', error);
  process.exit(1);
}); 