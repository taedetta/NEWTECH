'use strict';

const express = require('express');
const { verifyUnsubscribeToken, typeLabel, buildManagePrefsUrl } = require('../lib/unsubscribe-token');
const { updatePrefs, ensureDefaultPrefs } = require('../db/notification-prefs');
const { EMAIL_TYPES } = require('../lib/email-types');
const { getAppUrl } = require('../lib/app-url');

const router = express.Router();

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderPage({ title, message, ok, confirm = false, token = '', type = 'all' }) {
  const color = ok ? '#059669' : '#DC2626';
  const manageUrl = buildManagePrefsUrl();
  const appUrl = `${getAppUrl()}/app`;
  const confirmAction = `/api/email/unsubscribe?token=${encodeURIComponent(token)}&type=${encodeURIComponent(type)}`;
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
    button.btn { display: inline-block; background: #0EA5E9; color: #fff; border: 0; cursor: pointer; padding: 12px 22px; border-radius: 7px; font-weight: 600; font-size: 0.9rem; }
    a.link { color: #0EA5E9; text-decoration: none; font-size: 0.88rem; }
  </style>
</head>
<body>
  <div class="card">
    <h1>${escapeHtml(title)}</h1>
    <p>${message}</p>
    ${confirm ? `<form method="POST" action="${escapeHtml(confirmAction)}"><button class="btn" type="submit">Confirm unsubscribe</button></form>` : `<a class="btn" href="${manageUrl}">Manage email preferences</a>`}
    <p style="margin-top:20px"><a class="link" href="${appUrl}">Open FlightSlate</a></p>
  </div>
</body>
</html>`;
}

function validateRequest(req) {
  const token = typeof req.query.token === 'string' ? req.query.token : '';
  const rawType = req.query.type === undefined ? '' : String(req.query.type).trim();
  if (!token) {
    return { error: 'missing' };
  }

  const verified = verifyUnsubscribeToken(token);
  if (!verified) {
    return { error: 'invalid' };
  }

  if (rawType && rawType !== verified.type) {
    return { error: 'tampered' };
  }
  if (verified.type !== 'all' && !EMAIL_TYPES[verified.type]) {
    return { error: 'invalid_type' };
  }

  return { token, userId: verified.userId, type: verified.type };
}

router.get('/unsubscribe', async (req, res) => {
  try {
    const request = validateRequest(req);
    if (request.error === 'missing') {
      return res.status(400).send(renderPage({
        ok: false,
        title: 'Invalid link',
        message: 'This unsubscribe link is missing required information. Sign in and open My Account to manage email preferences.',
      }));
    }

    if (request.error) {
      return res.status(400).send(renderPage({
        ok: false,
        title: 'Link expired or invalid',
        message: 'This unsubscribe link is no longer valid. Sign in and open My Account to manage your email preferences.',
      }));
    }

    const label = typeLabel(request.type);
    return res.send(renderPage({
      ok: true,
      title: 'Confirm unsubscribe',
      message: request.type === 'all'
        ? 'Please confirm that you want to stop optional email notifications from New Tech Aviation. Required account and security emails will still be sent.'
        : `Please confirm that you want to unsubscribe from <strong>${label}</strong>. Other notification types are unchanged.`,
      confirm: true,
      token: request.token,
      type: request.type,
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
    const request = validateRequest(req);
    if (request.error) {
      return res.status(400).send(renderPage({
        ok: false,
        title: 'Link expired or invalid',
        message: 'This unsubscribe link is no longer valid. Sign in and open My Account to manage your email preferences.',
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
    console.error('[email-unsubscribe] POST error:', err.message);
    res.status(500).send(renderPage({
      ok: false,
      title: 'Something went wrong',
      message: 'We could not process your unsubscribe request. Please try again or manage preferences in My Account.',
    }));
  }
});

module.exports = router;
