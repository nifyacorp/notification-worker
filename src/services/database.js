import { SecretManagerServiceClient } from '@google-cloud/secret-manager';
import pkg from 'pg';
import { logger } from '../utils/logger.js';
import { config } from '../config/index.js';
import { withRetry, isDatabaseConnectionError, isDatabaseResourceError } from '../utils/retry.js';

const { Pool } = pkg;

// Connection state for monitoring
export const connectionState = {
  lastInitTime: null,
  initCount: 0,
  lastErrorMessage: null,
  isInitializing: false,
  isConnected: false,
  lastSuccessTime: null,
  lastErrorTime: null
};

// Secret Manager client
const secretManagerClient = new SecretManagerServiceClient();

// Database pool
let pool;

/**
 * Retrieves a secret from Secret Manager
 * @param {string} secretName - The name of the secret to retrieve
 * @returns {Promise<string>} - The secret value
 */
async function getSecret(secretName) {
  try {
    const name = `projects/${config.projectId}/secrets/${secretName}/versions/latest`;
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

/**
 * Creates database pool configuration
 * @returns {Promise<Object>} - The pool configuration
 */
async function createPoolConfig() {
  try {
    // For local development, check if we can use environment variables
    if (config.environment !== 'production' && 
        config.database.user && 
        config.database.password && 
        config.database.name) {
      
      logger.info('Using database credentials from environment variables');
      
      return {
        user: config.database.user,
        password: config.database.password,
        database: config.database.name,
        host: config.database.host,
        port: config.database.port,
        max: config.database.maxPool,
        idleTimeoutMillis: config.database.idleTimeout,
        connectionTimeoutMillis: config.database.connectionTimeout
      };
    }
    
    // Otherwise retrieve from Secret Manager
    const [dbName, dbUser, dbPassword] = await Promise.all([
      getSecret('DB_NAME'),
      getSecret('DB_USER'),
      getSecret('DB_PASSWORD')
    ]);

    // Configuration based on environment
    const dbConfig = config.environment === 'production' 
      ? {
        user: dbUser,
        password: dbPassword,
        database: dbName,
        host: `/cloudsql/${config.instanceConnectionName}`,
        max: config.database.maxPool,
        min: config.database.minPool,
        idleTimeoutMillis: config.database.idleTimeout,
        connectionTimeoutMillis: config.database.connectionTimeout,
        application_name: 'notification-worker',
        keepalive: true,
        statement_timeout: 60000,
        query_timeout: 60000,
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
        host: config.database.host,
        port: config.database.port,
        max: config.database.maxPool,
        idleTimeoutMillis: config.database.idleTimeout,
        connectionTimeoutMillis: config.database.connectionTimeout,
        keepalive: true
      };

    logger.info('Database connection configuration created', {
      host: dbConfig.host,
      database: dbConfig.database,
      user: dbConfig.user,
      max: dbConfig.max,
      environment: config.environment
    });

    return dbConfig;
  } catch (error) {
    logger.error('Failed to create pool configuration', {
      error: error.message,
      code: error.code,
      stack: error.stack
    });
    throw error;
  }
}

/**
 * Tests the database connection
 * @param {Object} pool - The database pool to test
 * @param {number} retryCount - The current retry count
 * @returns {Promise<boolean>} - Whether the connection is successful
 */
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
        timeout_ms: 10000,
        connection_state: connectionState
      });
      throw new Error('Database connection test timeout');
    }, 10000);

    try {
      // Get a client from the pool
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
    if (retryCount < config.retry.database.maxRetries) {
      const delay = Math.pow(config.retry.database.factor, retryCount) * config.retry.database.initialDelay;
      logger.info(`Retrying database connection in ${delay}ms`, { retry_count: retryCount + 1 });
      await new Promise(resolve => setTimeout(resolve, delay));
      return testConnection(pool, retryCount + 1);
    }
    
    throw error;
  }
}

/**
 * Initializes the database pool
 * @returns {Promise<Object>} - The initialized pool
 */
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
    const dbConfig = await createPoolConfig();
    const newPool = new Pool(dbConfig);

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
      host: dbConfig.host.includes('/cloudsql') ? 'Cloud SQL' : dbConfig.host,
      database: dbConfig.database
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

/**
 * Database service with query, transaction, and RLS functions
 */
export const database = {
  /**
   * Executes a database query with retries and error handling
   * @param {string} text - The SQL query text
   * @param {Array} params - The query parameters
   * @param {Object} queryOptions - Options for the query execution
   * @returns {Promise<Object>} - Query result
   */
  query: async (text, params, queryOptions = {}) => {
    const maxRetries = queryOptions.maxRetries || config.retry.database.maxRetries;
    const retryDelay = queryOptions.retryDelay || config.retry.database.initialDelay;
    
    return withRetry(
      async () => {
        const start = Date.now();
        
        if (!pool || !connectionState.isConnected) {
          pool = await initializePool();
        }
        
        // Get a client for better control
        const client = await pool.connect();
        
        try {
          // Execute query
          const result = await client.query(text, params);
          const duration = Date.now() - start;
          
          logger.debug('Query executed successfully', {
            text: text.substring(0, 100) + (text.length > 100 ? '...' : ''),
            duration,
            rows: result.rowCount,
            command: result.command
          });
          
          return result;
        } finally {
          // Always release client back to pool
          client.release();
        }
      },
      {
        name: 'database.query',
        maxRetries,
        initialDelay: retryDelay,
        retryOnError: (err) => isDatabaseConnectionError(err) || isDatabaseResourceError(err),
        context: {
          query: text.substring(0, 100) + (text.length > 100 ? '...' : '')
        }
      }
    );
  },
  
  /**
   * Sets the RLS context for a database session
   * @param {string} userId - The user ID to set for RLS
   * @returns {Promise<boolean>} - Whether the operation was successful
   */
  setRLSContext: async (userId) => {
    if (!userId) {
      logger.warn('Cannot set RLS context: missing userId');
      return false;
    }
    
    try {
      // Validate that userId is a valid UUID to prevent SQL injection
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (!uuidRegex.test(userId)) {
        logger.warn('Invalid UUID format for RLS context', { userId });
        return false;
      }
      
      // PostgreSQL doesn't support parameters in SET LOCAL commands
      await database.query(`SET LOCAL app.current_user_id = '${userId}'`, []);
      logger.debug('Set RLS context for user', { userId });
      return true;
    } catch (error) {
      logger.warn('Failed to set RLS context', {
        error: error.message,
        userId
      });
      return false;
    }
  },
  
  /**
   * Executes a function within a transaction with RLS context set
   * @param {string} userId - The user ID to set for RLS
   * @param {Function} callback - Function to execute within the transaction
   * @returns {Promise<any>} - Result of the callback function
   */
  withRLSContext: async (userId, callback) => {
    if (!pool) {
      pool = await initializePool();
    }
    
    const client = await pool.connect();
    
    try {
      await client.query('BEGIN');
      
      // Set RLS context
      if (userId) {
        // PostgreSQL doesn't support parameters in SET LOCAL commands
        await client.query(`SET LOCAL app.current_user_id = '${userId}'`, []);
      }
      
      // Execute the callback with the client
      const result = await callback(client);
      
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  },
  
  /**
   * Tests the database connection
   * @returns {Promise<boolean>} - Whether the connection is successful
   */
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
  
  /**
   * Gets the current connection state
   * @returns {Object} - The connection state
   */
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
  
  /**
   * Closes the database pool
   * @returns {Promise<void>}
   */
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