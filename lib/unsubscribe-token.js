'use strict';

const jwt = require('jsonwebtoken');
const { getAppUrl } = require('./app-url');
const { TYPE_LABELS, isUnsubscribableEmailType } = require('./email-types');

const JWT_SECRET = process.env.JWT_SECRET || 'REDACTED';

function normalizeUnsubscribeType(type) {
  if (type === null || type === undefined) return null;
  const normalized = String(type).trim();
  return isUnsubscribableEmailType(normalized) ? normalized : null;
}

/** Token binds the user and email type so query-string edits cannot widen opt-outs. */
function signUnsubscribeToken(userId, type = 'all') {
  const safeType = normalizeUnsubscribeType(type);
  if (!safeType) return null;
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

function buildUnsubscribeUrl(userId, type = 'all') {
  const safeType = normalizeUnsubscribeType(type);
  if (!safeType) return buildManagePrefsUrl();
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
};
