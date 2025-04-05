import { serviceStatus } from '../services/status.js';
import { logger } from '../utils/logger.js';

/**
 * Handler for the /health endpoint
 * @param {Object} req - HTTP request object
 * @param {Object} res - HTTP response object
 */
export function handleHealthCheck(req, res) {
  const healthStatus = serviceStatus.getHealthStatus();
  
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(healthStatus));
}

/**
 * Handler for the /debug/status endpoint
 * @param {Object} req - HTTP request object
 * @param {Object} res - HTTP response object
 */
export function handleDebugStatus(req, res) {
  try {
    const status = serviceStatus.getDiagnosticStatus();
    
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(status, null, 2));
  } catch (error) {
    logger.error('Debug status error:', {
      error: error.message,
      stack: error.stack
    });
    
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      error: 'Failed to fetch worker status',
      message: error.message
    }));
  }
}