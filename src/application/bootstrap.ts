/**
 * @file Application bootstrap
 * Initializes the application and sets up dependency injection
 */

import http from 'http';
import { logger } from '../shared/logger/logger';
import { config, logConfig } from '../shared/config/config';
import { DatabaseConnection } from '../infrastructure/database/connection';
import { GooglePubSubService } from '../infrastructure/messaging/pubsub-service-impl';
import { PostgresNotificationRepository } from '../infrastructure/repositories/notification-repository-impl';
import { DefaultProcessorRegistry } from './services/processor-registry-impl';
import { DefaultNotificationService } from './services/notification-service-impl';
import { BOEProcessor } from '../infrastructure/processors/boe-processor';
import { RealEstateProcessor } from '../infrastructure/processors/real-estate-processor';
import { ProcessorMessage } from '../domain/models/message';
import { PubSubService } from '../domain/services/pubsub-service';
import { NotificationRepository } from '../domain/repositories/notification-repository';
import { ProcessorRegistry } from '../domain/services/processor-registry';
import { NotificationService } from '../domain/services/notification-service';
import { setRoutes } from '../interfaces/routes';
import { ServiceStatus } from './services/service-status';

/**
 * Application container
 * Provides dependency injection container for the application
 */
export class Application {
  private server: http.Server;
  private dbConnection: DatabaseConnection;
  private pubSubService: PubSubService;
  private notificationRepository: NotificationRepository;
  private processorRegistry: ProcessorRegistry;
  private notificationService: NotificationService;
  private serviceStatus: ServiceStatus;
  
  // For testing purposes
  public mockDatabaseConnection = false;
  
  constructor() {
    // Log configuration
    logConfig();
    
    // Create HTTP server
    this.server = http.createServer((req, res) => {
      this.handleRequest(req, res);
    });
    
    // Initialize dependencies
    this.dbConnection = new DatabaseConnection(logger);
    this.pubSubService = new GooglePubSubService(logger);
    this.notificationRepository = new PostgresNotificationRepository(this.dbConnection, logger);
    this.processorRegistry = new DefaultProcessorRegistry(logger);
    this.notificationService = new DefaultNotificationService(
      this.notificationRepository,
      this.processorRegistry,
      this.dbConnection,
      this.pubSubService,
      logger
    );
    this.serviceStatus = new ServiceStatus();
    
    // Register signal handlers
    this.registerSignalHandlers();
  }
  
  /**
   * Initialize the application
   * @returns Promise resolving when initialization is complete
   */
  public async initialize(): Promise<void> {
    try {
      logger.info('Initializing notification worker application', {
        environment: config.environment,
        pubsub_project: config.projectId,
        pubsub_subscription: config.pubsub.subscription
      });
      
      // Initialize database connection
      logger.info('Testing database connection');
      try {
        if (this.mockDatabaseConnection) {
          logger.info('Using mock database connection');
          this.serviceStatus.setDatabaseActive(true);
        } else {
          await this.dbConnection.testConnection();
          logger.info('Database connection successful');
          this.serviceStatus.setDatabaseActive(true);
        }
      } catch (error) {
        logger.error('Database connection failed', {
          error: (error as Error).message,
          stack: (error as Error).stack
        });
        this.serviceStatus.setDatabaseActive(false);
        this.serviceStatus.addError('database', (error as Error).message);
        
        // Retry database connection after a delay
        logger.info('Retrying database connection after 5 second delay');
        setTimeout(async () => {
          try {
            await this.dbConnection.testConnection();
            logger.info('Database retry connection successful');
            this.serviceStatus.setDatabaseActive(true);
            this.serviceStatus.updateOperatingMode();
          } catch (retryError) {
            logger.error('Database retry connection failed, continuing in limited mode', {
              error: (retryError as Error).message
            });
          }
        }, 5000);
      }
      
      // Initialize PubSub
      try {
        if (this.mockDatabaseConnection) {
          logger.info('Using mock PubSub service');
          this.serviceStatus.setPubSubActive(true);
          this.serviceStatus.setSubscriptionActive(true);
        } else {
          await this.pubSubService.initialize();
          logger.info('PubSub resources initialized successfully');
          this.serviceStatus.setPubSubActive(true);
          
          // Set up message processor subscription
          if (config.pubsub.subscription) {
            await this.setupMessageProcessing();
            logger.info('PubSub subscription listeners set up successfully');
            this.serviceStatus.setSubscriptionActive(true);
          }
        }
      } catch (error) {
        logger.error('Failed to initialize PubSub resources', {
          error: (error as Error).message,
          stack: (error as Error).stack
        });
        this.serviceStatus.setPubSubActive(false);
        this.serviceStatus.setSubscriptionActive(false);
        this.serviceStatus.addError('pubsub', (error as Error).message);
      }
      
      // Register processors
      this.registerProcessors();
      
      // Update overall service status
      this.serviceStatus.updateOperatingMode();
      
      logger.info('Notification worker application initialized', {
        mode: this.serviceStatus.getOperatingMode(),
        services_available: {
          database: this.serviceStatus.isDatabaseActive(),
          pubsub: this.serviceStatus.isPubSubActive(),
          subscription: this.serviceStatus.isSubscriptionActive()
        }
      });
    } catch (error) {
      logger.error('Failed to initialize application', {
        error: (error as Error).message,
        stack: (error as Error).stack
      });
      
      throw error;
    }
  }
  
  /**
   * Start the application
   * @returns Promise resolving when application is started
   */
  public async start(): Promise<void> {
    // Start HTTP server
    const port = config.port;
    
    return new Promise((resolve) => {
      this.server.listen(port, () => {
        logger.info(`HTTP server listening on port ${port}`);
        resolve();
      });
    });
  }
  
  /**
   * Registers processors with the registry
   */
  private registerProcessors(): void {
    // Register BOE processor
    const boeProcessor = new BOEProcessor(this.notificationRepository, logger);
    this.processorRegistry.register(boeProcessor);
    
    // Register Real Estate processor
    const realEstateProcessor = new RealEstateProcessor(this.notificationRepository, logger);
    this.processorRegistry.register(realEstateProcessor);
  }
  
  /**
   * Set up message processing subscription
   */
  private async setupMessageProcessing(): Promise<void> {
    try {
      if (!config.pubsub.subscription) {
        logger.warn('No PubSub subscription configured, skipping setup');
        return;
      }
      
      // Extract topic name from subscription name (assuming format: projects/{project}/subscriptions/{topic}-sub)
      const subscriptionParts = config.pubsub.subscription.split('-');
      const topicName = subscriptionParts.length > 1 ? subscriptionParts.slice(0, -1).join('-') : config.pubsub.subscription;
      
      // Subscribe to the main subscription
      await this.pubSubService.subscribe(
        topicName,
        config.pubsub.subscription,
        async (message: ProcessorMessage, messageId: string, publishTime: string) => {
          // Add message ID and publish time to message context if not present
          if (!message.trace_id) {
            message.trace_id = messageId;
          }
          
          logger.info('Received message', {
            message_id: messageId,
            publish_time: publishTime,
            processor_type: message.processor_type,
            trace_id: message.trace_id
          });
          
          try {
            // Process message
            await this.notificationService.processMessage(message);
          } catch (error) {
            logger.error('Error processing message', {
              error: (error as Error).message,
              message_id: messageId,
              trace_id: message.trace_id
            });
            
            // Publish to DLQ
            await this.pubSubService.publishToDLQ(message, error as Error);
          }
        },
        (error: Error) => {
          // Subscription error callback
          this.serviceStatus.setSubscriptionActive(false);
          this.serviceStatus.addError('pubsub', error.message);
          this.serviceStatus.updateOperatingMode();
          
          // Try to recover by reinitializing after a delay
          setTimeout(async () => {
            try {
              await this.pubSubService.initialize();
              await this.setupMessageProcessing();
              
              logger.info('Successfully recovered from PubSub subscription error');
              this.serviceStatus.setSubscriptionActive(true);
              this.serviceStatus.updateOperatingMode();
            } catch (recoveryError) {
              logger.error('Failed to recover from PubSub subscription error', {
                error: (recoveryError as Error).message
              });
            }
          }, 30000);
        }
      );
    } catch (error) {
      logger.error('Failed to set up message processing', {
        error: (error as Error).message
      });
      
      throw error;
    }
  }
  
  /**
   * Handle HTTP requests
   * @param req - HTTP request
   * @param res - HTTP response
   */
  private handleRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
    // Set up routes with dependencies
    const routeHandler = setRoutes({
      serviceStatus: this.serviceStatus,
      notificationRepository: this.notificationRepository,
      notificationService: this.notificationService,
      processorRegistry: this.processorRegistry,
      dbConnection: this.dbConnection,
      logger
    });
    
    // Handle request
    routeHandler(req, res);
  }
  
  /**
   * Register signal handlers for graceful shutdown
   */
  private registerSignalHandlers(): void {
    // Handle graceful shutdown
    process.on('SIGTERM', async () => {
      logger.info('Received SIGTERM signal, shutting down gracefully');
      await this.shutdown();
    });
    
    process.on('SIGINT', async () => {
      logger.info('Received SIGINT signal, shutting down gracefully');
      await this.shutdown();
    });
  }
  
  /**
   * Shutdown the application gracefully
   */
  private async shutdown(): Promise<void> {
    // Close HTTP server first (stop accepting new requests)
    await new Promise<void>((resolve) => {
      this.server.close(() => {
        logger.info('HTTP server closed');
        resolve();
      });
    });
    
    // Close PubSub connections
    try {
      await this.pubSubService.close();
      logger.info('PubSub connections closed');
    } catch (error) {
      logger.error('Error closing PubSub connections', {
        error: (error as Error).message
      });
    }
    
    // Close database connections
    try {
      await this.dbConnection.end();
      logger.info('Database connections closed');
    } catch (error) {
      logger.error('Error closing database connections', {
        error: (error as Error).message
      });
    }
    
    // Exit process
    process.exit(0);
  }
}

// Export singleton instance
export const app = new Application();