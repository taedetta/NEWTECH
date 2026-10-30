'use strict';

const jwt = require('jsonwebtoken');
const { getAppUrl } = require('./app-url');
const { TYPE_LABELS, OPTIONAL_EMAIL_TYPES } = require('./email-types');

const JWT_SECRET = process.env.JWT_SECRET || 'REDACTED';

function normalizeUnsubscribeType(type) {
  if (type === 'all') return 'all';
  return OPTIONAL_EMAIL_TYPES.has(type) ? type : null;
}

/** Token identifies both the user and the preference type it is allowed to change. */
function signUnsubscribeToken(userId, type = 'all') {
  const safeType = normalizeUnsubscribeType(type) || 'all';
  return jwt.sign({ uid: userId, typ: safeType, aud: 'email-unsub' }, JWT_SECRET, { expiresIn: '365d' });
}

function verifyUnsubscribeToken(token, expectedType) {
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const safeExpectedType = normalizeUnsubscribeType(expectedType);
    if (!payload?.uid || payload.aud !== 'email-unsub' || !payload.typ) return null;
    if (!safeExpectedType || payload.typ !== safeExpectedType) return null;
    return { userId: payload.uid, type: payload.typ };
  } catch (_) {
    return null;
  }
}

function buildUnsubscribeUrl(userId, type = 'all') {
  const safeType = normalizeUnsubscribeType(type) || 'all';
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
