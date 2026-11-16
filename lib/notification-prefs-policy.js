'use strict';

const { REQUIRED_EMAIL_TYPES } = require('./email-types');

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

function rowToPrefs(row) {
  if (!row) return { ...DEFAULT_PREFS };
  const out = {};
  for (const col of PREF_COLUMNS) {
    out[col] = REQUIRED_EMAIL_TYPES.has(col)
      ? true
      : (row[col] !== undefined ? !!row[col] : DEFAULT_PREFS[col]);
  }
  return out;
}

function sanitizePreferencePatch(patch = {}) {
  const out = {};
  for (const col of PREF_COLUMNS) {
    if (REQUIRED_EMAIL_TYPES.has(col)) continue;
    if (patch[col] !== undefined) out[col] = !!patch[col];
  }
  return out;
}

module.exports = {
  DEFAULT_PREFS,
  PREF_COLUMNS,
  OPTIONAL_BOOL_COLUMNS,
  rowToPrefs,
  sanitizePreferencePatch,
};
