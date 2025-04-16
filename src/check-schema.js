import { database } from './services/database.js';
import { logger } from './utils/logger.js';

async function checkSchema() {
  try {
    const result = await database.query('SELECT column_name FROM information_schema.columns WHERE table_name = $1 ORDER BY ordinal_position', ['users']);
    console.log('Users table columns:');
    console.log(result.rows);
    process.exit(0);
  } catch (error) {
    console.error('Error checking schema:', error);
    process.exit(1);
  }
}

checkSchema(); 