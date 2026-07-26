'use strict';

const assert = require('assert');

process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://test:test@localhost:5432/test';
process.env.APP_URL = process.env.APP_URL || 'https://example.test';

async function testPasswordResetBypassesPreferences() {
  const dbPrefsPath = require.resolve('../db/notification-prefs');
  const notificationPath = require.resolve('../lib/notification-prefs');

  delete require.cache[notificationPath];
  require.cache[dbPrefsPath] = {
    id: dbPrefsPath,
    filename: dbPrefsPath,
    loaded: true,
    exports: {
      getPrefs: async () => ({
        email_all_off: true,
        password_reset: false,
        booking_confirmation: false,
      }),
    },
  };

  const prefs = require('../lib/notification-prefs');

  assert.strictEqual(
    await prefs.shouldSendEmail(123, prefs.EMAIL_TYPES.password_reset),
    true,
    'password reset must send even when all optional email is off'
  );
  assert.strictEqual(
    await prefs.shouldSendEmail(123, prefs.EMAIL_TYPES.booking_confirmation),
    false,
    'optional email should still respect opt-out preferences'
  );

  const resetEmail = prefs.appendUnsubscribeFooter(
    '<html><body>Password reset</body></html>',
    'Password reset',
    123,
    prefs.EMAIL_TYPES.password_reset
  );
  assert.ok(!/Unsubscribe/i.test(resetEmail.html), 'password reset emails must not include unsubscribe links');
  assert.ok(!/Unsubscribe/i.test(resetEmail.text), 'password reset text emails must not include unsubscribe links');

  const bookingEmail = prefs.appendUnsubscribeFooter(
    '<html><body>Booking</body></html>',
    'Booking',
    123,
    prefs.EMAIL_TYPES.booking_confirmation
  );
  assert.ok(/Unsubscribe/i.test(bookingEmail.html), 'optional emails should keep unsubscribe links');

  const catalogTypes = prefs.getPreferenceCatalog('student', false)
    .flatMap((category) => category.types.map((type) => type.key));
  assert.ok(!catalogTypes.includes('password_reset'), 'password reset must be hidden from preference catalog');
  assert.ok(
    !prefs.USER_CONFIGURABLE_EMAIL_TYPES.includes('password_reset'),
    'password reset must not be directly user configurable'
  );

  delete require.cache[notificationPath];
  delete require.cache[dbPrefsPath];
}

async function testRequiredPreferenceCannotPersistDisabled() {
  const dbIndexPath = require.resolve('../db/index');
  const dbPrefsPath = require.resolve('../db/notification-prefs');

  delete require.cache[dbPrefsPath];
  require.cache[dbIndexPath] = {
    id: dbIndexPath,
    filename: dbIndexPath,
    loaded: true,
    exports: { query: async () => ({ rows: [] }) },
  };

  const dbPrefs = require('../db/notification-prefs');
  const row = dbPrefs.rowToPrefs({ email_all_off: true, password_reset: false });
  assert.strictEqual(row.password_reset, true, 'stored false password_reset values must read back as enabled');

  const calls = [];
  const fakeDb = {
    query: async (sql, params) => {
      calls.push({ sql, params });
      if (/SELECT \*/.test(sql)) {
        return { rows: [{ email_all_off: false, password_reset: false, booking_confirmation: false }] };
      }
      return { rows: [] };
    },
  };

  await dbPrefs.updatePrefs(123, { password_reset: false, booking_confirmation: false }, fakeDb);
  const update = calls.find((call) => /^UPDATE user_email_preferences SET/.test(call.sql));
  assert.ok(update, 'updatePrefs should persist configurable preference changes');
  assert.ok(!/password_reset/.test(update.sql), 'updatePrefs must ignore password_reset patches');
  assert.ok(/booking_confirmation/.test(update.sql), 'updatePrefs should still update optional preferences');

  delete require.cache[dbPrefsPath];
  delete require.cache[dbIndexPath];
}

function testUnsubscribeUrlDoesNotTargetRequiredType() {
  const { buildUnsubscribeUrl } = require('../lib/unsubscribe-token');
  const url = new URL(buildUnsubscribeUrl(123, 'password_reset'));
  assert.strictEqual(
    url.searchParams.get('type'),
    'all',
    'required email types should never produce direct unsubscribe links'
  );
}

(async () => {
  await testPasswordResetBypassesPreferences();
  await testRequiredPreferenceCannotPersistDisabled();
  testUnsubscribeUrlDoesNotTargetRequiredType();
  console.log('critical bug regressions passed');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
