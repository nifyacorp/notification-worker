import express from 'express';
import { Config } from '../../infrastructure/config/Config.js';
import { Logger } from '../../infrastructure/logging/Logger.js';
import { MessageHandlerService } from '../../application/services/MessageHandlerService.js';
import { PostgresClient } from '../../infrastructure/database/PostgresClient.js';
import { PubSubService } from '../../infrastructure/messaging/PubSubService.js';
import { ProcessorRegistry } from '../processors/ProcessorRegistry.js';

/**
 * Status data for the health endpoint
 */
export interface ServiceStatus {
  status: 'ok' | 'degraded' | 'failed';
  databaseActive: boolean;
  pubsubActive: boolean;
  subscriptionActive: boolean;
  uptime: number;
  startTime: Date;
  errors: Record<string, string[]>;
  metrics: {
    messagesProcessed: number;
    successRate: string;
    avgProcessingTimeMs: number;
    lastMessageAt: string | null;
  };
}

/**
 * HTTP server for health checks and diagnostics
 */
export class HttpServer {
  private app: express.Application;
  private status: ServiceStatus = {
    status: 'failed',
    databaseActive: false,
    pubsubActive: false,
    subscriptionActive: false,
    uptime: 0,
    startTime: new Date(),
    errors: {},
    metrics: {
      messagesProcessed: 0,
      successRate: '0%',
      avgProcessingTimeMs: 0,
      lastMessageAt: null
    }
  };

  /**
   * Creates a new HTTP server
   * @param config Application configuration
   * @param logger Logger service
   * @param database Database client
   * @param pubsubService PubSub service
   * @param messageHandler Message handler service
   * @param processorRegistry Processor registry
   */
  constructor(
    private readonly config: Config,
    private readonly logger: Logger,
    private readonly database: PostgresClient,
    private readonly pubsubService: PubSubService,
    private readonly messageHandler: MessageHandlerService,
    private readonly processorRegistry: ProcessorRegistry
  ) {
    this.app = express();
    this.setupRoutes();
  }

  /**
   * Sets up HTTP routes
   */
  private setupRoutes(): void {
    // Health check endpoint
    this.app.get('/health', (req, res) => {
      this.updateStatus();
      res.json(this.status);
    });

    // Readiness probe
    this.app.get('/ready', (req, res) => {
      this.updateStatus();
      if (this.status.status === 'ok' || this.status.status === 'degraded') {
        res.status(200).send('OK');
      } else {
        res.status(503).send('Not Ready');
      }
    });

    // Liveness probe
    this.app.get('/alive', (req, res) => {
      res.status(200).send('OK');
    });

    // Metrics endpoint
    this.app.get('/metrics', (req, res) => {
      const metrics = this.messageHandler.getMetrics();
      res.json(metrics);
    });

    // Diagnostics endpoint
    this.app.get('/api/diagnostics', (req, res) => {
      this.updateStatus();
      
      const diagnostics = {
        ...this.status,
        database: {
          ...this.database.getConnectionState(),
        },
        processors: {
          available: this.processorRegistry.getProcessorTypes(),
        },
        config: {
          environment: this.config.environment,
          serviceName: this.config.serviceName,
          subscriptionName: this.config.pubsub.subscriptionName,
          deduplicationWindowMinutes: this.config.deduplicationWindowMinutes,
        }
      };
      
      res.json(diagnostics);
    });

    // 404 handler
    this.app.use((req, res) => {
      res.status(404).json({ error: 'Not Found' });
    });

    // Error handler
    this.app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
      this.logger.error('HTTP error', {
        error: err.message,
        stack: err.stack,
        path: req.path
      });
      res.status(500).json({ error: 'Internal Server Error' });
    });
  }

  /**
   * Updates the service status
   */
  private updateStatus(): void {
    // Update uptime
    this.status.uptime = Math.floor((Date.now() - this.status.startTime.getTime()) / 1000);
    
    // Update database status
    const dbState = this.database.getConnectionState();
    this.status.databaseActive = dbState.isConnected;
    
    // Update metrics
    const metrics = this.messageHandler.getMetrics();
    this.status.metrics.messagesProcessed = metrics.messageCount;
    this.status.metrics.lastMessageAt = metrics.lastActivity.toISOString();
    this.status.metrics.avgProcessingTimeMs = Math.round(metrics.avgProcessingTimeMs);
    
    if (metrics.messageCount > 0) {
      const successRate = (metrics.successfulMessages / metrics.messageCount) * 100;
      this.status.metrics.successRate = `${Math.round(successRate)}%`;
    }
    
    // Update overall status
    if (this.status.databaseActive && this.status.pubsubActive && this.status.subscriptionActive) {
      this.status.status = 'ok';
    } else if (this.status.databaseActive || (this.status.pubsubActive && this.status.subscriptionActive)) {
      this.status.status = 'degraded';
    } else {
      this.status.status = 'failed';
    }
  }

  /**
   * Starts the HTTP server
   * @returns Express application
   */
  start(): express.Application {
    const port = this.config.server.port;
    this.app.listen(port, () => {
      this.logger.info(`HTTP server listening on port ${port}`);
    });
    return this.app;
  }

  /**
   * Updates the PubSub status
   * @param pubsubActive Whether PubSub is active
   * @param subscriptionActive Whether subscription is active
   */
  updatePubSubStatus(pubsubActive: boolean, subscriptionActive: boolean): void {
    this.status.pubsubActive = pubsubActive;
    this.status.subscriptionActive = subscriptionActive;
    
    // Update overall status
    if (this.status.databaseActive && this.status.pubsubActive && this.status.subscriptionActive) {
      this.status.status = 'ok';
    } else if (this.status.databaseActive || (this.status.pubsubActive && this.status.subscriptionActive)) {
      this.status.status = 'degraded';
    } else {
      this.status.status = 'failed';
    }
  }

  /**
   * Adds an error to the status
   * @param category Error category
   * @param message Error message
   */
  addError(category: string, message: string): void {
    if (!this.status.errors[category]) {
      this.status.errors[category] = [];
    }
    this.status.errors[category].push(message);
    
    // Limit to last 5 errors per category
    if (this.status.errors[category].length > 5) {
      this.status.errors[category] = this.status.errors[category].slice(-5);
    }
  }
}