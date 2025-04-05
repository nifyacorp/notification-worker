import { logger } from '../utils/logger.js';

export const config = {
  // Server settings
  port: process.env.PORT || 8080,
  environment: process.env.NODE_ENV || 'development',
  
  // Google Cloud settings
  projectId: process.env.GOOGLE_CLOUD_PROJECT,
  instanceConnectionName: process.env.GOOGLE_CLOUD_PROJECT 
    ? `${process.env.GOOGLE_CLOUD_PROJECT}:us-central1:nifya-db`
    : 'delta-entity-447812-p2:us-central1:nifya-db',
  
  // PubSub settings
  pubsubSubscription: process.env.PUBSUB_SUBSCRIPTION,
  dlqTopic: process.env.DLQ_TOPIC,
  emailImmediateTopic: process.env.EMAIL_IMMEDIATE_TOPIC || 'email-notifications-immediate',
  emailDailyTopic: process.env.EMAIL_DAILY_TOPIC || 'email-notifications-daily',
  
  // Database settings
  database: {
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    name: process.env.DB_NAME,
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 5432,
    maxPool: process.env.NODE_ENV === 'production' ? 10 : 5,
    minPool: process.env.NODE_ENV === 'production' ? 1 : 0,
    idleTimeout: 30000,
    connectionTimeout: process.env.NODE_ENV === 'production' ? 30000 : 10000,
  },
  
  // Retry settings
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

export function logConfig() {
  logger.info('Application configuration loaded', {
    environment: config.environment,
    project_id: config.projectId,
    pubsub_subscription: config.pubsubSubscription,
    database_host: process.env.NODE_ENV === 'production' ? 'Cloud SQL' : config.database.host
  });
}