'use strict';

const assert = require('assert');
const jwt = require('jsonwebtoken');

process.env.JWT_SECRET = 'critical-bug-regression-secret';
process.env.APP_URL = 'https://example.test';

const { EMAIL_TYPES } = require('../lib/email-types');
const dbPrefsPath = require.resolve('../db/notification-prefs');
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
  REQUIRED_EMAIL_TYPES,
  appendUnsubscribeFooter,
  getPreferenceCatalog,
  shouldSendEmail,
} = require('../lib/notification-prefs');
const {
  buildUnsubscribeUrl,
  signUnsubscribeToken,
  verifyUnsubscribeToken,
  normalizeUnsubscribeType,
} = require('../lib/unsubscribe-token');
const {
  calendarDateFromDate,
  timeHmFromDate,
} = require('../lib/school-timezone');
const {
  shiftedBookingTimesForFlightDate,
} = require('../lib/flight-date-sync');
const {
  isHistoricalScheduleEdit,
} = require('../lib/booking-overlap');

(async () => {
  assert.strictEqual(REQUIRED_EMAIL_TYPES.password_reset, true);
  assert.strictEqual(normalizeUnsubscribeType(EMAIL_TYPES.password_reset), null);

  const token = signUnsubscribeToken(123, EMAIL_TYPES.booking_confirmation);
  assert.deepStrictEqual(verifyUnsubscribeToken(token, EMAIL_TYPES.booking_confirmation), {
    userId: 123,
    type: EMAIL_TYPES.booking_confirmation,
  });
  assert.strictEqual(verifyUnsubscribeToken(token, EMAIL_TYPES.preflight_reminder), null);
  assert.strictEqual(verifyUnsubscribeToken(token, 'all'), null);

  const legacyUidOnlyToken = jwt.sign({ uid: 123, aud: 'email-unsub' }, process.env.JWT_SECRET);
  assert.strictEqual(verifyUnsubscribeToken(legacyUidOnlyToken, EMAIL_TYPES.booking_confirmation), null);

  const generatedUrl = new URL(buildUnsubscribeUrl(123, EMAIL_TYPES.booking_confirmation));
  assert.strictEqual(generatedUrl.searchParams.get('type'), EMAIL_TYPES.booking_confirmation);
  assert.strictEqual(
    verifyUnsubscribeToken(generatedUrl.searchParams.get('token'), EMAIL_TYPES.booking_confirmation).type,
    EMAIL_TYPES.booking_confirmation
  );
  assert.strictEqual(verifyUnsubscribeToken(generatedUrl.searchParams.get('token'), 'all'), null);

  const allCatalogKeys = getPreferenceCatalog('admin', false).flatMap((category) =>
    category.types.map((type) => type.key)
  );
  assert.ok(!allCatalogKeys.includes(EMAIL_TYPES.password_reset));

  const resetEmail = appendUnsubscribeFooter('<body>Reset</body>', 'Reset', 123, EMAIL_TYPES.password_reset);
  assert.strictEqual(resetEmail.html, '<body>Reset</body>');
  assert.strictEqual(resetEmail.text, 'Reset');

  const regularEmail = appendUnsubscribeFooter('<body>Booked</body>', 'Booked', 123, EMAIL_TYPES.booking_confirmation);
  assert.ok(regularEmail.html.includes('/api/email/unsubscribe'));
  assert.ok(regularEmail.text.includes('Unsubscribe from Booking confirmations'));

  assert.strictEqual(await shouldSendEmail(123, EMAIL_TYPES.password_reset), true);
  assert.strictEqual(await shouldSendEmail(123, EMAIL_TYPES.booking_confirmation), false);

  assert.strictEqual(
    shiftedBookingTimesForFlightDate(
      '2026-08-01T13:30:00.000Z',
      '2026-08-01T14:45:00.000Z',
      '2026-08-01'
    ),
    null
  );

  const moved = shiftedBookingTimesForFlightDate(
    '2026-08-01T13:30:00.000Z',
    '2026-08-01T14:45:00.000Z',
    '2026-08-02'
  );
  assert.strictEqual(calendarDateFromDate(moved.startIso), '2026-08-02');
  assert.strictEqual(calendarDateFromDate(moved.endIso), '2026-08-02');
  assert.strictEqual(timeHmFromDate(moved.startIso), '09:30');
  assert.strictEqual(timeHmFromDate(moved.endIso), '10:45');
  assert.strictEqual((new Date(moved.endIso).getTime() - new Date(moved.startIso).getTime()) / 60000, 75);

  assert.strictEqual(
    isHistoricalScheduleEdit({ role: 'admin', id: 1 }, { status: 'confirmed', instructor_id: 2 }),
    false
  );
  assert.strictEqual(
    isHistoricalScheduleEdit({ role: 'admin', id: 1 }, { status: 'completed', instructor_id: 2 }),
    true
  );
  assert.strictEqual(
    isHistoricalScheduleEdit({ role: 'instructor', id: 2 }, { status: 'completed', instructor_id: 2 }),
    true
  );
  assert.strictEqual(
    isHistoricalScheduleEdit({ role: 'instructor', id: 3 }, { status: 'completed', instructor_id: 2 }),
    false
  );

  console.log('critical bug regressions passed');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
