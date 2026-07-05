'use strict';

const jwt = require('jsonwebtoken');
const { getAppUrl } = require('./app-url');
const { EMAIL_TYPES, REQUIRED_EMAIL_TYPES, TYPE_LABELS } = require('./email-types');

const JWT_SECRET = process.env.JWT_SECRET || 'REDACTED';

function normalizeUnsubscribeType(type) {
  const safeType = type === 'all' || EMAIL_TYPES[type] ? type : 'all';
  return REQUIRED_EMAIL_TYPES.has(safeType) ? 'all' : safeType;
}

/** Token binds the user and exact preference target so URL query params cannot be retargeted. */
function signUnsubscribeToken(userId, type = 'all') {
  return jwt.sign({ uid: userId, type: normalizeUnsubscribeType(type), aud: 'email-unsub' }, JWT_SECRET, { expiresIn: '365d' });
}

function verifyUnsubscribeToken(token) {
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const type = normalizeUnsubscribeType(payload?.type);
    if (!payload?.uid || payload.aud !== 'email-unsub' || payload.type !== type) return null;
    return { userId: payload.uid, type };
  } catch (_) {
    return null;
  }
}

function buildUnsubscribeUrl(userId, type = 'all') {
  const safeType = normalizeUnsubscribeType(type);
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
  normalizeUnsubscribeType,
  buildUnsubscribeUrl,
  buildManagePrefsUrl,
  typeLabel,
};
