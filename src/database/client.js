import pg from 'pg';
import { logger } from '../utils/logger.js';

const { Pool } = pg;

// Log all available DB-related environment variables
logger.info('Database environment configuration', {
  NODE_ENV: process.env.NODE_ENV,
  DB_USER: process.env.DB_USER,
  DB_NAME: process.env.DB_NAME,
  DB_HOST: process.env.NODE_ENV === 'production' ? `/cloudsql/${process.env.INSTANCE_CONNECTION_NAME}` : 'localhost',
  INSTANCE_CONNECTION_NAME: process.env.INSTANCE_CONNECTION_NAME,
  HAS_PASSWORD: !!process.env.DB_PASSWORD
});

const config = {
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  host: process.env.NODE_ENV === 'production' ? `/cloudsql/${process.env.INSTANCE_CONNECTION_NAME}` : 'localhost',
  max: 5, // Reduce max connections for better error visibility
  connectionTimeoutMillis: 5000, // Reduce timeout to fail faster
  ssl: process.env.NODE_ENV === 'production'
};

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
    await client.query('SELECT 1');
    logger.info('Database connection successful');
  } catch (err) {
    logger.error('Database connection failed', {
      error: err.message,
      code: err.code,
      host: config.host,
      user: config.user,
      database: config.database
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