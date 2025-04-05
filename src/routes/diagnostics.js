import { logger } from '../utils/logger.js';
import { database } from '../services/database.js';
import { createNotification } from '../services/notification.js';
import url from 'url';

/**
 * Handler for database diagnostics endpoint
 * @param {Object} req - HTTP request object
 * @param {Object} res - HTTP response object
 */
export async function handleDatabaseDiagnostics(req, res) {
  logger.info('Processing database diagnostics request');
  
  try {
    // Parse query parameters
    const parsedUrl = url.parse(req.url, true);
    const queryParams = parsedUrl.query;
    const userId = queryParams.userId || '8bf705b5-2423-4257-92bd-ab0df1ee3218'; // Default test user ID
    
    // Check database connection
    const dbConnectionStatus = database.getConnectionState();
    
    // Diagnostic query results
    let notificationCount = null;
    let databaseRole = null;
    let testNotificationResult = null;
    let rlsPolicies = null;
    let rlsEnabled = null;
    let appUserIdSetting = null;
    
    // Only run these if we're connected
    if (dbConnectionStatus.isConnected) {
      try {
        // Check current database role
        const roleResult = await database.query('SELECT current_user, current_database()');
        databaseRole = roleResult.rows[0];
        
        // Check if RLS is enabled on notifications table
        const rlsResult = await database.query(`
          SELECT relname, relrowsecurity 
          FROM pg_class 
          WHERE relname = 'notifications'
        `);
        rlsEnabled = rlsResult.rows[0]?.relrowsecurity === true;
        
        // Get RLS policies on notifications table
        const policiesResult = await database.query(`
          SELECT * FROM pg_policies 
          WHERE tablename = 'notifications'
        `);
        rlsPolicies = policiesResult.rows;
        
        // Check app.current_user_id setting
        try {
          const settingResult = await database.query(`SELECT current_setting('app.current_user_id', TRUE) as app_user_id`);
          appUserIdSetting = settingResult.rows[0]?.app_user_id;
        } catch (settingError) {
          appUserIdSetting = null;
        }
        
        // Try to set the user ID for RLS
        try {
          await database.query(`SET LOCAL app.current_user_id = $1`, [userId]);
          logger.info('Set app.current_user_id for RLS', { userId });
        } catch (setError) {
          logger.warn('Failed to set app.current_user_id', { error: setError.message });
        }
        
        // Try to count notifications for user
        const countResult = await database.query('SELECT COUNT(*) FROM notifications WHERE user_id = $1', [userId]);
        notificationCount = parseInt(countResult.rows[0].count, 10);
        
        // Try to create a test notification
        const testNotification = {
          user_id: userId,
          subscription_id: '00000000-0000-0000-0000-000000000000', // Test subscription ID
          title: 'Database Diagnostic Test',
          content: 'This is a test notification from the diagnostics endpoint',
          source_url: '',
          metadata: JSON.stringify({
            diagnostic: true,
            timestamp: new Date().toISOString(),
            source: 'diagnostics-endpoint'
          })
        };
        
        try {
          // Direct database insertion to test database access
          const insertResult = await database.query(
            `INSERT INTO notifications (
              user_id, subscription_id, title, content, source_url, metadata, created_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
            [
              testNotification.user_id,
              testNotification.subscription_id,
              testNotification.title,
              testNotification.content,
              testNotification.source_url,
              testNotification.metadata,
              new Date()
            ]
          );
          
          testNotificationResult = {
            success: true,
            notification_id: insertResult.rows[0].id
          };
          
          // Try to read back the notification we just created to test RLS
          const readBackResult = await database.query(
            `SELECT * FROM notifications WHERE id = $1`,
            [insertResult.rows[0].id]
          );
          
          testNotificationResult.read_back_success = readBackResult.rowCount > 0;
          testNotificationResult.read_back_count = readBackResult.rowCount;
          
        } catch (insertError) {
          testNotificationResult = {
            success: false,
            error: insertError.message,
            code: insertError.code
          };
        }
      } catch (queryError) {
        logger.error('Diagnostic query error:', {
          error: queryError.message,
          stack: queryError.stack
        });
      }
    }
    
    // Get environment variables (redact sensitive values)
    const envVars = {};
    for (const [key, value] of Object.entries(process.env)) {
      // Redact sensitive values
      if (key.includes('PASSWORD') || key.includes('KEY') || key.includes('SECRET')) {
        envVars[key] = '[REDACTED]';
      } else {
        envVars[key] = value;
      }
    }
    
    // Send diagnostics response
    const responseData = {
      timestamp: new Date().toISOString(),
      service: 'notification-worker',
      database: dbConnectionStatus,
      diagnostics: {
        user_id: userId,
        notification_count: notificationCount,
        database_role: databaseRole,
        rls_enabled: rlsEnabled,
        rls_policies: rlsPolicies,
        app_user_id_setting: appUserIdSetting,
        test_notification: testNotificationResult
      },
      environment: envVars
    };
    
    logger.info('Sending diagnostics response', {
      success: true,
      timestamp: responseData.timestamp,
      database_connected: dbConnectionStatus.isConnected
    });
    
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(responseData, null, 2));
  } catch (error) {
    logger.error('Diagnostics endpoint error:', {
      error: error.message,
      stack: error.stack
    });
    
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      error: 'Diagnostics failed',
      message: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    }));
  }
}

/**
 * Handler for notification creation test endpoint
 * @param {Object} req - HTTP request object
 * @param {Object} res - HTTP response object
 */
export function handleCreateNotification(req, res) {
  // Read request body
  let body = '';
  req.on('data', chunk => {
    body += chunk.toString();
  });
  
  req.on('end', async () => {
    try {
      const data = JSON.parse(body);
      const { userId, title, content, subscriptionId } = data;
      
      if (!userId || !subscriptionId) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          error: 'Missing required fields',
          message: 'userId and subscriptionId are required'
        }));
        return;
      }
      
      // Create test notification using the service with RLS context
      const testNotificationData = {
        userId,
        subscriptionId,
        title: title || 'Service Diagnostic Test',
        content: content || 'This is a test notification created via the service layer',
        sourceUrl: '',
        metadata: {
          diagnostic: true,
          source: 'diagnostics-service-endpoint',
          timestamp: new Date().toISOString()
        }
      };
      
      // Use the notification service to create the notification with RLS context
      const result = await createNotification(testNotificationData);
      
      // Try to read back the notification to verify RLS is working
      let readBackResult = null;
      try {
        const readResult = await database.withRLSContext(userId, async (client) => {
          return client.query('SELECT * FROM notifications WHERE id = $1', [result.id]);
        });
        
        if (readResult.rowCount > 0) {
          readBackResult = {
            success: true,
            notification_id: readResult.rows[0].id,
            title: readResult.rows[0].title,
            created_at: readResult.rows[0].created_at
          };
        } else {
          readBackResult = {
            success: false,
            message: 'Notification created but could not be read back with RLS context'
          };
        }
      } catch (readError) {
        readBackResult = {
          success: false,
          error: readError.message
        };
      }
      
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        success: true,
        notification: result,
        read_back_test: readBackResult,
        timestamp: new Date().toISOString()
      }));
    } catch (parseError) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        error: 'Invalid request body',
        message: parseError.message
      }));
    }
  });
}

/**
 * Handler for debug notifications endpoint
 * @param {Object} req - HTTP request object
 * @param {Object} res - HTTP response object
 */
export async function handleDebugNotifications(req, res) {
  try {
    // Parse query parameters
    const parsedUrl = url.parse(req.url, true);
    const queryParams = parsedUrl.query;
    const userId = queryParams.userId || null;
    const limit = parseInt(queryParams.limit || '10', 10);
    const offset = parseInt(queryParams.offset || '0', 10);
    const subscriptionId = queryParams.subscriptionId || null;
    
    logger.info('Processing debug notifications request', {
      userId,
      limit,
      offset,
      subscriptionId
    });
    
    // Fetch recent notifications
    let query = 'SELECT * FROM notifications';
    const params = [];
    let conditions = [];
    
    if (userId) {
      conditions.push('user_id = $' + (params.length + 1));
      params.push(userId);
    }
    
    if (subscriptionId) {
      conditions.push('subscription_id = $' + (params.length + 1));
      params.push(subscriptionId);
    }
    
    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ');
    }
    
    query += ' ORDER BY created_at DESC LIMIT $' + (params.length + 1) + ' OFFSET $' + (params.length + 2);
    params.push(limit, offset);
    
    const notificationsResult = await database.query(query, params);
    
    // Count total notifications
    let countQuery = 'SELECT COUNT(*) FROM notifications';
    if (conditions.length > 0) {
      countQuery += ' WHERE ' + conditions.join(' AND ');
    }
    
    const countResult = await database.query(countQuery, params.slice(0, params.length - 2));
    const totalCount = parseInt(countResult.rows[0].count, 10);
    
    // Get service state info from processorMetrics
    
    // Send response
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      notifications: notificationsResult.rows,
      pagination: {
        total: totalCount,
        offset,
        limit,
        has_more: offset + limit < totalCount
      },
      timestamp: new Date().toISOString()
    }, null, 2));
    
  } catch (error) {
    logger.error('Debug notifications error:', {
      error: error.message,
      stack: error.stack
    });
    
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      error: 'Failed to fetch notifications',
      message: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    }));
  }
}