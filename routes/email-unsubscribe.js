'use strict';

const express = require('express');
const { verifyUnsubscribeToken, typeLabel, buildManagePrefsUrl } = require('../lib/unsubscribe-token');
const { updatePrefs, ensureDefaultPrefs } = require('../db/notification-prefs');
const { getAppUrl } = require('../lib/app-url');

const router = express.Router();
router.use(express.urlencoded({ extended: false }));

function escHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function requestType(req) {
  const raw = req.query.type ?? req.body?.type;
  return raw == null ? null : String(raw).trim();
}

function validateTokenRequest(req, token) {
  if (!token) return { error: 'missing_token' };
  const verified = verifyUnsubscribeToken(token);
  if (!verified?.emailType) return { error: 'invalid_token' };
  const rawType = requestType(req);
  if (rawType && rawType !== verified.emailType) return { error: 'type_mismatch' };
  return { verified, emailType: verified.emailType };
}

function renderPage({ title, message, ok, confirmToken, confirmType }) {
  const color = ok ? '#059669' : '#DC2626';
  const manageUrl = buildManagePrefsUrl();
  const appUrl = `${getAppUrl()}/app`;
  const confirmHtml = confirmToken ? `
    <form method="POST" action="/api/email/unsubscribe" style="margin:0 0 18px;">
      <input type="hidden" name="token" value="${escHtml(confirmToken)}">
      <input type="hidden" name="type" value="${escHtml(confirmType || '')}">
      <button type="submit" class="btn">Confirm unsubscribe</button>
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
    a.btn, button.btn { display: inline-block; background: #0EA5E9; color: #fff; text-decoration: none; padding: 12px 22px; border-radius: 7px; font-weight: 600; font-size: 0.9rem; border:0; cursor:pointer; font-family:inherit; }
    a.link { color: #0EA5E9; text-decoration: none; font-size: 0.88rem; }
  </style>
</head>
<body>
  <div class="card">
    <h1>${title}</h1>
    <p>${message}</p>
    ${confirmHtml}
    <a class="btn" href="${manageUrl}">Manage email preferences</a>
    <p style="margin-top:20px"><a class="link" href="${appUrl}">Open FlightSlate</a></p>
  </div>
</body>
</html>`;
}

router.get('/unsubscribe', async (req, res) => {
  try {
    const token = req.query.token;
    const validation = validateTokenRequest(req, token);
    if (validation.error === 'missing_token') {
      return res.status(400).send(renderPage({
        ok: false,
        title: 'Invalid link',
        message: 'This unsubscribe link is missing required information. Sign in and open My Account to manage email preferences.',
      }));
    }
    if (validation.error === 'invalid_token') {
      return res.status(400).send(renderPage({
        ok: false,
        title: 'Link expired or invalid',
        message: 'This unsubscribe link is no longer valid. Sign in and open My Account to manage your email preferences.',
      }));
    }
    if (validation.error === 'type_mismatch') {
      return res.status(400).send(renderPage({
        ok: false,
        title: 'Invalid preference type',
        message: 'This unsubscribe link is not valid. Sign in and open My Account to manage your email preferences.',
      }));
    }

    const rawType = validation.emailType;
    const label = typeLabel(rawType);
    return res.send(renderPage({
      ok: true,
      title: 'Confirm unsubscribe',
      message: rawType === 'all'
        ? 'Please confirm that you want to turn off optional email notifications from New Tech Aviation. Required account and security emails will still be sent.'
        : `Please confirm that you want to unsubscribe from <strong>${label}</strong>. Other notification types are unchanged.`,
      confirmToken: token,
      confirmType: rawType,
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
    const token = req.body?.token || req.query.token;
    const validation = validateTokenRequest(req, token);
    if (validation.error) {
      return res.status(400).send(renderPage({
        ok: false,
        title: validation.error === 'missing_token' ? 'Invalid link' : 'Link expired or invalid',
        message: 'This unsubscribe request is not valid. Sign in and open My Account to manage your email preferences.',
      }));
    }

    const { userId } = validation.verified;
    const rawType = validation.emailType;
    await ensureDefaultPrefs(userId);

    if (rawType === 'all') {
      await updatePrefs(userId, { email_all_off: true });
    } else {
      await updatePrefs(userId, { [rawType]: false });
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
    console.error('[email-unsubscribe] POST error:', err.message);
    res.status(500).send(renderPage({
      ok: false,
      title: 'Something went wrong',
      message: 'We could not process your unsubscribe request. Please try again or manage preferences in My Account.',
    }));
  }
});

module.exports = router;
