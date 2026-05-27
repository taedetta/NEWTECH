'use strict';

const webpush = require('web-push');
const pool = require('../db/index');
const { isStaging } = require('./app-env');

let vapidConfigured = false;

function ensureVapid() {
  if (vapidConfigured) return !!process.env.VAPID_PUBLIC_KEY;
  const pub = process.env.VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT || 'mailto:admin@newtechaviation.com';
  if (!pub || !priv) {
    console.warn('[push] VAPID keys not set — push notifications disabled');
    return false;
  }
  webpush.setVapidDetails(subject, pub, priv);
  vapidConfigured = true;
  return true;
}

function getVapidPublicKey() {
  return process.env.VAPID_PUBLIC_KEY || null;
}

async function saveSubscription(userId, subscription, userAgent) {
  const { endpoint, keys } = subscription;
  if (!endpoint || !keys?.p256dh || !keys?.auth) {
    throw new Error('Invalid push subscription');
  }
  await pool.query(
    `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, user_agent)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (endpoint) DO UPDATE SET user_id = $1, p256dh = $3, auth = $4, user_agent = $5`,
    [userId, endpoint, keys.p256dh, keys.auth, userAgent || null]
  );
}

async function removeSubscription(userId, endpoint) {
  await pool.query(
    'DELETE FROM push_subscriptions WHERE user_id = $1 AND endpoint = $2',
    [userId, endpoint]
  );
}

async function logUserNotification(userId, { title, body, link, notification_type }) {
  try {
    await pool.query(
      `INSERT INTO user_notifications (user_id, title, body, link, notification_type)
       VALUES ($1, $2, $3, $4, $5)`,
      [userId, title, body || null, link || null, notification_type || null]
    );
  } catch (err) {
    console.error('[push] notification log error:', err.message);
  }
}

async function sendPushToUser(userId, payload) {
  const { title, body, link, tag, notification_type } = payload;
  await logUserNotification(userId, { title, body, link, notification_type });

  if (isStaging()) {
    console.log(`[push][staging] Skipped device push for user ${userId}: ${title}`);
    return { sent: 0, failed: 0, skipped: true };
  }

  if (!ensureVapid()) return { sent: 0, failed: 0 };

  const subs = await pool.query(
    'SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = $1',
    [userId]
  );
  if (!subs.rows.length) return { sent: 0, failed: 0 };

  const pushPayload = JSON.stringify({
    title,
    body: body || '',
    link: link || '/app',
    tag: tag || notification_type || 'nta',
  });

  let sent = 0;
  let failed = 0;
  for (const sub of subs.rows) {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        pushPayload
      );
      sent++;
    } catch (err) {
      failed++;
      if (err.statusCode === 404 || err.statusCode === 410) {
        await pool.query('DELETE FROM push_subscriptions WHERE id = $1', [sub.id]);
      }
      console.warn('[push] send failed:', err.statusCode || err.message);
    }
  }
  return { sent, failed };
}

async function notifyUsers(userIds, payload) {
  const unique = [...new Set(userIds.filter(Boolean))];
  const results = await Promise.allSettled(unique.map((id) => sendPushToUser(id, payload)));
  return results;
}

async function notifyRoleUsers(roles, payload) {
  const r = await pool.query(
    `SELECT id FROM users WHERE role = ANY($1) AND deleted_at IS NULL AND approval_status = 'approved'`,
    [roles]
  );
  return notifyUsers(r.rows.map((row) => row.id), payload);
}

module.exports = {
  getVapidPublicKey,
  saveSubscription,
  removeSubscription,
  sendPushToUser,
  notifyUsers,
  notifyRoleUsers,
  logUserNotification,
};
