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
        connectionTimeoutMillis: 30000, // Increased timeout for cloud SQL connections
        application_name: 'notification-worker',
        keepalive: true,
        statement_timeout: 60000, // Add statement timeout
        query_timeout: 60000, // Add query timeout
        // Add connection error handler
        on_error: (err, client) => {
          logger.error('Unexpected database error on client', {
            error: err.message,
            code: err.code,
            severity: err.severity || 'unknown'
          });
        }
      } 
      : {
        user: dbUser,
        password: dbPassword,
        database: dbName,
        host: 'localhost',
        port: 5432,
        max: 5,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 10000, // Increased from 5000
        keepalive: true
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
  // Prevent multiple simultaneous initialization attempts
  if (connectionState.isInitializing) {
    logger.info('Pool initialization already in progress, waiting...');
    
    // Wait for current initialization to complete with timeout
    let waitTime = 0;
    const interval = 100;
    const maxWait = 10000;
    
    while (connectionState.isInitializing && waitTime < maxWait) {
      await new Promise(resolve => setTimeout(resolve, interval));
      waitTime += interval;
    }
    
    // If we waited and the connection is now ready, return the pool
    if (connectionState.isConnected && pool) {
      return pool;
    }
    
    // If we waited but initialization is still ongoing, throw an error
    if (connectionState.isInitializing) {
      throw new Error('Timed out waiting for ongoing pool initialization');
    }
  }
  
  // Mark as initializing
  connectionState.isInitializing = true;
  connectionState.lastInitTime = new Date().toISOString();
  connectionState.initCount++;
  
  try {
    logger.info('Initializing database pool', {
      attempt: connectionState.initCount,
      previous_error: connectionState.lastErrorMessage || 'none'
    });
    
    // Create pool config and initialize pool
    const config = await createPoolConfig();
    const newPool = new Pool(config);

    // Test the connection before returning
    const client = await Promise.race([
      newPool.connect(),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Connection timeout during pool initialization')), 15000)
      )
    ]);
    
    // Connection successful
    client.release();
    
    // Update connection state
    connectionState.isConnected = true;
    connectionState.isInitializing = false;
    connectionState.lastSuccessTime = new Date().toISOString();
    connectionState.lastErrorMessage = null;
    connectionState.lastErrorTime = null;
    
    logger.info('Database pool initialized successfully', {
      host: config.host.includes('/cloudsql') ? 'Cloud SQL' : config.host,
      database: config.database
    });
    
    // Add event listeners for pool errors
    newPool.on('error', (err) => {
      logger.error('Unexpected error on idle client', {
        error: err.message,
        code: err.code || 'unknown'
      });
      
      // Update connection state
      connectionState.isConnected = false;
      connectionState.lastErrorMessage = err.message;
      connectionState.lastErrorTime = new Date().toISOString();
    });
    
    // Monitor pool for connection issues
    newPool.on('connect', (client) => {
      logger.debug('New database connection established');
      connectionState.isConnected = true;
      connectionState.lastSuccessTime = new Date().toISOString();
    });
    
    return newPool;
  } catch (error) {
    // Update connection state on failure
    connectionState.isInitializing = false;
    connectionState.isConnected = false;
    connectionState.lastErrorMessage = error.message;
    connectionState.lastErrorTime = new Date().toISOString();
    
    logger.error('Failed to initialize database pool', {
      error: error.message,
      code: error.code || 'unknown',
      stack: error.stack
    });
    
    throw error;
  }
}

export async function query(text, params, retryOptions = {}) {
  // Get retry settings
  const maxRetries = retryOptions.maxRetries || 2;
  const retryDelay = retryOptions.retryDelay || 1000;
  const initialRetryDelay = retryOptions.initialRetryDelay || 500;
  let attempt = 0;
  let lastError = null;
  
  // Ensure pool exists
  if (!pool) {
    logger.info('Database pool not initialized yet, initializing now from query call');
    try {
      pool = await initializePool();
    } catch (error) {
      logger.error('Failed to initialize pool during query', {
        error: error.message,
        query: text.substring(0, 80) + (text.length > 80 ? '...' : ''),
        retry_attempt: attempt
      });
      throw new Error(`Database connection failed: ${error.message}`);
    }
  }

  // Retry loop
  while (attempt <= maxRetries) {
    const startTime = Date.now();
    let client = null;
    
    try {
      // If we're not connected, try to initialize
      if (!connectionState.isConnected) {
        logger.warn('Database not connected, attempting to reconnect before query', {
          retry_attempt: attempt,
          query: text.substring(0, 80) + (text.length > 80 ? '...' : '')
        });
        pool = await initializePool();
      }

      // Get a client from the pool with timeout
      client = await Promise.race([
        pool.connect(),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Timeout acquiring client from pool')), 10000)
        )
      ]);
      
      // Execute query with timeout
      const result = await Promise.race([
        client.query(text, params),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Query execution timeout')), 30000)
        )
      ]);
      
      const duration = Date.now() - startTime;
      
      // Log query success
      if (duration > 1000) {
        logger.info('Slow database query completed', {
          duration_ms: duration,
          query: text.substring(0, 80) + (text.length > 80 ? '...' : ''),
          rows: result.rowCount,
          retry_attempt: attempt
        });
      } else {
        logger.debug('Database query completed', {
          duration_ms: duration,
          query: text.substring(0, 80) + (text.length > 80 ? '...' : ''),
          rows: result.rowCount
        });
      }
      
      // Return successful result
      return result;
    } catch (error) {
      lastError = error;
      const duration = Date.now() - startTime;
      
      // Increment attempt counter for next try
      attempt++;
      
      // Categorize error
      const isConnectionError = 
        error.code === 'ECONNREFUSED' || 
        error.code === 'ETIMEDOUT' || 
        error.code === 'ENOTFOUND' ||
        error.code === '08003' || // Connection does not exist
        error.code === '08006' || // Connection failure
        error.code === '57P01' || // Admin shutdown
        error.code === '08001' || // Unable to establish connection
        error.code === '08004' || // Rejected connection
        error.message.includes('timeout') ||
        error.message.includes('Connection terminated');

      const isDeadlockError = 
        error.code === '40P01' || // Deadlock detected
        error.code === '55P03';   // Lock not available

      const isResourceError =
        error.code === '53300' || // Too many connections
        error.code === '53400';   // Configuration limit exceeded

      // Log the error with different levels based on retry status
      if (attempt <= maxRetries && (isConnectionError || isDeadlockError || isResourceError)) {
        // Log retryable errors as warnings
        logger.warn('Database query error, will retry', {
          error: error.message,
          code: error.code || 'unknown',
          severity: error.severity || 'unknown',
          query: text.substring(0, 80) + (text.length > 80 ? '...' : ''),
          duration_ms: duration,
          retry_attempt: attempt,
          max_retries: maxRetries,
          is_connection_error: isConnectionError,
          is_deadlock_error: isDeadlockError,
          is_resource_error: isResourceError
        });
        
        // Update connection state for connection errors
        if (isConnectionError) {
          connectionState.isConnected = false;
          connectionState.lastErrorMessage = error.message;
          connectionState.lastErrorTime = new Date().toISOString();
          
          // For connection errors, try to reinitialize the pool before retrying
          try {
            logger.info('Reinitializing database pool after connection error');
            pool = await initializePool();
          } catch (poolError) {
            logger.error('Failed to reinitialize pool during retry', {
              error: poolError.message,
              retry_attempt: attempt
            });
            // Continue with retry anyway
          }
        }
      } else {
        // Log terminal errors as errors
        logger.error('Database query failed', {
          error: error.message,
          code: error.code || 'unknown',
          severity: error.severity || 'unknown',
          query: text.substring(0, 80) + (text.length > 80 ? '...' : ''),
          duration_ms: duration,
          retry_attempt: attempt,
          max_retries: maxRetries
        });
      }
    } finally {
      // Always release the client back to the pool if we got one
      if (client) {
        client.release();
      }
    }
    
    // If we're not at max retries yet, wait before trying again
    // Use exponential backoff for retry delay
    if (attempt <= maxRetries) {
      const delay = initialRetryDelay + (attempt * retryDelay);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  
  // If we got here, we've exhausted our retries
  throw new Error(`Database query failed after ${maxRetries + 1} attempts: ${lastError.message}`);
}