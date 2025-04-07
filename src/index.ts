/**
 * @file Application entry point
 * Starts the notification worker application
 */

import { app } from './application/bootstrap';
import { logger } from './shared/logger/logger';

/**
 * Start the service
 */
async function startService() {
  try {
    // Initialize application
    await app.initialize();
    
    // Start application
    await app.start();
    
    logger.info('Notification worker started successfully');
  } catch (error) {
    logger.error('Failed to start notification worker', {
      error: (error as Error).message,
      stack: (error as Error).stack
    });
    
    // Exit with error
    process.exit(1);
  }
}

// Start the service
startService();