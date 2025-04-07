/**
 * @file API route handlers
 * HTTP route handlers for the notification worker API
 */
import http from 'http';
import { Logger } from '../shared/logger/logger';
import { ServiceStatus } from '../application/services/service-status';
import { NotificationRepository } from '../domain/repositories/notification-repository';
import { NotificationService } from '../domain/services/notification-service';
import { ProcessorRegistry } from '../domain/services/processor-registry';
import { DatabaseConnection } from '../infrastructure/database/connection';
/**
 * Dependencies for route handlers
 */
interface RouteDependencies {
    serviceStatus: ServiceStatus;
    notificationRepository: NotificationRepository;
    notificationService: NotificationService;
    processorRegistry: ProcessorRegistry;
    dbConnection: DatabaseConnection;
    logger: Logger;
}
/**
 * Set up routes with dependencies
 * @param dependencies - Route dependencies
 * @returns Route handler function
 */
export declare function setRoutes(dependencies: RouteDependencies): (req: http.IncomingMessage, res: http.ServerResponse) => void;
export {};
