'use strict';

const assert = require('assert');

process.env.APP_URL = process.env.APP_URL || 'https://example.test';

const dbIndexPath = require.resolve('../db/index');
require.cache[dbIndexPath] = {
  id: dbIndexPath,
  filename: dbIndexPath,
  loaded: true,
  exports: {
    async query() {
      return { rows: [] };
    },
    on() {},
  },
};

const {
  EMAIL_TYPES,
  REQUIRED_EMAIL_TYPE_KEYS,
  TYPE_CATEGORIES,
  isRequiredEmailType,
} = require('../lib/email-types');
const {
  appendUnsubscribeFooter,
  getPreferenceCatalog,
  shouldSendEmail,
} = require('../lib/notification-prefs');
const {
  buildUnsubscribeUrl,
  signUnsubscribeToken,
  verifyUnsubscribeToken,
} = require('../lib/unsubscribe-token');
const {
  bookingsOverlap,
  shouldCheckBookingConflict,
} = require('../lib/booking-overlap');
const { rowToPrefs, updatePrefs } = require('../db/notification-prefs');

async function run() {
  assert(REQUIRED_EMAIL_TYPE_KEYS.includes(EMAIL_TYPES.password_reset), 'password reset must be required');
  assert(isRequiredEmailType(EMAIL_TYPES.password_reset), 'password reset classification is required');

  const optionalUrl = new URL(buildUnsubscribeUrl(123, EMAIL_TYPES.booking_confirmation));
  const optionalToken = optionalUrl.searchParams.get('token');
  assert.strictEqual(optionalUrl.searchParams.get('type'), EMAIL_TYPES.booking_confirmation);
  assert.deepStrictEqual(verifyUnsubscribeToken(optionalToken), {
    userId: 123,
    type: EMAIL_TYPES.booking_confirmation,
  });

  const tamperedUrl = new URL(optionalUrl.toString());
  tamperedUrl.searchParams.set('type', 'all');
  assert.notStrictEqual(
    tamperedUrl.searchParams.get('type'),
    verifyUnsubscribeToken(tamperedUrl.searchParams.get('token')).type,
    'tampered query type must not alter the signed unsubscribe action'
  );

  const legacyUserOnlyToken = require('jsonwebtoken').sign(
    { uid: 123, aud: 'email-unsub' },
    process.env.JWT_SECRET || 'REDACTED',
    { expiresIn: '365d' }
  );
  assert.strictEqual(verifyUnsubscribeToken(legacyUserOnlyToken), null, 'legacy user-only tokens are unsafe');

  const requiredUrl = new URL(buildUnsubscribeUrl(123, EMAIL_TYPES.password_reset));
  assert.strictEqual(requiredUrl.searchParams.get('type'), 'all', 'required types must not get type-level unsubscribe links');

  const requiredMessage = appendUnsubscribeFooter(
    '<html><body>Reset your password</body></html>',
    'Reset your password',
    123,
    EMAIL_TYPES.password_reset
  );
  assert.strictEqual(requiredMessage.html, '<html><body>Reset your password</body></html>');
  assert.strictEqual(requiredMessage.text, 'Reset your password');

  const optionalTextOnly = appendUnsubscribeFooter(null, 'Expiry notice', 123, EMAIL_TYPES.endorsement_expiry);
  assert.strictEqual(optionalTextOnly.html, null);
  assert(optionalTextOnly.text.includes('Unsubscribe from Endorsement expiry alerts'));

  const catalogTypes = getPreferenceCatalog('student', false).flatMap((category) => category.types.map((type) => type.key));
  for (const type of REQUIRED_EMAIL_TYPE_KEYS) {
    assert(!catalogTypes.includes(type), `${type} must not be exposed as an editable preference`);
  }
  assert(
    TYPE_CATEGORIES.flatMap((category) => category.types).includes(EMAIL_TYPES.password_reset),
    'password reset can remain categorized without becoming editable'
  );

  const staleDisabledRequiredPrefs = rowToPrefs({
    email_all_off: true,
    password_reset: false,
    account_approved: false,
  });
  assert.strictEqual(staleDisabledRequiredPrefs.password_reset, true);
  assert.strictEqual(staleDisabledRequiredPrefs.account_approved, true);
  assert.strictEqual(staleDisabledRequiredPrefs.email_all_off, true);

  const fakeDb = {
    queries: [],
    async query(sql, params) {
      this.queries.push({ sql, params });
      if (sql.includes('SELECT * FROM user_email_preferences')) {
        return { rows: [{ user_id: 123, email_all_off: false, booking_confirmation: true }] };
      }
      return { rows: [] };
    },
  };
  await updatePrefs(123, { password_reset: false, account_approved: false }, fakeDb);
  assert(!fakeDb.queries.some((query) => (
    query.sql.trim().startsWith('UPDATE user_email_preferences')
    && /password_reset|account_approved/.test(query.sql)
  )));

  assert.strictEqual(await shouldSendEmail(123, EMAIL_TYPES.password_reset), true);

  assert.strictEqual(
    bookingsOverlap('2026-09-08T17:00:00Z', '2026-09-08T18:00:00Z', '2026-09-08T18:00:00Z', '2026-09-08T19:00:00Z'),
    false,
    'back-to-back bookings must remain allowed'
  );
  assert.strictEqual(
    shouldCheckBookingConflict({ previousStatus: 'confirmed', nextStatus: 'confirmed', scheduleChanged: true }),
    true,
    'active booking schedule edits must be conflict-checked for every role, including admins'
  );
  assert.strictEqual(
    shouldCheckBookingConflict({ previousStatus: 'completed', nextStatus: 'confirmed', scheduleChanged: false }),
    true,
    'reactivating a historical booking must check conflicts even when times are unchanged'
  );
  assert.strictEqual(
    shouldCheckBookingConflict({ previousStatus: 'completed', nextStatus: 'completed', scheduleChanged: true }),
    false,
    'completed bookings that remain historical do not block the schedule'
  );
}

run()
  .then(() => {
    console.log('critical bug regressions passed');
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
