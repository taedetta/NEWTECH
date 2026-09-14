'use strict';

const jwt = require('jsonwebtoken');
const { getAppUrl } = require('./app-url');
const { EMAIL_TYPES, REQUIRED_EMAIL_TYPES, TYPE_LABELS } = require('./email-types');

const JWT_SECRET = process.env.JWT_SECRET || 'REDACTED';

function normalizeType(type) {
  if (type === 'all') return type;
  return EMAIL_TYPES[type] && !REQUIRED_EMAIL_TYPES.has(type) ? type : null;
}

/** Token binds both the user and the exact unsubscribe scope. */
function signUnsubscribeToken(userId, type = 'all') {
  const safeType = normalizeType(type);
  if (!safeType) throw new Error('Invalid unsubscribe type');
  return jwt.sign({ uid: userId, type: safeType, aud: 'email-unsub' }, JWT_SECRET, { expiresIn: '365d' });
}

function verifyUnsubscribeToken(token, expectedType) {
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const tokenType = normalizeType(payload?.type);
    if (!payload?.uid || payload.aud !== 'email-unsub' || !tokenType) return null;
    if (expectedType && tokenType !== expectedType) return null;
    return { userId: payload.uid, type: tokenType };
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
  signUnsubscribeToken,
  verifyUnsubscribeToken,
  buildUnsubscribeUrl,
  buildManagePrefsUrl,
  typeLabel,
};
