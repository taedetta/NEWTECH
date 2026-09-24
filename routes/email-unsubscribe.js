'use strict';

const express = require('express');
const { verifyUnsubscribeToken, typeLabel, buildManagePrefsUrl } = require('../lib/unsubscribe-token');
const { updatePrefs, ensureDefaultPrefs } = require('../db/notification-prefs');
const { EMAIL_TYPES, isRequiredEmailType } = require('../lib/email-types');
const { getAppUrl } = require('../lib/app-url');

const router = express.Router();

function renderPage({ title, message, ok, confirm }) {
  const color = ok ? '#059669' : '#DC2626';
  const manageUrl = buildManagePrefsUrl();
  const appUrl = `${getAppUrl()}/app`;
  const confirmHtml = confirm ? `
    <form method="POST" action="/api/email/unsubscribe?token=${encodeURIComponent(confirm.token)}&type=${encodeURIComponent(confirm.type)}" style="margin:0 0 18px;">
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
    a.btn, button.btn { display: inline-block; background: #0EA5E9; color: #fff; text-decoration: none; padding: 12px 22px; border: 0; border-radius: 7px; font-weight: 600; font-size: 0.9rem; cursor: pointer; }
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

function validateRequest(req) {
  const token = req.query.token;
  const rawType = String(req.query.type || 'all').trim();
  if (!token) {
    return {
      error: {
        status: 400,
        title: 'Invalid link',
        message: 'This unsubscribe link is missing required information. Sign in and open My Account to manage email preferences.',
      },
    };
  }

  const verified = verifyUnsubscribeToken(token);
  if (!verified) {
    return {
      error: {
        status: 400,
        title: 'Link expired or invalid',
        message: 'This unsubscribe link is no longer valid. Sign in and open My Account to manage your email preferences.',
      },
    };
  }

  if (rawType !== 'all' && !EMAIL_TYPES[rawType]) {
    return {
      error: {
        status: 400,
        title: 'Invalid preference type',
        message: 'This unsubscribe link is not valid. Sign in and open My Account to manage your email preferences.',
      },
    };
  }

  if (verified.type !== rawType) {
    return {
      error: {
        status: 400,
        title: 'Invalid preference type',
        message: 'This unsubscribe link does not match the notification type requested. Sign in and open My Account to manage your email preferences.',
      },
    };
  }

  if (rawType !== 'all' && isRequiredEmailType(rawType)) {
    return {
      error: {
        status: 400,
        title: 'Required notification',
        message: 'This notification type is required for account security and cannot be disabled.',
      },
    };
  }

  return { token, type: rawType, userId: verified.userId };
}

router.get('/unsubscribe', async (req, res) => {
  const validation = validateRequest(req);
  if (validation.error) {
    return res.status(validation.error.status).send(renderPage({
      ok: false,
      title: validation.error.title,
      message: validation.error.message,
    }));
  }

  const label = typeLabel(validation.type);
  return res.send(renderPage({
    ok: true,
    title: 'Confirm unsubscribe',
    message: validation.type === 'all'
      ? 'Please confirm that you want to unsubscribe from optional email notifications from New Tech Aviation. Required account and security emails will still be sent.'
      : `Please confirm that you want to unsubscribe from <strong>${label}</strong>. Other notification types are unchanged.`,
    confirm: { token: validation.token, type: validation.type },
  }));
});

router.post('/unsubscribe', async (req, res) => {
  try {
    const validation = validateRequest(req);
    if (validation.error) {
      return res.status(validation.error.status).send(renderPage({
        ok: false,
        title: validation.error.title,
        message: validation.error.message,
      }));
    }

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
    console.error('[email-unsubscribe] error:', err.message);
    res.status(500).send(renderPage({
      ok: false,
      title: 'Something went wrong',
      message: 'We could not process your unsubscribe request. Please try again or manage preferences in My Account.',
    }));
  }
});

module.exports = router;
