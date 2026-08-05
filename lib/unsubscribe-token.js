'use strict';

const jwt = require('jsonwebtoken');
const { getAppUrl } = require('./app-url');
const { EMAIL_TYPES, TYPE_LABELS, isRequiredEmailType } = require('./email-types');

const JWT_SECRET = process.env.JWT_SECRET || 'REDACTED';

function normalizeUnsubscribeType(type) {
  if (type === 'all') return 'all';
  if (EMAIL_TYPES[type] && !isRequiredEmailType(type)) return type;
  return null;
}

/** Token binds the user and preference type so query-string tampering cannot broaden an opt-out. */
function signUnsubscribeToken(userId, type = 'all') {
  const safeType = normalizeUnsubscribeType(type) || 'all';
  return jwt.sign({ uid: userId, type: safeType, aud: 'email-unsub' }, JWT_SECRET, { expiresIn: '365d' });
}

function verifyUnsubscribeToken(token) {
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    if (!payload?.uid) return null;
    if (payload.aud && payload.aud !== 'email-unsub') return null;
    const type = normalizeUnsubscribeType(payload.type);
    if (!type) return null;
    return { userId: payload.uid, type };
  } catch (_) {
    return null;
  }
}

function buildUnsubscribeUrl(userId, type = 'all') {
  const base = getAppUrl();
  const safeType = normalizeUnsubscribeType(type) || 'all';
  const token = signUnsubscribeToken(userId, safeType);
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
