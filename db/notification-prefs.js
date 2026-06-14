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

function rowToPrefs(row) {
  if (!row) return { ...DEFAULT_PREFS };
  const out = {};
  for (const col of PREF_COLUMNS) {
    out[col] = row[col] !== undefined ? !!row[col] : DEFAULT_PREFS[col];
  }
  return out;
}

async function ensureDefaultPrefs(userId, db = pool) {
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
  ensureDefaultPrefs,
  getPrefs,
  updatePrefs,
  rowToPrefs,
};
