'use strict';

const express = require('express');
const { verifyUnsubscribeToken, typeLabel, buildManagePrefsUrl } = require('../lib/unsubscribe-token');
const { updatePrefs, ensureDefaultPrefs } = require('../db/notification-prefs');
const { EMAIL_TYPES, isRequiredEmailType } = require('../lib/email-types');
const { getAppUrl } = require('../lib/app-url');

const router = express.Router();
router.use(express.urlencoded({ extended: false }));

function escapeAttr(value) {
  return String(value || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

function renderPage({ title, message, ok, action }) {
  const color = ok ? '#059669' : '#DC2626';
  const manageUrl = buildManagePrefsUrl();
  const appUrl = `${getAppUrl()}/app`;
  const actionHtml = action ? `
    <form method="POST" action="/api/email/unsubscribe" style="margin:0 0 20px;">
      <input type="hidden" name="token" value="${escapeAttr(action.token)}">
      <input type="hidden" name="type" value="${escapeAttr(action.type)}">
      <button class="btn" type="submit">Confirm unsubscribe</button>
    </form>` : `<a class="btn" href="${manageUrl}">Manage email preferences</a>`;
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
    .btn { display: inline-block; background: #0EA5E9; color: #fff; text-decoration: none; padding: 12px 22px; border-radius: 7px; font-weight: 600; font-size: 0.9rem; border: 0; cursor: pointer; }
    a.link { color: #0EA5E9; text-decoration: none; font-size: 0.88rem; }
  </style>
</head>
<body>
  <div class="card">
    <h1>${title}</h1>
    <p>${message}</p>
    ${actionHtml}
    <p style="margin-top:20px"><a class="link" href="${appUrl}">Open FlightSlate</a></p>
  </div>
</body>
</html>`;
}

function getValidatedUnsubscribeRequest(req, res) {
  const token = req.body?.token || req.query.token;
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

  const rawType = String(req.body?.type || req.query.type || verified.type || 'all').trim();
  if (rawType !== verified.type || (rawType !== 'all' && !EMAIL_TYPES[rawType])) {
    res.status(400).send(renderPage({
      ok: false,
      title: 'Invalid preference type',
      message: 'This unsubscribe link is not valid. Sign in and open My Account to manage your email preferences.',
    }));
    return null;
  }

  if (rawType !== 'all' && isRequiredEmailType(rawType)) {
    res.status(400).send(renderPage({
      ok: false,
      title: 'Required email',
      message: 'This notification is required for account access or security and cannot be disabled.',
    }));
    return null;
  }

  return { token, userId: verified.userId, type: rawType, label: typeLabel(rawType) };
}

router.get('/unsubscribe', async (req, res) => {
  try {
    const request = getValidatedUnsubscribeRequest(req, res);
    if (!request) return;
    return res.send(renderPage({
      ok: true,
      title: 'Confirm unsubscribe',
      message: request.type === 'all'
        ? 'Please confirm that you want to unsubscribe from optional New Tech Aviation email notifications.'
        : `Please confirm that you want to unsubscribe from <strong>${request.label}</strong>.`,
      action: request,
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
    const request = getValidatedUnsubscribeRequest(req, res);
    if (!request) return;
    await ensureDefaultPrefs(request.userId);

    if (request.type === 'all') {
      await updatePrefs(request.userId, { email_all_off: true });
    } else {
      await updatePrefs(request.userId, { [request.type]: false });
    }

    return res.send(renderPage({
      ok: true,
      title: 'Unsubscribed',
      message: request.type === 'all'
        ? 'You will no longer receive email notifications from New Tech Aviation. Sign in and open My Account to turn individual types back on.'
        : `You have been unsubscribed from <strong>${request.label}</strong>. Other notification types are unchanged. Sign in to review all settings in My Account.`,
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
module.exports.getValidatedUnsubscribeRequest = getValidatedUnsubscribeRequest;
