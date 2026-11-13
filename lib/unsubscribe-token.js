'use strict';

const jwt = require('jsonwebtoken');
const { getAppUrl } = require('./app-url');
const { EMAIL_TYPES, TYPE_LABELS } = require('./email-types');

const JWT_SECRET = process.env.JWT_SECRET || 'REDACTED';

function normalizeUnsubscribeType(type = 'all') {
  return type === 'all' || EMAIL_TYPES[type] ? type : 'all';
}

/** Token binds both the user and unsubscribe type so query strings cannot be widened. */
function signUnsubscribeToken(userId, type = 'all') {
  const safeType = normalizeUnsubscribeType(type);
  return jwt.sign({ uid: userId, typ: safeType, aud: 'email-unsub' }, JWT_SECRET, { expiresIn: '365d' });
}

function verifyUnsubscribeToken(token, expectedType) {
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    if (!payload?.uid || payload.aud !== 'email-unsub' || !payload.typ) return null;
    if (payload.typ !== 'all' && !EMAIL_TYPES[payload.typ]) return null;
    if (expectedType && payload.typ !== expectedType) return null;
    return { userId: payload.uid, type: payload.typ };
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
  normalizeUnsubscribeType,
  signUnsubscribeToken,
  verifyUnsubscribeToken,
  buildUnsubscribeUrl,
  buildManagePrefsUrl,
  typeLabel,
};
