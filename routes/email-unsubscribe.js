'use strict';

const express = require('express');
const { verifyUnsubscribeToken, typeLabel, buildManagePrefsUrl } = require('../lib/unsubscribe-token');
const { updatePrefs, ensureDefaultPrefs } = require('../db/notification-prefs');
const { EMAIL_TYPES, isRequiredEmailType } = require('../lib/email-types');
const { getAppUrl } = require('../lib/app-url');

const router = express.Router();
const formParser = express.urlencoded({ extended: false });

function escapeHtml(value) {
  return String(value)
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
    a.btn, button.btn { display: inline-block; background: #0EA5E9; color: #fff; text-decoration: none; padding: 12px 22px; border-radius: 7px; font-weight: 600; font-size: 0.9rem; border: 0; cursor: pointer; }
    form { margin: 0 0 18px; }
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

function validateUnsubscribeRequest(source) {
  const token = source.token;
  const rawType = String(source.type || 'all').trim();
  if (!token) {
    return { error: 'missing' };
  }
  if (rawType !== 'all' && !EMAIL_TYPES[rawType]) {
    return { error: 'invalid_type' };
  }
  if (rawType !== 'all' && isRequiredEmailType(rawType)) {
    return { error: 'required_type' };
  }
  const verified = verifyUnsubscribeToken(token);
  if (!verified || verified.type !== rawType) {
    return { error: 'invalid_token' };
  }
  return { token, type: rawType, userId: verified.userId };
}

function invalidResponse(res, validation) {
  const message = validation.error === 'required_type'
    ? 'This email type is required for account access or security and cannot be disabled.'
    : 'This unsubscribe link is no longer valid. Sign in and open My Account to manage your email preferences.';
  return res.status(400).send(renderPage({
    ok: false,
    title: validation.error === 'missing' ? 'Invalid link' : 'Link expired or invalid',
    message,
  }));
}

router.get('/unsubscribe', async (req, res) => {
  try {
    const validation = validateUnsubscribeRequest(req.query);
    if (validation.error) return invalidResponse(res, validation);

    const label = typeLabel(validation.type);
    const form = `
      <form method="post" action="/api/email/unsubscribe">
        <input type="hidden" name="token" value="${escapeHtml(validation.token)}">
        <input type="hidden" name="type" value="${escapeHtml(validation.type)}">
        <button class="btn" type="submit">Confirm unsubscribe</button>
      </form>`;
    return res.send(renderPage({
      ok: true,
      title: 'Confirm unsubscribe',
      message: validation.type === 'all'
        ? 'Please confirm that you want to stop receiving optional email notifications from New Tech Aviation. Required account and security emails will still be sent.'
        : `Please confirm that you want to unsubscribe from <strong>${escapeHtml(label)}</strong>.`,
      extraHtml: form,
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

router.post('/unsubscribe', formParser, async (req, res) => {
  try {
    const validation = validateUnsubscribeRequest(req.body || {});
    if (validation.error) return invalidResponse(res, validation);

    await ensureDefaultPrefs(validation.userId);
    if (validation.type === 'all') {
      await updatePrefs(validation.userId, { email_all_off: true });
    } else {
      await updatePrefs(validation.userId, { [validation.type]: false });
    }

    const label = typeLabel(validation.type);
    return res.send(renderPage({
      ok: true,
      title: 'Unsubscribed',
      message: validation.type === 'all'
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
