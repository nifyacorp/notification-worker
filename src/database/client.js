import pg from 'pg';
import { logger } from '../utils/logger.js';

const { Pool } = pg;

const config = {
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  host: `/cloudsql/${process.env.INSTANCE_CONNECTION_NAME}`,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
};

const pool = new Pool(config);

pool.on('error', (err) => {
  logger.error('Unexpected database error', {
    error: err.message,
    stack: err.stack,
    code: err.code
  });
});

// Test database connection
async function testConnection() {
  let client;
  try {
    client = await pool.connect();
    const result = await client.query('SELECT NOW()');
    logger.info('Connected to database', {
      timestamp: result.rows[0].now
    });
    return result;
  } catch (err) {
    logger.error('Database connection failed', {
      error: err.message,
      stack: err.stack,
      code: err.code,
      config: {
        user: config.user,
        database: config.database,
        host: config.host
      }
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
      logger.debug('Executed query', {
        text,
        duration,
        rows: result.rowCount
      });
      return result;
    } catch (err) {
      logger.error('Query failed', {
        error: err.message,
        stack: err.stack,
        code: err.code,
        text,
        params
      });
      throw err;
    }
  },
  end: () => pool.end(),
  testConnection
};