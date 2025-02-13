import pg from 'pg';
import { logger } from '../utils/logger.js';

const { Pool } = pg;

const config = {
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  host: process.env.INSTANCE_CONNECTION_NAME ? `/cloudsql/${process.env.INSTANCE_CONNECTION_NAME}` : 'localhost',
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
  ssl: false
};

logger.info('Environment variables for database connection', {
  DB_USER: process.env.DB_USER || 'not set',
  DB_NAME: process.env.DB_NAME || 'not set',
  INSTANCE_CONNECTION_NAME: process.env.INSTANCE_CONNECTION_NAME || 'not set',
  NODE_ENV: process.env.NODE_ENV || 'not set'
});

logger.info('Initializing database connection pool', {
  config: {
    user: config.user,
    database: config.database,
    host: config.host,
    max: config.max,
    idleTimeoutMillis: config.idleTimeoutMillis,
    connectionTimeoutMillis: config.connectionTimeoutMillis,
    instance_connection_name: process.env.INSTANCE_CONNECTION_NAME,
    socket_path: process.env.INSTANCE_CONNECTION_NAME ? `/cloudsql/${process.env.INSTANCE_CONNECTION_NAME}` : null,
    is_production: process.env.NODE_ENV === 'production'
  }
});

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
    logger.info('Attempting to acquire database connection', {
      connection_details: {
        host: config.host,
        database: config.database,
        user: config.user,
        max_connections: config.max,
        connection_timeout: config.connectionTimeoutMillis,
        idle_timeout: config.idleTimeoutMillis,
        ssl_enabled: config.ssl
      }
    });

    client = await pool.connect();
    logger.info('Successfully acquired database connection, executing test query');
    
    const result = await client.query('SELECT NOW()');
    logger.info('Connected to database', {
      timestamp: result.rows[0].now
    });
    return result;
  } catch (err) {
    const isConnectionError = ['ECONNREFUSED', 'ETIMEDOUT', '28P01', '3D000'].includes(err.code);
    logger.error('Database connection failed', {
      error: err.message,
      raw_error: err,
      stack: err.stack,
      code: err.code,
      sqlState: err.sqlState,
      detail: err.detail,
      hint: err.hint,
      position: err.position,
      internalPosition: err.internalPosition,
      internalQuery: err.internalQuery,
      where: err.where,
      schema: err.schema,
      table: err.table,
      column: err.column,
      dataType: err.dataType,
      constraint: err.constraint,
      errorType: isConnectionError ? 'connection' : 'query',
      config: {
        user: config.user,
        database: config.database,
        host: `/cloudsql/${process.env.INSTANCE_CONNECTION_NAME}`,
        connection_string: process.env.INSTANCE_CONNECTION_NAME ? 
          `postgresql://${config.user}:****@${config.host}/${config.database}` :
          `postgresql://${config.user}:****@localhost/${config.database}`,
        socket_path: `/cloudsql/${process.env.INSTANCE_CONNECTION_NAME}`,
        instance_connection_name: process.env.INSTANCE_CONNECTION_NAME
      }
    });
    throw err;
  } finally {
    if (client) {
      logger.info('Releasing database connection');
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