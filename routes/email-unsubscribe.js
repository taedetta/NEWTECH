'use strict';

const express = require('express');
const { verifyUnsubscribeToken, typeLabel, buildManagePrefsUrl } = require('../lib/unsubscribe-token');
const { updatePrefs, ensureDefaultPrefs } = require('../db/notification-prefs');
const { OPTIONAL_EMAIL_TYPES } = require('../lib/email-types');
const { getAppUrl } = require('../lib/app-url');

const router = express.Router();

function renderPage({ title, message, ok, actionHtml = '' }) {
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
    ${actionHtml}
    <a class="btn" href="${manageUrl}">Manage email preferences</a>
    <p style="margin-top:20px"><a class="link" href="${appUrl}">Open FlightSlate</a></p>
  </div>
</body>
</html>`;
}

function validateUnsubscribeRequest(req) {
  const token = req.query.token || req.body?.token;
  const rawType = String(req.query.type || req.body?.type || 'all').trim();
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

  if (rawType !== 'all' && !OPTIONAL_EMAIL_TYPES[rawType]) {
    return {
      error: {
        status: 400,
        title: 'Invalid preference type',
        message: 'This unsubscribe link is not valid. Sign in and open My Account to manage your email preferences.',
      },
    };
  }

  if (rawType !== verified.type) {
    return {
      error: {
        status: 400,
        title: 'Invalid preference type',
        message: 'This unsubscribe link does not match the requested email preference. Sign in and open My Account to manage your email preferences.',
      },
    };
  }

  return { token, type: rawType, userId: verified.userId };
}

function sendValidationError(res, error) {
  return res.status(error.status).send(renderPage({
    ok: false,
    title: error.title,
    message: error.message,
  }));
}

router.get('/unsubscribe', async (req, res) => {
  try {
    const validated = validateUnsubscribeRequest(req);
    if (validated.error) return sendValidationError(res, validated.error);

    const label = typeLabel(validated.type);
    const actionHtml = `
      <form method="POST" action="/api/email/unsubscribe?token=${encodeURIComponent(validated.token)}&type=${encodeURIComponent(validated.type)}" style="margin:0 0 16px;">
        <button class="btn" type="submit" style="border:0;cursor:pointer;background:#DC2626;">Confirm unsubscribe</button>
      </form>`;
    return res.send(renderPage({
      ok: true,
      title: 'Confirm unsubscribe',
      message: validated.type === 'all'
        ? 'Confirm that you want to stop optional email notifications from New Tech Aviation.'
        : `Confirm that you want to unsubscribe from <strong>${label}</strong>.`,
      actionHtml,
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
    const validated = validateUnsubscribeRequest(req);
    if (validated.error) return sendValidationError(res, validated.error);

    const rawType = validated.type;
    const label = typeLabel(rawType);
    await ensureDefaultPrefs(validated.userId);

    if (rawType === 'all') {
      await updatePrefs(validated.userId, { email_all_off: true });
    } else {
      await updatePrefs(validated.userId, { [rawType]: false });
    }

    return res.send(renderPage({
      ok: true,
      title: 'Unsubscribed',
      message: rawType === 'all'
        ? 'You will no longer receive optional email notifications from New Tech Aviation. Sign in and open My Account to turn individual types back on.'
        : `You have been unsubscribed from <strong>${label}</strong>. Other optional notification types are unchanged. Sign in to review all settings in My Account.`,
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
