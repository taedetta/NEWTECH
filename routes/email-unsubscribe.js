'use strict';

const express = require('express');
const { verifyUnsubscribeToken, typeLabel, buildManagePrefsUrl } = require('../lib/unsubscribe-token');
const { updatePrefs, ensureDefaultPrefs } = require('../db/notification-prefs');
const { EMAIL_TYPES, REQUIRED_EMAIL_TYPES } = require('../lib/email-types');
const { getAppUrl } = require('../lib/app-url');

const router = express.Router();

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderPage({ title, message, ok, action }) {
  const color = ok ? '#059669' : '#DC2626';
  const manageUrl = buildManagePrefsUrl();
  const appUrl = `${getAppUrl()}/app`;
  const actionHtml = action ? `
    <form method="POST" action="/api/email/unsubscribe" style="margin:0 0 18px;">
      <input type="hidden" name="token" value="${escapeHtml(action.token)}">
      <input type="hidden" name="type" value="${escapeHtml(action.type)}">
      <button type="submit" style="background:#DC2626;color:#fff;border:0;border-radius:7px;padding:12px 22px;font-weight:700;font-size:0.9rem;cursor:pointer;">Confirm unsubscribe</button>
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

function validateUnsubscribeRequest(req) {
  const token = req.query.token || req.body?.token;
  const rawType = String(req.query.type || req.body?.type || '').trim();
  if (!token) {
    return {
      status: 400,
      page: {
        ok: false,
        title: 'Invalid link',
        message: 'This unsubscribe link is missing required information. Sign in and open My Account to manage email preferences.',
      },
    };
  }

  const verified = verifyUnsubscribeToken(token);
  if (!verified) {
    return {
      status: 400,
      page: {
        ok: false,
        title: 'Link expired or invalid',
        message: 'This unsubscribe link is no longer valid. Sign in and open My Account to manage your email preferences.',
      },
    };
  }

  if ((rawType && rawType !== verified.type) || (verified.type !== 'all' && !EMAIL_TYPES[verified.type]) || REQUIRED_EMAIL_TYPES.has(verified.type)) {
    return {
      status: 400,
      page: {
        ok: false,
        title: 'Invalid preference type',
        message: 'This unsubscribe link is not valid. Sign in and open My Account to manage your email preferences.',
      },
    };
  }

  return { token, type: verified.type, userId: verified.userId };
}

router.get('/unsubscribe', async (req, res) => {
  try {
    const validation = validateUnsubscribeRequest(req);
    if (validation.page) return res.status(validation.status).send(renderPage(validation.page));
    const label = typeLabel(validation.type);
    return res.send(renderPage({
      ok: true,
      title: 'Confirm unsubscribe',
      message: validation.type === 'all'
        ? 'Please confirm that you want to turn off optional email notifications from New Tech Aviation. Required account and security emails will still be delivered.'
        : `Please confirm that you want to unsubscribe from <strong>${label}</strong>. Other notification types are unchanged.`,
      action: { token: validation.token, type: validation.type },
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
    const validation = validateUnsubscribeRequest(req);
    if (validation.page) return res.status(validation.status).send(renderPage(validation.page));

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
        ? 'Optional email notifications from New Tech Aviation are now turned off. Required account and security emails will still be delivered.'
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
