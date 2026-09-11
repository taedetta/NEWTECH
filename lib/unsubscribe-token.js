'use strict';

const jwt = require('jsonwebtoken');
const { getAppUrl } = require('./app-url');
const { EMAIL_TYPES, TYPE_LABELS, isRequiredEmailType } = require('./email-types');

const JWT_SECRET = process.env.JWT_SECRET || 'REDACTED';

function normalizeUnsubscribeType(type = 'all') {
  const value = String(type || 'all').trim();
  if (value === 'all') return 'all';
  if (EMAIL_TYPES[value] && !isRequiredEmailType(value)) return value;
  return 'all';
}

function signUnsubscribeToken(userId, type = 'all') {
  const emailType = normalizeUnsubscribeType(type);
  return jwt.sign({ uid: userId, typ: emailType, aud: 'email-unsub' }, JWT_SECRET, { expiresIn: '365d' });
}

function verifyUnsubscribeToken(token) {
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    if (!payload?.uid || payload.aud !== 'email-unsub' || !payload.typ) return null;
    const emailType = normalizeUnsubscribeType(payload.typ);
    if (emailType !== payload.typ) return null;
    return { userId: payload.uid, type: emailType };
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
