'use strict';

const jwt = require('jsonwebtoken');
const { getAppUrl } = require('./app-url');
const { EMAIL_TYPES, TYPE_LABELS, REQUIRED_EMAIL_TYPES } = require('./email-types');

const JWT_SECRET = process.env.JWT_SECRET || 'REDACTED';

/** Token identifies both the user and the exact preference being changed. */
function signUnsubscribeToken(userId, type = 'all') {
  const safeType = type === 'all' || EMAIL_TYPES[type] ? type : 'all';
  return jwt.sign({ uid: userId, type: safeType, aud: 'email-unsub' }, JWT_SECRET, { expiresIn: '365d' });
}

function verifyUnsubscribeToken(token) {
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    if (!payload?.uid || !payload?.type || payload.aud !== 'email-unsub') return null;
    if (payload.type !== 'all' && !EMAIL_TYPES[payload.type]) return null;
    return { userId: payload.uid, type: payload.type };
  } catch (_) {
    return null;
  }
}

function buildUnsubscribeUrl(userId, type = 'all') {
  const safeType = type === 'all' || EMAIL_TYPES[type] ? type : 'all';
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

function resolveUnsubscribeRequest(token, rawType) {
  const type = String(rawType || 'all').trim();
  if (!token) {
    return {
      ok: false,
      status: 400,
      title: 'Invalid link',
      message: 'This unsubscribe link is missing required information. Sign in and open My Account to manage email preferences.',
    };
  }

  const verified = verifyUnsubscribeToken(token);
  if (!verified) {
    return {
      ok: false,
      status: 400,
      title: 'Link expired or invalid',
      message: 'This unsubscribe link is no longer valid. Sign in and open My Account to manage your email preferences.',
    };
  }

  if (type !== 'all' && (!EMAIL_TYPES[type] || REQUIRED_EMAIL_TYPES.has(type))) {
    return {
      ok: false,
      status: 400,
      title: 'Invalid preference type',
      message: 'This unsubscribe link is not valid. Sign in and open My Account to manage your email preferences.',
    };
  }

  if (verified.type !== type) {
    return {
      ok: false,
      status: 400,
      title: 'Invalid preference type',
      message: 'This unsubscribe link does not match the requested preference. Sign in and open My Account to manage your email preferences.',
    };
  }

  return { ok: true, userId: verified.userId, type };
}

module.exports = {
  signUnsubscribeToken,
  verifyUnsubscribeToken,
  buildUnsubscribeUrl,
  buildManagePrefsUrl,
  typeLabel,
  resolveUnsubscribeRequest,
};
