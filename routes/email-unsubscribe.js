'use strict';

const express = require('express');
const { verifyUnsubscribeToken, typeLabel, buildManagePrefsUrl, isUnsubscribableType } = require('../lib/unsubscribe-token');
const { updatePrefs, ensureDefaultPrefs } = require('../db/notification-prefs');
const { getAppUrl } = require('../lib/app-url');

const router = express.Router();

function escapeAttr(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function renderPage({ title, message, ok, confirm }) {
  const color = ok ? '#059669' : '#DC2626';
  const manageUrl = buildManagePrefsUrl();
  const appUrl = `${getAppUrl()}/app`;
  const confirmForm = confirm ? `
    <form method="POST" action="/api/email/unsubscribe" style="margin:0 0 20px;">
      <input type="hidden" name="token" value="${escapeAttr(confirm.token)}">
      <input type="hidden" name="type" value="${escapeAttr(confirm.type)}">
      <button class="btn" type="submit">Confirm unsubscribe</button>
    </form>` : '';
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
    a.btn { display: inline-block; background: #0EA5E9; color: #fff; text-decoration: none; padding: 12px 22px; border-radius: 7px; font-weight: 600; font-size: 0.9rem; }
    button.btn { border: 0; cursor: pointer; display: inline-block; background: #0EA5E9; color: #fff; padding: 12px 22px; border-radius: 7px; font-weight: 600; font-size: 0.9rem; }
    a.link { color: #0EA5E9; text-decoration: none; font-size: 0.88rem; }
  </style>
</head>
<body>
  <div class="card">
    <h1>${title}</h1>
    <p>${message}</p>
    ${confirmForm}
    <a class="btn" href="${manageUrl}">Manage email preferences</a>
    <p style="margin-top:20px"><a class="link" href="${appUrl}">Open FlightSlate</a></p>
  </div>
</body>
</html>`;
}

function readUnsubscribeRequest(req) {
  const token = req.query.token || req.body?.token;
  const rawType = String(req.query.type || req.body?.type || 'all').trim();
  return { token, rawType };
}

function renderInvalid(res, status, title, message) {
  return res.status(status).send(renderPage({ ok: false, title, message }));
}

router.get('/unsubscribe', async (req, res) => {
  try {
    const { token, rawType } = readUnsubscribeRequest(req);
    if (!token) {
      return renderInvalid(res, 400, 'Invalid link', 'This unsubscribe link is missing required information. Sign in and open My Account to manage email preferences.');
    }

    if (!isUnsubscribableType(rawType)) {
      return renderInvalid(res, 400, 'Invalid preference type', 'This unsubscribe link is not valid. Sign in and open My Account to manage your email preferences.');
    }

    const verified = verifyUnsubscribeToken(token, rawType);
    if (!verified) {
      return renderInvalid(res, 400, 'Link expired or invalid', 'This unsubscribe link is no longer valid. Sign in and open My Account to manage your email preferences.');
    }

    const label = typeLabel(rawType);
    return res.send(renderPage({
      ok: true,
      title: 'Confirm unsubscribe',
      message: rawType === 'all'
        ? 'Please confirm that you want to unsubscribe from optional email notifications from New Tech Aviation.'
        : `Please confirm that you want to unsubscribe from <strong>${label}</strong>. Other notification types are unchanged.`,
      confirm: { token, type: rawType },
    }));
  } catch (err) {
    console.error('[email-unsubscribe] confirm error:', err.message);
    res.status(500).send(renderPage({
      ok: false,
      title: 'Something went wrong',
      message: 'We could not process your unsubscribe request. Please try again or manage preferences in My Account.',
    }));
  }
});

router.post('/unsubscribe', express.urlencoded({ extended: false }), async (req, res) => {
  try {
    const { token, rawType } = readUnsubscribeRequest(req);
    if (!token) {
      return renderInvalid(res, 400, 'Invalid link', 'This unsubscribe link is missing required information. Sign in and open My Account to manage email preferences.');
    }
    if (!isUnsubscribableType(rawType)) {
      return renderInvalid(res, 400, 'Invalid preference type', 'This unsubscribe link is not valid. Sign in and open My Account to manage your email preferences.');
    }

    const verified = verifyUnsubscribeToken(token, rawType);
    if (!verified) {
      return renderInvalid(res, 400, 'Link expired or invalid', 'This unsubscribe link is no longer valid. Sign in and open My Account to manage your email preferences.');
    }

    await ensureDefaultPrefs(verified.userId);

    if (rawType === 'all') {
      await updatePrefs(verified.userId, { email_all_off: true });
    } else {
      await updatePrefs(verified.userId, { [rawType]: false });
    }

    const label = typeLabel(rawType);
    return res.send(renderPage({
      ok: true,
      title: 'Unsubscribed',
      message: rawType === 'all'
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
