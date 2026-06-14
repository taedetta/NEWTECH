'use strict';

const express = require('express');
const { verifyUnsubscribeToken, typeLabel, buildManagePrefsUrl } = require('../lib/unsubscribe-token');
const { updatePrefs, ensureDefaultPrefs } = require('../db/notification-prefs');
const { EMAIL_TYPES } = require('../lib/email-types');

const router = express.Router();

function renderPage({ title, message, ok }) {
  const color = ok ? '#059669' : '#DC2626';
  const manageUrl = buildManagePrefsUrl();
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
    <p style="margin-top:20px"><a class="link" href="${manageUrl.replace('?page=account-settings', '')}">Open FlightSlate</a></p>
  </div>
</body>
</html>`;
}

router.get('/unsubscribe', async (req, res) => {
  try {
    const token = req.query.token;
    const type = req.query.type || 'all';
    if (!token) {
      return res.status(400).send(renderPage({
        ok: false,
        title: 'Invalid link',
        message: 'This unsubscribe link is missing required information. Sign in and open My Account to manage email preferences.',
      }));
    }

    const verified = verifyUnsubscribeToken(token);
    if (!verified) {
      return res.status(400).send(renderPage({
        ok: false,
        title: 'Link expired or invalid',
        message: 'This unsubscribe link is no longer valid. Sign in and open My Account to manage your email preferences.',
      }));
    }

    const effectiveType = type === 'all' ? 'all' : (EMAIL_TYPES[type] ? type : verified.type);
    await ensureDefaultPrefs(verified.userId);

    if (effectiveType === 'all') {
      await updatePrefs(verified.userId, { email_all_off: true });
    } else {
      await updatePrefs(verified.userId, { [effectiveType]: false });
    }

    const label = typeLabel(effectiveType);
    return res.send(renderPage({
      ok: true,
      title: 'Unsubscribed',
      message: effectiveType === 'all'
        ? 'You will no longer receive email notifications from New Tech Aviation. You can turn individual types back on anytime in My Account.'
        : `You have been unsubscribed from <strong>${label}</strong>. Other email types are unchanged unless you turn them off separately.`,
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
