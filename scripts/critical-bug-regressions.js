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
const { bookingUpdateNeedsConflictCheck } = require('../lib/booking-overlap');
const { syncFlightRecord, shiftedBookingTimesForFlightDate } = require('../lib/sync-flight-record');

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

  assert.strictEqual(bookingUpdateNeedsConflictCheck({
    previousStatus: 'confirmed',
    nextStatus: 'confirmed',
    scheduleChanged: true,
  }), true);
  assert.strictEqual(bookingUpdateNeedsConflictCheck({
    previousStatus: 'cancelled',
    nextStatus: 'confirmed',
    scheduleChanged: false,
  }), true);
  assert.strictEqual(bookingUpdateNeedsConflictCheck({
    previousStatus: 'confirmed',
    nextStatus: 'confirmed',
    scheduleChanged: false,
  }), false);
  assert.strictEqual(bookingUpdateNeedsConflictCheck({
    previousStatus: 'completed',
    nextStatus: 'completed',
    scheduleChanged: true,
  }), false);

  const booking = {
    start_time: '2026-01-15T14:30:00.000Z',
    end_time: '2026-01-15T16:00:00.000Z',
  };
  assert.strictEqual(shiftedBookingTimesForFlightDate(booking, '2026-01-15'), null);
  assert.deepStrictEqual(shiftedBookingTimesForFlightDate(booking, '2026-01-16'), {
    start_time: '2026-01-16T14:30:00.000Z',
    end_time: '2026-01-16T16:00:00.000Z',
  });

  let flightLogUpdateValues = null;
  const fakeClient = {
    query: async (sql, params) => {
      const text = String(sql);
      if (text === 'SELECT * FROM bookings WHERE id = $1') {
        return {
          rows: [{
            id: 99,
            status: 'completed',
            aircraft_id: 5,
            student_id: 7,
            instructor_id: null,
            booking_type: 'student_solo',
            lesson_type: 'Solo',
            start_time: booking.start_time,
            end_time: booking.end_time,
            hobbs_start: 10,
            hobbs_end: 11,
            billing_voided: false,
          }],
        };
      }
      if (text === 'SELECT * FROM flight_logs WHERE booking_id = $1') {
        return {
          rows: [{
            booking_id: 99,
            aircraft_id: 5,
            student_id: 7,
            instructor_id: null,
            booking_type: 'student_solo',
            flight_date: '2026-01-15',
            hobbs_start: 10,
            hobbs_end: 11,
            hobbs_delta: 1,
            tach_start: null,
            tach_end: null,
            tach_delta: null,
            dual_instruction_hours: 0,
            aircraft_charge_amount: 100,
            instruction_charge_amount: 0,
          }],
        };
      }
      if (text === 'SELECT hourly_rate FROM aircraft WHERE id = $1') return { rows: [{ hourly_rate: 100 }] };
      if (text.startsWith('UPDATE flight_logs SET')) flightLogUpdateValues = params;
      return { rows: [] };
    },
  };
  await syncFlightRecord(fakeClient, 99, {
    hobbs_start: 10,
    hobbs_end: 11,
    dual_instruction_hours: 1,
    aircraft_charge_amount: 1,
    instruction_charge_amount: 2,
    allow_charge_overrides: false,
  });
  assert.strictEqual(flightLogUpdateValues[8], 100);
  assert.strictEqual(flightLogUpdateValues[9], 0);

  console.log('Critical bug regressions passed');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
