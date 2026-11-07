'use strict';

const express = require('express');
const { verifyUnsubscribeToken, typeLabel, buildManagePrefsUrl } = require('../lib/unsubscribe-token');
const { updatePrefs, ensureDefaultPrefs } = require('../db/notification-prefs');
const { getAppUrl } = require('../lib/app-url');

const router = express.Router();

function renderPage({ title, message, ok }) {
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
    <a class="btn" href="${manageUrl}">Manage email preferences</a>
    <p style="margin-top:20px"><a class="link" href="${appUrl}">Open FlightSlate</a></p>
  </div>
</body>
</html>`;
}

function invalidLink(res, status, title = 'Link expired or invalid') {
  return res.status(status).send(renderPage({
    ok: false,
    title,
    message: 'This unsubscribe link is no longer valid. Sign in and open My Account to manage your email preferences.',
  }));
}

function resolveRequest(req, res) {
  const token = req.query.token || req.body?.token;
  const requestedType = req.query.type || req.body?.type;
  if (!token) {
    invalidLink(res, 400, 'Invalid link');
    return null;
  }

  const verified = verifyUnsubscribeToken(token);
  if (!verified) {
    invalidLink(res, 400);
    return null;
  }

  if (requestedType && String(requestedType).trim() !== verified.type) {
    invalidLink(res, 400, 'Invalid preference type');
    return null;
  }

  return { token, userId: verified.userId, type: verified.type };
}

function renderConfirmation({ token, type }) {
  const label = typeLabel(type);
  const action = `/api/email/unsubscribe?token=${encodeURIComponent(token)}&type=${encodeURIComponent(type)}`;
  const message = type === 'all'
    ? 'Confirm that you want to turn off optional email notifications from New Tech Aviation. Account and security emails will still be delivered.'
    : `Confirm that you want to unsubscribe from <strong>${label}</strong>. Other notification types are unchanged.`;
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Confirm unsubscribe — New Tech Aviation</title>
  <style>
    body { font-family: 'Helvetica Neue', Arial, sans-serif; background: #f4f6f9; margin: 0; padding: 40px 16px; color: #1a202c; }
    .card { max-width: 520px; margin: 0 auto; background: #fff; border-radius: 10px; padding: 32px; box-shadow: 0 2px 12px rgba(0,0,0,0.08); text-align: center; }
    h1 { font-size: 1.35rem; margin: 0 0 12px; color: #080E1A; }
    p { font-size: 0.95rem; line-height: 1.6; color: #475569; margin: 0 0 20px; }
    button { background: #DC2626; color: #fff; border: 0; padding: 12px 22px; border-radius: 7px; font-weight: 600; font-size: 0.9rem; cursor: pointer; }
    a.link { color: #0EA5E9; text-decoration: none; font-size: 0.88rem; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Confirm unsubscribe</h1>
    <p>${message}</p>
    <form method="POST" action="${action}">
      <button type="submit">Confirm unsubscribe</button>
    </form>
    <p style="margin-top:20px"><a class="link" href="${buildManagePrefsUrl()}">Manage preferences instead</a></p>
  </div>
</body>
</html>`;
}

router.get('/unsubscribe', async (req, res) => {
  try {
    const resolved = resolveRequest(req, res);
    if (!resolved) return;
    return res.send(renderConfirmation(resolved));
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
    const resolved = resolveRequest(req, res);
    if (!resolved) return;

    await ensureDefaultPrefs(resolved.userId);

    if (resolved.type === 'all') {
      await updatePrefs(resolved.userId, { email_all_off: true });
    } else {
      await updatePrefs(resolved.userId, { [resolved.type]: false });
    }

    const label = typeLabel(resolved.type);
    return res.send(renderPage({
      ok: true,
      title: 'Unsubscribed',
      message: resolved.type === 'all'
        ? 'You will no longer receive optional email notifications from New Tech Aviation. Account and security emails will still be delivered.'
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
