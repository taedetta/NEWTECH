'use strict';

const express = require('express');
const { verifyUnsubscribeToken, typeLabel, buildManagePrefsUrl } = require('../lib/unsubscribe-token');
const { updatePrefs, ensureDefaultPrefs } = require('../db/notification-prefs');
const { EMAIL_TYPES } = require('../lib/email-types');
const { getAppUrl } = require('../lib/app-url');

const router = express.Router();
const unsubscribeFormParser = express.urlencoded({ extended: false });

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderPage({ title, message, ok, actionsHtml }) {
  const color = ok ? '#059669' : '#DC2626';
  const manageUrl = buildManagePrefsUrl();
  const appUrl = `${getAppUrl()}/app`;
  const actions = actionsHtml || `<a class="btn" href="${manageUrl}">Manage email preferences</a>`;
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
    .btn.secondary { background: #e2e8f0; color: #334155; margin-left: 8px; }
    a.link { color: #0EA5E9; text-decoration: none; font-size: 0.88rem; }
    form { margin: 0 0 20px; }
  </style>
</head>
<body>
  <div class="card">
    <h1>${title}</h1>
    <p>${message}</p>
    ${actions}
    <p style="margin-top:20px"><a class="link" href="${appUrl}">Open FlightSlate</a></p>
  </div>
</body>
</html>`;
}

function renderConfirmPage({ token, rawType }) {
  const label = typeLabel(rawType);
  const manageUrl = buildManagePrefsUrl();
  return renderPage({
    ok: true,
    title: 'Confirm unsubscribe',
    message: rawType === 'all'
      ? 'Please confirm that you want to unsubscribe from all email notifications from New Tech Aviation.'
      : `Please confirm that you want to unsubscribe from <strong>${escapeHtml(label)}</strong>. Other notification types will remain unchanged.`,
    actionsHtml: `
      <form method="POST" action="/api/email/unsubscribe">
        <input type="hidden" name="token" value="${escapeHtml(token)}">
        <input type="hidden" name="type" value="${escapeHtml(rawType)}">
        <button class="btn" type="submit">Confirm unsubscribe</button>
        <a class="btn secondary" href="${manageUrl}">Keep emails on</a>
      </form>`,
  });
}

function invalidType(rawType) {
  return rawType !== 'all' && !EMAIL_TYPES[rawType];
}

router.get('/unsubscribe', async (req, res) => {
  try {
    const token = req.query.token;
    const rawType = String(req.query.type || 'all').trim();
    if (!token) {
      return res.status(400).send(renderPage({
        ok: false,
        title: 'Invalid link',
        message: 'This unsubscribe link is missing required information. Sign in and open My Account to manage email preferences.',
      }));
    }

    if (invalidType(rawType)) {
      return res.status(400).send(renderPage({
        ok: false,
        title: 'Invalid preference type',
        message: 'This unsubscribe link is not valid. Sign in and open My Account to manage your email preferences.',
      }));
    }

    const verified = verifyUnsubscribeToken(token, rawType);
    if (!verified) {
      return res.status(400).send(renderPage({
        ok: false,
        title: 'Link expired or invalid',
        message: 'This unsubscribe link is no longer valid. Sign in and open My Account to manage your email preferences.',
      }));
    }

    return res.send(renderConfirmPage({ token, rawType }));
  } catch (err) {
    console.error('[email-unsubscribe] error:', err.message);
    res.status(500).send(renderPage({
      ok: false,
      title: 'Something went wrong',
      message: 'We could not process your unsubscribe request. Please try again or manage preferences in My Account.',
    }));
  }
});

router.post('/unsubscribe', unsubscribeFormParser, async (req, res) => {
  try {
    const token = req.body?.token;
    const rawType = String(req.body?.type || 'all').trim();
    if (!token) {
      return res.status(400).send(renderPage({
        ok: false,
        title: 'Invalid link',
        message: 'This unsubscribe request is missing required information. Sign in and open My Account to manage email preferences.',
      }));
    }

    if (invalidType(rawType)) {
      return res.status(400).send(renderPage({
        ok: false,
        title: 'Invalid preference type',
        message: 'This unsubscribe link is not valid. Sign in and open My Account to manage your email preferences.',
      }));
    }

    const verified = verifyUnsubscribeToken(token, rawType);
    if (!verified) {
      return res.status(400).send(renderPage({
        ok: false,
        title: 'Link expired or invalid',
        message: 'This unsubscribe link is no longer valid. Sign in and open My Account to manage your email preferences.',
      }));
    }

    await ensureDefaultPrefs(verified.userId);

    if (rawType === 'all') {
      await updatePrefs(verified.userId, { email_all_off: true });
    } else {
      await updatePrefs(verified.userId, { [rawType]: false });
    }

    const label = typeLabel(rawType);
    return res.send(renderPage({
      ok: true,
      title: 'Unsubscribed',
      message: rawType === 'all'
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
