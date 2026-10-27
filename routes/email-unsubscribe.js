'use strict';

const express = require('express');
const { verifyUnsubscribeToken, typeLabel, buildManagePrefsUrl } = require('../lib/unsubscribe-token');
const { updatePrefs, ensureDefaultPrefs } = require('../db/notification-prefs');
const { EMAIL_TYPES, REQUIRED_EMAIL_TYPES } = require('../lib/email-types');
const { getAppUrl } = require('../lib/app-url');

const router = express.Router();
const REQUIRED_EMAIL_TYPE_SET = new Set(REQUIRED_EMAIL_TYPES);

function escHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderPage({ title, message, ok, actionHtml = '' }) {
  const color = ok ? '#059669' : '#DC2626';
  const manageUrl = buildManagePrefsUrl();
  const appUrl = `${getAppUrl()}/app`;
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title} — New Tech Aviation</title>
  <style>
    body { font-family: 'Helvetica Neue', Arial, sans-serif; background: #f4f6f9; margin: 0; padding: 40px 16px; color: #1a202c; }
    .card { max-width: 520px; margin: 0 auto; background: #fff; border-radius: 10px; padding: 32px; box-shadow: 0 2px 12px rgba(0,0,0,0.08); text-align: center; }
    h1 { font-size: 1.35rem; margin: 0 0 12px; color: ${color}; }
    p { font-size: 0.95rem; line-height: 1.6; color: #475569; margin: 0 0 20px; }
    a.btn, button.btn { display: inline-block; border: 0; background: #0EA5E9; color: #fff; text-decoration: none; padding: 12px 22px; border-radius: 7px; font-weight: 600; font-size: 0.9rem; cursor: pointer; }
    a.link { color: #0EA5E9; text-decoration: none; font-size: 0.88rem; }
  </style>
</head>
<body>
  <div class="card">
    <h1>${title}</h1>
    <p>${message}</p>
    ${actionHtml}
    <a class="btn" href="${manageUrl}">Manage email preferences</a>
    <p style="margin-top:20px"><a class="link" href="${appUrl}">Open FlightSlate</a></p>
  </div>
</body>
</html>`;
}

function validateUnsubscribeRequest(req, res) {
  const token = req.query.token;
  const rawType = String(req.query.type || 'all').trim();
  if (!token) {
    res.status(400).send(renderPage({
      ok: false,
      title: 'Invalid link',
      message: 'This unsubscribe link is missing required information. Sign in and open My Account to manage email preferences.',
    }));
    return null;
  }

  if (rawType !== 'all' && (!EMAIL_TYPES[rawType] || REQUIRED_EMAIL_TYPE_SET.has(rawType))) {
    res.status(400).send(renderPage({
      ok: false,
      title: 'Invalid preference type',
      message: 'This unsubscribe link is not valid. Sign in and open My Account to manage your email preferences.',
    }));
    return null;
  }

  const verified = verifyUnsubscribeToken(token, rawType);
  if (!verified) {
    res.status(400).send(renderPage({
      ok: false,
      title: 'Link expired or invalid',
      message: 'This unsubscribe link is no longer valid. Sign in and open My Account to manage your email preferences.',
    }));
    return null;
  }

  return { token, type: rawType, userId: verified.userId };
}

router.get('/unsubscribe', (req, res) => {
  const valid = validateUnsubscribeRequest(req, res);
  if (!valid) return;

  const label = typeLabel(valid.type);
  const action = `/api/email/unsubscribe?token=${encodeURIComponent(valid.token)}&type=${encodeURIComponent(valid.type)}`;
  res.send(renderPage({
    ok: true,
    title: 'Confirm unsubscribe',
    message: valid.type === 'all'
      ? 'Confirm that you want to turn off optional email notifications from New Tech Aviation. Required account and security emails will still be sent.'
      : `Confirm that you want to unsubscribe from <strong>${escHtml(label)}</strong>. Other notification types are unchanged.`,
    actionHtml: `<form method="POST" action="${escHtml(action)}" style="margin:0 0 12px;"><button class="btn" type="submit">Confirm unsubscribe</button></form>`,
  }));
});

router.post('/unsubscribe', async (req, res) => {
  try {
    const valid = validateUnsubscribeRequest(req, res);
    if (!valid) return;

    await ensureDefaultPrefs(valid.userId);

    if (valid.type === 'all') {
      await updatePrefs(valid.userId, { email_all_off: true });
    } else {
      await updatePrefs(valid.userId, { [valid.type]: false });
    }

    const label = typeLabel(valid.type);
    return res.send(renderPage({
      ok: true,
      title: 'Unsubscribed',
      message: valid.type === 'all'
        ? 'You will no longer receive optional email notifications from New Tech Aviation. Required account and security emails will still be sent.'
        : `You have been unsubscribed from <strong>${label}</strong>. Other notification types are unchanged. Sign in to review all settings in My Account.`,
    }));
  } catch (err) {
    console.error('[email-unsubscribe] error:', err.message);
    res.status(500).send(renderPage({
      ok: false,
      title: 'Something went wrong',
      message: 'We could not process your unsubscribe request. Please try again or manage preferences in My Account.',
    }));
  }
});

module.exports = router;
