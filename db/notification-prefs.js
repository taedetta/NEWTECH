'use strict';

const pool = require('./index');

const DEFAULT_PREFS = {
  email_all_off: false,
  booking_confirmation: true,
  booking_cancelled: true,
  preflight_reminder: true,
  flight_completed: true,
  instructor_briefing: true,
  endorsement_expiry: true,
  maintenance_alert: true,
  password_reset: true,
  account_approved: true,
  account_rejected: true,
  signup_pending: true,
  account_invite: true,
  profile_change: true,
  welcome: true,
};

const PREF_COLUMNS = Object.keys(DEFAULT_PREFS);

const OPTIONAL_BOOL_COLUMNS = PREF_COLUMNS.filter((c) => c !== 'email_all_off');

let schemaPromise = null;

async function ensureEmailPrefsSchema(db = pool) {
  if (!schemaPromise) {
    schemaPromise = (async () => {
      await db.query(`
        CREATE TABLE IF NOT EXISTS user_email_preferences (
          user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
          email_all_off BOOLEAN NOT NULL DEFAULT FALSE,
          booking_confirmation BOOLEAN NOT NULL DEFAULT TRUE,
          booking_cancelled BOOLEAN NOT NULL DEFAULT TRUE,
          preflight_reminder BOOLEAN NOT NULL DEFAULT TRUE,
          flight_completed BOOLEAN NOT NULL DEFAULT TRUE,
          instructor_briefing BOOLEAN NOT NULL DEFAULT TRUE,
          endorsement_expiry BOOLEAN NOT NULL DEFAULT TRUE,
          maintenance_alert BOOLEAN NOT NULL DEFAULT TRUE,
          password_reset BOOLEAN NOT NULL DEFAULT TRUE,
          account_approved BOOLEAN NOT NULL DEFAULT TRUE,
          account_rejected BOOLEAN NOT NULL DEFAULT TRUE,
          signup_pending BOOLEAN NOT NULL DEFAULT TRUE,
          account_invite BOOLEAN NOT NULL DEFAULT TRUE,
          profile_change BOOLEAN NOT NULL DEFAULT TRUE,
          welcome BOOLEAN NOT NULL DEFAULT TRUE,
          updated_at TIMESTAMPTZ DEFAULT NOW()
        );
      `);
      for (const col of OPTIONAL_BOOL_COLUMNS) {
        await db.query(
          `ALTER TABLE user_email_preferences ADD COLUMN IF NOT EXISTS ${col} BOOLEAN NOT NULL DEFAULT TRUE`
        );
      }
    })().catch((err) => {
      schemaPromise = null;
      throw err;
    });
  }
  return schemaPromise;
}

function rowToPrefs(row) {
  if (!row) return { ...DEFAULT_PREFS };
  const out = {};
  for (const col of PREF_COLUMNS) {
    out[col] = row[col] !== undefined ? !!row[col] : DEFAULT_PREFS[col];
  }
  return out;
}

async function ensureDefaultPrefs(userId, db = pool) {
  await ensureEmailPrefsSchema(db);
  await db.query(
    `INSERT INTO user_email_preferences (user_id)
     VALUES ($1)
     ON CONFLICT (user_id) DO NOTHING`,
    [userId]
  );
}

async function getPrefs(userId, db = pool) {
  await ensureDefaultPrefs(userId, db);
  const result = await db.query(
    'SELECT * FROM user_email_preferences WHERE user_id = $1',
    [userId]
  );
  return rowToPrefs(result.rows[0]);
}

async function updatePrefs(userId, patch, db = pool) {
  await ensureDefaultPrefs(userId, db);
  const sets = [];
  const vals = [];
  let i = 1;
  for (const col of PREF_COLUMNS) {
    if (patch[col] !== undefined) {
      sets.push(`${col} = $${i++}`);
      vals.push(!!patch[col]);
    }
  }
  if (sets.length === 0) return getPrefs(userId, db);
  sets.push('updated_at = NOW()');
  vals.push(userId);
  await db.query(
    `UPDATE user_email_preferences SET ${sets.join(', ')} WHERE user_id = $${i}`,
    vals
  );
  return getPrefs(userId, db);
}

module.exports = {
  DEFAULT_PREFS,
  PREF_COLUMNS,
  ensureEmailPrefsSchema,
  ensureDefaultPrefs,
  getPrefs,
  updatePrefs,
  rowToPrefs,
};
