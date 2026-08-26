'use strict';

const jwt = require('jsonwebtoken');
const { getAppUrl } = require('./app-url');
const { TYPE_LABELS, isUnsubscribableEmailType } = require('./email-types');

const JWT_SECRET = process.env.JWT_SECRET || 'REDACTED';

function normalizeUnsubscribeType(type) {
  if (type === undefined || type === null || type === '') return null;
  const normalized = String(type).trim();
  return isUnsubscribableEmailType(normalized) ? normalized : null;
}

/** Token binds both the user and the exact preference type it may mutate. */
function signUnsubscribeToken(userId, type = 'all') {
  const safeType = normalizeUnsubscribeType(type) || 'all';
  return jwt.sign({ uid: userId, type: safeType, aud: 'email-unsub' }, JWT_SECRET, { expiresIn: '365d' });
}

function verifyUnsubscribeToken(token) {
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    if (!payload?.uid || payload.aud !== 'email-unsub') return null;
    const type = normalizeUnsubscribeType(payload.type);
    if (!type) return null;
    return { userId: payload.uid, type };
  } catch (_) {
    return null;
  }
}

function verifyUnsubscribeRequest(token, requestedType) {
  const verified = verifyUnsubscribeToken(token);
  if (!verified) return null;
  const type = requestedType ? normalizeUnsubscribeType(requestedType) : verified.type;
  if (!type || type !== verified.type) return null;
  return verified;
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
  verifyUnsubscribeRequest,
  buildUnsubscribeUrl,
  buildManagePrefsUrl,
  typeLabel,
};
