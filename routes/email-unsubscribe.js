'use strict';

const express = require('express');
const { verifyUnsubscribeToken, typeLabel, buildManagePrefsUrl } = require('../lib/unsubscribe-token');
const { updatePrefs, ensureDefaultPrefs } = require('../db/notification-prefs');
const { EMAIL_TYPES } = require('../lib/email-types');
const { getAppUrl } = require('../lib/app-url');

const router = express.Router();

function escHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function resolveRequest(query) {
  const token = query.token;
  const rawType = query.type == null ? null : String(query.type).trim();
  if (!token) {
    return {
      errorStatus: 400,
      title: 'Invalid link',
      message: 'This unsubscribe link is missing required information. Sign in and open My Account to manage email preferences.',
    };
  }

  const verified = verifyUnsubscribeToken(token);
  if (!verified) {
    return {
      errorStatus: 400,
      title: 'Link expired or invalid',
      message: 'This unsubscribe link is no longer valid. Sign in and open My Account to manage your email preferences.',
    };
  }

  if (rawType && rawType !== verified.emailType) {
    return {
      errorStatus: 400,
      title: 'Invalid preference type',
      message: 'This unsubscribe link is not valid. Sign in and open My Account to manage your email preferences.',
    };
  }

  if (verified.emailType !== 'all' && !EMAIL_TYPES[verified.emailType]) {
    return {
      errorStatus: 400,
      title: 'Invalid preference type',
      message: 'This unsubscribe link is not valid. Sign in and open My Account to manage your email preferences.',
    };
  }

  return { token: String(token), userId: verified.userId, emailType: verified.emailType };
}

function renderPage({ title, message, ok, confirmAction, confirmLabel }) {
  const color = ok ? '#059669' : '#DC2626';
  const manageUrl = buildManagePrefsUrl();
  const appUrl = `${getAppUrl()}/app`;
  const buttonHtml = confirmAction
    ? `<form method="POST" action="${escHtml(confirmAction)}" style="margin:0 0 20px;">
        <button class="btn" type="submit">${escHtml(confirmLabel || 'Confirm unsubscribe')}</button>
      </form>`
    : `<a class="btn" href="${escHtml(manageUrl)}">Manage email preferences</a>`;
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
    <h1>${escHtml(title)}</h1>
    <p>${message}</p>
    ${buttonHtml}
    <p style="margin-top:20px"><a class="link" href="${escHtml(appUrl)}">Open FlightSlate</a></p>
  </div>
</body>
</html>`;
}

router.get('/unsubscribe', async (req, res) => {
  try {
    const request = resolveRequest(req.query);
    if (request.errorStatus) {
      return res.status(request.errorStatus).send(renderPage({
        ok: false,
        title: request.title,
        message: escHtml(request.message),
      }));
    }

    const label = typeLabel(request.emailType);
    const action = `/api/email/unsubscribe?token=${encodeURIComponent(request.token)}&type=${encodeURIComponent(request.emailType)}`;
    return res.send(renderPage({
      ok: true,
      title: 'Confirm unsubscribe',
      message: request.emailType === 'all'
        ? 'Confirm that you want to unsubscribe from optional email notifications. Required account and security emails will still be sent.'
        : `Confirm that you want to unsubscribe from ${escHtml(label)}. Other notification types are unchanged.`,
      confirmAction: action,
      confirmLabel: 'Confirm unsubscribe',
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
    const request = resolveRequest(req.query);
    if (request.errorStatus) {
      return res.status(request.errorStatus).send(renderPage({
        ok: false,
        title: request.title,
        message: escHtml(request.message),
      }));
    }

    await ensureDefaultPrefs(request.userId);

    if (request.emailType === 'all') {
      await updatePrefs(request.userId, { email_all_off: true });
    } else {
      await updatePrefs(request.userId, { [request.emailType]: false });
    }

    const label = typeLabel(request.emailType);
    return res.send(renderPage({
      ok: true,
      title: 'Unsubscribed',
      message: request.emailType === 'all'
        ? 'You will no longer receive optional email notifications from New Tech Aviation. Required account and security emails will still be sent.'
        : `You have been unsubscribed from <strong>${escHtml(label)}</strong>. Other notification types are unchanged. Sign in to review all settings in My Account.`,
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
module.exports.resolveRequest = resolveRequest;
