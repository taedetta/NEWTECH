'use strict';

const jwt = require('jsonwebtoken');
const { getAppUrl } = require('./app-url');
const { EMAIL_TYPES, TYPE_LABELS } = require('./email-types');

const JWT_SECRET = process.env.JWT_SECRET || 'REDACTED';

function normalizeType(type) {
  if (type === 'all') return 'all';
  return EMAIL_TYPES[type] ? type : null;
}

/** Token binds both the user and the exact preference type it may change. */
function signUnsubscribeToken(userId, type = 'all') {
  const safeType = normalizeType(type) || 'all';
  return jwt.sign({ uid: userId, type: safeType, aud: 'email-unsub' }, JWT_SECRET, { expiresIn: '365d' });
}

function verifyUnsubscribeToken(token) {
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    if (!payload?.uid || payload.aud !== 'email-unsub' || !normalizeType(payload.type)) return null;
    return { userId: payload.uid, type: payload.type };
  } catch (_) {
    return null;
  }
}

function buildUnsubscribeUrl(userId, type = 'all') {
  const safeType = normalizeType(type) || 'all';
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
  normalizeType,
  signUnsubscribeToken,
  verifyUnsubscribeToken,
  buildUnsubscribeUrl,
  buildManagePrefsUrl,
  typeLabel,
};
