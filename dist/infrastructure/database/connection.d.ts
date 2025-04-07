/**
 * @file Database connection manager
 * Manages PostgreSQL connections with enhanced retry and monitoring
 */
import { Pool, PoolClient, QueryResult } from 'pg';
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
export declare class DatabaseConnection {
    private pool;
    private logger;
    private secretManagerClient;
    private connectionState;
    private instanceConnectionName;
    private environment;
    /**
     * Constructor
     * @param logger - The logger instance
     */
    constructor(logger: Logger);
    /**
     * Get connection state
     * @returns Current connection state
     */
    getConnectionState(): ConnectionState;
    /**
     * Initialize pool
     * @returns Initialized pool
     */
    initializePool(): Promise<Pool>;
    /**
     * Create pool configuration
     * @returns Database pool configuration
     */
    private createPoolConfig;
    /**
     * Get a secret from Google Secret Manager
     * @param secretName - The name of the secret
     * @returns The secret value
     */
    private getSecret;
    /**
     * Test the database connection
     * @param retryCount - Current retry count
     * @returns Whether the connection is successful
     */
    testConnection(retryCount?: number): Promise<boolean>;
    /**
     * Execute a query with retry
     * @param text - SQL query text
     * @param params - Query parameters
     * @param options - Query options
     * @returns Query result
     */
    query<T = any>(text: string, params?: any[], options?: QueryOptions): Promise<QueryResult<T>>;
    /**
     * Set RLS context for database session
     * @param userId - User ID for RLS context
     * @returns Whether the operation was successful
     */
    setRLSContext(userId: string): Promise<boolean>;
    /**
     * Execute a function within a transaction with RLS context
     * @param userId - User ID for RLS context
     * @param callback - Function to execute within transaction
     * @returns Result of callback function
     */
    withRLSContext<T>(userId: string, callback: (client: PoolClient) => Promise<T>): Promise<T>;
    /**
     * Close database connections
     * @returns Promise that resolves when connections are closed
     */
    end(): Promise<void>;
}
