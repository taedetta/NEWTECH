'use strict';

const express = require('express');
const { verifyUnsubscribeToken, typeLabel, buildManagePrefsUrl } = require('../lib/unsubscribe-token');
const { updatePrefs, ensureDefaultPrefs } = require('../db/notification-prefs');
const { EMAIL_TYPES, isRequiredEmailType } = require('../lib/email-types');
const { getAppUrl } = require('../lib/app-url');

const router = express.Router();

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderPage({ title, message, ok, token, type }) {
  const color = ok ? '#059669' : '#DC2626';
  const manageUrl = buildManagePrefsUrl();
  const appUrl = `${getAppUrl()}/app`;
  const action = token && type
    ? `/api/email/unsubscribe?token=${encodeURIComponent(token)}&type=${encodeURIComponent(type)}`
    : '';
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
    <h1>${escapeHtml(title)}</h1>
    <p>${message}</p>
    ${action ? `<form method="POST" action="${escapeHtml(action)}" style="margin:0 0 16px"><button type="submit" class="btn">Confirm unsubscribe</button></form>` : ''}
    <a class="btn" href="${manageUrl}">Manage email preferences</a>
    <p style="margin-top:20px"><a class="link" href="${appUrl}">Open FlightSlate</a></p>
  </div>
</body>
</html>`;
}

function getRequestTokenAndType(req) {
  return {
    token: req.body?.token || req.query.token,
    rawType: String(req.body?.type || req.query.type || '').trim(),
  };
}

function validateUnsubscribeRequest(token, rawType) {
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

  const expectedType = verified.type;
  if (!expectedType || isRequiredEmailType(expectedType)) {
    return {
      status: 400,
      page: {
        ok: false,
        title: 'Invalid preference type',
        message: 'This unsubscribe link is not valid. Sign in and open My Account to manage your email preferences.',
      },
    };
  }

  if (rawType && rawType !== expectedType) {
    return {
      status: 400,
      page: {
        ok: false,
        title: 'Invalid preference type',
        message: 'This unsubscribe link does not match the requested preference. Sign in and open My Account to manage your email preferences.',
      },
    };
  }

  if (expectedType !== 'all' && !EMAIL_TYPES[expectedType]) {
    return {
      status: 400,
      page: {
        ok: false,
        title: 'Invalid preference type',
        message: 'This unsubscribe link is not valid. Sign in and open My Account to manage your email preferences.',
      },
    };
  }

  return { verified, type: expectedType };
}

router.get('/unsubscribe', async (req, res) => {
  try {
    const { token, rawType } = getRequestTokenAndType(req);
    const validation = validateUnsubscribeRequest(token, rawType);
    if (validation.page) return res.status(validation.status).send(renderPage(validation.page));

    const label = typeLabel(validation.type);
    return res.send(renderPage({
      ok: true,
      title: 'Confirm unsubscribe',
      message: validation.type === 'all'
        ? 'Please confirm that you want to stop optional email notifications from New Tech Aviation. Required account and security emails will still be sent.'
        : `Please confirm that you want to unsubscribe from <strong>${escapeHtml(label)}</strong>. Other notification types are unchanged.`,
      token,
      type: validation.type,
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
    const { token, rawType } = getRequestTokenAndType(req);
    const validation = validateUnsubscribeRequest(token, rawType);
    if (validation.page) return res.status(validation.status).send(renderPage(validation.page));

    await ensureDefaultPrefs(validation.verified.userId);

    if (validation.type === 'all') {
      await updatePrefs(validation.verified.userId, { email_all_off: true });
    } else {
      await updatePrefs(validation.verified.userId, { [validation.type]: false });
    }

    const label = typeLabel(validation.type);
    return res.send(renderPage({
      ok: true,
      title: 'Unsubscribed',
      message: validation.type === 'all'
        ? 'You will no longer receive optional email notifications from New Tech Aviation. Required account and security emails will still be sent.'
        : `You have been unsubscribed from <strong>${escapeHtml(label)}</strong>. Other notification types are unchanged. Sign in to review all settings in My Account.`,
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
