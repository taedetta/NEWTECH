/**
 * Pre-Flight Email Reminder Job
 *
 * Standalone CLI entry point — same logic runs hourly in-process via lib/preflight-reminders.js.
 * Usage: node jobs/reminder-email.js
 */
'use strict';

const { Pool } = require('pg');
const { runPreflightReminders } = require('../lib/preflight-reminders');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('localhost') ? false : { rejectUnauthorized: false },
  max: 3,
  idleTimeoutMillis: 15000,
});

runPreflightReminders(pool)
  .catch((err) => {
    console.error('[reminder-email] Fatal error:', err.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
