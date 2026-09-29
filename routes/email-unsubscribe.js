'use strict';

const express = require('express');
const { verifyUnsubscribeToken, typeLabel, buildManagePrefsUrl } = require('../lib/unsubscribe-token');
const { updatePrefs, ensureDefaultPrefs } = require('../db/notification-prefs');
const { getAppUrl } = require('../lib/app-url');

const router = express.Router();

function escapeAttr(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function renderPage({ title, message, ok, confirm }) {
  const color = ok ? '#059669' : '#DC2626';
  const manageUrl = buildManagePrefsUrl();
  const appUrl = `${getAppUrl()}/app`;
  const action = confirm ? `
    <form method="POST" action="/api/email/unsubscribe" style="margin:0 0 18px">
      <input type="hidden" name="token" value="${escapeAttr(confirm.token)}">
      <button class="btn" type="submit">Confirm unsubscribe</button>
    </form>` : '';
  const manageButton = confirm ? '' : `<a class="btn" href="${manageUrl}">Manage email preferences</a>`;
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
    ${action}
    ${manageButton}
    <p style="margin-top:20px"><a class="link" href="${appUrl}">Open FlightSlate</a></p>
  </div>
</body>
</html>`;
}

function renderInvalidLink(res, status = 400) {
  return res.status(status).send(renderPage({
    ok: false,
    title: 'Link expired or invalid',
    message: 'This unsubscribe link is no longer valid. Sign in and open My Account to manage your email preferences.',
  }));
}

function verifiedFromRequest(req) {
  const token = req.query.token || req.body?.token;
  if (!token) return null;
  const verified = verifyUnsubscribeToken(token);
  if (!verified) return null;

  const rawType = req.query.type ? String(req.query.type).trim() : null;
  if (rawType && rawType !== verified.type) return null;
  return { token, ...verified };
}

router.get('/unsubscribe', async (req, res) => {
  try {
    const verified = verifiedFromRequest(req);
    if (!verified) return renderInvalidLink(res);
    const label = typeLabel(verified.type);
    return res.send(renderPage({
      ok: true,
      title: 'Confirm unsubscribe',
      message: verified.type === 'all'
        ? 'Please confirm that you want to turn off optional email notifications from New Tech Aviation. Required account and security emails will still be sent.'
        : `Please confirm that you want to unsubscribe from <strong>${label}</strong>. Other notification types are unchanged.`,
      confirm: { token: verified.token },
    }));
  } catch (err) {
    console.error('[email-unsubscribe] GET error:', err.message);
    return renderInvalidLink(res, 500);
  }
});

router.post('/unsubscribe', express.urlencoded({ extended: false }), async (req, res) => {
  try {
    const verified = verifiedFromRequest(req);
    if (!verified) return renderInvalidLink(res);

    await ensureDefaultPrefs(verified.userId);

    if (verified.type === 'all') {
      await updatePrefs(verified.userId, { email_all_off: true });
    } else {
      await updatePrefs(verified.userId, { [verified.type]: false });
    }

    const label = typeLabel(verified.type);
    return res.send(renderPage({
      ok: true,
      title: 'Unsubscribed',
      message: verified.type === 'all'
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
