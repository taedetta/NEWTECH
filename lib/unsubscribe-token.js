'use strict';

const jwt = require('jsonwebtoken');
const { getAppUrl } = require('./app-url');
const { EMAIL_TYPES, TYPE_LABELS, isRequiredEmailType } = require('./email-types');

const JWT_SECRET = process.env.JWT_SECRET || 'REDACTED';

function normalizeUnsubscribeType(type) {
  if (type === 'all') return 'all';
  if (EMAIL_TYPES[type] && !isRequiredEmailType(type)) return type;
  return 'all';
}

/** Token identifies the user and exact preference type it is allowed to mutate. */
function signUnsubscribeToken(userId, type = 'all') {
  const safeType = normalizeUnsubscribeType(type);
  return jwt.sign({ uid: userId, type: safeType, aud: 'email-unsub' }, JWT_SECRET, { expiresIn: '365d' });
}

function verifyUnsubscribeToken(token, expectedType = 'all') {
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const safeType = normalizeUnsubscribeType(expectedType);
    if (!payload?.uid || payload.aud !== 'email-unsub' || payload.type !== safeType) return null;
    return { userId: payload.uid, type: safeType };
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
