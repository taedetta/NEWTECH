'use strict';

const express = require('express');
const { verifyUnsubscribeToken, typeLabel, buildManagePrefsUrl } = require('../lib/unsubscribe-token');
const { updatePrefs, ensureDefaultPrefs } = require('../db/notification-prefs');
const { REQUIRED_EMAIL_TYPES } = require('../lib/email-types');
const { getAppUrl } = require('../lib/app-url');

const router = express.Router();

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
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
    a.btn, button.btn { display: inline-block; background: #0EA5E9; color: #fff; text-decoration: none; padding: 12px 22px; border-radius: 7px; font-weight: 600; font-size: 0.9rem; border: 0; cursor: pointer; }
    button.danger { background: #DC2626; }
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

function invalidLink(res, title = 'Link expired or invalid') {
  return res.status(400).send(renderPage({
    ok: false,
    title,
    message: 'This unsubscribe link is no longer valid. Sign in and open My Account to manage your email preferences.',
  }));
}

router.get('/unsubscribe', async (req, res) => {
  try {
    const token = req.query.token;
    if (!token) {
      return res.status(400).send(renderPage({
        ok: false,
        title: 'Invalid link',
        message: 'This unsubscribe link is missing required information. Sign in and open My Account to manage email preferences.',
      }));
    }

    const verified = verifyUnsubscribeToken(token);
    if (!verified) {
      return invalidLink(res);
    }
    if (REQUIRED_EMAIL_TYPES.has(verified.type)) {
      return invalidLink(res, 'Cannot unsubscribe from required emails');
    }

    const label = typeLabel(verified.type);
    return res.send(renderPage({
      ok: true,
      title: 'Confirm unsubscribe',
      message: verified.type === 'all'
        ? 'Confirm that you want to stop optional email notifications from New Tech Aviation. Required account and security emails will still be sent.'
        : `Confirm that you want to unsubscribe from <strong>${label}</strong>. Other notification types are unchanged.`,
      actionHtml: `<form method="POST" action="/api/email/unsubscribe" style="margin:0 0 16px">
        <input type="hidden" name="token" value="${escapeHtml(token)}">
        <button class="btn danger" type="submit">Confirm unsubscribe</button>
      </form>`,
    }));
  } catch (err) {
    console.error('[email-unsubscribe] GET error:', err.message);
    res.status(500).send(renderPage({
      ok: false,
      title: 'Something went wrong',
      message: 'We could not process your unsubscribe request. Please try again or manage preferences in My Account.',
    }));
  }
});

router.post('/unsubscribe', express.urlencoded({ extended: false }), async (req, res) => {
  try {
    const token = req.body?.token || req.query.token;
    if (!token) {
      return res.status(400).send(renderPage({
        ok: false,
        title: 'Invalid link',
        message: 'This unsubscribe request is missing required information. Sign in and open My Account to manage email preferences.',
      }));
    }

    const verified = verifyUnsubscribeToken(token);
    if (!verified) {
      return invalidLink(res);
    }
    if (REQUIRED_EMAIL_TYPES.has(verified.type)) {
      return invalidLink(res, 'Cannot unsubscribe from required emails');
    }

    await ensureDefaultPrefs(verified.userId);

    if (verified.type === 'all') {
      await updatePrefs(verified.userId, { email_all_off: true });
    } else {
      await updatePrefs(verified.userId, { [verified.type]: false });
    }

    const label = typeLabel(verified.type);
    return res.send(renderPage({
      ok: true,
      title: 'Unsubscribed',
      message: verified.type === 'all'
        ? 'You will no longer receive optional email notifications from New Tech Aviation. Required account and security emails will still be sent.'
        : `You have been unsubscribed from <strong>${label}</strong>. Other notification types are unchanged. Sign in to review all settings in My Account.`,
    }));
  } catch (err) {
    console.error('[email-unsubscribe] POST error:', err.message);
    res.status(500).send(renderPage({
      ok: false,
      title: 'Something went wrong',
      message: 'We could not process your unsubscribe request. Please try again or manage preferences in My Account.',
    }));
  }
});

module.exports = router;
