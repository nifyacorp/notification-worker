import { SecretManagerServiceClient } from '@google-cloud/secret-manager';
import pkg from 'pg';
import { logger } from '../utils/logger.js'; 

const { Pool } = pkg;

const INSTANCE_CONNECTION_NAME = process.env.GOOGLE_CLOUD_PROJECT 
  ? `${process.env.GOOGLE_CLOUD_PROJECT}:us-central1:nifya-db`
  : 'delta-entity-447812-p2:us-central1:nifya-db';

const secretManagerClient = new SecretManagerServiceClient();

async function getSecret(secretName) {
  try {
    const name = `projects/${process.env.GOOGLE_CLOUD_PROJECT}/secrets/${secretName}/versions/latest`;
    const [version] = await secretManagerClient.accessSecretVersion({ name });
    return version.payload.data.toString();
  } catch (error) {
    logger.error('Failed to retrieve secret', {
      secretName,
      error: error.message,
      code: error.code
    });
    throw error;
  }
}

async function createPoolConfig() {
  try {
    const [dbName, dbUser, dbPassword] = await Promise.all([
      getSecret('DB_NAME'),
      getSecret('DB_USER'),
      getSecret('DB_PASSWORD')
    ]);

    const config = {
      user: dbUser,
      password: dbPassword,
      database: dbName,
      ...(process.env.NODE_ENV === 'production' ? {
        host: `/cloudsql/${INSTANCE_CONNECTION_NAME}`,
        max: 20,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 5000,
        application_name: 'notification-worker',
        statement_timeout: 10000,
        query_timeout: 10000,
        keepalive: true,
        keepaliveInitialDelayMillis: 10000
      } : {
        host: 'localhost',
        port: 5432
      })
    };

    logger.info('Database connection configuration', {
      host: config.host,
      database: config.database,
      user: config.user,
      max: config.max,
      idleTimeoutMillis: config.idleTimeoutMillis,
      connectionTimeoutMillis: config.connectionTimeoutMillis,
      environment: process.env.NODE_ENV
    });

    return config;
  } catch (error) {
    logger.error('Failed to create pool configuration', {
      error: error.message,
      code: error.code,
      stack: error.stack
    });
    throw error;
  }
}

async function testConnection(pool) {
  try {
    logger.info('Testing database connection');
    const client = await pool.connect();
    const [versionResult, tablesResult] = await Promise.all([
      client.query('SELECT version()'),
      client.query(`
        SELECT table_name, 
               (SELECT count(*) FROM information_schema.columns WHERE table_name = t.table_name) as column_count
        FROM information_schema.tables t
        WHERE table_schema = 'public'
      `)
    ]);
    
    logger.info({
      phase: 'connection_test_success',
      pgVersion: versionResult.rows[0]?.version,
      tableCount: tablesResult.rows?.length,
      tables: tablesResult.rows.map(r => r.table_name)
    }, 'Database connection successful');
    client.release();
  } catch (error) {
    logger.error('Database connection failed', {
      error: error.message,
      code: error.code,
      stack: error.stack
    });
    throw error;
  }
}

let pool;

export const db = {
  query: async (text, params) => {
    if (!pool) {
      pool = await initializePool();
    }
    const start = Date.now();
    try {
      const result = await pool.query(text, params);
      const duration = Date.now() - start;
      logger.debug('Query executed successfully', {
        text,
        duration,
        rows: result.rowCount,
        command: result.command
      });
      return result;
    } catch (error) {
      logger.error('Query failed', {
        error: error.message,
        error_code: error.code,
        stack: error.stack,
        severity: error.severity,
        detail: error.detail,
        hint: error.hint,
        text,
        params,
        duration: Date.now() - start
      });
      throw error;
    }
  },
  end: async () => {
    if (pool) {
      logger.info('Closing database connection pool');
      await pool.end();
      logger.info('Database connection pool closed');
      pool = null;
    }
  }
};

export async function initializePool() {
  try {
    const config = await createPoolConfig();
    pool = new Pool(config);
    
    pool.on('error', (error) => {
      logger.error('Unexpected database error', {
        error: error.message,
        code: error.code,
        detail: error.detail
      });
    });

    await testConnection(pool);
    return pool;
  } catch (error) {
    logger.error('Failed to initialize pool', {
      error: error.message,
      code: error.code,
      stack: error.stack
    });
    throw error;
  }
}