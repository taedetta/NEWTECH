'use strict';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'critical-bug-regression-secret';
process.env.APP_URL = process.env.APP_URL || 'https://www.newtechaviation.com';

const assert = require('assert');
const express = require('express');
const http = require('http');
const jwt = require('jsonwebtoken');

const prefsModulePath = require.resolve('../db/notification-prefs');
const updateCalls = [];
let getPrefsCalls = 0;

require.cache[prefsModulePath] = {
  id: prefsModulePath,
  filename: prefsModulePath,
  loaded: true,
  exports: {
    ensureDefaultPrefs: async () => {},
    getPrefs: async () => {
      getPrefsCalls += 1;
      return { email_all_off: true, booking_confirmation: false, endorsement_expiry: true };
    },
    updatePrefs: async (userId, patch) => {
      updateCalls.push({ userId, patch });
      return { email_all_off: !!patch.email_all_off, ...patch };
    },
  },
};

const {
  signUnsubscribeToken,
  verifyUnsubscribeToken,
  buildUnsubscribeUrl,
} = require('../lib/unsubscribe-token');
const {
  appendUnsubscribeFooter,
  getPreferenceCatalog,
  shouldSendEmail,
  EMAIL_TYPES,
} = require('../lib/notification-prefs');
const emailUnsubscribeRoutes = require('../routes/email-unsubscribe');

function request(app, method, path) {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, () => {
      const { port } = server.address();
      const req = http.request({ port, method, path }, (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => { body += chunk; });
        res.on('end', () => {
          server.close(() => resolve({ statusCode: res.statusCode, body }));
        });
      });
      req.on('error', (err) => {
        server.close(() => reject(err));
      });
      req.end();
    });
  });
}

(async () => {
  const token = signUnsubscribeToken(42, EMAIL_TYPES.booking_confirmation);
  assert.deepStrictEqual(verifyUnsubscribeToken(token), {
    userId: 42,
    type: EMAIL_TYPES.booking_confirmation,
  });

  const legacyToken = jwt.sign({ uid: 42, aud: 'email-unsub' }, process.env.JWT_SECRET);
  assert.strictEqual(verifyUnsubscribeToken(legacyToken), null, 'legacy user-only tokens must be rejected');

  const requiredUrl = buildUnsubscribeUrl(42, EMAIL_TYPES.password_reset);
  assert.match(requiredUrl, /[?&]type=all(?:&|$)/, 'required email types must not get type-specific unsubscribe links');

  const catalogJson = JSON.stringify(getPreferenceCatalog('admin', false));
  assert(!catalogJson.includes('password_reset'), 'required password reset email must not be user-toggleable');
  assert(!catalogJson.includes('account_approved'), 'required account lifecycle emails must not be user-toggleable');

  const requiredSend = await shouldSendEmail(42, EMAIL_TYPES.password_reset);
  assert.strictEqual(requiredSend, true, 'required emails must ignore email_all_off and per-type opt-outs');
  assert.strictEqual(getPrefsCalls, 0, 'required email checks must not consult mutable preferences');

  const optionalSend = await shouldSendEmail(42, EMAIL_TYPES.booking_confirmation);
  assert.strictEqual(optionalSend, false, 'optional emails should still honor email_all_off');
  assert.strictEqual(getPrefsCalls, 1);

  const requiredFooter = appendUnsubscribeFooter('<p>reset</p>', 'reset', 42, EMAIL_TYPES.password_reset);
  assert.strictEqual(requiredFooter.html, '<p>reset</p>');
  assert.strictEqual(requiredFooter.text, 'reset');

  const textOnlyFooter = appendUnsubscribeFooter(null, 'endorsement', 42, EMAIL_TYPES.endorsement_expiry);
  assert.strictEqual(textOnlyFooter.html, null, 'text-only optional emails must not crash or gain bogus HTML');
  assert.match(textOnlyFooter.text, /Unsubscribe from Endorsement expiry alerts/);

  const app = express();
  app.use('/api/email', emailUnsubscribeRoutes);

  updateCalls.length = 0;
  const getRes = await request(
    app,
    'GET',
    `/api/email/unsubscribe?token=${encodeURIComponent(token)}&type=${encodeURIComponent(EMAIL_TYPES.booking_confirmation)}`
  );
  assert.strictEqual(getRes.statusCode, 200);
  assert.match(getRes.body, /Confirm unsubscribe/);
  assert.strictEqual(updateCalls.length, 0, 'GET must render confirmation without mutating preferences');

  const tampered = await request(
    app,
    'POST',
    `/api/email/unsubscribe?token=${encodeURIComponent(token)}&type=all`
  );
  assert.strictEqual(tampered.statusCode, 400, 'query-string type tampering must be rejected');
  assert.strictEqual(updateCalls.length, 0);

  const postRes = await request(
    app,
    'POST',
    `/api/email/unsubscribe?token=${encodeURIComponent(token)}&type=${encodeURIComponent(EMAIL_TYPES.booking_confirmation)}`
  );
  assert.strictEqual(postRes.statusCode, 200);
  assert.deepStrictEqual(updateCalls.pop(), {
    userId: 42,
    patch: { booking_confirmation: false },
  });

  const allToken = signUnsubscribeToken(42, 'all');
  const allRes = await request(app, 'POST', `/api/email/unsubscribe?token=${encodeURIComponent(allToken)}&type=all`);
  assert.strictEqual(allRes.statusCode, 200);
  assert.deepStrictEqual(updateCalls.pop(), {
    userId: 42,
    patch: { email_all_off: true },
  });

  console.log('critical bug regressions passed');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
