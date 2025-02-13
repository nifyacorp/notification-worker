import pg from 'pg';
import { logger } from '../utils/logger.js';

const { Pool } = pg;

logger.info('Initializing database connection pool', {
  host: process.env.NODE_ENV === 'production' 
    ? `/cloudsql/${process.env.INSTANCE_CONNECTION_NAME}`
    : 'localhost',
  database: process.env.DB_NAME,
  user: process.env.DB_USER
});

const pool = new Pool({
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  host: process.env.NODE_ENV === 'production' 
    ? `/cloudsql/${process.env.INSTANCE_CONNECTION_NAME}`
    : 'localhost',
});

pool.on('error', (err) => {
  logger.error('Unexpected database error', { error: err });
});

// Test database connection
async function testConnection() {
  try {
    const result = await pool.query('SELECT NOW()');
    logger.info('Database connection successful', {
      timestamp: result.rows[0].now
    });
  } catch (err) {
    logger.error('Database connection failed', { error: err });
    throw err;
  }
}

export const db = {
  query: (text, params) => pool.query(text, params),
  end: () => pool.end(),
  testConnection
};