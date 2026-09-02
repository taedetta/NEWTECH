'use strict';

const assert = require('assert');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'critical-bug-regression-secret';

const { EMAIL_TYPES } = require('../lib/email-types');
const dbIndexPath = require.resolve('../db/index');
require.cache[dbIndexPath] = {
  id: dbIndexPath,
  filename: dbIndexPath,
  loaded: true,
  exports: {
    query: async () => ({ rows: [] }),
  },
};
const dbNotificationPrefs = require('../db/notification-prefs');
dbNotificationPrefs.getPrefs = async () => ({
  email_all_off: true,
  booking_confirmation: false,
  password_reset: false,
  account_approved: false,
  profile_change: false,
});

const {
  appendUnsubscribeFooter,
  getPreferenceCatalog,
  isRequiredEmailType,
  isUserConfigurableEmailType,
  shouldSendEmail,
} = require('../lib/notification-prefs');
const {
  buildUnsubscribeUrl,
  signUnsubscribeToken,
  verifyUnsubscribeToken,
} = require('../lib/unsubscribe-token');

function tokenFromUrl(url) {
  return new URL(url).searchParams.get('token');
}

(async () => {
  assert.strictEqual(isRequiredEmailType(EMAIL_TYPES.password_reset), true);
  assert.strictEqual(isUserConfigurableEmailType(EMAIL_TYPES.password_reset), false);
  assert.strictEqual(isUserConfigurableEmailType(EMAIL_TYPES.booking_confirmation), true);
  const storedPrefs = dbNotificationPrefs.rowToPrefs({
    email_all_off: true,
    booking_confirmation: false,
    password_reset: false,
    account_approved: false,
    profile_change: false,
  });
  assert.strictEqual(storedPrefs.password_reset, true);
  assert.strictEqual(storedPrefs.account_approved, true);
  assert.strictEqual(storedPrefs.profile_change, true);

  const studentCatalogKeys = getPreferenceCatalog('student', false)
    .flatMap((category) => category.types.map((type) => type.key));
  assert(studentCatalogKeys.includes(EMAIL_TYPES.booking_confirmation));
  assert(!studentCatalogKeys.includes(EMAIL_TYPES.password_reset));
  assert(!studentCatalogKeys.includes(EMAIL_TYPES.account_approved));
  assert(!studentCatalogKeys.includes(EMAIL_TYPES.profile_change));

  assert.strictEqual(await shouldSendEmail(123, EMAIL_TYPES.password_reset), true);
  assert.strictEqual(await shouldSendEmail(123, EMAIL_TYPES.account_approved), true);
  assert.strictEqual(await shouldSendEmail(123, EMAIL_TYPES.profile_change), true);
  assert.strictEqual(await shouldSendEmail(123, EMAIL_TYPES.booking_confirmation), false);

  const requiredFooter = appendUnsubscribeFooter(
    '<html><body>Reset password<!-- Footer --></body></html>',
    'Reset password',
    123,
    EMAIL_TYPES.password_reset
  );
  assert(!requiredFooter.html.includes('Unsubscribe from this type'));
  assert(!requiredFooter.text.includes('Unsubscribe'));

  const textOnlyFooter = appendUnsubscribeFooter(null, 'Booking confirmed', 123, EMAIL_TYPES.booking_confirmation);
  assert.strictEqual(textOnlyFooter.html, null);
  assert(textOnlyFooter.text.includes('Unsubscribe from Booking confirmations'));

  const bookingUrl = buildUnsubscribeUrl(123, EMAIL_TYPES.booking_confirmation);
  const bookingUrlObject = new URL(bookingUrl);
  assert.strictEqual(bookingUrlObject.searchParams.get('type'), EMAIL_TYPES.booking_confirmation);
  const verifiedBooking = verifyUnsubscribeToken(tokenFromUrl(bookingUrl));
  assert.deepStrictEqual(verifiedBooking, { userId: 123, type: EMAIL_TYPES.booking_confirmation });
  assert.notStrictEqual(verifiedBooking.type, EMAIL_TYPES.preflight_reminder);

  const allToken = signUnsubscribeToken(123, 'all');
  assert.deepStrictEqual(verifyUnsubscribeToken(allToken), { userId: 123, type: 'all' });

  console.log('critical bug regressions passed');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
