'use strict';

const express = require('express');
const { verifyUnsubscribeToken, typeLabel, buildManagePrefsUrl } = require('../lib/unsubscribe-token');
const { updatePrefs, ensureDefaultPrefs } = require('../db/notification-prefs');
const { EMAIL_TYPES, isRequiredEmailType } = require('../lib/email-types');
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

function renderPage({ title, message, ok, actionHtml }) {
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
    a.link { color: #0EA5E9; text-decoration: none; font-size: 0.88rem; }
  </style>
</head>
<body>
  <div class="card">
    <h1>${title}</h1>
    <p>${message}</p>
    ${actionHtml || `<a class="btn" href="${manageUrl}">Manage email preferences</a>`}
    <p style="margin-top:20px"><a class="link" href="${appUrl}">Open FlightSlate</a></p>
  </div>
</body>
</html>`;
}

function readUnsubscribeRequest(req) {
  const token = req.body?.token || req.query.token;
  const rawType = String(req.body?.type || req.query.type || '').trim();
  if (!token) {
    return { error: 'missing' };
  }

  const verified = verifyUnsubscribeToken(token);
  if (!verified) {
    return { error: 'invalid' };
  }

  if (rawType !== verified.type) {
    return { error: 'invalid_type' };
  }

  if (rawType !== 'all' && (!EMAIL_TYPES[rawType] || isRequiredEmailType(rawType))) {
    return { error: 'invalid_type' };
  }

  return { token, rawType, verified };
}

function invalidLinkResponse(res, reason) {
  const messages = {
    missing: 'This unsubscribe link is missing required information. Sign in and open My Account to manage email preferences.',
    invalid: 'This unsubscribe link is no longer valid. Sign in and open My Account to manage your email preferences.',
    invalid_type: 'This unsubscribe link is not valid. Sign in and open My Account to manage your email preferences.',
  };
  return res.status(400).send(renderPage({
    ok: false,
    title: reason === 'missing' ? 'Invalid link' : 'Link expired or invalid',
    message: messages[reason] || messages.invalid,
  }));
}

router.get('/unsubscribe', async (req, res) => {
  try {
    const parsed = readUnsubscribeRequest(req);
    if (parsed.error) return invalidLinkResponse(res, parsed.error);

    const label = escapeHtml(typeLabel(parsed.rawType));
    const actionHtml = `
      <form method="post" action="/api/email/unsubscribe" style="margin:0 0 14px;">
        <input type="hidden" name="token" value="${escapeHtml(parsed.token)}">
        <input type="hidden" name="type" value="${escapeHtml(parsed.rawType)}">
        <button class="btn" type="submit" style="border:0;cursor:pointer;">Confirm unsubscribe</button>
      </form>
      <a class="link" href="${escapeHtml(buildManagePrefsUrl())}">Manage email preferences instead</a>`;

    return res.send(renderPage({
      ok: true,
      title: 'Confirm unsubscribe',
      message: parsed.rawType === 'all'
        ? 'Please confirm that you want to turn off optional email notifications from New Tech Aviation.'
        : `Please confirm that you want to unsubscribe from <strong>${label}</strong>.`,
      actionHtml,
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
    const parsed = readUnsubscribeRequest(req);
    if (parsed.error) return invalidLinkResponse(res, parsed.error);

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
        ? 'You will no longer receive optional email notifications from New Tech Aviation. Required account security emails will still be sent.'
        : `You have been unsubscribed from <strong>${escapeHtml(label)}</strong>. Other notification types are unchanged. Sign in to review all settings in My Account.`,
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
module.exports.readUnsubscribeRequest = readUnsubscribeRequest;
