'use strict';

const jwt = require('jsonwebtoken');
const { getAppUrl } = require('./app-url');
const { OPTIONAL_EMAIL_TYPES, TYPE_LABELS } = require('./email-types');

const JWT_SECRET = process.env.JWT_SECRET || 'REDACTED';

function isUnsubscribableType(type) {
  return type === 'all' || !!OPTIONAL_EMAIL_TYPES[type];
}

function normalizeUnsubscribeType(type) {
  return isUnsubscribableType(type) ? type : 'all';
}

function signUnsubscribeToken(userId, type = 'all') {
  const safeType = normalizeUnsubscribeType(type);
  return jwt.sign({ uid: userId, type: safeType, aud: 'email-unsub' }, JWT_SECRET, { expiresIn: '365d' });
}

function verifyUnsubscribeToken(token) {
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    if (!payload?.uid) return null;
    if (payload.aud && payload.aud !== 'email-unsub') return null;
    const type = payload.type;
    if (!isUnsubscribableType(type)) return null;
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
  isUnsubscribableType,
  normalizeUnsubscribeType,
  typeLabel,
};
