/**
 * @file Service status tracking
 * Tracks the health and status of service dependencies
 */
/**
 * Operating mode enum
 */
export declare enum OperatingMode {
    FULL = "FULL",
    LIMITED = "LIMITED",
    READONLY = "READONLY",
    ERROR = "ERROR"
}
/**
 * Service errors type
 */
export type ServiceErrors = Record<string, string>;
/**
 * Status object for a service
 */
export interface ServiceStatusReport {
    operatingMode: OperatingMode;
    healthy: boolean;
    errors: ServiceErrors;
    serviceStatuses: {
        database: boolean;
        pubsub: boolean;
        subscription: boolean;
    };
    startTime: string;
    uptime: number;
    version: string;
}
/**
 * Service status tracking class
 */
export declare class ServiceStatus {
    private databaseActive;
    private pubsubActive;
    private subscriptionActive;
    private operatingMode;
    private errors;
    private startTime;
    private version;
    /**
     * Constructor
     */
    constructor();
    /**
     * Set database active state
     * @param active - Whether database is active
     */
    setDatabaseActive(active: boolean): void;
    /**
     * Set PubSub active state
     * @param active - Whether PubSub is active
     */
    setPubSubActive(active: boolean): void;
    /**
     * Set subscription active state
     * @param active - Whether subscription is active
     */
    setSubscriptionActive(active: boolean): void;
    /**
     * Check if database is active
     * @returns Whether database is active
     */
    isDatabaseActive(): boolean;
    /**
     * Check if PubSub is active
     * @returns Whether PubSub is active
     */
    isPubSubActive(): boolean;
    /**
     * Check if subscription is active
     * @returns Whether subscription is active
     */
    isSubscriptionActive(): boolean;
    /**
     * Get current operating mode
     * @returns Current operating mode
     */
    getOperatingMode(): OperatingMode;
    /**
     * Update operating mode based on service states
     */
    updateOperatingMode(): void;
    /**
     * Add an error
     * @param key - Error key
     * @param message - Error message
     */
    addError(key: string, message: string): void;
    /**
     * Remove an error
     * @param key - Error key
     */
    removeError(key: string): void;
    /**
     * Check if service is healthy
     * @returns Whether service is healthy
     */
    isHealthy(): boolean;
    /**
     * Check if service is in read-only mode
     * @returns Whether service is in read-only mode
     */
    isReadOnly(): boolean;
    /**
     * Get service status report
     * @returns Service status report
     */
    getStatusReport(): ServiceStatusReport;
    /**
     * Reset errors
     */
    resetErrors(): void;
}
