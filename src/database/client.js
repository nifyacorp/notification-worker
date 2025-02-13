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
  logger.error('Unexpected database error', { error: err });
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
  } catch (err) {
    logger.error('Database connection failed', { error: err });
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
    return pool.query(text, params).catch(err => {
      });
      return result;
    } catch (err) {
      logger.error('Query failed', {
        error: err,
        text,
        params
      throw err;
    }
  },
  end: () => pool.end(),
  testConnection
};