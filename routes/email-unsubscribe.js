'use strict';

const express = require('express');
const { verifyUnsubscribeToken, typeLabel, buildManagePrefsUrl } = require('../lib/unsubscribe-token');
const { updatePrefs, ensureDefaultPrefs } = require('../db/notification-prefs');
const { EMAIL_TYPES } = require('../lib/email-types');
const { getAppUrl } = require('../lib/app-url');

const router = express.Router();

function renderPage({ title, message, ok, form }) {
  const color = ok ? '#059669' : '#DC2626';
  const manageUrl = buildManagePrefsUrl();
  const appUrl = `${getAppUrl()}/app`;
  const formHtml = form
    ? `<form method="POST" action="/api/email/unsubscribe?token=${encodeURIComponent(form.token)}&type=${encodeURIComponent(form.type)}" style="margin:0 0 18px;">
        <button type="submit" class="btn">${form.buttonText}</button>
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
    .btn { display: inline-block; background: #0EA5E9; color: #fff; text-decoration: none; padding: 12px 22px; border:0; border-radius: 7px; font-weight: 600; font-size: 0.9rem; cursor:pointer; }
    a.link { color: #0EA5E9; text-decoration: none; font-size: 0.88rem; }
  </style>
</head>
<body>
  <div class="card">
    <h1>${title}</h1>
    <p>${message}</p>
    ${formHtml}
    <p style="margin-top:20px"><a class="link" href="${appUrl}">Open FlightSlate</a></p>
  </div>
</body>
</html>`;
}

function parseUnsubscribeRequest(req) {
  const token = req.query.token;
  const rawType = String(req.query.type || '').trim();
  if (!token) {
    return { error: 'missing' };
  }
  const verified = verifyUnsubscribeToken(token);
  if (!verified) {
    return { error: 'invalid' };
  }
  if (rawType !== verified.type || (rawType !== 'all' && !EMAIL_TYPES[rawType])) {
    return { error: 'invalid_type' };
  }
  return { token, userId: verified.userId, type: verified.type };
}

function renderRequestError(res, error) {
  if (error === 'missing') {
    return res.status(400).send(renderPage({
      ok: false,
      title: 'Invalid link',
      message: 'This unsubscribe link is missing required information. Sign in and open My Account to manage email preferences.',
    }));
  }
  return res.status(400).send(renderPage({
    ok: false,
    title: error === 'invalid_type' ? 'Invalid preference type' : 'Link expired or invalid',
    message: 'This unsubscribe link is not valid. Sign in and open My Account to manage your email preferences.',
  }));
}

router.get('/unsubscribe', async (req, res) => {
  try {
    const parsed = parseUnsubscribeRequest(req);
    if (parsed.error) return renderRequestError(res, parsed.error);

    const label = typeLabel(parsed.type);
    return res.send(renderPage({
      ok: true,
      title: 'Confirm unsubscribe',
      message: parsed.type === 'all'
        ? 'Please confirm that you want to stop optional email notifications from New Tech Aviation. Required account and security emails will still be sent.'
        : `Please confirm that you want to unsubscribe from <strong>${label}</strong>. Other notification types are unchanged.`,
      form: {
        token: parsed.token,
        type: parsed.type,
        buttonText: parsed.type === 'all' ? 'Unsubscribe from optional emails' : `Unsubscribe from ${label}`,
      },
    }));
  } catch (err) {
    console.error('[email-unsubscribe] GET error:', err.message);
    res.status(500).send(renderPage({
      ok: false,
      title: 'Something went wrong',
      message: 'We could not load this unsubscribe request. Please try again or manage preferences in My Account.',
    }));
  }
});

router.post('/unsubscribe', async (req, res) => {
  try {
    const parsed = parseUnsubscribeRequest(req);
    if (parsed.error) return renderRequestError(res, parsed.error);

    await ensureDefaultPrefs(parsed.userId);

    if (parsed.type === 'all') {
      await updatePrefs(parsed.userId, { email_all_off: true });
    } else {
      await updatePrefs(parsed.userId, { [parsed.type]: false });
    }

    const label = typeLabel(parsed.type);
    return res.send(renderPage({
      ok: true,
      title: 'Unsubscribed',
      message: parsed.type === 'all'
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
