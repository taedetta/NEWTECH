/**
 * Shared database pool — single source of truth for all DB connections.
 * No other file may construct a new Pool(). Import this instead.
 *
 * For source-tag isolation: use source-wrapper.js for SELECT/INSERT/UPDATE/DELETE operations.
 * It automatically injects APP_ENV-based source filtering and tagging.
 */
const { Pool } = require('pg');

if (!process.env.DATABASE_URL) {
  console.error('ERROR: DATABASE_URL environment variable is required');
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('localhost') ? false : { rejectUnauthorized: false },
  max: 15,
  connectionTimeoutMillis: 10000,
  idleTimeoutMillis: 30000,
});

pool.on('error', (err) => {
  console.error('[db-pool] Unexpected error on idle client:', err.message);
});

pool.on('connect', () => {
  console.log('[db-pool] New client connected');
});

module.exports = pool;
