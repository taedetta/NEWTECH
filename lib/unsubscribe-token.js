'use strict';

const jwt = require('jsonwebtoken');
const { getAppUrl } = require('./app-url');
const { TYPE_LABELS, isConfigurableEmailType } = require('./email-types');

const JWT_SECRET = process.env.JWT_SECRET || 'REDACTED';

function normalizeUnsubscribeType(type = 'all') {
  const value = String(type || 'all').trim();
  if (value === 'all') return value;
  return isConfigurableEmailType(value) ? value : null;
}

/** Token identifies the user and the exact preference target this link may change. */
function signUnsubscribeToken(userId, type = 'all') {
  const safeType = normalizeUnsubscribeType(type) || 'all';
  return jwt.sign({ uid: userId, typ: safeType, aud: 'email-unsub' }, JWT_SECRET, { expiresIn: '365d' });
}

function verifyUnsubscribeToken(token) {
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    if (!payload?.uid || payload.aud !== 'email-unsub') return null;
    const type = normalizeUnsubscribeType(payload.typ);
    if (!type) return null;
    return { userId: payload.uid, type };
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

function resolveUnsubscribeRequest(token, requestedType) {
  const verified = verifyUnsubscribeToken(token);
  if (!verified) return { error: 'invalid_token' };

  const requested = requestedType === undefined
    ? verified.type
    : String(requestedType || '').trim();
  if (!requested || requested !== verified.type) {
    return { error: 'type_mismatch' };
  }
  return verified;
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
  resolveUnsubscribeRequest,
  buildManagePrefsUrl,
  typeLabel,
};
