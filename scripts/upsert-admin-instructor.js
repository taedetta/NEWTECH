'use strict';

const bcrypt = require('bcryptjs');
const { Pool } = require('pg');
const { upsertFullUserPermissions } = require('../lib/user-permissions-db');
const { loadDotEnv, requireEnv } = require('./qa-safety');

loadDotEnv();

const EMAIL = requireEnv('ADMIN_EMAIL', 'admin upsert');
const NAME = process.env.ADMIN_NAME || 'FlightSlate Admin';
const PASSWORD = requireEnv('ADMIN_PASSWORD', 'admin upsert');
const ROLE = process.env.ADMIN_ROLE || 'admin';

async function main() {
  if (process.env.ALLOW_ADMIN_UPSERT !== 'true') {
    throw new Error('Set ALLOW_ADMIN_UPSERT=true before creating or updating an admin account');
  }
  const poolConfig = { connectionString: requireEnv('DATABASE_URL', 'admin upsert') };
  if (process.env.DATABASE_URL && /render\.com|neon\.tech|dpg-/.test(process.env.DATABASE_URL)) {
    poolConfig.ssl = { rejectUnauthorized: false };
  }
  const pool = new Pool(poolConfig);
  try {
    const hash = await bcrypt.hash(PASSWORD, 12);
    const existing = await pool.query(
      'SELECT id, role FROM users WHERE LOWER(email) = LOWER($1)',
      [EMAIL]
    );

    let userId;
    if (existing.rows.length > 0) {
      userId = existing.rows[0].id;
      await pool.query(
        `UPDATE users SET password_hash = $1, name = $2,
         role = $3, is_instructor = TRUE, approval_status = 'approved',
         deleted_at = NULL, updated_at = NOW()
         WHERE id = $4`,
        [hash, NAME, ROLE, userId]
      );
      console.log(`Updated account (${ROLE} + instructor): ${EMAIL}`);
    } else {
      const inserted = await pool.query(
        `INSERT INTO users (email, name, password_hash, role, is_instructor, approval_status)
         VALUES ($1, $2, $3, $4, TRUE, 'approved')
         RETURNING id`,
        [EMAIL.toLowerCase(), NAME, hash, ROLE]
      );
      userId = inserted.rows[0].id;
      console.log(`Created account (${ROLE} + instructor): ${EMAIL}`);
    }

    await upsertFullUserPermissions(pool, userId);

    const row = await pool.query(
      'SELECT id, email, name, role, is_instructor, approval_status FROM users WHERE id = $1',
      [userId]
    );
    console.log(JSON.stringify(row.rows[0], null, 2));
    console.log('Password updated from ADMIN_PASSWORD.');
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
