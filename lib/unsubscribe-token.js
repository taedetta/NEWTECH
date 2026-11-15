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

function signUnsubscribeToken(userId, type = 'all') {
  const safeType = normalizeUnsubscribeType(type) || 'all';
  return jwt.sign({ uid: userId, typ: safeType, aud: 'email-unsub' }, JWT_SECRET, { expiresIn: '365d' });
}

function verifyUnsubscribeToken(token, expectedType) {
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const safeType = normalizeUnsubscribeType(payload?.typ);
    if (!payload?.uid || payload.aud !== 'email-unsub' || !safeType) return null;
    if (expectedType !== undefined && safeType !== expectedType) return null;
    return { userId: payload.uid, type: safeType };
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
  buildUnsubscribeUrl,
  buildManagePrefsUrl,
  typeLabel,
  normalizeUnsubscribeType,
};
