'use strict';

const webpush = require('web-push');
const pool = require('../db/index');

async function ensureVapidKeys() {
  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) return;

  try {
    const existing = await pool.query(
      `SELECT key, value FROM school_settings WHERE key IN ('vapid_public_key', 'vapid_private_key')`
    );
    const map = Object.fromEntries(existing.rows.map((r) => [r.key, r.value]));
    if (map.vapid_public_key && map.vapid_private_key) {
      process.env.VAPID_PUBLIC_KEY = map.vapid_public_key;
      process.env.VAPID_PRIVATE_KEY = map.vapid_private_key;
      return;
    }
  } catch (_) { /* table may not exist yet */ }

  const keys = webpush.generateVAPIDKeys();
  process.env.VAPID_PUBLIC_KEY = keys.publicKey;
  process.env.VAPID_PRIVATE_KEY = keys.privateKey;
  try {
    await pool.query(
      `INSERT INTO school_settings (key, value, updated_at) VALUES
         ('vapid_public_key', $1, NOW()),
         ('vapid_private_key', $2, NOW())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
      [keys.publicKey, keys.privateKey]
    );
    console.log('[push] Generated and stored VAPID keys in school_settings');
  } catch (err) {
    console.warn('[push] VAPID keys generated for this session only — set VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY in env');
  }
}

module.exports = { ensureVapidKeys };
