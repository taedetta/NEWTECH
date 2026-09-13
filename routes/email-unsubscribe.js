'use strict';

const express = require('express');
const { verifyUnsubscribeToken, typeLabel, buildManagePrefsUrl } = require('../lib/unsubscribe-token');
const { updatePrefs } = require('../db/notification-prefs');
const { EMAIL_TYPES, isRequiredEmailType } = require('../lib/email-types');
const { getAppUrl } = require('../lib/app-url');

const router = express.Router();

function renderPage({ title, message, ok, confirmAction, confirmLabel }) {
  const color = ok ? '#059669' : '#DC2626';
  const manageUrl = buildManagePrefsUrl();
  const appUrl = `${getAppUrl()}/app`;
  const confirmForm = confirmAction ? `
    <form method="POST" action="${confirmAction}" style="margin:0 0 20px;">
      <button type="submit" style="display:inline-block;background:#DC2626;color:#fff;border:0;padding:12px 22px;border-radius:7px;font-weight:600;font-size:0.9rem;cursor:pointer;">${confirmLabel || 'Confirm unsubscribe'}</button>
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
    ${confirmForm}
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

  if (rawType !== 'all' && !EMAIL_TYPES[rawType]) {
    return {
      status: 400,
      page: {
        ok: false,
        title: 'Invalid preference type',
        message: 'This unsubscribe link is not valid. Sign in and open My Account to manage your email preferences.',
      },
    };
  }

  if (!verified.type || verified.type !== rawType) {
    return {
      status: 400,
      page: {
        ok: false,
        title: 'Link expired or invalid',
        message: 'This unsubscribe link is no longer valid. Sign in and open My Account to manage your email preferences.',
      },
    };
  }

  if (rawType !== 'all' && isRequiredEmailType(rawType)) {
    return {
      status: 400,
      page: {
        ok: false,
        title: 'Required email',
        message: 'This email type is required for account security and cannot be disabled.',
      },
    };
  }

  return { verified, rawType, label: typeLabel(rawType) };
}

router.get('/unsubscribe', async (req, res) => {
  try {
    const validation = validateRequest(req);
    if (validation.page) {
      return res.status(validation.status).send(renderPage(validation.page));
    }

    const { rawType, label } = validation;
    return res.send(renderPage({
      ok: true,
      title: 'Confirm unsubscribe',
      message: rawType === 'all'
        ? 'Please confirm that you want to unsubscribe from optional email notifications from New Tech Aviation.'
        : `Please confirm that you want to unsubscribe from <strong>${label}</strong>.`,
      confirmAction: `/api/email/unsubscribe?token=${encodeURIComponent(req.query.token)}&type=${encodeURIComponent(rawType)}`,
      confirmLabel: rawType === 'all' ? 'Unsubscribe from optional emails' : `Unsubscribe from ${label}`,
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
    const validation = validateRequest(req);
    if (validation.page) {
      return res.status(validation.status).send(renderPage(validation.page));
    }

    const { verified, rawType, label } = validation;
    if (rawType === 'all') {
      await updatePrefs(verified.userId, { email_all_off: true });
    } else {
      await updatePrefs(verified.userId, { [rawType]: false });
    }

    return res.send(renderPage({
      ok: true,
      title: 'Unsubscribed',
      message: rawType === 'all'
        ? 'You will no longer receive optional email notifications from New Tech Aviation. Sign in and open My Account to turn individual types back on.'
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
