/**
 * @file Database connection manager
 * Manages PostgreSQL connections with enhanced retry and monitoring
 */

import pg from 'pg';
const { Pool } = pg;
type PoolClient = pg.PoolClient;
type QueryResult<T> = pg.QueryResult<T>;
import { SecretManagerServiceClient } from '@google-cloud/secret-manager';
import { Logger } from '../../shared/logger/logger';

/**
 * ConnectionState interface for tracking database connection status
 */
export interface ConnectionState {
  lastInitTime: string | null;
  initCount: number;
  lastErrorMessage: string | null;
  isInitializing: boolean;
  isConnected: boolean;
  lastSuccessTime: string | null;
  lastErrorTime: string | null;
  poolStats?: {
    totalCount: number;
    idleCount: number;
    waitingCount: number;
  } | null;
}

/**
 * RetryOptions interface for database retry configuration
 */
export interface RetryOptions {
  maxRetries?: number;
  initialDelay?: number;
  maxDelay?: number;
  factor?: number;
  retryOnError?: (err: Error) => boolean;
}

/**
 * QueryOptions interface for database query configuration
 */
export interface QueryOptions {
  maxRetries?: number;
  retryDelay?: number;
  timeout?: number;
}

/**
 * DatabaseConnection class
 * Manages database connections with retry, monitoring, and RLS support
 */
export class DatabaseConnection {
  private pool: Pool | null = null;
  private logger: Logger;
  private secretManagerClient: SecretManagerServiceClient;
  private connectionState: ConnectionState = {
    lastInitTime: null,
    initCount: 0,
    lastErrorMessage: null,
    isInitializing: false,
    isConnected: false,
    lastSuccessTime: null,
    lastErrorTime: null
  };
  
  private instanceConnectionName: string;
  private environment: string;
  
  /**
   * Constructor
   * @param logger - The logger instance
   */
  constructor(logger: Logger) {
    this.logger = logger;
    this.secretManagerClient = new SecretManagerServiceClient();
    this.environment = process.env.NODE_ENV || 'development';
    this.instanceConnectionName = process.env.GOOGLE_CLOUD_PROJECT 
      ? `${process.env.GOOGLE_CLOUD_PROJECT}:us-central1:nifya-db`
      : 'delta-entity-447812-p2:us-central1:nifya-db';
  }
  
  /**
   * Get connection state
   * @returns Current connection state
   */
  public getConnectionState(): ConnectionState {
    return {
      ...this.connectionState,
      poolStats: this.pool ? {
        totalCount: this.pool.totalCount,
        idleCount: this.pool.idleCount,
        waitingCount: this.pool.waitingCount
      } : null
    };
  }
  
  /**
   * Initialize pool
   * @returns Initialized pool
   */
  public async initializePool(): Promise<Pool> {
    // Prevent multiple simultaneous initialization attempts
    if (this.connectionState.isInitializing) {
      this.logger.info('Pool initialization already in progress, waiting...');
      
      // Wait for current initialization to complete with timeout
      let waitTime = 0;
      const interval = 100;
      const maxWait = 10000;
      
      while (this.connectionState.isInitializing && waitTime < maxWait) {
        await new Promise(resolve => setTimeout(resolve, interval));
        waitTime += interval;
      }
      
      // If we waited and the connection is now ready, return the pool
      if (this.connectionState.isConnected && this.pool) {
        return this.pool;
      }
      
      // If we waited but initialization is still ongoing, throw an error
      if (this.connectionState.isInitializing) {
        throw new Error('Timed out waiting for ongoing pool initialization');
      }
    }
    
    // Mark as initializing
    this.connectionState.isInitializing = true;
    this.connectionState.lastInitTime = new Date().toISOString();
    this.connectionState.initCount++;
    
    try {
      this.logger.info('Initializing database pool', {
        attempt: this.connectionState.initCount,
        previous_error: this.connectionState.lastErrorMessage || 'none'
      });
      
      // Create pool config and initialize pool
      const config = await this.createPoolConfig();
      const newPool = new Pool(config);
      
      // Test the connection before returning
      const client = await Promise.race([
        newPool.connect(),
        new Promise<never>((_, reject) => 
          setTimeout(() => reject(new Error('Connection timeout during pool initialization')), 15000)
        )
      ]);
      
      // Connection successful
      client.release();
      
      // Update connection state
      this.connectionState.isConnected = true;
      this.connectionState.isInitializing = false;
      this.connectionState.lastSuccessTime = new Date().toISOString();
      this.connectionState.lastErrorMessage = null;
      this.connectionState.lastErrorTime = null;
      
      this.logger.info('Database pool initialized successfully', {
        host: config.host.includes('/cloudsql') ? 'Cloud SQL' : config.host,
        database: config.database
      });
      
      // Add event listeners for pool errors
      newPool.on('error', (err) => {
        this.logger.error('Unexpected error on idle client', {
          error: err.message,
          code: err.code || 'unknown'
        });
        
        // Update connection state
        this.connectionState.isConnected = false;
        this.connectionState.lastErrorMessage = err.message;
        this.connectionState.lastErrorTime = new Date().toISOString();
      });
      
      // Monitor pool for connection issues
      newPool.on('connect', () => {
        this.logger.debug('New database connection established');
        this.connectionState.isConnected = true;
        this.connectionState.lastSuccessTime = new Date().toISOString();
      });
      
      this.pool = newPool;
      return newPool;
    } catch (error: any) {
      // Update connection state on failure
      this.connectionState.isInitializing = false;
      this.connectionState.isConnected = false;
      this.connectionState.lastErrorMessage = error.message;
      this.connectionState.lastErrorTime = new Date().toISOString();
      
      this.logger.error('Failed to initialize database pool', {
        error: error.message,
        code: error.code || 'unknown',
        stack: error.stack
      });
      
      throw error;
    }
  }
  
  /**
   * Create pool configuration
   * @returns Database pool configuration
   */
  private async createPoolConfig(): Promise<any> {
    try {
      // For local development, check if we can use environment variables
      if (this.environment !== 'production' && 
          process.env.DB_USER && 
          process.env.DB_PASSWORD && 
          process.env.DB_NAME) {
        
        this.logger.info('Using database credentials from environment variables');
        
        return {
          user: process.env.DB_USER,
          password: process.env.DB_PASSWORD,
          database: process.env.DB_NAME,
          host: process.env.DB_HOST || 'localhost',
          port: process.env.DB_PORT || 5432,
          max: 5,
          idleTimeoutMillis: 30000,
          connectionTimeoutMillis: 5000
        };
      }
      
      // Otherwise retrieve from Secret Manager
      const [dbName, dbUser, dbPassword] = await Promise.all([
        this.getSecret('DB_NAME'),
        this.getSecret('DB_USER'),
        this.getSecret('DB_PASSWORD')
      ]);
      
      // Simplified configuration based on backend approach
      const config = this.environment === 'production' 
        ? {
          user: dbUser,
          password: dbPassword,
          database: dbName,
          host: `/cloudsql/${this.instanceConnectionName}`,
          max: 10,
          min: 1, // Always keep at least one connection
          idleTimeoutMillis: 30000,
          connectionTimeoutMillis: 30000, // Increased timeout for cloud SQL connections
          application_name: 'notification-worker',
          keepalive: true,
          statement_timeout: 60000, // Add statement timeout
          query_timeout: 60000, // Add query timeout
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
      
      this.logger.info('Database connection configuration', {
        host: config.host,
        database: config.database,
        user: config.user,
        max: config.max,
        environment: this.environment
      });
      
      return config;
    } catch (error: any) {
      this.logger.error('Failed to create pool configuration', {
        error: error.message,
        code: error.code,
        stack: error.stack
      });
      throw error;
    }
  }
  
  /**
   * Get a secret from Google Secret Manager
   * @param secretName - The name of the secret
   * @returns The secret value
   */
  private async getSecret(secretName: string): Promise<string> {
    try {
      const name = `projects/${process.env.GOOGLE_CLOUD_PROJECT}/secrets/${secretName}/versions/latest`;
      const [version] = await this.secretManagerClient.accessSecretVersion({ name });
      return version.payload!.data!.toString();
    } catch (error: any) {
      this.logger.error('Failed to retrieve secret', {
        secretName,
        error: error.message,
        code: error.code
      });
      throw error;
    }
  }
  
  /**
   * Test the database connection
   * @param retryCount - Current retry count
   * @returns Whether the connection is successful
   */
  public async testConnection(retryCount = 0): Promise<boolean> {
    try {
      if (!this.pool) {
        this.pool = await this.initializePool();
      }
      
      this.logger.info('Testing database connection', { 
        retry_count: retryCount,
        connection_state: this.getConnectionState()
      });
      
      // Set timeout for the whole test operation
      const timeout = setTimeout(() => {
        this.logger.error('Database connection test timeout reached', {
          retry_count: retryCount,
          timeout_ms: 10000,
          connection_state: this.getConnectionState()
        });
        throw new Error('Database connection test timeout');
      }, 10000);
      
      try {
        // Get a client from the pool with explicit timeout
        this.logger.debug('Attempting to acquire client from pool');
        const client = await this.pool.connect();
        
        // Execute a simple query
        this.logger.debug('Executing simple test query');
        const result = await client.query('SELECT 1 as connection_test');
        
        // Simple validation
        if (result.rows[0].connection_test === 1) {
          this.logger.info('Database connection successful', {
            pool_stats: {
              totalCount: this.pool.totalCount,
              idleCount: this.pool.idleCount,
              waitingCount: this.pool.waitingCount
            }
          });
        }
        
        // Release client
        client.release();
        clearTimeout(timeout);
        
        // Update connection state
        this.connectionState.isConnected = true;
        this.connectionState.lastErrorMessage = null;
        this.connectionState.lastSuccessTime = new Date().toISOString();
        
        return true;
      } catch (error) {
        clearTimeout(timeout);
        throw error;
      }
    } catch (error: any) {
      // Update connection state with error
      this.connectionState.isConnected = false;
      this.connectionState.lastErrorMessage = error.message;
      this.connectionState.lastErrorTime = new Date().toISOString();
      
      this.logger.error('Database connection failed', {
        error: error.message,
        code: error.code,
        stack: error.stack,
        retry_count: retryCount,
        connection_state: this.getConnectionState()
      });
      
      // Retry with exponential backoff
      if (retryCount < 3) {
        const delay = Math.pow(2, retryCount) * 1000; // 1s, 2s, 4s
        this.logger.info(`Retrying database connection in ${delay}ms`, { retry_count: retryCount + 1 });
        await new Promise(resolve => setTimeout(resolve, delay));
        return this.testConnection(retryCount + 1);
      }
      
      throw error;
    }
  }
  
  /**
   * Execute a query with retry
   * @param text - SQL query text
   * @param params - Query parameters
   * @param options - Query options
   * @returns Query result
   */
  public async query<T = any>(
    text: string,
    params: any[] = [],
    options: QueryOptions = {}
  ): Promise<QueryResult<T>> {
    const maxRetries = options.maxRetries || 2;
    const retryDelay = options.retryDelay || 1000;
    let attempts = 0;
    
    while (attempts <= maxRetries) {
      const start = Date.now();
      
      try {
        if (!this.pool || !this.connectionState.isConnected) {
          this.pool = await this.initializePool();
        }
        
        // Directly get a client for better control
        const client = await this.pool.connect();
        
        try {
          // Execute query
          const result = await client.query<T>(text, params);
          const duration = Date.now() - start;
          
          if (duration > 1000) {
            this.logger.info('Slow database query completed', {
              duration_ms: duration,
              query: text.substring(0, 80) + (text.length > 80 ? '...' : ''),
              rows: result.rowCount,
              retry_attempt: attempts
            });
          } else {
            this.logger.debug('Database query completed', {
              duration_ms: duration,
              query: text.substring(0, 80) + (text.length > 80 ? '...' : ''),
              rows: result.rowCount
            });
          }
          
          return result;
        } finally {
          // Always release client back to pool
          client.release();
        }
      } catch (error: any) {
        attempts++;
        const isConnectionError = 
          error.code === 'ECONNREFUSED' || 
          error.code === '57P01' || // admin_shutdown
          error.code === '57P03' || // cannot_connect_now
          error.message.includes('timeout') ||
          error.message.includes('Connection terminated');
          
        this.logger.error('Query failed', {
          error: error.message,
          error_code: error.code,
          stack: error.stack?.substring(0, 500) || 'No stack trace',
          severity: error.severity,
          detail: error.detail,
          text: text.substring(0, 80) + (text.length > 80 ? '...' : ''),
          duration: Date.now() - start,
          attempt: attempts,
          max_retries: maxRetries,
          is_connection_error: isConnectionError
        });
        
        if (isConnectionError && attempts <= maxRetries) {
          // For connection errors, try to reinitialize the pool
          try {
            await new Promise(resolve => setTimeout(resolve, retryDelay * attempts)); // Progressive backoff
            this.logger.info('Reinitializing pool after connection error', { attempt: attempts });
            this.connectionState.isConnected = false;
            this.pool = await this.initializePool();
          } catch (initError) {
            this.logger.error('Failed to reinitialize pool during query retry', {
              error: (initError as Error).message
            });
          }
        } else if (attempts <= maxRetries) {
          // For non-connection errors, wait before retry
          await new Promise(resolve => setTimeout(resolve, retryDelay * attempts));
          this.logger.info('Retrying query after error', { attempt: attempts });
        } else {
          throw error;
        }
      }
    }
    
    throw new Error('Query failed after maximum retries');
  }
  
  /**
   * Set RLS context for database session
   * @param userId - User ID for RLS context
   * @returns Whether the operation was successful
   */
  public async setRLSContext(userId: string): Promise<boolean> {
    if (!userId) {
      this.logger.warn('Cannot set RLS context: missing userId');
      return false;
    }
    
    try {
      // Validate that userId is a valid UUID to prevent SQL injection
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (!uuidRegex.test(userId)) {
        this.logger.warn('Invalid UUID format for RLS context', { userId });
        return false;
      }
      
      // PostgreSQL doesn't support parameters in SET LOCAL commands
      await this.query(`SET LOCAL app.current_user_id = '${userId}'`, []);
      this.logger.debug('Set RLS context for user', { userId });
      return true;
    } catch (error: any) {
      this.logger.warn('Failed to set RLS context', {
        error: error.message,
        userId
      });
      return false;
    }
  }
  
  /**
   * Execute a function within a transaction with RLS context
   * @param userId - User ID for RLS context
   * @param callback - Function to execute within transaction
   * @returns Result of callback function
   */
  public async withRLSContext<T>(userId: string, callback: (client: PoolClient) => Promise<T>): Promise<T> {
    if (!this.pool) {
      this.pool = await this.initializePool();
    }
    
    const client = await this.pool.connect();
    
    try {
      await client.query('BEGIN');
      
      // Set RLS context
      if (userId) {
        // Validate userId to prevent SQL injection
        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        if (!uuidRegex.test(userId)) {
          throw new Error('Invalid UUID format for RLS context');
        }
        
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
  }
  
  /**
   * Close database connections
   * @returns Promise that resolves when connections are closed
   */
  public async end(): Promise<void> {
    if (this.pool) {
      this.logger.info('Closing database connection pool');
      await this.pool.end();
      this.logger.info('Database connection pool closed');
      this.pool = null;
      this.connectionState.isConnected = false;
    }
  }
}