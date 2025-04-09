import { SecretManagerServiceClient } from '@google-cloud/secret-manager';
import pkg from 'pg';
import { logger } from '../utils/logger.js';
import { config } from '../config/index.js';
import { withRetry, isDatabaseConnectionError, isDatabaseResourceError } from '../utils/retry.js';

const { Pool } = pkg;

// Simplified connection state for basic monitoring
export const connectionState = {
  isConnected: false,
  lastSuccessTime: null,
  lastErrorTime: null,
  lastErrorMessage: null
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
        query_timeout: 60000
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
      max: dbConfig.max,
      environment: config.environment
    });

    return dbConfig;
  } catch (error) {
    logger.error('Failed to create pool configuration', {
      error: error.message,
      stack: error.stack
    });
    throw error;
  }
}

/**
 * Initializes the database pool
 * @returns {Promise<Object>} - The initialized pool
 */
export async function initializePool() {
  try {
    logger.info('Initializing database pool');
    
    // Create pool config and initialize pool
    const dbConfig = await createPoolConfig();
    const newPool = new Pool(dbConfig);

    // Test the connection before returning
    const client = await newPool.connect();
    const result = await client.query('SELECT 1 as connection_test');
    
    // Connection successful
    client.release();
    
    // Update connection state
    connectionState.isConnected = true;
    connectionState.lastSuccessTime = new Date().toISOString();
    connectionState.lastErrorMessage = null;
    
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
    
    return newPool;
  } catch (error) {
    // Update connection state on failure
    connectionState.isConnected = false;
    connectionState.lastErrorMessage = error.message;
    connectionState.lastErrorTime = new Date().toISOString();
    
    logger.error('Failed to initialize database pool', {
      error: error.message,
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
        // Initialize pool if not already done
        if (!pool) {
          pool = await initializePool();
        }
        
        // Get a client for better control
        const client = await pool.connect();
        
        try {
          // Execute query
          const result = await client.query(text, params);
          
          // Update connection state on success
          connectionState.isConnected = true;
          connectionState.lastSuccessTime = new Date().toISOString();
          
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
        retryOnError: (err) => isDatabaseConnectionError(err) || isDatabaseResourceError(err)
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

      await database.query(`SET LOCAL app.current_user_id = '${userId}'`);
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
   * Executes queries with RLS context
   * @param {string} userId - The user ID for RLS context
   * @param {Function} callback - Function to execute within RLS context
   * @returns {Promise<any>} - Result of the callback
   */
  withRLSContext: async (userId, callback) => {
    // Initialize pool if not already done
    if (!pool) {
      pool = await initializePool();
    }
    
    const client = await pool.connect();
    
    try {
      // Begin transaction
      await client.query('BEGIN');
      
      // Set RLS context
      await client.query(`SET LOCAL app.current_user_id = '${userId}'`);
      
      // Execute callback
      const result = await callback(client);
      
      // Commit transaction
      await client.query('COMMIT');
      
      return result;
    } catch (error) {
      // Rollback transaction
      await client.query('ROLLBACK').catch(rollbackError => {
        logger.error('Error rolling back transaction', {
          error: rollbackError.message,
          original_error: error.message
        });
      });
      
      throw error;
    } finally {
      // Release client
      client.release();
    }
  },
  
  /**
   * Gets the database connection state
   * @returns {Object} - The connection state
   */
  getConnectionState: () => {
    return { ...connectionState };
  },
  
  /**
   * Tests the database connection
   * @returns {Promise<boolean>} - Whether the connection is successful
   */
  testConnection: async () => {
    try {
      // Initialize pool if not already done
      if (!pool) {
        pool = await initializePool();
      }
      
      // Execute simple query
      await database.query('SELECT 1');
      
      // Update connection state
      connectionState.isConnected = true;
      connectionState.lastSuccessTime = new Date().toISOString();
      
      return true;
    } catch (error) {
      // Update connection state
      connectionState.isConnected = false;
      connectionState.lastErrorMessage = error.message;
      connectionState.lastErrorTime = new Date().toISOString();
      
      throw error;
    }
  },
  
  /**
   * Closes the database pool
   * @returns {Promise<void>}
   */
  end: async () => {
    if (pool) {
      await pool.end();
      pool = null;
      connectionState.isConnected = false;
      logger.info('Database pool closed');
    }
  }
};