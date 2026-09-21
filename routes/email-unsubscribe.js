'use strict';

const express = require('express');
const { verifyUnsubscribeToken, typeLabel, buildManagePrefsUrl } = require('../lib/unsubscribe-token');
const { updatePrefs, ensureDefaultPrefs } = require('../db/notification-prefs');
const { EMAIL_TYPES } = require('../lib/email-types');
const { getAppUrl } = require('../lib/app-url');

const router = express.Router();
router.use(express.urlencoded({ extended: false }));

function escHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderPage({ title, message, ok, action }) {
  const color = ok ? '#059669' : '#DC2626';
  const manageUrl = buildManagePrefsUrl();
  const appUrl = `${getAppUrl()}/app`;
  const actionHtml = action ? `
    <form method="POST" action="/api/email/unsubscribe" style="margin:0 0 14px;">
      <input type="hidden" name="token" value="${escHtml(action.token)}">
      <input type="hidden" name="type" value="${escHtml(action.type)}">
      <button class="btn" type="submit">${escHtml(action.label)}</button>
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
    button.btn { display: inline-block; background: #0EA5E9; color: #fff; text-decoration: none; padding: 12px 22px; border-radius: 7px; font-weight: 600; font-size: 0.9rem; border: 0; cursor: pointer; }
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

function parseUnsubscribeRequest(req) {
  const token = req.query.token || req.body?.token;
  const rawType = String(req.query.type || req.body?.type || '').trim();
  if (!token) {
    return { error: 'missing' };
  }
  const verified = verifyUnsubscribeToken(token);
  if (!verified) {
    return { error: 'invalid-token' };
  }
  const requestedType = rawType || verified.type;
  if (requestedType !== verified.type || (requestedType !== 'all' && !EMAIL_TYPES[requestedType])) {
    return { error: 'invalid-type' };
  }
  return { token, userId: verified.userId, type: requestedType };
}

router.get('/unsubscribe', async (req, res) => {
  try {
    const parsed = parseUnsubscribeRequest(req);
    if (parsed.error === 'missing') {
      return res.status(400).send(renderPage({
        ok: false,
        title: 'Invalid link',
        message: 'This unsubscribe link is missing required information. Sign in and open My Account to manage email preferences.',
      }));
    }
    if (parsed.error === 'invalid-token') {
      return res.status(400).send(renderPage({
        ok: false,
        title: 'Link expired or invalid',
        message: 'This unsubscribe link is no longer valid. Sign in and open My Account to manage your email preferences.',
      }));
    }
    if (parsed.error === 'invalid-type') {
      return res.status(400).send(renderPage({
        ok: false,
        title: 'Invalid preference type',
        message: 'This unsubscribe link is not valid. Sign in and open My Account to manage your email preferences.',
      }));
    }

    const label = typeLabel(parsed.type);
    return res.send(renderPage({
      ok: true,
      title: 'Confirm unsubscribe',
      message: parsed.type === 'all'
        ? 'Confirm that you want to turn off optional email notifications from New Tech Aviation. Required account and security emails will still be sent.'
        : `Confirm that you want to unsubscribe from <strong>${label}</strong>. Other notification types are unchanged.`,
      action: {
        token: parsed.token,
        type: parsed.type,
        label: parsed.type === 'all' ? 'Turn off optional emails' : `Unsubscribe from ${label}`,
      },
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
    const parsed = parseUnsubscribeRequest(req);
    if (parsed.error) {
      const status = parsed.error === 'missing' ? 400 : 400;
      return res.status(status).send(renderPage({
        ok: false,
        title: parsed.error === 'invalid-token' ? 'Link expired or invalid' : 'Invalid link',
        message: 'This unsubscribe link is not valid. Sign in and open My Account to manage your email preferences.',
      }));
    }

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
        ? 'Optional email notifications have been turned off. Required account and security emails will still be sent.'
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
