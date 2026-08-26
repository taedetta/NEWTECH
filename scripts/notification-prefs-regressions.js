#!/usr/bin/env node
'use strict';

const assert = require('assert');

function fresh(modulePath) {
  delete require.cache[require.resolve(modulePath)];
  return require(modulePath);
}

function loadNotificationPrefsWithPrefs(prefs) {
  for (const modulePath of [
    '../lib/notification-prefs',
    '../db/notification-prefs',
  ]) {
    delete require.cache[require.resolve(modulePath)];
  }
  const dbPath = require.resolve('../db/notification-prefs');
  require.cache[dbPath] = {
    id: dbPath,
    filename: dbPath,
    loaded: true,
    exports: {
      getPrefs: async () => prefs,
    },
  };
  return require('../lib/notification-prefs');
}

function stubDbPool() {
  const poolPath = require.resolve('../db/index');
  require.cache[poolPath] = {
    id: poolPath,
    filename: poolPath,
    loaded: true,
    exports: {
      query: async () => ({ rows: [] }),
    },
  };
}

(async () => {
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'notification-pref-test-secret';

  const {
    buildUnsubscribeUrl,
    verifyUnsubscribeRequest,
  } = fresh('../lib/unsubscribe-token');

  const typedUrl = new URL(buildUnsubscribeUrl(123, 'booking_confirmation'));
  const typedToken = typedUrl.searchParams.get('token');
  assert.deepStrictEqual(
    verifyUnsubscribeRequest(typedToken, 'booking_confirmation'),
    { userId: 123, type: 'booking_confirmation' },
    'typed unsubscribe token should validate for its own email type'
  );
  assert.strictEqual(
    verifyUnsubscribeRequest(typedToken, 'all'),
    null,
    'typed unsubscribe token must not be reusable as unsubscribe-all'
  );

  const legacyUserOnlyToken = require('jsonwebtoken').sign(
    { uid: 123, aud: 'email-unsub' },
    process.env.JWT_SECRET,
    { expiresIn: '365d' }
  );
  assert.strictEqual(
    verifyUnsubscribeRequest(legacyUserOnlyToken, 'all'),
    null,
    'legacy user-only tokens must not be accepted because the URL type is mutable'
  );

  const passwordResetUrl = new URL(buildUnsubscribeUrl(123, 'password_reset'));
  assert.strictEqual(
    verifyUnsubscribeRequest(passwordResetUrl.searchParams.get('token'), 'password_reset'),
    null,
    'password reset must not be directly unsubscribable'
  );
  assert.deepStrictEqual(
    verifyUnsubscribeRequest(passwordResetUrl.searchParams.get('token'), 'all'),
    { userId: 123, type: 'all' },
    'invalid unsubscribe types should fall back to an explicit unsubscribe-all token'
  );

  const notificationPrefs = loadNotificationPrefsWithPrefs({
    email_all_off: true,
    password_reset: false,
    booking_confirmation: true,
  });
  assert.strictEqual(
    await notificationPrefs.shouldSendEmail(123, 'password_reset'),
    true,
    'password reset delivery must bypass global and per-type opt-outs'
  );
  assert.strictEqual(
    await notificationPrefs.shouldSendEmail(123, 'booking_confirmation'),
    false,
    'optional email delivery should still honor global opt-out'
  );

  const categories = notificationPrefs.getPreferenceCatalog('student', false);
  assert(
    !categories.some((category) => category.types.some((type) => type.key === 'password_reset')),
    'password reset should not appear in configurable preference categories'
  );

  const withFooter = notificationPrefs.appendUnsubscribeFooter('<p>Body</p>', 'Body', 123, 'password_reset');
  assert.deepStrictEqual(
    withFooter,
    { html: '<p>Body</p>', text: 'Body' },
    'password reset emails should not include unsubscribe links'
  );

  stubDbPool();
  const { rowToPrefs, updatePrefs } = fresh('../db/notification-prefs');
  assert.strictEqual(
    rowToPrefs({ email_all_off: false, password_reset: false }).password_reset,
    true,
    'stored false password_reset values should be normalized to true'
  );

  const calls = [];
  const fakeDb = {
    query: async (sql, params) => {
      calls.push({ sql, params });
      if (/SELECT \*/.test(sql)) return { rows: [{ email_all_off: false, password_reset: false, booking_confirmation: false }] };
      return { rows: [] };
    },
  };
  await updatePrefs(123, { password_reset: false }, fakeDb);
  assert(
    !calls.some((call) => /UPDATE user_email_preferences SET/.test(call.sql)),
    'password_reset-only updates should no-op instead of writing a disabled value'
  );

  console.log('notification preference regressions passed');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
