'use strict';

const jwt = require('jsonwebtoken');
const { getAppUrl } = require('./app-url');
const { EMAIL_TYPES, TYPE_LABELS } = require('./email-types');

const JWT_SECRET = process.env.JWT_SECRET || 'REDACTED';

function validUnsubscribeType(type) {
  return type === 'all' || !!EMAIL_TYPES[type];
}

function signUnsubscribeToken(userId, type = 'all') {
  const safeType = validUnsubscribeType(type) ? type : 'all';
  return jwt.sign({ uid: userId, typ: safeType, aud: 'email-unsub' }, JWT_SECRET, { expiresIn: '365d' });
}

function verifyUnsubscribeToken(token) {
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    if (!payload?.uid || payload.aud !== 'email-unsub') return null;
    return { userId: payload.uid, type: payload.typ || null };
  } catch (_) {
    return null;
  }
}

function buildUnsubscribeUrl(userId, type = 'all') {
  const base = getAppUrl();
  const safeType = validUnsubscribeType(type) ? type : 'all';
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
  validUnsubscribeType,
};
