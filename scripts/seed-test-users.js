'use strict';

const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const { Pool } = require('pg');

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

const PASSWORD = process.env.TEST_USER_PASSWORD || 'TestPass123!';

const TEST_USERS = [
  { email: 'qa-admin@test.local', name: 'QA Admin', role: 'admin', is_instructor: true, perms: 'all' },
  { email: 'qa-instructor@test.local', name: 'QA Instructor', role: 'instructor', is_instructor: true, perms: 'instructor' },
  { email: 'qa-student@test.local', name: 'QA Student', role: 'student', is_instructor: false, perms: null },
  { email: 'qa-maintenance@test.local', name: 'QA Maintenance', role: 'maintenance', is_instructor: false, perms: null },
  { email: 'qa-renter@test.local', name: 'QA Renter', role: 'renter', is_instructor: false, perms: null },
];

async function upsertUser(pool, user, hash) {
  const existing = await pool.query(
    'SELECT id FROM users WHERE LOWER(email) = LOWER($1)',
    [user.email]
  );
  let id;
  if (existing.rows.length > 0) {
    id = existing.rows[0].id;
    await pool.query(
      `UPDATE users SET password_hash = $1, name = $2, role = $3, is_instructor = $4,
       approval_status = 'approved', deleted_at = NULL, updated_at = NOW() WHERE id = $5`,
      [hash, user.name, user.role, !!user.is_instructor, id]
    );
  } else {
    const ins = await pool.query(
      `INSERT INTO users (email, name, password_hash, role, is_instructor, approval_status)
       VALUES ($1, $2, $3, $4, $5, 'approved') RETURNING id`,
      [user.email.toLowerCase(), user.name, hash, user.role, !!user.is_instructor]
    );
    id = ins.rows[0].id;
  }

  if (user.perms === 'all') {
    await pool.query('DELETE FROM user_permissions WHERE user_id = $1', [id]);
    await pool.query(
      `INSERT INTO user_permissions (user_id, can_manage_aircraft, can_manage_instructors, can_manage_permissions, can_manage_students, can_edit_website)
       VALUES ($1, TRUE, TRUE, TRUE, TRUE, TRUE)`,
      [id]
    );
  } else if (user.perms === 'instructor') {
    await pool.query('DELETE FROM user_permissions WHERE user_id = $1', [id]);
    await pool.query(
      `INSERT INTO user_permissions (user_id, can_manage_aircraft, can_manage_instructors, can_manage_permissions, can_manage_students, can_edit_website)
       VALUES ($1, TRUE, FALSE, FALSE, TRUE, FALSE)`,
      [id]
    );
  }
  return id;
}

async function ensureSampleAircraft(pool) {
  const check = await pool.query('SELECT COUNT(*) AS cnt FROM aircraft');
  if (parseInt(check.rows[0].cnt, 10) > 0) return;
  await pool.query(
    `INSERT INTO aircraft (tail_number, make_model, type, status, hourly_rate, current_hobbs, current_tach)
     VALUES ('N123QA', 'Cessna 172S', 'single_engine', 'available', 165.00, 1000.0, 950.0)
     ON CONFLICT (tail_number) DO NOTHING`
  );
}

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const hash = await bcrypt.hash(PASSWORD, 12);
  try {
    for (const user of TEST_USERS) {
      const id = await upsertUser(pool, user, hash);
      console.log(`Seeded ${user.role}: ${user.email} (id=${id})`);
    }
    await ensureSampleAircraft(pool);
    console.log(`\nAll test users use password: ${PASSWORD}`);
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
