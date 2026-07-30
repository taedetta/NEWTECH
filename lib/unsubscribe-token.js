'use strict';

const jwt = require('jsonwebtoken');
const { getAppUrl } = require('./app-url');
const { EMAIL_TYPES, TYPE_LABELS, isRequiredEmailType } = require('./email-types');

const JWT_SECRET = process.env.JWT_SECRET || 'REDACTED';

function normalizeUnsubscribeType(type) {
  return type === 'all' || (EMAIL_TYPES[type] && !isRequiredEmailType(type)) ? type : 'all';
}

/** Token identifies the user and the single authorized unsubscribe scope. */
function signUnsubscribeToken(userId, type = 'all') {
  return jwt.sign({ uid: userId, type: normalizeUnsubscribeType(type), aud: 'email-unsub' }, JWT_SECRET, { expiresIn: '365d' });
}

function verifyUnsubscribeToken(token) {
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    if (!payload?.uid || payload.aud !== 'email-unsub') return null;
    const type = normalizeUnsubscribeType(payload.type);
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
  buildUnsubscribeUrl,
  buildManagePrefsUrl,
  normalizeUnsubscribeType,
  typeLabel,
};
