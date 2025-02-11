import pg from 'pg';
import { logger } from '../utils/logger.js';

const { Pool } = pg;

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

export const db = {
  query: (text, params) => pool.query(text, params),
  end: () => pool.end(),
};