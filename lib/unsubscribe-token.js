'use strict';

const jwt = require('jsonwebtoken');
const { getAppUrl } = require('./app-url');
const { TYPE_LABELS, isConfigurableEmailType } = require('./email-types');

const JWT_SECRET = process.env.JWT_SECRET || 'REDACTED';

function normalizeUnsubscribeType(type, { defaultToAll = false } = {}) {
  if (type == null || type === '') return defaultToAll ? 'all' : null;
  const value = String(type).trim();
  if (value === 'all') return 'all';
  return isConfigurableEmailType(value) ? value : null;
}

/** Token binds the user and preference type; query params are display-only. */
function signUnsubscribeToken(userId, type = 'all') {
  const safeType = normalizeUnsubscribeType(type, { defaultToAll: true }) || 'all';
  return jwt.sign({ uid: userId, type: safeType, aud: 'email-unsub' }, JWT_SECRET, { expiresIn: '365d' });
}

function verifyUnsubscribeToken(token) {
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const safeType = normalizeUnsubscribeType(payload?.type);
    if (!payload?.uid || payload.aud !== 'email-unsub' || !safeType) return null;
    return { userId: payload.uid, type: safeType };
  } catch (_) {
    return null;
  }
}

function buildUnsubscribeUrl(userId, type = 'all') {
  const safeType = normalizeUnsubscribeType(type, { defaultToAll: true }) || 'all';
  const token = signUnsubscribeToken(userId, safeType);
  const base = getAppUrl();
  return `${base}/api/email/unsubscribe?token=${encodeURIComponent(token)}&type=${encodeURIComponent(safeType)}`;
}

function buildManagePrefsUrl() {
  return `${getAppUrl()}/app#account-settings`;
}

function typeLabel(type) {
  if (type === 'all') return 'all email notifications';
  return TYPE_LABELS[type] || type;
}

module.exports = {
  signUnsubscribeToken,
  verifyUnsubscribeToken,
  buildUnsubscribeUrl,
  buildManagePrefsUrl,
  typeLabel,
  normalizeUnsubscribeType,
};
