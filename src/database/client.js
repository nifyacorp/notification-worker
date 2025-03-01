import { SecretManagerServiceClient } from '@google-cloud/secret-manager';
import pkg from 'pg';
import { logger } from '../utils/logger.js'; 

const { Pool } = pkg;

const INSTANCE_CONNECTION_NAME = process.env.GOOGLE_CLOUD_PROJECT 
  ? `${process.env.GOOGLE_CLOUD_PROJECT}:us-central1:nifya-db`
  : 'delta-entity-447812-p2:us-central1:nifya-db';

// For tracking connection attempts and history
const connectionState = {
  lastInitTime: null,
  initCount: 0,
  lastErrorMessage: null,
  isInitializing: false,
  isConnected: false,
  lastSuccessTime: null,
  lastErrorTime: null
};

const secretManagerClient = new SecretManagerServiceClient();

async function getSecret(secretName) {
  try {
    const name = `projects/${process.env.GOOGLE_CLOUD_PROJECT}/secrets/${secretName}/versions/latest`;
    const [version] = await secretManagerClient.accessSecretVersion({ name });
    return version.payload.data.toString();
  } catch (error) {
    logger.error('Failed to retrieve secret', {
      secretName,
      error: error.message,
      code: error.code
    });
    throw error;
  }
}

async function createPoolConfig() {
  try {
    // For local development, check if we can use environment variables
    if (process.env.NODE_ENV !== 'production' && 
        process.env.DB_USER && 
        process.env.DB_PASSWORD && 
        process.env.DB_NAME) {
      
      logger.info('Using database credentials from environment variables');
      
      const config = {
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME,
        host: process.env.DB_HOST || 'localhost',
        port: process.env.DB_PORT || 5432,
        max: 5,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 5000
      };
      
      return config;
    }
    
    // Otherwise retrieve from Secret Manager
    const [dbName, dbUser, dbPassword] = await Promise.all([
      getSecret('DB_NAME'),
      getSecret('DB_USER'),
      getSecret('DB_PASSWORD')
    ]);

    // Simplified configuration based on backend approach
    const config = process.env.NODE_ENV === 'production' 
      ? {
        user: dbUser,
        password: dbPassword,
        database: dbName,
        host: `/cloudsql/${INSTANCE_CONNECTION_NAME}`,
        max: 10,
        min: 1, // Always keep at least one connection
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 15000, // Increased from 10000
        application_name: 'notification-worker',
        keepalive: true
      } 
      : {
        user: dbUser,
        password: dbPassword,
        database: dbName,
        host: 'localhost',
        port: 5432,
        max: 5,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 5000
      };

    logger.info('Database connection configuration', {
      host: config.host,
      database: config.database,
      user: config.user,
      max: config.max,
      environment: process.env.NODE_ENV
    });

    return config;
  } catch (error) {
    logger.error('Failed to create pool configuration', {
      error: error.message,
      code: error.code,
      stack: error.stack
    });
    throw error;
  }
}

async function testConnection(pool, retryCount = 0) {
  try {
    logger.info('Testing database connection', { 
      retry_count: retryCount,
      pool_exists: !!pool,
      pool_stats: pool ? {
        totalCount: pool.totalCount,
        idleCount: pool.idleCount,
        waitingCount: pool.waitingCount
      } : null,
      connection_state: connectionState
    });
    
    // Set timeout for the whole test operation
    const timeout = setTimeout(() => {
      logger.error('Database connection test timeout reached', {
        retry_count: retryCount,
        timeout_ms: 10000, // Increased from 8000
        connection_state: connectionState
      });
      throw new Error('Database connection test timeout');
    }, 10000); // Increased timeout

    try {
      // Get a client from the pool with explicit timeout - simplified approach
      logger.debug('Attempting to acquire client from pool');
      const client = await pool.connect();
      
      // Execute a simple query
      logger.debug('Executing simple test query');
      const result = await client.query('SELECT 1 as connection_test');
      
      // Simple validation
      if (result.rows[0].connection_test === 1) {
        logger.info('Database connection successful', {
          pool_stats: {
            totalCount: pool.totalCount,
            idleCount: pool.idleCount,
            waitingCount: pool.waitingCount
          }
        });
      }
      
      // Release client
      client.release();
      clearTimeout(timeout);
      
      // Update connection state
      connectionState.isConnected = true;
      connectionState.lastErrorMessage = null;
      connectionState.lastSuccessTime = new Date().toISOString();
      
      return true;
    } catch (error) {
      clearTimeout(timeout);
      throw error;
    }
  } catch (error) {
    // Update connection state with error
    connectionState.isConnected = false;
    connectionState.lastErrorMessage = error.message;
    connectionState.lastErrorTime = new Date().toISOString();
    
    logger.error('Database connection failed', {
      error: error.message,
      code: error.code,
      stack: error.stack,
      retry_count: retryCount,
      connection_state: connectionState
    });
    
    // Retry with exponential backoff
    if (retryCount < 3) { // Increased max retries
      const delay = Math.pow(2, retryCount) * 1000; // 1s, 2s, 4s
      logger.info(`Retrying database connection in ${delay}ms`, { retry_count: retryCount + 1 });
      await new Promise(resolve => setTimeout(resolve, delay));
      return testConnection(pool, retryCount + 1);
    }
    
    throw error;
  }
}

let pool;

export const db = {
  // Enhanced query method with retries for connection issues
  query: async (text, params, queryOptions = {}) => {
    const maxRetries = queryOptions.maxRetries || 2; // Increased from 1
    const retryDelay = queryOptions.retryDelay || 1000;
    let attempts = 0;
    
    while (attempts <= maxRetries) {
      // Define start here so it's accessible in both try and catch blocks
      // This fixes the "start is not defined" ReferenceError in error handling
      const start = Date.now();
      
      try {
        if (!pool || !connectionState.isConnected) {
          pool = await initializePool();
        }
        
        // Directly get a client for better control
        const client = await pool.connect();
        
        try {
          // Execute query
          const result = await client.query(text, params);
          const duration = Date.now() - start;
          
          logger.debug('Query executed successfully', {
            text: text.substring(0, 100) + (text.length > 100 ? '...' : ''),
            duration,
            rows: result.rowCount,
            command: result.command,
            attempt: attempts + 1
          });
          
          return result;
        } finally {
          // Always release client back to pool
          client.release();
        }
      } catch (error) {
        attempts++;
        const isConnectionError = 
          error.code === 'ECONNREFUSED' || 
          error.code === '57P01' || // admin_shutdown
          error.code === '57P03' || // cannot_connect_now
          error.message.includes('timeout') ||
          error.message.includes('Connection terminated');
          
        logger.error('Query failed', {
          error: error.message,
          error_code: error.code,
          stack: error.stack?.substring(0, 500) || 'No stack trace',
          severity: error.severity,
          detail: error.detail,
          text: text.substring(0, 100) + (text.length > 100 ? '...' : ''),
          duration: Date.now() - start,
          attempt: attempts,
          max_retries: maxRetries,
          is_connection_error: isConnectionError
        });
        
        if (isConnectionError && attempts <= maxRetries) {
          // For connection errors, try to reinitialize the pool
          try {
            await new Promise(resolve => setTimeout(resolve, retryDelay * attempts)); // Progressive backoff
            logger.info('Reinitializing pool after connection error', { attempt: attempts });
            connectionState.isConnected = false;
            pool = await initializePool();
          } catch (initError) {
            logger.error('Failed to reinitialize pool during query retry', {
              error: initError.message
            });
          }
        } else if (attempts <= maxRetries) {
          // For non-connection errors, wait before retry
          await new Promise(resolve => setTimeout(resolve, retryDelay * attempts));
          logger.info('Retrying query after error', { attempt: attempts });
        } else {
          throw error;
        }
      }
    }
  },
  
  testConnection: async () => {
    // If already initializing, wait for that to complete instead of starting another init
    if (connectionState.isInitializing) {
      logger.info('Pool initialization already in progress, waiting');
      
      // Wait for existing initialization to complete (max 15 seconds)
      for (let i = 0; i < 15; i++) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        if (!connectionState.isInitializing) {
          logger.info('Existing pool initialization completed');
          return connectionState.isConnected;
        }
      }
      
      // If we get here, initialization is taking too long
      throw new Error('Existing database initialization is taking too long');
    }
    
    if (!pool) {
      pool = await initializePool();
    } else {
      await testConnection(pool);
    }
    return connectionState.isConnected;
  },
  
  getConnectionState: () => {
    return {
      ...connectionState,
      poolExists: !!pool,
      poolStats: pool ? {
        totalCount: pool.totalCount,
        idleCount: pool.idleCount,
        waitingCount: pool.waitingCount
      } : null
    };
  },
  
  end: async () => {
    if (pool) {
      logger.info('Closing database connection pool');
      await pool.end();
      logger.info('Database connection pool closed');
      pool = null;
      connectionState.isConnected = false;
    }
  }
};

export async function initializePool() {
  // Set the initialization flag to prevent parallel attempts
  connectionState.isInitializing = true;
  connectionState.initCount++;
  connectionState.lastInitTime = new Date().toISOString();
  
  try {
    logger.info('Initializing database pool', {
      init_count: connectionState.initCount,
      existing_pool: !!pool,
      connection_state: connectionState
    });
    
    const config = await createPoolConfig();
    
    // If there's an existing pool, end it properly before creating a new one
    if (pool) {
      try {
        logger.info('Ending existing pool before creating a new one', {
          pool_stats: {
            totalCount: pool.totalCount,
            idleCount: pool.idleCount,
            waitingCount: pool.waitingCount
          }
        });
        await pool.end();
      } catch (endError) {
        logger.warn('Error ending existing pool', { 
          error: endError.message,
          stack: endError.stack 
        });
        // Continue anyway to create a new pool
      }
    }
    
    // Create new pool
    logger.info('Creating new database pool with config', {
      host: config.host.includes('cloudsql') ? 'cloudsql' : config.host,
      max_connections: config.max,
      min_connections: config.min,
      idle_timeout: config.idleTimeoutMillis,
      connection_timeout: config.connectionTimeoutMillis
    });
    
    pool = new Pool(config);
    
    // Add more robust error handling
    pool.on('error', (error) => {
      logger.error('Unexpected database pool error', {
        error: error.message,
        code: error.code,
        detail: error.detail,
        connection_state: connectionState
      });
      connectionState.isConnected = false;
      connectionState.lastErrorMessage = error.message;
      connectionState.lastErrorTime = new Date().toISOString();
      
      // If totally disconnected, try to reconnect
      if (pool.totalCount === 0) {
        logger.warn('No connections in pool, attempting to reinitialize');
        setTimeout(() => {
          try {
            initializePool().catch(err => {
              logger.error('Failed auto-reconnect after pool error', {
                error: err.message
              });
            });
          } catch (err) {
            logger.error('Error during auto-reconnect attempt', {
              error: err.message
            });
          }
        }, 5000);
      }
    });
    
    pool.on('connect', (client) => {
      logger.debug('New database connection established');
    });
    
    pool.on('remove', (client) => {
      logger.debug('Database connection removed from pool');
    });

    // Test the new pool
    logger.info('Testing new database pool');
    await testConnection(pool);
    
    return pool;
  } catch (error) {
    logger.error('Failed to initialize pool', {
      error: error.message,
      code: error.code,
      stack: error.stack,
      init_count: connectionState.initCount,
      connection_state: connectionState
    });
    throw error;
  } finally {
    // Always clear the initialization flag
    connectionState.isInitializing = false;
  }
}