'use strict';

const express = require('express');
const { verifyUnsubscribeToken, typeLabel, buildManagePrefsUrl } = require('../lib/unsubscribe-token');
const { updatePrefs, ensureDefaultPrefs } = require('../db/notification-prefs');
const { EMAIL_TYPES, isMandatoryEmailType } = require('../lib/email-types');
const { getAppUrl } = require('../lib/app-url');

const router = express.Router();
router.use(express.urlencoded({ extended: false }));

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderPage({ title, message, ok, extraHtml = '' }) {
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
    a.btn { display: inline-block; background: #0EA5E9; color: #fff; text-decoration: none; padding: 12px 22px; border-radius: 7px; font-weight: 600; font-size: 0.9rem; }
    button.btn { display: inline-block; background: #DC2626; color: #fff; border: 0; cursor: pointer; padding: 12px 22px; border-radius: 7px; font-weight: 600; font-size: 0.9rem; margin-bottom: 14px; }
    a.link { color: #0EA5E9; text-decoration: none; font-size: 0.88rem; }
  </style>
</head>
<body>
  <div class="card">
    <h1>${title}</h1>
    <p>${message}</p>
    ${extraHtml}
    <a class="btn" href="${manageUrl}">Manage email preferences</a>
    <p style="margin-top:20px"><a class="link" href="${appUrl}">Open FlightSlate</a></p>
  </div>
</body>
</html>`;
}

function validateUnsubscribeRequest(req, res) {
  const token = req.body?.token || req.query.token;
  const rawType = String(req.body?.type || req.query.type || 'all').trim();
  if (!token) {
    res.status(400).send(renderPage({
      ok: false,
      title: 'Invalid link',
      message: 'This unsubscribe link is missing required information. Sign in and open My Account to manage email preferences.',
    }));
    return null;
  }

  const verified = verifyUnsubscribeToken(token);
  if (!verified) {
    res.status(400).send(renderPage({
      ok: false,
      title: 'Link expired or invalid',
      message: 'This unsubscribe link is no longer valid. Sign in and open My Account to manage your email preferences.',
    }));
    return null;
  }

  if (rawType !== 'all' && !EMAIL_TYPES[rawType]) {
    res.status(400).send(renderPage({
      ok: false,
      title: 'Invalid preference type',
      message: 'This unsubscribe link is not valid. Sign in and open My Account to manage your email preferences.',
    }));
    return null;
  }

  if (isMandatoryEmailType(rawType)) {
    res.status(400).send(renderPage({
      ok: false,
      title: 'Required email',
      message: 'This email type is required for account access and cannot be unsubscribed. You can still manage optional email preferences in My Account.',
    }));
    return null;
  }

  return { token, rawType, verified };
}

router.get('/unsubscribe', async (req, res) => {
  try {
    const parsed = validateUnsubscribeRequest(req, res);
    if (!parsed) return;

    const label = typeLabel(parsed.rawType);
    return res.send(renderPage({
      ok: true,
      title: 'Confirm unsubscribe',
      message: parsed.rawType === 'all'
        ? 'Please confirm that you want to turn off optional email notifications from New Tech Aviation.'
        : `Please confirm that you want to unsubscribe from <strong>${label}</strong>. Other notification types are unchanged.`,
      extraHtml: `
        <form method="POST" action="/api/email/unsubscribe">
          <input type="hidden" name="token" value="${escapeHtml(parsed.token)}">
          <input type="hidden" name="type" value="${escapeHtml(parsed.rawType)}">
          <button class="btn" type="submit">Confirm unsubscribe</button>
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

router.post('/unsubscribe', async (req, res) => {
  try {
    const parsed = validateUnsubscribeRequest(req, res);
    if (!parsed) return;

    await ensureDefaultPrefs(parsed.verified.userId);

    if (parsed.rawType === 'all') {
      await updatePrefs(parsed.verified.userId, { email_all_off: true });
    } else {
      await updatePrefs(parsed.verified.userId, { [parsed.rawType]: false });
    }

    const label = typeLabel(parsed.rawType);
    return res.send(renderPage({
      ok: true,
      title: 'Unsubscribed',
      message: parsed.rawType === 'all'
        ? 'You will no longer receive optional email notifications from New Tech Aviation. Required account emails will still be delivered.'
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
