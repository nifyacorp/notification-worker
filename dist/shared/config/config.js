/**
 * @file Application configuration
 * Centralized configuration with validation
 */
import { z } from 'zod';
import { logger } from '../logger/logger';
/**
 * Database configuration schema
 */
const DatabaseConfigSchema = z.object({
    user: z.string().optional(),
    password: z.string().optional(),
    name: z.string().optional(),
    host: z.string().default('localhost'),
    port: z.number().int().positive().default(5432),
    maxPool: z.number().int().positive().default(5),
    minPool: z.number().int().min(0).default(0),
    idleTimeout: z.number().int().positive().default(30000),
    connectionTimeout: z.number().int().positive().default(10000),
});
/**
 * Retry configuration schema
 */
const RetryConfigSchema = z.object({
    maxRetries: z.number().int().min(0).default(3),
    initialDelay: z.number().int().positive().default(1000),
    maxDelay: z.number().int().positive().default(10000),
    factor: z.number().positive().default(2),
});
/**
 * PubSub configuration schema
 */
const PubSubConfigSchema = z.object({
    subscription: z.string().optional(),
    dlqTopic: z.string().optional(),
    emailImmediateTopic: z.string().default('email-notifications-immediate'),
    emailDailyTopic: z.string().default('email-notifications-daily'),
    retry: RetryConfigSchema.default({}),
});
/**
 * Application configuration schema
 */
const AppConfigSchema = z.object({
    port: z.number().int().positive().default(8080),
    environment: z.enum(['development', 'test', 'production']).default('development'),
    projectId: z.string().optional(),
    instanceConnectionName: z.string().optional(),
    database: DatabaseConfigSchema.default({}),
    pubsub: PubSubConfigSchema.default({}),
    retry: z.object({
        database: RetryConfigSchema.default({}),
        pubsub: RetryConfigSchema.default({}),
    }).default({}),
});
/**
 * Load environment variables into configuration
 * @returns Validated configuration object
 */
function loadConfig() {
    // Initialize with default values and environment variables
    const rawConfig = {
        port: parseInt(process.env.PORT || '8080', 10),
        environment: process.env.NODE_ENV || 'development',
        projectId: process.env.GOOGLE_CLOUD_PROJECT,
        instanceConnectionName: process.env.GOOGLE_CLOUD_PROJECT
            ? `${process.env.GOOGLE_CLOUD_PROJECT}:us-central1:nifya-db`
            : 'delta-entity-447812-p2:us-central1:nifya-db',
        database: {
            user: process.env.DB_USER,
            password: process.env.DB_PASSWORD,
            name: process.env.DB_NAME,
            host: process.env.DB_HOST || 'localhost',
            port: parseInt(process.env.DB_PORT || '5432', 10),
            maxPool: process.env.NODE_ENV === 'production' ? 10 : 5,
            minPool: process.env.NODE_ENV === 'production' ? 1 : 0,
            idleTimeout: 30000,
            connectionTimeout: process.env.NODE_ENV === 'production' ? 30000 : 10000,
        },
        pubsub: {
            subscription: process.env.PUBSUB_SUBSCRIPTION,
            dlqTopic: process.env.DLQ_TOPIC,
            emailImmediateTopic: process.env.EMAIL_IMMEDIATE_TOPIC || 'email-notifications-immediate',
            emailDailyTopic: process.env.EMAIL_DAILY_TOPIC || 'email-notifications-daily',
        },
        retry: {
            database: {
                maxRetries: 3,
                initialDelay: 1000,
                maxDelay: 10000,
                factor: 2
            },
            pubsub: {
                maxRetries: 3,
                initialDelay: 2000,
                maxDelay: 15000,
                factor: 2
            }
        }
    };
    // Validate configuration against schema
    try {
        return AppConfigSchema.parse(rawConfig);
    }
    catch (error) {
        logger.error('Invalid configuration', { error });
        throw new Error('Configuration validation failed');
    }
}
/**
 * Application configuration singleton
 */
export const config = loadConfig();
/**
 * Log the current configuration
 */
export function logConfig() {
    logger.info('Application configuration loaded', {
        environment: config.environment,
        project_id: config.projectId,
        pubsub_subscription: config.pubsub.subscription,
        database_host: process.env.NODE_ENV === 'production' ? 'Cloud SQL' : config.database.host
    });
}
//# sourceMappingURL=config.js.map