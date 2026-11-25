'use strict';

const express = require('express');
const { verifyUnsubscribeToken, typeLabel, buildManagePrefsUrl } = require('../lib/unsubscribe-token');
const { updatePrefs, ensureDefaultPrefs } = require('../db/notification-prefs');
const { EMAIL_TYPES, isRequiredEmailType } = require('../lib/email-types');
const { getAppUrl } = require('../lib/app-url');

const router = express.Router();

function renderPage({ title, message, ok, confirm }) {
  const color = ok ? '#059669' : '#DC2626';
  const manageUrl = buildManagePrefsUrl();
  const appUrl = `${getAppUrl()}/app`;
  const confirmHtml = confirm ? `
    <form method="POST" action="/api/email/unsubscribe?token=${encodeURIComponent(confirm.token)}&type=${encodeURIComponent(confirm.type)}" style="margin:0 0 18px;">
      <button type="submit" class="btn">Confirm unsubscribe</button>
    </form>` : '';
  const primaryLink = confirmHtml || `<a class="btn" href="${manageUrl}">Manage email preferences</a>`;
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
    ${primaryLink}
    <p style="margin-top:20px"><a class="link" href="${appUrl}">Open FlightSlate</a></p>
  </div>
</body>
</html>`;
}

function readUnsubscribeRequest(req) {
  const token = req.query.token || req.body?.token;
  const rawType = String(req.query.type || req.body?.type || '').trim();
  if (!token) {
    return { error: 'missing' };
  }

  const verified = verifyUnsubscribeToken(token);
  if (!verified) {
    return { error: 'invalid' };
  }

  if (rawType && rawType !== verified.type) {
    return { error: 'type_mismatch' };
  }

  if (verified.type !== 'all' && (!EMAIL_TYPES[verified.type] || isRequiredEmailType(verified.type))) {
    return { error: 'invalid_type' };
  }

  return {
    token,
    userId: verified.userId,
    type: verified.type,
  };
}

function renderInvalid(res, reason) {
  const isMissing = reason === 'missing';
  return res.status(400).send(renderPage({
    ok: false,
    title: isMissing ? 'Invalid link' : 'Link expired or invalid',
    message: isMissing
      ? 'This unsubscribe link is missing required information. Sign in and open My Account to manage email preferences.'
      : 'This unsubscribe link is not valid. Sign in and open My Account to manage your email preferences.',
  }));
}

router.get('/unsubscribe', async (req, res) => {
  try {
    const request = readUnsubscribeRequest(req);
    if (request.error) return renderInvalid(res, request.error);

    const label = typeLabel(request.type);
    return res.send(renderPage({
      ok: true,
      title: 'Confirm unsubscribe',
      message: request.type === 'all'
        ? 'Please confirm that you want to stop optional email notifications from New Tech Aviation.'
        : `Please confirm that you want to unsubscribe from <strong>${label}</strong>.`,
      confirm: { token: request.token, type: request.type },
    }));
  } catch (err) {
    console.error('[email-unsubscribe] confirmation error:', err.message);
    res.status(500).send(renderPage({
      ok: false,
      title: 'Something went wrong',
      message: 'We could not process your unsubscribe request. Please try again or manage preferences in My Account.',
    }));
  }
});

router.post('/unsubscribe', async (req, res) => {
  try {
    const request = readUnsubscribeRequest(req);
    if (request.error) return renderInvalid(res, request.error);

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
        ? 'You will no longer receive optional email notifications from New Tech Aviation. Sign in and open My Account to turn individual types back on.'
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
