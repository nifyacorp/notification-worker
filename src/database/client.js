import pg from 'pg';
import { logger } from '../utils/logger.js';

const { Pool } = pg;

// Ensure required environment variables are present
const requiredEnvVars = ['DB_USER', 'DB_PASSWORD', 'DB_NAME', 'INSTANCE_CONNECTION_NAME'];
for (const envVar of requiredEnvVars) {
  if (!process.env[envVar]) {
    logger.error('Missing required environment variable', {
      variable: envVar,
      available_vars: Object.keys(process.env)
        .filter(key => key.startsWith('DB_') || key === 'INSTANCE_CONNECTION_NAME')
        .map(key => `${key}: ${key === 'DB_PASSWORD' ? '****' : process.env[key]}`)
    });
    throw new Error(`Missing required environment variable: ${envVar}. Check your environment configuration.`);
  }
}

logger.info('Configuring database connection', {
  environment: process.env.NODE_ENV,
  user: process.env.DB_USER,
  database: process.env.DB_NAME,
  host: process.env.NODE_ENV === 'production' ? 'Using Cloud SQL socket' : 'localhost',
  instance_connection: process.env.INSTANCE_CONNECTION_NAME
});

const config = {
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  host: process.env.NODE_ENV === 'production' ? `/cloudsql/${process.env.INSTANCE_CONNECTION_NAME}` : 'localhost',
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
  ssl: process.env.NODE_ENV === 'production'
};

logger.info('Initializing database connection pool', {
  config: {
    user: config.user,
    database: config.database,
    host: config.host,
    max: config.max,
    idleTimeoutMillis: config.idleTimeoutMillis,
    connectionTimeoutMillis: config.connectionTimeoutMillis,
    ssl: config.ssl,
    socket_path: process.env.NODE_ENV === 'production' ? `/cloudsql/${process.env.INSTANCE_CONNECTION_NAME}` : null,
    is_production: process.env.NODE_ENV === 'production'
  }
});

const pool = new Pool(config);

pool.on('error', (err) => {
  logger.error('Unexpected database error', {
    error: err.message,
    error_code: err.code,
    stack: err.stack,
    severity: err.severity,
    detail: err.detail,
    hint: err.hint,
    position: err.position
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
    logger.info('Successfully acquired client from pool, executing test query');
    
    const result = await client.query('SELECT NOW()');
    logger.info('Connected to database', {
      timestamp: result.rows[0].now
    });
    return result;
  } catch (err) {
    const isConnectionError = ['ECONNREFUSED', 'ETIMEDOUT', '28P01', '3D000', 'ENOENT'].includes(err.code);
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
      connection_type: process.env.NODE_ENV === 'production' ? 'cloud_sql_socket' : 'tcp',
      config: {
        user: config.user,
        database: config.database,
        host: config.host,
        connection_string: process.env.INSTANCE_CONNECTION_NAME ? 
          `postgresql://${config.user}:****@/cloudsql/${process.env.INSTANCE_CONNECTION_NAME}/${config.database}` :
          `postgresql://${config.user}:****@localhost/${config.database}`,
        socket_path: process.env.NODE_ENV === 'production' ? `/cloudsql/${process.env.INSTANCE_CONNECTION_NAME}` : null,
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