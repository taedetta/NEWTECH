'use strict';

const express = require('express');
const { typeLabel, buildManagePrefsUrl } = require('../lib/unsubscribe-token');
const { updatePrefs, ensureDefaultPrefs } = require('../db/notification-prefs');
const { normalizeUnsubscribeRequest } = require('../lib/unsubscribe-request');
const { getAppUrl } = require('../lib/app-url');

const router = express.Router();

function escAttr(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function renderPage({ title, message, ok, confirmUrl, confirmLabel }) {
  const color = ok ? '#059669' : '#DC2626';
  const manageUrl = buildManagePrefsUrl();
  const appUrl = `${getAppUrl()}/app`;
  const confirmButton = confirmUrl
    ? `<form method="POST" action="${escAttr(confirmUrl)}" style="margin:0 0 18px;">
        <button class="btn" type="submit">${escAttr(confirmLabel || 'Confirm unsubscribe')}</button>
      </form>`
    : `<a class="btn" href="${manageUrl}">Manage email preferences</a>`;
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
    a.btn, button.btn { display: inline-block; background: #0EA5E9; color: #fff; text-decoration: none; padding: 12px 22px; border: 0; border-radius: 7px; font-weight: 600; font-size: 0.9rem; cursor: pointer; }
    a.link { color: #0EA5E9; text-decoration: none; font-size: 0.88rem; }
  </style>
</head>
<body>
  <div class="card">
    <h1>${title}</h1>
    <p>${message}</p>
    ${confirmButton}
    <p style="margin-top:20px"><a class="link" href="${appUrl}">Open FlightSlate</a></p>
  </div>
</body>
</html>`;
}

router.get('/unsubscribe', async (req, res) => {
  try {
    const request = normalizeUnsubscribeRequest(req.query);
    if (request.errorStatus) {
      return res.status(request.errorStatus).send(renderPage({
        ok: false,
        title: request.title,
        message: request.message,
      }));
    }

    const label = typeLabel(request.type);
    const confirmUrl = `/api/email/unsubscribe?token=${encodeURIComponent(request.token)}&type=${encodeURIComponent(request.type)}`;
    return res.send(renderPage({
      ok: true,
      title: 'Confirm unsubscribe',
      message: request.type === 'all'
        ? 'Please confirm that you want to turn off optional email notifications from New Tech Aviation. Required account and security emails will still be sent.'
        : `Please confirm that you want to unsubscribe from <strong>${label}</strong>. Other notification types are unchanged.`,
      confirmUrl,
      confirmLabel: request.type === 'all' ? 'Confirm unsubscribe from optional emails' : `Confirm unsubscribe from ${label}`,
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

router.post('/unsubscribe', async (req, res) => {
  try {
    const request = normalizeUnsubscribeRequest(req.query);
    if (request.errorStatus) {
      return res.status(request.errorStatus).send(renderPage({
        ok: false,
        title: request.title,
        message: request.message,
      }));
    }

    await ensureDefaultPrefs(request.userId);

    if (request.type === 'all') {
      await updatePrefs(request.userId, { email_all_off: true });
    } else {
      await updatePrefs(request.userId, { [request.type]: false });
    }

    const label = typeLabel(request.type);
    return res.send(renderPage({
      ok: true,
      title: 'Unsubscribed',
      message: request.type === 'all'
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
