'use strict';

const pool = require('./index');
const {
  DEFAULT_PREFS,
  PREF_COLUMNS,
  OPTIONAL_BOOL_COLUMNS,
  rowToPrefs,
  sanitizePreferencePatch,
} = require('../lib/notification-prefs-policy');

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
  const sanitizedPatch = sanitizePreferencePatch(patch);
  for (const col of PREF_COLUMNS) {
    if (sanitizedPatch[col] !== undefined) {
      sets.push(`${col} = $${i++}`);
      vals.push(sanitizedPatch[col]);
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
  sanitizePreferencePatch,
};
