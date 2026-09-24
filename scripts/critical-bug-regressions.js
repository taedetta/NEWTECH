'use strict';

const assert = require('assert');
const express = require('express');
const jwt = require('jsonwebtoken');

process.env.JWT_SECRET = 'critical-bug-regression-secret';
process.env.APP_URL = 'https://example.test';

const dbPrefsPath = require.resolve('../db/notification-prefs');
const routePath = require.resolve('../routes/email-unsubscribe');
const notificationPrefsPath = require.resolve('../lib/notification-prefs');
const unsubscribeTokenPath = require.resolve('../lib/unsubscribe-token');

function clearModule(path) {
  delete require.cache[path];
}

async function withServer(app, fn) {
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  try {
    const { port } = server.address();
    await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
}

async function testUnsubscribeRoute() {
  const updates = [];
  clearModule(routePath);
  clearModule(unsubscribeTokenPath);
  require.cache[dbPrefsPath] = {
    id: dbPrefsPath,
    filename: dbPrefsPath,
    loaded: true,
    exports: {
      ensureDefaultPrefs: async () => {},
      updatePrefs: async (userId, patch) => {
        updates.push({ userId, patch });
        return {};
      },
    },
  };

  const { signUnsubscribeToken } = require('../lib/unsubscribe-token');
  const route = require('../routes/email-unsubscribe');
  const app = express();
  app.use('/api/email', route);

  await withServer(app, async (base) => {
    const bookingToken = signUnsubscribeToken(42, 'booking_confirmation');

    let response = await fetch(`${base}/api/email/unsubscribe?token=${encodeURIComponent(bookingToken)}&type=booking_confirmation`);
    assert.strictEqual(response.status, 200);
    assert.match(await response.text(), /Confirm unsubscribe/);
    assert.deepStrictEqual(updates, [], 'GET must not update preferences');

    response = await fetch(`${base}/api/email/unsubscribe?token=${encodeURIComponent(bookingToken)}&type=preflight_reminder`, { method: 'POST' });
    assert.strictEqual(response.status, 400, 'token type mismatch must be rejected');
    assert.deepStrictEqual(updates, [], 'tampered type must not update preferences');

    response = await fetch(`${base}/api/email/unsubscribe?token=${encodeURIComponent(bookingToken)}&type=booking_confirmation`, { method: 'POST' });
    assert.strictEqual(response.status, 200);
    assert.deepStrictEqual(updates, [{ userId: 42, patch: { booking_confirmation: false } }]);

    updates.length = 0;
    const resetToken = signUnsubscribeToken(42, 'password_reset');
    response = await fetch(`${base}/api/email/unsubscribe?token=${encodeURIComponent(resetToken)}&type=password_reset`, { method: 'POST' });
    assert.strictEqual(response.status, 400, 'required email types cannot be disabled');
    assert.deepStrictEqual(updates, []);

    const legacyToken = jwt.sign({ uid: 42, aud: 'email-unsub' }, process.env.JWT_SECRET);
    response = await fetch(`${base}/api/email/unsubscribe?token=${encodeURIComponent(legacyToken)}&type=booking_confirmation`, { method: 'POST' });
    assert.strictEqual(response.status, 400, 'legacy untyped tokens must be rejected');
  });
}

async function testNotificationPreferences() {
  clearModule(notificationPrefsPath);
  require.cache[dbPrefsPath] = {
    id: dbPrefsPath,
    filename: dbPrefsPath,
    loaded: true,
    exports: {
      getPrefs: async () => ({
        email_all_off: true,
        booking_confirmation: false,
        password_reset: false,
      }),
    },
  };

  const {
    appendUnsubscribeFooter,
    getPreferenceCatalog,
    shouldSendEmail,
  } = require('../lib/notification-prefs');

  const studentTypes = getPreferenceCatalog('student', false).flatMap((category) => category.types.map((type) => type.key));
  assert(!studentTypes.includes('password_reset'), 'required reset emails should not appear in preference catalog');
  assert(!studentTypes.includes('profile_change'), 'required profile-change emails should not appear in preference catalog');

  assert.strictEqual(await shouldSendEmail(42, 'password_reset'), true, 'required email bypasses all-off preferences');
  assert.strictEqual(await shouldSendEmail(42, 'booking_confirmation'), false, 'optional disabled email remains disabled');

  const requiredFooter = appendUnsubscribeFooter('<p>Reset</p>', 'Reset', 42, 'password_reset');
  assert.deepStrictEqual(requiredFooter, { html: '<p>Reset</p>', text: 'Reset' });

  const optionalFooter = appendUnsubscribeFooter(null, 'Endorsement expiring', 42, 'endorsement_expiry');
  assert.strictEqual(optionalFooter.html, null);
  assert.match(optionalFooter.text, /Unsubscribe from Endorsement expiry alerts/);
}

(async () => {
  await testUnsubscribeRoute();
  await testNotificationPreferences();
  console.log('critical bug regressions passed');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
