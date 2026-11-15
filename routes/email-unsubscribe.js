'use strict';

const express = require('express');
const { verifyUnsubscribeToken, typeLabel, buildManagePrefsUrl, normalizeUnsubscribeType } = require('../lib/unsubscribe-token');
const { updatePrefs, ensureDefaultPrefs } = require('../db/notification-prefs');
const { getAppUrl } = require('../lib/app-url');

const router = express.Router();

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderPage({ title, message, ok, confirm, token, type }) {
  const color = ok ? '#059669' : '#DC2626';
  const manageUrl = buildManagePrefsUrl();
  const appUrl = `${getAppUrl()}/app`;
  const submitAction = `/api/email/unsubscribe?token=${encodeURIComponent(token || '')}&type=${encodeURIComponent(type || '')}`;
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
    .btn { display: inline-block; border: 0; background: #0EA5E9; color: #fff; text-decoration: none; padding: 12px 22px; border-radius: 7px; font-weight: 600; font-size: 0.9rem; cursor: pointer; }
    a.link { color: #0EA5E9; text-decoration: none; font-size: 0.88rem; }
  </style>
</head>
<body>
  <div class="card">
    <h1>${escapeHtml(title)}</h1>
    <p>${message}</p>
    ${confirm ? `<form method="POST" action="${submitAction}">
      <input type="hidden" name="token" value="${escapeHtml(token || '')}">
      <input type="hidden" name="type" value="${escapeHtml(type || '')}">
      <button class="btn" type="submit">Confirm unsubscribe</button>
    </form>
    <p style="margin-top:20px"><a class="link" href="${manageUrl}">Manage email preferences instead</a></p>` : `<a class="btn" href="${manageUrl}">Manage email preferences</a>`}
    <p style="margin-top:20px"><a class="link" href="${appUrl}">Open FlightSlate</a></p>
  </div>
</body>
</html>`;
}

function invalidLink(res, title = 'Link expired or invalid') {
  return res.status(400).send(renderPage({
    ok: false,
    title,
    message: 'This unsubscribe link is no longer valid. Sign in and open My Account to manage your email preferences.',
  }));
}

function parseUnsubscribeRequest(req) {
  const token = String(req.body?.token || req.query.token || '').trim();
  const rawType = String(req.body?.type || req.query.type || 'all').trim();
  const type = normalizeUnsubscribeType(rawType);
  if (!token || !type) return null;
  const verified = verifyUnsubscribeToken(token, type);
  if (!verified) return null;
  return { token, type, userId: verified.userId };
}

router.get('/unsubscribe', async (req, res) => {
  try {
    const parsed = parseUnsubscribeRequest(req);
    if (!parsed) {
      return res.status(400).send(renderPage({
        ok: false,
        title: 'Invalid link',
        message: 'This unsubscribe link is missing required information. Sign in and open My Account to manage email preferences.',
      }));
    }

    const label = typeLabel(parsed.type);
    return res.send(renderPage({
      ok: true,
      title: 'Confirm unsubscribe',
      message: parsed.type === 'all'
        ? 'Please confirm that you want to stop optional email notifications from New Tech Aviation.'
        : `Please confirm that you want to unsubscribe from <strong>${escapeHtml(label)}</strong>. Other notification types are unchanged.`,
      confirm: true,
      token: parsed.token,
      type: parsed.type,
    }));
  } catch (err) {
    console.error('[email-unsubscribe] confirmation error:', err.message);
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
    if (!parsed) return invalidLink(res);

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
        ? 'You will no longer receive email notifications from New Tech Aviation. Sign in and open My Account to turn individual types back on.'
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
module.exports._private = { parseUnsubscribeRequest, renderPage };
