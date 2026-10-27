'use strict';

const jwt = require('jsonwebtoken');
const { getAppUrl } = require('./app-url');
const { EMAIL_TYPES, TYPE_LABELS } = require('./email-types');

const JWT_SECRET = process.env.JWT_SECRET || 'REDACTED';

function normalizeType(type) {
  return type === 'all' || EMAIL_TYPES[type] ? type : 'all';
}

/** Token binds the user and preference type so query-string edits cannot widen scope. */
function signUnsubscribeToken(userId, type = 'all') {
  return jwt.sign({ uid: userId, type: normalizeType(type), aud: 'email-unsub' }, JWT_SECRET, { expiresIn: '365d' });
}

function verifyUnsubscribeToken(token, expectedType) {
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    if (!payload?.uid || payload.aud !== 'email-unsub') return null;
    const tokenType = normalizeType(payload.type);
    if (!payload.type || (expectedType && tokenType !== expectedType)) return null;
    return { userId: payload.uid, type: tokenType };
  } catch (_) {
    return null;
  }
}

function buildUnsubscribeUrl(userId, type = 'all') {
  const safeType = normalizeType(type);
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
  normalizeType,
  buildUnsubscribeUrl,
  buildManagePrefsUrl,
  typeLabel,
};
