import pg from 'pg';
import { logger } from '../utils/logger.js';

const INSTANCE_CONNECTION_NAME = process.env.GOOGLE_CLOUD_PROJECT 
  ? `${process.env.GOOGLE_CLOUD_PROJECT}:us-central1:nifya-db` 
  : 'delta-entity-447812-p2:us-central1:nifya-db';

const { Pool } = pg;

const config = {
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
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
  environment: process.env.NODE_ENV,
  socketExists: process.env.NODE_ENV === 'production' ? 
    require('fs').existsSync(config.host) : 'N/A'
});

const pool = new Pool(config);

pool.on('error', (err) => {
  logger.error('Unexpected database error', {
    error: err.message,
    code: err.code,
    detail: err.detail
  });
});

// Test database connection
async function testConnection() {
  let client;
  try {
    logger.info('Testing database connection');
    client = await pool.connect();
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
  } catch (err) {
    logger.error('Database connection failed', {
      error: err.message,
      code: err.code,
      errorStack: err.stack,
      host: config.host,
      user: config.user,
      database: config.database,
      socketExists: process.env.NODE_ENV === 'production' ? 
        require('fs').existsSync(config.host) : 'N/A'
    });
    throw err;
  } finally {
    if (client) {
      client.release();
    }
  }
}

export const db = {
  query: async (text, params) => {
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
    } catch (err) {
      logger.error('Query failed', {
        error: err.message,
        error_code: err.code,
        stack: err.stack,
        severity: err.severity,
        detail: err.detail,
        hint: err.hint,
        text,
        params,
        duration: Date.now() - start
      });
      throw err;
    }
  },
  end: async () => {
    logger.info('Closing database connection pool');
    await pool.end();
    logger.info('Database connection pool closed');
  },
  testConnection
};