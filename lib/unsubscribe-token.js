'use strict';

const jwt = require('jsonwebtoken');
const { getAppUrl } = require('./app-url');
const { EMAIL_TYPES, REQUIRED_EMAIL_TYPES, TYPE_LABELS } = require('./email-types');

const JWT_SECRET = process.env.JWT_SECRET || 'REDACTED';
const REQUIRED_EMAIL_TYPE_SET = new Set(REQUIRED_EMAIL_TYPES);

function isUnsubscribableType(type) {
  return type === 'all' || (EMAIL_TYPES[type] && !REQUIRED_EMAIL_TYPE_SET.has(type));
}

function signUnsubscribeToken(userId, type = 'all') {
  if (!isUnsubscribableType(type)) return null;
  return jwt.sign({ uid: userId, type, aud: 'email-unsub' }, JWT_SECRET, { expiresIn: '365d' });
}

function verifyUnsubscribeToken(token) {
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    if (!payload?.uid) return null;
    const type = payload.type || null;
    if (!isUnsubscribableType(type)) return null;
    if (payload.aud && payload.aud !== 'email-unsub') return null;
    return { userId: payload.uid, type };
  } catch (_) {
    return null;
  }
}

function buildUnsubscribeUrl(userId, type = 'all') {
  const safeType = isUnsubscribableType(type) ? type : 'all';
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
  typeLabel,
};
