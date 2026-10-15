'use strict';

const express = require('express');
const { verifyUnsubscribeToken, typeLabel, buildManagePrefsUrl } = require('../lib/unsubscribe-token');
const { updatePrefs, ensureDefaultPrefs } = require('../db/notification-prefs');
const { EMAIL_TYPES } = require('../lib/email-types');
const { getAppUrl } = require('../lib/app-url');

const router = express.Router();

router.use(express.urlencoded({ extended: false }));

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[ch]));
}

function renderPage({ title, message, ok, actionHtml }) {
  const color = ok ? '#059669' : '#DC2626';
  const manageUrl = buildManagePrefsUrl();
  const appUrl = `${getAppUrl()}/app`;
  const safeTitle = escapeHtml(title);
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${safeTitle} — New Tech Aviation</title>
  <style>
    body { font-family: 'Helvetica Neue', Arial, sans-serif; background: #f4f6f9; margin: 0; padding: 40px 16px; color: #1a202c; }
    .card { max-width: 520px; margin: 0 auto; background: #fff; border-radius: 10px; padding: 32px; box-shadow: 0 2px 12px rgba(0,0,0,0.08); text-align: center; }
    h1 { font-size: 1.35rem; margin: 0 0 12px; color: ${color}; }
    p { font-size: 0.95rem; line-height: 1.6; color: #475569; margin: 0 0 20px; }
    a.btn, button.btn { display: inline-block; background: #0EA5E9; color: #fff; text-decoration: none; padding: 12px 22px; border-radius: 7px; font-weight: 600; font-size: 0.9rem; border: 0; cursor: pointer; }
    a.link { color: #0EA5E9; text-decoration: none; font-size: 0.88rem; }
  </style>
</head>
<body>
  <div class="card">
    <h1>${safeTitle}</h1>
    <p>${message}</p>
    ${actionHtml || `<a class="btn" href="${manageUrl}">Manage email preferences</a>`}
    <p style="margin-top:20px"><a class="link" href="${appUrl}">Open FlightSlate</a></p>
  </div>
</body>
</html>`;
}

function readUnsubscribeRequest(req) {
  const token = req.body?.token || req.query.token;
  const rawType = String(req.body?.type || req.query.type || 'all').trim();
  if (!token) {
    return { error: 'missing' };
  }
  if (rawType !== 'all' && !EMAIL_TYPES[rawType]) {
    return { error: 'type' };
  }
  const verified = verifyUnsubscribeToken(token, rawType);
  if (!verified) {
    return { error: 'token' };
  }
  return { token, rawType, verified };
}

function renderRequestError(error) {
  if (error === 'missing') {
    return {
      status: 400,
      page: renderPage({
        ok: false,
        title: 'Invalid link',
        message: 'This unsubscribe link is missing required information. Sign in and open My Account to manage email preferences.',
      }),
    };
  }
  if (error === 'type') {
    return {
      status: 400,
      page: renderPage({
        ok: false,
        title: 'Invalid preference type',
        message: 'This unsubscribe link is not valid. Sign in and open My Account to manage your email preferences.',
      }),
    };
  }
  return {
    status: 400,
    page: renderPage({
      ok: false,
      title: 'Link expired or invalid',
      message: 'This unsubscribe link is no longer valid. Sign in and open My Account to manage your email preferences.',
    }),
  };
}

async function applyUnsubscribe(userId, rawType) {
  await ensureDefaultPrefs(userId);

  if (rawType === 'all') {
    await updatePrefs(userId, { email_all_off: true });
  } else {
    await updatePrefs(userId, { [rawType]: false });
  }
}

function renderSuccess(rawType) {
  const label = typeLabel(rawType);
  return renderPage({
    ok: true,
    title: 'Unsubscribed',
    message: rawType === 'all'
      ? 'You will no longer receive email notifications from New Tech Aviation. Sign in and open My Account to turn individual types back on.'
      : `You have been unsubscribed from <strong>${label}</strong>. Other notification types are unchanged. Sign in to review all settings in My Account.`,
  });
}

router.get('/unsubscribe', async (req, res) => {
  try {
    const parsed = readUnsubscribeRequest(req);
    if (parsed.error) {
      const { status, page } = renderRequestError(parsed.error);
      return res.status(status).send(page);
    }

    const label = typeLabel(parsed.rawType);
    const actionHtml = `
      <form method="POST" action="/api/email/unsubscribe">
        <input type="hidden" name="token" value="${escapeHtml(parsed.token)}">
        <input type="hidden" name="type" value="${escapeHtml(parsed.rawType)}">
        <button class="btn" type="submit">Confirm unsubscribe</button>
      </form>
      <p style="margin-top:16px"><a class="link" href="${buildManagePrefsUrl()}">Manage all preferences instead</a></p>`;
    return res.send(renderPage({
      ok: true,
      title: 'Confirm unsubscribe',
      message: parsed.rawType === 'all'
        ? 'Please confirm that you want to unsubscribe from all email notifications from New Tech Aviation.'
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
    if (parsed.error) {
      const { status, page } = renderRequestError(parsed.error);
      return res.status(status).send(page);
    }

    await applyUnsubscribe(parsed.verified.userId, parsed.rawType);
    return res.send(renderSuccess(parsed.rawType));
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
