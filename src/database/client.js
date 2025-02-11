import pg from 'pg';
import { SecretManagerServiceClient } from '@google-cloud/secret-manager';
import { logger } from '../utils/logger.js';

const { Pool } = pg;
const secretManager = new SecretManagerServiceClient();

async function getSecret(name) {
  const projectId = process.env.GOOGLE_CLOUD_PROJECT;
  const [version] = await secretManager.accessSecretVersion({
    name: `projects/${projectId}/secrets/${name}/versions/latest`,
  });
  return version.payload.data.toString();
}

let pool;

export const db = {
  query: async (text, params) => {
    if (!pool) {
      const [dbName, dbUser, dbPassword] = await Promise.all([
        getSecret('notification-worker-db-name'),
        getSecret('notification-worker-db-user'),
        getSecret('notification-worker-db-password'),
      ]);

      pool = new Pool({
        user: dbUser,
        password: dbPassword,
        database: dbName,
        host: process.env.NODE_ENV === 'production'
          ? `/cloudsql/${process.env.INSTANCE_CONNECTION_NAME}`
          : 'localhost',
      });

      pool.on('error', (err) => {
        logger.error('Unexpected database error', { error: err });
      });
    }
    return pool.query(text, params);
  },
  end: async () => {
    if (pool) {
      await pool.end();
      pool = null;
    }
  },
};