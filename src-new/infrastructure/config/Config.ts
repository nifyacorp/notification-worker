import { z } from 'zod';

/**
 * Database configuration schema
 */
const DatabaseConfigSchema = z.object({
  host: z.string().default('localhost'),
  port: z.number().int().positive().default(5432),
  database: z.string().min(1),
  user: z.string().min(1),
  password: z.string(),
  ssl: z.boolean().default(false),
  max: z.number().int().positive().default(20),
  idleTimeoutMillis: z.number().int().positive().default(30000),
  connectionTimeoutMillis: z.number().int().positive().default(5000),
});

/**
 * PubSub configuration schema
 */
const PubSubConfigSchema = z.object({
  projectId: z.string().min(1),
  subscriptionName: z.string().min(1),
  deadLetterTopicName: z.string().default('notification-worker-dlq'),
  emailTopics: z.object({
    immediate: z.string().default('email-notifications-immediate'),
    daily: z.string().default('email-notifications-daily'),
  }),
  realtimeTopicName: z.string().default('realtime-notifications'),
});

/**
 * Server configuration schema
 */
const ServerConfigSchema = z.object({
  port: z.number().int().positive().default(8080),
});

/**
 * Application configuration schema
 */
const ConfigSchema = z.object({
  environment: z.enum(['development', 'test', 'production']).default('development'),
  database: DatabaseConfigSchema,
  pubsub: PubSubConfigSchema,
  server: ServerConfigSchema,
  serviceName: z.string().default('notification-worker'),
  logLevel: z.enum(['error', 'warn', 'info', 'debug']).default('info'),
  deduplicationWindowMinutes: z.number().int().positive().default(1440), // 24 hours
});

/**
 * Type definition for application configuration
 */
export type Config = z.infer<typeof ConfigSchema>;

/**
 * Class for managing application configuration
 */
export class ConfigService {
  private config: Config;

  /**
   * Initializes configuration with environment variables and defaults
   */
  constructor() {
    this.config = ConfigSchema.parse({
      environment: process.env.NODE_ENV || 'development',
      database: {
        host: process.env.DB_HOST,
        port: process.env.DB_PORT ? parseInt(process.env.DB_PORT, 10) : undefined,
        database: process.env.DB_NAME,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        ssl: process.env.DB_SSL === 'true',
        max: process.env.DB_POOL_SIZE ? parseInt(process.env.DB_POOL_SIZE, 10) : undefined,
        idleTimeoutMillis: process.env.DB_IDLE_TIMEOUT 
          ? parseInt(process.env.DB_IDLE_TIMEOUT, 10) 
          : undefined,
        connectionTimeoutMillis: process.env.DB_CONNECTION_TIMEOUT 
          ? parseInt(process.env.DB_CONNECTION_TIMEOUT, 10) 
          : undefined,
      },
      pubsub: {
        projectId: process.env.GCP_PROJECT_ID || '',
        subscriptionName: process.env.PUBSUB_SUBSCRIPTION || '',
        deadLetterTopicName: process.env.DLQ_TOPIC || undefined,
        emailTopics: {
          immediate: process.env.EMAIL_IMMEDIATE_TOPIC || undefined,
          daily: process.env.EMAIL_DAILY_TOPIC || undefined,
        },
        realtimeTopicName: process.env.REALTIME_TOPIC || undefined,
      },
      server: {
        port: process.env.PORT ? parseInt(process.env.PORT, 10) : undefined,
      },
      serviceName: process.env.SERVICE_NAME || undefined,
      logLevel: (process.env.LOG_LEVEL as any) || undefined,
      deduplicationWindowMinutes: process.env.DEDUPLICATION_WINDOW_MINUTES 
        ? parseInt(process.env.DEDUPLICATION_WINDOW_MINUTES, 10) 
        : undefined,
    });
  }

  /**
   * Gets the entire configuration object
   * @returns Application configuration
   */
  getConfig(): Config {
    return this.config;
  }

  /**
   * Logs the current configuration (with sensitive data redacted)
   * @returns Redacted configuration for logging
   */
  getRedactedConfig(): Record<string, unknown> {
    const redacted = JSON.parse(JSON.stringify(this.config)) as Record<string, unknown>;
    
    // Redact sensitive information
    if (redacted.database && typeof redacted.database === 'object') {
      (redacted.database as any).password = '******';
    }
    
    return redacted;
  }
}