'use strict';

const express = require('express');
const { verifyUnsubscribeToken, typeLabel, buildManagePrefsUrl } = require('../lib/unsubscribe-token');
const { updatePrefs, ensureDefaultPrefs } = require('../db/notification-prefs');
const { EMAIL_TYPES, isRequiredEmailType } = require('../lib/email-types');
const { getAppUrl } = require('../lib/app-url');

const router = express.Router();

function renderPage({ title, message, ok, actionUrl, actionLabel }) {
  const color = ok ? '#059669' : '#DC2626';
  const manageUrl = buildManagePrefsUrl();
  const appUrl = `${getAppUrl()}/app`;
  const action = actionUrl ? `
    <form method="POST" action="${actionUrl}" style="margin:0 0 18px;">
      <button type="submit" class="btn">${actionLabel || 'Confirm unsubscribe'}</button>
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
    button.btn { border: 0; cursor: pointer; background: #0EA5E9; color: #fff; padding: 12px 22px; border-radius: 7px; font-weight: 600; font-size: 0.9rem; }
    a.link { color: #0EA5E9; text-decoration: none; font-size: 0.88rem; }
  </style>
</head>
<body>
  <div class="card">
    <h1>${title}</h1>
    <p>${message}</p>
    ${action}
    <a class="btn" href="${manageUrl}">Manage email preferences</a>
    <p style="margin-top:20px"><a class="link" href="${appUrl}">Open FlightSlate</a></p>
  </div>
</body>
</html>`;
}

function invalidPage(message) {
  return renderPage({ ok: false, title: 'Invalid link', message });
}

function verifyRequest(req, res) {
  const token = req.query.token;
  const queryType = req.query.type ? String(req.query.type).trim() : null;
  if (!token) {
    res.status(400).send(invalidPage('This unsubscribe link is missing required information. Sign in and open My Account to manage email preferences.'));
    return null;
  }

  const verified = verifyUnsubscribeToken(token);
  if (!verified) {
    res.status(400).send(renderPage({
      ok: false,
      title: 'Link expired or invalid',
      message: 'This unsubscribe link is no longer valid. Sign in and open My Account to manage your email preferences.',
    }));
    return null;
  }

  if (queryType && queryType !== verified.type) {
    res.status(400).send(invalidPage('This unsubscribe link is not valid. Sign in and open My Account to manage your email preferences.'));
    return null;
  }

  if (verified.type !== 'all' && (!EMAIL_TYPES[verified.type] || isRequiredEmailType(verified.type))) {
    res.status(400).send(invalidPage('This notification type cannot be disabled. Sign in and open My Account to manage optional email preferences.'));
    return null;
  }

  return { token, verified };
}

router.get('/unsubscribe', async (req, res) => {
  const checked = verifyRequest(req, res);
  if (!checked) return;

  const { token, verified } = checked;
  const label = typeLabel(verified.type);
  const actionUrl = `/api/email/unsubscribe?token=${encodeURIComponent(token)}&type=${encodeURIComponent(verified.type)}`;
  return res.send(renderPage({
    ok: true,
    title: 'Confirm unsubscribe',
    message: verified.type === 'all'
      ? 'Please confirm that you want to turn off optional email notifications from New Tech Aviation. Required account and security emails will still be sent.'
      : `Please confirm that you want to unsubscribe from <strong>${label}</strong>. Other notification types are unchanged.`,
    actionUrl,
    actionLabel: verified.type === 'all' ? 'Turn off optional emails' : `Unsubscribe from ${label}`,
  }));
});

router.post('/unsubscribe', async (req, res) => {
  try {
    const checked = verifyRequest(req, res);
    if (!checked) return;

    const { verified } = checked;
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
        ? 'Optional email notifications from New Tech Aviation have been turned off. Required account and security emails will still be sent.'
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
