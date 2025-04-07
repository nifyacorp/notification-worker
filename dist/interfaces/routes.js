/**
 * @file API route handlers
 * HTTP route handlers for the notification worker API
 */
import { URL } from 'url';
import { AppError } from '../shared/errors/app-error';
import { config } from '../shared/config/config';
/**
 * Set up routes with dependencies
 * @param dependencies - Route dependencies
 * @returns Route handler function
 */
export function setRoutes(dependencies) {
    const { logger } = dependencies;
    // Define routes
    const routes = [
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
    return (req, res) => {
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
async function handleRequest(req, res, routes, dependencies) {
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
            }
            catch (error) {
                handleError(error, req, res, logger);
            }
        }
        else {
            // No matching route found
            res.statusCode = 404;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({
                status: 'error',
                message: 'Not Found'
            }));
        }
    }
    catch (error) {
        handleError(error, req, res, logger);
    }
}
/**
 * Handle an error
 * @param error - The error
 * @param req - HTTP request
 * @param res - HTTP response
 * @param logger - Logger instance
 */
function handleError(error, req, res, logger) {
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
async function homeHandler(req, res, dependencies) {
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
async function healthHandler(req, res, dependencies) {
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
async function readinessHandler(req, res, dependencies) {
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
async function statusHandler(req, res, dependencies) {
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
async function diagnosticsHandler(req, res, dependencies) {
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
//# sourceMappingURL=routes.js.map