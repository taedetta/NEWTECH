'use strict';

const express = require('express');
const { resolveUnsubscribeRequest, typeLabel, buildManagePrefsUrl } = require('../lib/unsubscribe-token');
const { updatePrefs, ensureDefaultPrefs } = require('../db/notification-prefs');
const { getAppUrl } = require('../lib/app-url');

const router = express.Router();

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderPage({ title, message, ok, confirm }) {
  const color = ok ? '#059669' : '#DC2626';
  const manageUrl = buildManagePrefsUrl();
  const appUrl = `${getAppUrl()}/app`;
  const confirmForm = confirm ? `
    <form method="POST" action="/api/email/unsubscribe" style="margin: 0 0 20px;">
      <input type="hidden" name="token" value="${escapeHtml(confirm.token)}">
      <input type="hidden" name="type" value="${escapeHtml(confirm.type)}">
      <button type="submit" style="background:#DC2626;color:#fff;border:0;border-radius:7px;padding:12px 22px;font-weight:600;font-size:0.9rem;cursor:pointer;">
        Confirm unsubscribe
      </button>
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

function successMessage(type) {
  const label = typeLabel(type);
  return type === 'all'
    ? 'You will no longer receive optional email notifications from New Tech Aviation. Required account and security emails will still be sent. Sign in and open My Account to turn individual types back on.'
    : `You have been unsubscribed from <strong>${label}</strong>. Other notification types are unchanged. Sign in to review all settings in My Account.`;
}

router.get('/unsubscribe', async (req, res) => {
  try {
    const token = req.query.token;
    const resolved = resolveUnsubscribeRequest(token, req.query.type);
    if (!resolved.ok) {
      return res.status(resolved.status).send(renderPage(resolved));
    }

    const label = typeLabel(resolved.type);
    return res.send(renderPage({
      ok: true,
      title: 'Confirm unsubscribe',
      message: resolved.type === 'all'
        ? 'Please confirm that you want to stop optional email notifications from New Tech Aviation. Required account and security emails will still be sent.'
        : `Please confirm that you want to unsubscribe from <strong>${label}</strong>.`,
      confirm: { token, type: resolved.type },
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
    const resolved = resolveUnsubscribeRequest(token, req.body?.type || req.query.type);
    if (!resolved.ok) {
      return res.status(resolved.status).send(renderPage(resolved));
    }

    await ensureDefaultPrefs(resolved.userId);

    if (resolved.type === 'all') {
      await updatePrefs(resolved.userId, { email_all_off: true });
    } else {
      await updatePrefs(resolved.userId, { [resolved.type]: false });
    }

    return res.send(renderPage({
      ok: true,
      title: 'Unsubscribed',
      message: successMessage(resolved.type),
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
module.exports._private = { renderPage, successMessage };
