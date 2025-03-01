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
  isConnected: false
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
    const [dbName, dbUser, dbPassword] = await Promise.all([
      getSecret('DB_NAME'),
      getSecret('DB_USER'),
      getSecret('DB_PASSWORD')
    ]);

    const config = {
      user: dbUser,
      password: dbPassword,
      database: dbName,
      ...(process.env.NODE_ENV === 'production' ? {
        host: `/cloudsql/${INSTANCE_CONNECTION_NAME}`,
        max: 10, // Reduced from 20 to prevent connection saturation
        min: 0, // Explicitly set min connections
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 10000, // Increased from 5000
        application_name: 'notification-worker',
        statement_timeout: 15000, // Increased from 10000
        query_timeout: 15000, // Increased from 10000
        keepalive: true,
        keepaliveInitialDelayMillis: 5000, // Reduced from 10000
        // Add more reliable connection handling
        allowExitOnIdle: false,
        connectionRetryInterval: 1000
      } : {
        host: 'localhost',
        port: 5432,
        max: 5,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 5000
      })
    };

    logger.info('Database connection configuration', {
      host: config.host,
      database: config.database,
      user: config.user,
      max: config.max,
      min: config.min,
      idleTimeoutMillis: config.idleTimeoutMillis,
      connectionTimeoutMillis: config.connectionTimeoutMillis,
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
        timeout_ms: 8000,
        connection_state: connectionState
      });
      throw new Error('Database connection test timeout');
    }, 8000); // 8 second timeout for test

    try {
      // Get a client from the pool with explicit timeout
      logger.debug('Attempting to acquire client from pool');
      const clientAcquisitionStart = Date.now();
      
      const client = await Promise.race([
        pool.connect(),
        new Promise((_, reject) => 
          setTimeout(() => {
            logger.error('Client acquisition timeout', {
              timeout_ms: 5000,
              retry_count: retryCount,
              connection_state: connectionState
            });
            reject(new Error('Client acquisition timeout'));
          }, 5000)
        )
      ]);
      
      logger.debug('Successfully acquired client from pool', {
        duration_ms: Date.now() - clientAcquisitionStart
      });
      
      const startTime = Date.now();
      
      // Execute a simple query that shouldn't take long
      logger.debug('Executing simple test query');
      const result = await client.query('SELECT 1 as connection_test');
      
      // Only if that succeeds, try the more expensive queries
      if (result.rows[0].connection_test === 1) {
        logger.debug('Simple test query succeeded, running diagnostic queries');
        const [versionResult, tablesResult] = await Promise.all([
          client.query('SELECT version()'),
          client.query(`
            SELECT table_name, 
                  (SELECT count(*) FROM information_schema.columns WHERE table_name = t.table_name) as column_count
            FROM information_schema.tables t
            WHERE table_schema = 'public'
            LIMIT 10
          `)
        ]);
        
        const duration = Date.now() - startTime;
        
        logger.info({
          phase: 'connection_test_success',
          pgVersion: versionResult.rows[0]?.version,
          tableCount: tablesResult.rows?.length,
          tables: tablesResult.rows.map(r => r.table_name),
          duration_ms: duration,
          retry_count: retryCount,
          connection_state: {
            ...connectionState,
            connection_test_duration_ms: duration
          }
        }, 'Database connection successful');
      }
      
      logger.debug('Releasing client back to pool');
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
    
    // Retry up to 2 times with exponential backoff
    if (retryCount < 2) {
      const delay = Math.pow(2, retryCount) * 1000; // 1s, 2s
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
    const maxRetries = queryOptions.maxRetries || 1;
    const retryDelay = queryOptions.retryDelay || 1000;
    let attempts = 0;
    
    while (attempts <= maxRetries) {
      // Move the start time declaration here so it's accessible in both try and catch blocks
      const start = Date.now();
      
      try {
        if (!pool || !connectionState.isConnected) {
          pool = await initializePool();
        }
        
        // Remove the old declaration since we moved it outside
        const result = await pool.query(text, params);
        const duration = Date.now() - start;
        
        logger.debug('Query executed successfully', {
          text: text.substring(0, 100) + (text.length > 100 ? '...' : ''),
          duration,
          rows: result.rowCount,
          command: result.command,
          attempt: attempts + 1
        });
        
        return result;
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
          stack: error.stack.substring(0, 500),
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
            await new Promise(resolve => setTimeout(resolve, retryDelay));
            logger.info('Reinitializing pool after connection error', { attempt: attempts });
            connectionState.isConnected = false;
            pool = await initializePool();
          } catch (initError) {
            logger.error('Failed to reinitialize pool during query retry', {
              error: initError.message
            });
          }
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
      
      // Wait for existing initialization to complete (max 10 seconds)
      for (let i = 0; i < 10; i++) {
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