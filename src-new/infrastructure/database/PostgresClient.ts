import { Pool, PoolClient, QueryResult } from 'pg';
import { Config } from '../config/Config.js';
import { AppError, ErrorCode } from '../../domain/errors/AppError.js';

/**
 * Database connection state
 */
export interface ConnectionState {
  isConnected: boolean;
  poolSize: number;
  idleConnections: number;
  waitingClients: number;
  lastError?: string;
  lastCheckTime: Date;
}

/**
 * Interface for database query options
 */
export interface QueryOptions {
  maxRetries?: number;
  setContext?: string;
}

/**
 * Client for PostgreSQL database connections
 */
export class PostgresClient {
  private pool: Pool;
  private connectionState: ConnectionState = {
    isConnected: false,
    poolSize: 0,
    idleConnections: 0,
    waitingClients: 0,
    lastCheckTime: new Date(),
  };

  /**
   * Creates a new PostgreSQL client
   * @param config Database configuration
   */
  constructor(private readonly config: Config) {
    this.pool = new Pool(this.config.database);

    // Set up pool event listeners
    this.pool.on('connect', () => {
      this.connectionState.isConnected = true;
    });

    this.pool.on('error', (err) => {
      this.connectionState.lastError = err.message;
      // Don't crash on connection errors, but log them
      console.error('Unexpected error on idle client', err);
    });
  }

  /**
   * Tests the database connection
   * @returns True if connection is successful
   */
  async testConnection(): Promise<boolean> {
    try {
      const client = await this.pool.connect();
      try {
        await client.query('SELECT NOW()');
        this.connectionState = {
          isConnected: true,
          poolSize: this.pool.totalCount || 0,
          idleConnections: this.pool.idleCount || 0,
          waitingClients: this.pool.waitingCount || 0,
          lastCheckTime: new Date(),
        };
        return true;
      } finally {
        client.release();
      }
    } catch (error) {
      const err = error as Error;
      this.connectionState = {
        isConnected: false,
        poolSize: this.pool.totalCount || 0,
        idleConnections: this.pool.idleCount || 0,
        waitingClients: this.pool.waitingCount || 0,
        lastError: err.message,
        lastCheckTime: new Date(),
      };
      throw new AppError(
        `Database connection test failed: ${err.message}`,
        ErrorCode.DATABASE_CONNECTION_ERROR,
        {
          host: this.config.database.host,
          database: this.config.database.database,
        },
        err
      );
    }
  }

  /**
   * Executes a database query
   * @param text SQL query text
   * @param params Query parameters
   * @param options Query options
   * @returns Query result
   */
  async query<T = any>(
    text: string,
    params: any[] = [],
    options: QueryOptions = {}
  ): Promise<QueryResult<T>> {
    const maxRetries = options.maxRetries || 0;
    let lastError: Error | null = null;
    
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const client = await this.pool.connect();
        try {
          // Set RLS context if provided
          if (options.setContext) {
            await client.query('SELECT set_config(\'app.current_user_id\', $1, true)', [options.setContext]);
          }
          
          // Execute the query
          const result = await client.query<T>(text, params);
          return result;
        } finally {
          client.release();
        }
      } catch (error) {
        lastError = error as Error;
        if (attempt < maxRetries) {
          // Exponential backoff: 100ms, 200ms, 400ms, etc.
          const delay = Math.pow(2, attempt) * 100;
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }
    
    // If we get here, all retries failed
    throw new AppError(
      `Database query failed after ${maxRetries + 1} attempts: ${lastError?.message}`,
      ErrorCode.DATABASE_ERROR,
      {
        query: text,
        paramCount: params.length,
      },
      lastError || undefined
    );
  }

  /**
   * Executes a function with a database client
   * @param callback Function to execute with the client
   * @returns Result of the callback function
   */
  async withClient<T>(callback: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      return await callback(client);
    } finally {
      client.release();
    }
  }

  /**
   * Executes a function within a transaction
   * @param callback Function to execute within transaction
   * @returns Result of the callback function
   */
  async withTransaction<T>(callback: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
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
   * Executes a function with RLS context set
   * @param userId User ID to set for RLS context
   * @param callback Function to execute
   * @returns Result of the callback function
   */
  async withRLSContext<T>(userId: string, callback: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('SELECT set_config(\'app.current_user_id\', $1, true)', [userId]);
      return await callback(client);
    } finally {
      client.release();
    }
  }

  /**
   * Sets the RLS context for the entire session
   * @param userId User ID to set for RLS context
   */
  async setRLSContext(userId: string): Promise<void> {
    await this.query('SELECT set_config(\'app.current_user_id\', $1, false)', [userId]);
  }

  /**
   * Gets the current database connection state
   * @returns Connection state information
   */
  getConnectionState(): ConnectionState {
    return {
      ...this.connectionState,
      poolSize: this.pool.totalCount || 0,
      idleConnections: this.pool.idleCount || 0,
      waitingClients: this.pool.waitingCount || 0,
      lastCheckTime: new Date(),
    };
  }

  /**
   * Ends the database connection pool
   */
  async end(): Promise<void> {
    await this.pool.end();
  }
}