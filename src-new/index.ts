import { ConfigService } from './infrastructure/config/Config.js';
import { Logger } from './infrastructure/logging/Logger.js';
import { PostgresClient } from './infrastructure/database/PostgresClient.js';
import { PubSubService } from './infrastructure/messaging/PubSubService.js';
import { PostgresNotificationRepository } from './infrastructure/repositories/PostgresNotificationRepository.js';
import { PostgresUserRepository } from './infrastructure/repositories/PostgresUserRepository.js';
import { PostgresSubscriptionRepository } from './infrastructure/repositories/PostgresSubscriptionRepository.js';
import { NotificationService } from './application/services/NotificationService.js';
import { MessageHandlerService } from './application/services/MessageHandlerService.js';
import { ProcessSubscriptionResultUseCase } from './application/useCases/ProcessSubscriptionResultUseCase.js';
import { ProcessorRegistry } from './interfaces/processors/ProcessorRegistry.js';
import { BOEProcessor } from './interfaces/processors/BOEProcessor.js';
import { HttpServer } from './interfaces/http/Server.js';
import { Message } from '@google-cloud/pubsub';
import { AppError, ErrorCode } from './domain/errors/AppError.js';

/**
 * Main application class
 */
class Application {
  private configService: ConfigService;
  private logger: Logger;
  private db: PostgresClient;
  private pubsub: PubSubService;
  private notificationRepository: PostgresNotificationRepository;
  private userRepository: PostgresUserRepository;
  private subscriptionRepository: PostgresSubscriptionRepository;
  private notificationService: NotificationService;
  private processorRegistry: ProcessorRegistry;
  private messageHandler: MessageHandlerService;
  private httpServer: HttpServer;

  /**
   * Creates a new application instance
   */
  constructor() {
    // Initialize configuration
    this.configService = new ConfigService();
    const config = this.configService.getConfig();

    // Initialize logger
    this.logger = new Logger(config);
    
    // Log startup information
    this.logger.info('Starting notification worker service', {
      environment: config.environment,
      serviceName: config.serviceName
    });
    
    // Initialize database
    this.db = new PostgresClient(config);
    
    // Initialize PubSub
    this.pubsub = new PubSubService(config, this.logger);
    
    // Initialize repositories
    this.notificationRepository = new PostgresNotificationRepository(this.db, this.logger, config);
    this.userRepository = new PostgresUserRepository(this.db, this.logger);
    this.subscriptionRepository = new PostgresSubscriptionRepository(this.db, this.logger);
    
    // Initialize services
    this.notificationService = new NotificationService(
      this.notificationRepository,
      this.userRepository,
      this.subscriptionRepository,
      this.pubsub,
      this.logger
    );
    
    // Initialize processor registry
    this.processorRegistry = new ProcessorRegistry();
    
    // Register processors
    const boeProcessor = new BOEProcessor(this.notificationService, this.logger);
    this.processorRegistry.registerProcessor(boeProcessor);
    
    // Initialize use case
    const processUseCase = new ProcessSubscriptionResultUseCase(
      this.processorRegistry.getAllProcessors(),
      this.notificationService
    );
    
    // Initialize message handler
    this.messageHandler = new MessageHandlerService(
      processUseCase,
      this.pubsub,
      this.logger
    );
    
    // Initialize HTTP server
    this.httpServer = new HttpServer(
      config,
      this.logger,
      this.db,
      this.pubsub,
      this.messageHandler,
      this.processorRegistry
    );
  }

  /**
   * Starts the application
   */
  async start(): Promise<void> {
    try {
      // Start HTTP server first for health checks
      this.httpServer.start();
      
      // Test database connection
      this.logger.info('Testing database connection');
      try {
        await this.db.testConnection();
        this.logger.info('Database connection successful');
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        this.logger.error('Database connection failed', {
          error: err.message
        });
        
        this.httpServer.addError('database', err.message);
        
        // Retry database connection after delay
        this.logger.info('Retrying database connection after delay');
        setTimeout(async () => {
          try {
            await this.db.testConnection();
            this.logger.info('Database retry connection successful');
          } catch (retryError) {
            const rErr = retryError instanceof Error ? retryError : new Error(String(retryError));
            this.logger.error('Database retry connection failed', {
              error: rErr.message
            });
          }
        }, 5000);
      }
      
      // Initialize PubSub
      try {
        this.logger.info('Initializing PubSub');
        await this.pubsub.initialize();
        
        this.httpServer.updatePubSubStatus(true, false);
        
        // Set up message handler
        this.pubsub.setupSubscriptionHandler(
          (message: Message) => this.messageHandler.handleMessage(message),
          (error: Error) => this.handlePubSubError(error)
        );
        
        this.httpServer.updatePubSubStatus(true, true);
        this.logger.info('PubSub subscription listeners set up successfully');
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        this.logger.error('Failed to initialize PubSub', {
          error: err.message
        });
        
        this.httpServer.addError('pubsub', err.message);
        this.httpServer.updatePubSubStatus(false, false);
      }
      
      this.logger.info('Notification worker service started', {
        environment: this.configService.getConfig().environment,
        processors: this.processorRegistry.getProcessorTypes()
      });
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.logger.error('Failed to start application', {
        error: err.message,
        stack: err.stack
      });
      
      this.httpServer.addError('startup', err.message);
    }
  }

  /**
   * Handles PubSub subscription errors
   * @param error The error that occurred
   */
  private handlePubSubError(error: Error): void {
    this.logger.error('PubSub subscription error', {
      error: error.message,
      stack: error.stack
    });
    
    this.httpServer.addError('pubsub', error.message);
    this.httpServer.updatePubSubStatus(true, false);
    
    // Try to recover by reinitializing after a delay
    setTimeout(async () => {
      try {
        await this.pubsub.initialize();
        
        this.pubsub.setupSubscriptionHandler(
          (message: Message) => this.messageHandler.handleMessage(message),
          (error: Error) => this.handlePubSubError(error)
        );
        
        this.httpServer.updatePubSubStatus(true, true);
        this.logger.info('Successfully recovered from PubSub subscription error');
      } catch (recoveryError) {
        const err = recoveryError instanceof Error ? recoveryError : new Error(String(recoveryError));
        this.logger.error('Failed to recover from PubSub subscription error', {
          error: err.message
        });
      }
    }, 30000);
  }

  /**
   * Stops the application
   */
  async stop(): Promise<void> {
    this.logger.info('Stopping notification worker service');
    
    // Close PubSub
    try {
      await this.pubsub.close();
    } catch (error) {
      this.logger.error('Error closing PubSub', {
        error: error instanceof Error ? error.message : String(error)
      });
    }
    
    // Close database
    try {
      await this.db.end();
    } catch (error) {
      this.logger.error('Error closing database', {
        error: error instanceof Error ? error.message : String(error)
      });
    }
    
    this.logger.info('Notification worker service stopped');
  }
}

// Create and start the application
const app = new Application();

// Set up graceful shutdown
process.on('SIGTERM', async () => {
  console.log('Received SIGTERM signal, shutting down gracefully');
  await app.stop();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('Received SIGINT signal, shutting down gracefully');
  await app.stop();
  process.exit(0);
});

// Start the application
app.start().catch(error => {
  console.error('Failed to start application:', error);
  process.exit(1);
});