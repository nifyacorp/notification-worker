/**
 * @file API route handlers
 * HTTP route handlers for the notification worker API
 */

import http from 'http';
import { URL } from 'url';
import { Logger } from '../shared/logger/logger';
import { ServiceStatus } from '../application/services/service-status';
import { NotificationRepository } from '../domain/repositories/notification-repository';
import { NotificationService } from '../domain/services/notification-service';
import { ProcessorRegistry } from '../domain/services/processor-registry';
import { DatabaseConnection } from '../infrastructure/database/connection';
import { AppError } from '../shared/errors/app-error';
import { config } from '../shared/config/config';

/**
 * Dependencies for route handlers
 */
interface RouteDependencies {
  serviceStatus: ServiceStatus;
  notificationRepository: NotificationRepository;
  notificationService: NotificationService;
  processorRegistry: ProcessorRegistry;
  dbConnection: DatabaseConnection;
  logger: Logger;
}

/**
 * Route handler type
 */
type RouteHandler = (
  req: http.IncomingMessage,
  res: http.ServerResponse,
  dependencies: RouteDependencies
) => Promise<void>;

/**
 * Route definition
 */
interface Route {
  method: string;
  pattern: RegExp;
  handler: RouteHandler;
}

/**
 * Set up routes with dependencies
 * @param dependencies - Route dependencies
 * @returns Route handler function
 */
export function setRoutes(dependencies: RouteDependencies): (req: http.IncomingMessage, res: http.ServerResponse) => void {
  const { logger } = dependencies;
  
  // Define routes
  const routes: Route[] = [
    {
      method: 'GET',
      pattern: /^\/$/,
      handler: homeHandler
    },
    {
      method: 'GET',
      pattern: /^\/health$/,
      handler: healthHandler
    },
    {
      method: 'GET',
      pattern: /^\/ready$/,
      handler: readinessHandler
    },
    {
      method: 'GET',
      pattern: /^\/status$/,
      handler: statusHandler
    },
    {
      method: 'GET',
      pattern: /^\/diagnostics$/,
      handler: diagnosticsHandler
    }
  ];
  
  // Return route handler function
  return (req: http.IncomingMessage, res: http.ServerResponse) => {
    handleRequest(req, res, routes, dependencies);
  };
}

/**
 * Handle an HTTP request
 * @param req - HTTP request
 * @param res - HTTP response
 * @param routes - Available routes
 * @param dependencies - Route dependencies
 */
async function handleRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  routes: Route[],
  dependencies: RouteDependencies
): Promise<void> {
  const { logger } = dependencies;
  
  try {
    // Parse URL
    const parsedUrl = new URL(req.url || '/', `http://${req.headers.host}`);
    const path = parsedUrl.pathname;
    const method = req.method || 'GET';
    
    // Find matching route
    const route = routes.find(r => r.method === method && r.pattern.test(path));
    
    if (route) {
      logger.debug(`Handling request: ${method} ${path}`);
      
      try {
        await route.handler(req, res, dependencies);
      } catch (error) {
        handleError(error as Error, req, res, logger);
      }
    } else {
      // No matching route found
      res.statusCode = 404;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({
        status: 'error',
        message: 'Not Found'
      }));
    }
  } catch (error) {
    handleError(error as Error, req, res, logger);
  }
}

/**
 * Handle an error
 * @param error - The error
 * @param req - HTTP request
 * @param res - HTTP response
 * @param logger - Logger instance
 */
function handleError(error: Error, req: http.IncomingMessage, res: http.ServerResponse, logger: Logger): void {
  // Log error
  logger.error(`Error handling request: ${req.method} ${req.url}`, {
    error: error.message,
    stack: error.stack
  });
  
  // Set status code
  res.statusCode = error instanceof AppError ? error.statusCode : 500;
  
  // Set response headers
  res.setHeader('Content-Type', 'application/json');
  
  // Send error response
  res.end(JSON.stringify({
    status: 'error',
    message: error.message,
    code: error instanceof AppError ? error.code : 'INTERNAL_SERVER_ERROR'
  }));
}

/**
 * Home route handler
 */
async function homeHandler(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  dependencies: RouteDependencies
): Promise<void> {
  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({
    name: 'notification-worker',
    version: process.env.VERSION || '1.0.0',
    environment: config.environment
  }));
}

/**
 * Health check route handler
 */
async function healthHandler(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  dependencies: RouteDependencies
): Promise<void> {
  const { serviceStatus } = dependencies;
  
  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({
    status: 'ok'
  }));
}

/**
 * Readiness check route handler
 */
async function readinessHandler(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  dependencies: RouteDependencies
): Promise<void> {
  const { serviceStatus } = dependencies;
  
  const isReady = serviceStatus.isHealthy();
  
  res.statusCode = isReady ? 200 : 503;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({
    status: isReady ? 'ready' : 'not ready',
    mode: serviceStatus.getOperatingMode()
  }));
}

/**
 * Service status route handler
 */
async function statusHandler(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  dependencies: RouteDependencies
): Promise<void> {
  const { serviceStatus } = dependencies;
  
  const status = serviceStatus.getStatusReport();
  
  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({
    status: 'success',
    data: status
  }));
}

/**
 * Diagnostics route handler
 */
async function diagnosticsHandler(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  dependencies: RouteDependencies
): Promise<void> {
  const { serviceStatus, dbConnection, processorRegistry } = dependencies;
  
  const status = serviceStatus.getStatusReport();
  
  // Get database connection state
  const dbState = dbConnection.getConnectionState();
  
  // Get processor information
  const processors = processorRegistry.getAllProcessors().map(processor => ({
    type: processor.processorType,
    requiresDatabase: processor.requiresDatabase
  }));
  
  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({
    status: 'success',
    data: {
      service: status,
      database: {
        connected: dbState.isConnected,
        poolStats: dbState.poolStats,
        lastInitTime: dbState.lastInitTime,
        initCount: dbState.initCount,
        lastErrorTime: dbState.lastErrorTime,
        lastSuccessTime: dbState.lastSuccessTime
      },
      processors,
      environment: config.environment,
      version: process.env.VERSION || '1.0.0',
      nodeVersion: process.version,
      memoryUsage: process.memoryUsage(),
      uptime: process.uptime()
    }
  }));
}