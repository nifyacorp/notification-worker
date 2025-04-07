/**
 * @file Service status tracking
 * Tracks the health and status of service dependencies
 */

/**
 * Operating mode enum
 */
export enum OperatingMode {
  FULL = 'FULL',
  LIMITED = 'LIMITED',
  READONLY = 'READONLY',
  ERROR = 'ERROR'
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
export class ServiceStatus {
  private databaseActive: boolean = false;
  private pubsubActive: boolean = false;
  private subscriptionActive: boolean = false;
  private operatingMode: OperatingMode = OperatingMode.ERROR;
  private errors: ServiceErrors = {};
  private startTime: Date = new Date();
  private version: string = process.env.VERSION || '1.0.0';
  
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
  public setDatabaseActive(active: boolean): void {
    this.databaseActive = active;
    this.updateOperatingMode();
  }
  
  /**
   * Set PubSub active state
   * @param active - Whether PubSub is active
   */
  public setPubSubActive(active: boolean): void {
    this.pubsubActive = active;
    this.updateOperatingMode();
  }
  
  /**
   * Set subscription active state
   * @param active - Whether subscription is active
   */
  public setSubscriptionActive(active: boolean): void {
    this.subscriptionActive = active;
    this.updateOperatingMode();
  }
  
  /**
   * Check if database is active
   * @returns Whether database is active
   */
  public isDatabaseActive(): boolean {
    return this.databaseActive;
  }
  
  /**
   * Check if PubSub is active
   * @returns Whether PubSub is active
   */
  public isPubSubActive(): boolean {
    return this.pubsubActive;
  }
  
  /**
   * Check if subscription is active
   * @returns Whether subscription is active
   */
  public isSubscriptionActive(): boolean {
    return this.subscriptionActive;
  }
  
  /**
   * Get current operating mode
   * @returns Current operating mode
   */
  public getOperatingMode(): OperatingMode {
    return this.operatingMode;
  }
  
  /**
   * Update operating mode based on service states
   */
  public updateOperatingMode(): void {
    if (this.databaseActive && this.pubsubActive && this.subscriptionActive) {
      this.operatingMode = OperatingMode.FULL;
    } else if (this.databaseActive && this.pubsubActive) {
      this.operatingMode = OperatingMode.LIMITED;
    } else if (this.databaseActive) {
      this.operatingMode = OperatingMode.READONLY;
    } else {
      this.operatingMode = OperatingMode.ERROR;
    }
  }
  
  /**
   * Add an error
   * @param key - Error key
   * @param message - Error message
   */
  public addError(key: string, message: string): void {
    this.errors[key] = message;
  }
  
  /**
   * Remove an error
   * @param key - Error key
   */
  public removeError(key: string): void {
    delete this.errors[key];
  }
  
  /**
   * Check if service is healthy
   * @returns Whether service is healthy
   */
  public isHealthy(): boolean {
    return this.operatingMode === OperatingMode.FULL || this.operatingMode === OperatingMode.LIMITED;
  }
  
  /**
   * Check if service is in read-only mode
   * @returns Whether service is in read-only mode
   */
  public isReadOnly(): boolean {
    return this.operatingMode === OperatingMode.READONLY;
  }
  
  /**
   * Get service status report
   * @returns Service status report
   */
  public getStatusReport(): ServiceStatusReport {
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
  public resetErrors(): void {
    this.errors = {};
  }
}