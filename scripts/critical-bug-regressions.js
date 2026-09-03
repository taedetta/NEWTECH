'use strict';

const assert = require('assert');

process.env.JWT_SECRET = 'critical-bug-regression-secret';
process.env.APP_URL = 'https://example.test';

const queryLog = [];
const dbIndexPath = require.resolve('../db/index');
require.cache[dbIndexPath] = {
  id: dbIndexPath,
  filename: dbIndexPath,
  loaded: true,
  exports: {
    query: async (sql, params) => {
      const text = String(sql);
      queryLog.push({ text, params });
      if (text.includes('SELECT * FROM user_email_preferences')) {
        return {
          rows: [{
            email_all_off: true,
            booking_confirmation: false,
            password_reset: false,
          }],
        };
      }
      return { rows: [] };
    },
  },
};

const dbPrefs = require('../db/notification-prefs');
const {
  buildUnsubscribeUrl,
  resolveUnsubscribeRequest,
  verifyUnsubscribeToken,
} = require('../lib/unsubscribe-token');
const {
  appendUnsubscribeFooter,
  getPreferenceCatalog,
  isEmailSuppressedByPrefs,
  shouldSendEmail,
} = require('../lib/notification-prefs');

function getUrlToken(url) {
  return new URL(url).searchParams.get('token');
}

async function run() {
  const bookingUrl = buildUnsubscribeUrl(42, 'booking_confirmation');
  const bookingToken = getUrlToken(bookingUrl);
  assert.strictEqual(new URL(bookingUrl).searchParams.get('type'), 'booking_confirmation');
  assert.deepStrictEqual(verifyUnsubscribeToken(bookingToken), {
    userId: 42,
    type: 'booking_confirmation',
  });
  assert.deepStrictEqual(resolveUnsubscribeRequest(bookingToken, undefined), {
    userId: 42,
    type: 'booking_confirmation',
  });
  assert.strictEqual(resolveUnsubscribeRequest(bookingToken, 'booking_cancelled').error, 'type_mismatch');
  assert.strictEqual(resolveUnsubscribeRequest(bookingToken, 'password_reset').error, 'type_mismatch');

  assert.strictEqual(isEmailSuppressedByPrefs({
    email_all_off: true,
    password_reset: false,
  }, 'password_reset'), false);
  assert.strictEqual(isEmailSuppressedByPrefs({
    email_all_off: true,
    booking_confirmation: true,
  }, 'booking_confirmation'), true);
  assert.strictEqual(await shouldSendEmail(42, 'password_reset'), true);
  assert.strictEqual(await shouldSendEmail(42, 'booking_confirmation'), false);
  const updatedPrefs = await dbPrefs.updatePrefs(42, {
    booking_confirmation: false,
    password_reset: false,
  });
  const updateSql = queryLog.map((entry) => entry.text)
    .find((text) => text.startsWith('UPDATE user_email_preferences SET'));
  assert(updateSql.includes('booking_confirmation = $1'));
  assert(!updateSql.includes('password_reset'));
  assert.strictEqual(updatedPrefs.password_reset, true);

  const resetBody = '<html><body>Reset password</body></html>';
  const resetFooter = appendUnsubscribeFooter(resetBody, 'Reset password', 42, 'password_reset');
  assert.strictEqual(resetFooter.html, resetBody);
  assert(!resetFooter.text.includes('/api/email/unsubscribe'));

  const bookingFooter = appendUnsubscribeFooter(resetBody, 'Booking', 42, 'booking_confirmation');
  assert(bookingFooter.html.includes('/api/email/unsubscribe'));
  assert(bookingFooter.text.includes('Unsubscribe from Booking confirmations'));

  const studentCatalog = getPreferenceCatalog('student', false);
  const visibleTypes = studentCatalog.flatMap((category) => category.types.map((type) => type.key));
  assert(!visibleTypes.includes('password_reset'));
  assert(visibleTypes.includes('booking_confirmation'));

  console.log('Critical bug regressions passed');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
