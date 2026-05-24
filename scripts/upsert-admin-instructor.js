'use strict';

const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const { Pool } = require('pg');

// Load .env for local development (same as server.js)
try {
  const envPath = path.join(__dirname, '..', '.env');
  if (fs.existsSync(envPath)) {
    fs.readFileSync(envPath, 'utf8').split(/\r?\n/).forEach((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) return;
      const eq = trimmed.indexOf('=');
      if (eq === -1) return;
      const key = trimmed.slice(0, eq).trim();
      const val = trimmed.slice(eq + 1).trim();
      if (key && process.env[key] === undefined) process.env[key] = val;
    });
  }
} catch { /* ignore */ }

const EMAIL = process.env.ADMIN_EMAIL || 'evaughntaemw@gmail.com';
const NAME = process.env.ADMIN_NAME || 'Evaughntae White';
const PASSWORD = process.env.ADMIN_PASSWORD || process.env.OWNER_PASSWORD || 'NewTech2026!';
const ROLE = process.env.ADMIN_ROLE || 'admin';

async function main() {
  const poolConfig = { connectionString: process.env.DATABASE_URL };
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

    await pool.query(
      `INSERT INTO user_permissions (user_id, can_manage_aircraft, can_manage_instructors, can_manage_permissions, can_manage_students, can_edit_website)
       VALUES ($1, TRUE, TRUE, TRUE, TRUE, TRUE)
       ON CONFLICT (user_id) DO UPDATE SET
         can_manage_aircraft = TRUE,
         can_manage_instructors = TRUE,
         can_manage_permissions = TRUE,
         can_manage_students = TRUE,
         can_edit_website = TRUE`,
      [userId]
    );

    const row = await pool.query(
      'SELECT id, email, name, role, is_instructor, approval_status FROM users WHERE id = $1',
      [userId]
    );
    console.log(JSON.stringify(row.rows[0], null, 2));
    console.log(`Password: ${PASSWORD}`);
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
