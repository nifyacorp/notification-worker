/**
 * @file Service status tracking
 * Tracks the health and status of service dependencies
 */
/**
 * Operating mode enum
 */
export var OperatingMode;
(function (OperatingMode) {
    OperatingMode["FULL"] = "FULL";
    OperatingMode["LIMITED"] = "LIMITED";
    OperatingMode["READONLY"] = "READONLY";
    OperatingMode["ERROR"] = "ERROR";
})(OperatingMode || (OperatingMode = {}));
/**
 * Service status tracking class
 */
export class ServiceStatus {
    databaseActive = false;
    pubsubActive = false;
    subscriptionActive = false;
    operatingMode = OperatingMode.ERROR;
    errors = {};
    startTime = new Date();
    version = process.env.VERSION || '1.0.0';
    /**
     * Constructor
     */
    constructor() {
        // Update operating mode on initialization
        this.updateOperatingMode();
    }
    /**
     * Set database active state
     * @param active - Whether database is active
     */
    setDatabaseActive(active) {
        this.databaseActive = active;
        this.updateOperatingMode();
    }
    /**
     * Set PubSub active state
     * @param active - Whether PubSub is active
     */
    setPubSubActive(active) {
        this.pubsubActive = active;
        this.updateOperatingMode();
    }
    /**
     * Set subscription active state
     * @param active - Whether subscription is active
     */
    setSubscriptionActive(active) {
        this.subscriptionActive = active;
        this.updateOperatingMode();
    }
    /**
     * Check if database is active
     * @returns Whether database is active
     */
    isDatabaseActive() {
        return this.databaseActive;
    }
    /**
     * Check if PubSub is active
     * @returns Whether PubSub is active
     */
    isPubSubActive() {
        return this.pubsubActive;
    }
    /**
     * Check if subscription is active
     * @returns Whether subscription is active
     */
    isSubscriptionActive() {
        return this.subscriptionActive;
    }
    /**
     * Get current operating mode
     * @returns Current operating mode
     */
    getOperatingMode() {
        return this.operatingMode;
    }
    /**
     * Update operating mode based on service states
     */
    updateOperatingMode() {
        if (this.databaseActive && this.pubsubActive && this.subscriptionActive) {
            this.operatingMode = OperatingMode.FULL;
        }
        else if (this.databaseActive && this.pubsubActive) {
            this.operatingMode = OperatingMode.LIMITED;
        }
        else if (this.databaseActive) {
            this.operatingMode = OperatingMode.READONLY;
        }
        else {
            this.operatingMode = OperatingMode.ERROR;
        }
    }
    /**
     * Add an error
     * @param key - Error key
     * @param message - Error message
     */
    addError(key, message) {
        this.errors[key] = message;
    }
    /**
     * Remove an error
     * @param key - Error key
     */
    removeError(key) {
        delete this.errors[key];
    }
    /**
     * Check if service is healthy
     * @returns Whether service is healthy
     */
    isHealthy() {
        return this.operatingMode === OperatingMode.FULL || this.operatingMode === OperatingMode.LIMITED;
    }
    /**
     * Check if service is in read-only mode
     * @returns Whether service is in read-only mode
     */
    isReadOnly() {
        return this.operatingMode === OperatingMode.READONLY;
    }
    /**
     * Get service status report
     * @returns Service status report
     */
    getStatusReport() {
        return {
            operatingMode: this.operatingMode,
            healthy: this.isHealthy(),
            errors: { ...this.errors },
            serviceStatuses: {
                database: this.databaseActive,
                pubsub: this.pubsubActive,
                subscription: this.subscriptionActive
            },
            startTime: this.startTime.toISOString(),
            uptime: (Date.now() - this.startTime.getTime()) / 1000, // In seconds
            version: this.version
        };
    }
    /**
     * Reset errors
     */
    resetErrors() {
        this.errors = {};
    }
}
//# sourceMappingURL=service-status.js.map