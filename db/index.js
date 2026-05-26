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

const dbUrl = process.env.DATABASE_URL || '';
const isLocal = /localhost|127\.0\.0\.1/i.test(dbUrl);
const isRailwayInternal = /\.railway\.internal/i.test(dbUrl);
const pool = new Pool({
  connectionString: dbUrl,
  ssl: isLocal || isRailwayInternal ? false : { rejectUnauthorized: false },
  max: 15,
  connectionTimeoutMillis: 20000,
  idleTimeoutMillis: 30000,
});

// Retry initial connection — managed DB may still be starting
(async () => {
  for (let attempt = 1; attempt <= 10; attempt++) {
    try {
      await pool.query('SELECT 1');
      console.log('[db-pool] Database connection verified');
      return;
    } catch (err) {
      console.warn(`[db-pool] Connect attempt ${attempt}/10 failed:`, err.message);
      if (attempt === 10) {
        console.error('[db-pool] Could not connect to DATABASE_URL after 10 attempts');
      } else {
        await new Promise((r) => setTimeout(r, 3000));
      }
    }
  }
})();

pool.on('error', (err) => {
  console.error('[db-pool] Unexpected error on idle client:', err.message);
});

pool.on('connect', () => {
  console.log('[db-pool] New client connected');
});

module.exports = pool;
