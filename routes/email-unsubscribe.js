'use strict';

const express = require('express');
const { verifyUnsubscribeToken, typeLabel, buildManagePrefsUrl } = require('../lib/unsubscribe-token');
const { updatePrefs, ensureDefaultPrefs } = require('../db/notification-prefs');
const { EMAIL_TYPES, isRequiredEmailType } = require('../lib/email-types');
const { getAppUrl } = require('../lib/app-url');

const router = express.Router();
router.use(express.urlencoded({ extended: false }));

function escHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderPage({ title, message, ok }) {
  const color = ok ? '#059669' : '#DC2626';
  const manageUrl = buildManagePrefsUrl();
  const appUrl = `${getAppUrl()}/app`;
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escHtml(title)} — New Tech Aviation</title>
  <style>
    body { font-family: 'Helvetica Neue', Arial, sans-serif; background: #f4f6f9; margin: 0; padding: 40px 16px; color: #1a202c; }
    .card { max-width: 520px; margin: 0 auto; background: #fff; border-radius: 10px; padding: 32px; box-shadow: 0 2px 12px rgba(0,0,0,0.08); text-align: center; }
    h1 { font-size: 1.35rem; margin: 0 0 12px; color: ${color}; }
    p { font-size: 0.95rem; line-height: 1.6; color: #475569; margin: 0 0 20px; }
    a.btn { display: inline-block; background: #0EA5E9; color: #fff; text-decoration: none; padding: 12px 22px; border-radius: 7px; font-weight: 600; font-size: 0.9rem; }
    a.link { color: #0EA5E9; text-decoration: none; font-size: 0.88rem; }
    button.btn { border: 0; cursor: pointer; background: #0EA5E9; color: #fff; padding: 12px 22px; border-radius: 7px; font-weight: 600; font-size: 0.9rem; }
  </style>
</head>
<body>
  <div class="card">
    <h1>${escHtml(title)}</h1>
    <p>${message}</p>
    <a class="btn" href="${manageUrl}">Manage email preferences</a>
    <p style="margin-top:20px"><a class="link" href="${appUrl}">Open FlightSlate</a></p>
  </div>
</body>
</html>`;
}

function validateUnsubscribeParams(token, rawType) {
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

  if (verified.type && verified.type !== rawType) {
    return {
      error: {
        status: 400,
        title: 'Invalid preference type',
        message: 'This unsubscribe link can only update the email type it was created for.',
      },
    };
  }

  if (rawType !== 'all' && isRequiredEmailType(rawType)) {
    return {
      error: {
        status: 400,
        title: 'Required email',
        message: 'This account email type is required for security and cannot be disabled.',
      },
    };
  }

  return { verified, rawType };
}

function renderConfirmPage({ token, rawType }) {
  const label = typeLabel(rawType);
  const message = rawType === 'all'
    ? 'Please confirm that you want to unsubscribe from optional email notifications. Required security and account-access emails will still be delivered.'
    : `Please confirm that you want to unsubscribe from <strong>${escHtml(label)}</strong>.`;
  const manageUrl = buildManagePrefsUrl();
  const appUrl = `${getAppUrl()}/app`;
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Confirm unsubscribe — New Tech Aviation</title>
  <style>
    body { font-family: 'Helvetica Neue', Arial, sans-serif; background: #f4f6f9; margin: 0; padding: 40px 16px; color: #1a202c; }
    .card { max-width: 520px; margin: 0 auto; background: #fff; border-radius: 10px; padding: 32px; box-shadow: 0 2px 12px rgba(0,0,0,0.08); text-align: center; }
    h1 { font-size: 1.35rem; margin: 0 0 12px; color: #0f172a; }
    p { font-size: 0.95rem; line-height: 1.6; color: #475569; margin: 0 0 20px; }
    button.btn { border: 0; cursor: pointer; background: #DC2626; color: #fff; padding: 12px 22px; border-radius: 7px; font-weight: 600; font-size: 0.9rem; }
    a.link { color: #0EA5E9; text-decoration: none; font-size: 0.88rem; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Confirm unsubscribe</h1>
    <p>${message}</p>
    <form method="post" action="/api/email/unsubscribe">
      <input type="hidden" name="token" value="${escHtml(token)}">
      <input type="hidden" name="type" value="${escHtml(rawType)}">
      <button class="btn" type="submit">Confirm unsubscribe</button>
    </form>
    <p style="margin-top:20px"><a class="link" href="${manageUrl}">Manage preferences instead</a></p>
    <p><a class="link" href="${appUrl}">Open FlightSlate</a></p>
  </div>
</body>
</html>`;
}

router.get('/unsubscribe', (req, res) => {
  try {
    const token = req.query.token;
    const rawType = String(req.query.type || 'all').trim();
    const checked = validateUnsubscribeParams(token, rawType);
    if (checked.error) {
      return res.status(checked.error.status).send(renderPage({ ok: false, ...checked.error }));
    }
    return res.send(renderConfirmPage({ token, rawType: checked.rawType }));
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
    const token = req.body.token;
    const rawType = String(req.body.type || 'all').trim();
    const checked = validateUnsubscribeParams(token, rawType);
    if (checked.error) {
      return res.status(checked.error.status).send(renderPage({ ok: false, ...checked.error }));
    }

    await ensureDefaultPrefs(checked.verified.userId);

    if (checked.rawType === 'all') {
      await updatePrefs(checked.verified.userId, { email_all_off: true });
    } else {
      await updatePrefs(checked.verified.userId, { [checked.rawType]: false });
    }

    const label = typeLabel(checked.rawType);
    return res.send(renderPage({
      ok: true,
      title: 'Unsubscribed',
      message: checked.rawType === 'all'
        ? 'You will no longer receive optional email notifications from New Tech Aviation. Required security and account-access emails will still be delivered.'
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
