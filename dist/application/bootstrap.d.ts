/**
 * @file Application bootstrap
 * Initializes the application and sets up dependency injection
 */
/**
 * Application container
 * Provides dependency injection container for the application
 */
export declare class Application {
    private server;
    private dbConnection;
    private pubSubService;
    private notificationRepository;
    private processorRegistry;
    private notificationService;
    private serviceStatus;
    constructor();
    /**
     * Initialize the application
     * @returns Promise resolving when initialization is complete
     */
    initialize(): Promise<void>;
    /**
     * Start the application
     * @returns Promise resolving when application is started
     */
    start(): Promise<void>;
    /**
     * Registers processors with the registry
     */
    private registerProcessors;
    /**
     * Set up message processing subscription
     */
    private setupMessageProcessing;
    /**
     * Handle HTTP requests
     * @param req - HTTP request
     * @param res - HTTP response
     */
    private handleRequest;
    /**
     * Register signal handlers for graceful shutdown
     */
    private registerSignalHandlers;
    /**
     * Shutdown the application gracefully
     */
    private shutdown;
}
export declare const app: Application;
