'use strict';

const express = require('express');
const {
  verifyUnsubscribeToken,
  normalizeUnsubscribeType,
  typeLabel,
  buildManagePrefsUrl,
} = require('../lib/unsubscribe-token');
const { updatePrefs, ensureDefaultPrefs } = require('../db/notification-prefs');
const { getAppUrl } = require('../lib/app-url');

const router = express.Router();

function escHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderPage({ title, message, ok, actionUrl }) {
  const color = ok ? '#059669' : '#DC2626';
  const manageUrl = buildManagePrefsUrl();
  const appUrl = `${getAppUrl()}/app`;
  const action = actionUrl ? `
    <form method="POST" action="${escHtml(actionUrl)}" style="margin:0 0 20px;">
      <button class="btn" type="submit">Confirm unsubscribe</button>
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
    .btn { display: inline-block; background: #0EA5E9; color: #fff; text-decoration: none; padding: 12px 22px; border-radius: 7px; font-weight: 600; font-size: 0.9rem; border: 0; cursor: pointer; }
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

function validateUnsubscribeRequest(req, res) {
  const token = req.query.token;
  const rawType = String(req.query.type || 'all').trim();
  const safeType = normalizeUnsubscribeType(rawType);
  if (!token || !safeType) {
    res.status(400).send(renderPage({
      ok: false,
      title: 'Invalid link',
      message: 'This unsubscribe link is missing required information. Sign in and open My Account to manage email preferences.',
    }));
    return null;
  }

  const verified = verifyUnsubscribeToken(token, safeType);
  if (!verified) {
    res.status(400).send(renderPage({
      ok: false,
      title: 'Link expired or invalid',
      message: 'This unsubscribe link is no longer valid. Sign in and open My Account to manage your email preferences.',
    }));
    return null;
  }

  return { token, userId: verified.userId, type: verified.type };
}

router.get('/unsubscribe', async (req, res) => {
  try {
    const validated = validateUnsubscribeRequest(req, res);
    if (!validated) return;
    const label = typeLabel(validated.type);
    const actionUrl = `/api/email/unsubscribe?token=${encodeURIComponent(validated.token)}&type=${encodeURIComponent(validated.type)}`;
    return res.send(renderPage({
      ok: true,
      title: 'Confirm unsubscribe',
      message: validated.type === 'all'
        ? 'Please confirm that you want to unsubscribe from all optional email notifications from New Tech Aviation.'
        : `Please confirm that you want to unsubscribe from <strong>${label}</strong>.`,
      actionUrl,
    }));
  } catch (err) {
    console.error('[email-unsubscribe] confirmation error:', err.message);
    res.status(500).send(renderPage({
      ok: false,
      title: 'Something went wrong',
      message: 'We could not process your unsubscribe request. Please try again or manage preferences in My Account.',
    }));
  }
});

router.post('/unsubscribe', async (req, res) => {
  try {
    const validated = validateUnsubscribeRequest(req, res);
    if (!validated) return;
    await ensureDefaultPrefs(validated.userId);

    if (validated.type === 'all') {
      await updatePrefs(validated.userId, { email_all_off: true });
    } else {
      await updatePrefs(validated.userId, { [validated.type]: false });
    }

    const label = typeLabel(validated.type);
    return res.send(renderPage({
      ok: true,
      title: 'Unsubscribed',
      message: validated.type === 'all'
        ? 'You will no longer receive email notifications from New Tech Aviation. Sign in and open My Account to turn individual types back on.'
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
