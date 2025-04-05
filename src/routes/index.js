import { handleHealthCheck, handleDebugStatus } from './health.js';
import { 
  handleDatabaseDiagnostics,
  handleCreateNotification,
  handleDebugNotifications
} from './diagnostics.js';
import { logger } from '../utils/logger.js';
import url from 'url';

/**
 * CORS middleware to handle preflight requests
 * @param {Object} req - HTTP request
 * @param {Object} res - HTTP response
 * @returns {boolean} - Whether the request was handled
 */
function handleCors(req, res) {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, DELETE');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-User-Id, X-Requested-With, Accept');
  res.setHeader('Access-Control-Max-Age', '86400'); // 24 hours
  
  // Handle preflight requests
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return true;
  }
  
  return false;
}

/**
 * Routes HTTP requests to the appropriate handler
 * @param {Object} req - HTTP request
 * @param {Object} res - HTTP response
 */
export function routeRequest(req, res) {
  // Handle CORS preflight requests
  if (handleCors(req, res)) {
    return;
  }
  
  // Parse the URL to get the path
  const parsedUrl = url.parse(req.url, true);
  const path = parsedUrl.pathname;
  
  // Add debug logging to help diagnose routing issues
  logger.debug('Received HTTP request', {
    method: req.method,
    path: path,
    url: req.url
  });
  
  // Route to the appropriate handler
  if (path === '/health') {
    handleHealthCheck(req, res);
  } 
  else if (path === '/diagnostics/database') {
    handleDatabaseDiagnostics(req, res);
  } 
  else if (path === '/diagnostics/create-notification' && req.method === 'POST') {
    handleCreateNotification(req, res);
  } 
  else if ((path === '/debug' || path === '/debug/status') && req.method === 'GET') {
    handleDebugStatus(req, res);
  } 
  else if (path === '/debug/notifications' && req.method === 'GET') {
    handleDebugNotifications(req, res);
  } 
  else {
    // Default response for unknown routes
    logger.info('Route not found', { path: path, method: req.method });
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      error: 'Not Found',
      message: `Route ${path} not found`
    }));
  }
}