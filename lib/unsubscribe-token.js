'use strict';

const jwt = require('jsonwebtoken');
const { getAppUrl } = require('./app-url');
const { EMAIL_TYPES, TYPE_LABELS } = require('./email-types');

const JWT_SECRET = process.env.JWT_SECRET || 'REDACTED';

function normalizeUnsubscribeType(type) {
  return type === 'all' || EMAIL_TYPES[type] ? type : null;
}

function signUnsubscribeToken(userId, type = null) {
  const safeType = normalizeUnsubscribeType(type);
  const payload = { uid: userId, aud: 'email-unsub' };
  if (safeType) payload.type = safeType;
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '365d' });
}

function verifyUnsubscribeToken(token) {
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    if (!payload?.uid || payload.aud !== 'email-unsub') return null;
    if (payload.type !== undefined && !normalizeUnsubscribeType(payload.type)) return null;
    return { userId: payload.uid, type: payload.type || null };
  } catch (_) {
    return null;
  }
}

function buildUnsubscribeUrl(userId, type = 'all') {
  const base = getAppUrl();
  const safeType = type === 'all' || EMAIL_TYPES[type] ? type : 'all';
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
  normalizeUnsubscribeType,
  buildUnsubscribeUrl,
  buildManagePrefsUrl,
  typeLabel,
};
