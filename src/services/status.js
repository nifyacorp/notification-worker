import { logger } from '../utils/logger.js';
import { connectionState } from '../database/client.js';
import { pubsubState } from './pubsub/client.js';
import { processorMetrics } from './pubsub/processor.js';

// Service status singleton
export const serviceStatus = {
  // Core state
  startTime: new Date().toISOString(),
  operatingMode: 'initializing', // 'initializing', 'full', 'limited', or 'minimal'
  ready: false,
  
  // Subsystem states
  databaseActive: false,
  pubsubActive: false,
  subscriptionActive: false,
  
  // Error tracking
  errors: [],
  
  // Add a new error
  addError(source, message, data = {}) {
    this.errors.push({
      time: new Date().toISOString(),
      source,
      message,
      ...data
    });
    
    // Keep only the last 20 errors
    if (this.errors.length > 20) {
      this.errors.shift();
    }
  },
  
  // Update the operating mode based on component states
  updateOperatingMode() {
    if (this.databaseActive && this.pubsubActive && this.subscriptionActive) {
      this.operatingMode = 'full';
      this.ready = true;
      logger.info('Service operating in FULL mode - all services connected');
    } else if (this.databaseActive || (this.pubsubActive && this.subscriptionActive)) {
      this.operatingMode = 'limited';
      this.ready = true;
      logger.warn('Service operating in LIMITED mode', {
        database_connected: this.databaseActive,
        pubsub_connected: this.pubsubActive,
        subscription_active: this.subscriptionActive
      });
    } else {
      this.operatingMode = 'minimal';
      this.ready = true; // Still ready for health checks
      logger.error('Service operating in MINIMAL mode - only health endpoint available');
    }
  },
  
  // Get complete status for health checks
  getHealthStatus() {
    return {
      status: this.ready ? 'OK' : 'INITIALIZING',
      service: 'notification-worker',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      memory: this.getMemoryUsage(),
      database: {
        connected: this.databaseActive,
        connectionState
      },
      pubsub: {
        connected: this.pubsubActive,
        subscription_active: this.subscriptionActive,
        pubsubState
      }
    };
  },
  
  // Get detailed status for diagnostics
  getDiagnosticStatus() {
    return {
      service: 'notification-worker',
      status: this.ready ? 'running' : 'initializing',
      uptime: process.uptime(),
      started_at: this.startTime,
      mode: this.operatingMode,
      environment: process.env.NODE_ENV || 'development',
      version: process.env.npm_package_version || 'unknown',
      health: {
        database: this.databaseActive ? 'connected' : 'disconnected',
        pubsub: this.pubsubActive ? 'connected' : 'disconnected',
        subscription: this.subscriptionActive ? 'active' : 'inactive'
      },
      metrics: {
        messages_processed: processorMetrics.messageCount,
        successful_messages: processorMetrics.successfulMessages,
        validation_errors: processorMetrics.validationErrors,
        processing_errors: processorMetrics.processingErrors,
        db_unavailable_errors: processorMetrics.dbUnavailableErrors,
        memory_usage: this.getMemoryUsage().rss
      },
      timestamp: new Date().toISOString()
    };
  },
  
  // Get memory usage in a formatted way
  getMemoryUsage() {
    const memoryUsage = process.memoryUsage();
    return {
      rss: Math.round(memoryUsage.rss / 1024 / 1024),
      heapTotal: Math.round(memoryUsage.heapTotal / 1024 / 1024),
      heapUsed: Math.round(memoryUsage.heapUsed / 1024 / 1024)
    };
  }
};