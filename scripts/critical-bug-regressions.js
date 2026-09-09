'use strict';

const assert = require('assert');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'critical-regression-test-secret';
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://localhost/critical_regression_test';
process.env.SKIP_DB_CONNECT = 'true';

const {
  EMAIL_TYPES,
  isRequiredEmailType,
  isEmailTypeMutable,
} = require('../lib/email-types');
const {
  getPreferenceCatalog,
  appendUnsubscribeFooter,
  shouldSendEmail,
} = require('../lib/notification-prefs');
const {
  signUnsubscribeToken,
  verifyUnsubscribeToken,
} = require('../lib/unsubscribe-token');
const { resolveUnsubscribeType } = require('../routes/email-unsubscribe');
const {
  rowToPrefs,
  updatePrefs,
} = require('../db/notification-prefs');
const {
  bookingTimesForFlightDate,
  buildPatchFromInstructorHoursRow,
} = require('../lib/sync-flight-record');
const {
  calendarDateFromDate,
  timeHmFromDate,
} = require('../lib/school-timezone');
const profileRoutes = require('../routes/profile');
const {
  buildHistoryFlightSyncPatch,
  currentFlightDateForBooking,
} = require('../routes/booking-history');

async function testRequiredAccountEmailsAreNotUserMutable() {
  const required = [
    EMAIL_TYPES.password_reset,
    EMAIL_TYPES.account_approved,
    EMAIL_TYPES.account_rejected,
    EMAIL_TYPES.signup_pending,
    EMAIL_TYPES.account_invite,
    EMAIL_TYPES.profile_change,
    EMAIL_TYPES.welcome,
  ];

  for (const type of required) {
    assert.strictEqual(isRequiredEmailType(type), true, `${type} should be required`);
    assert.strictEqual(isEmailTypeMutable(type), false, `${type} should not be user-mutable`);
  }

  const catalogTypes = getPreferenceCatalog('student', false)
    .flatMap((category) => category.types.map((type) => type.key));
  for (const type of required) {
    assert.ok(!catalogTypes.includes(type), `${type} should be hidden from preference UI catalog`);
  }

  const prefs = rowToPrefs({
    email_all_off: true,
    password_reset: false,
    account_approved: false,
    profile_change: false,
  });
  assert.strictEqual(prefs.email_all_off, true);
  assert.strictEqual(prefs.password_reset, true);
  assert.strictEqual(prefs.account_approved, true);
  assert.strictEqual(prefs.profile_change, true);

  assert.strictEqual(await shouldSendEmail(123, EMAIL_TYPES.password_reset), true);
}

function testRequiredEmailsDoNotGetUnsubscribeFooters() {
  const html = '<html><body>Password reset</body></html>';
  const text = 'Password reset';
  const withFooter = appendUnsubscribeFooter(html, text, 123, EMAIL_TYPES.password_reset);
  assert.strictEqual(withFooter.html, html);
  assert.strictEqual(withFooter.text, text);

  const textOnly = appendUnsubscribeFooter(null, 'Endorsement expiring', 123, EMAIL_TYPES.endorsement_expiry);
  assert.strictEqual(textOnly.html, null);
  assert.match(textOnly.text, /Unsubscribe from Endorsement expiry alerts/);
}

function testUnsubscribeTokensAreBoundToType() {
  const token = signUnsubscribeToken(123, EMAIL_TYPES.booking_confirmation);
  const verified = verifyUnsubscribeToken(token);
  assert.deepStrictEqual(verified, { userId: 123, type: EMAIL_TYPES.booking_confirmation });

  assert.deepStrictEqual(
    resolveUnsubscribeType(EMAIL_TYPES.booking_confirmation, verified),
    { ok: true, type: EMAIL_TYPES.booking_confirmation }
  );
  assert.strictEqual(resolveUnsubscribeType(EMAIL_TYPES.preflight_reminder, verified).ok, false);
  assert.strictEqual(resolveUnsubscribeType(EMAIL_TYPES.password_reset, verified).ok, false);

  const allToken = signUnsubscribeToken(123, 'all');
  assert.deepStrictEqual(verifyUnsubscribeToken(allToken), { userId: 123, type: 'all' });
  assert.deepStrictEqual(resolveUnsubscribeType('all', verifyUnsubscribeToken(allToken)), { ok: true, type: 'all' });
}

function testUnsubscribeGetRequiresPostConfirmation() {
  const { renderConfirmationPage } = require('../routes/email-unsubscribe');
  const html = renderConfirmationPage({
    token: 'test-token',
    type: EMAIL_TYPES.booking_confirmation,
    label: 'Booking confirmations',
  });
  assert.match(html, /method="POST"/);
  assert.match(html, /Confirm unsubscribe/);
  assert.doesNotMatch(html, /name="password_reset"/);
}

async function testRequiredPreferencePatchesAreIgnored() {
  const statements = [];
  const fakeDb = {
    async query(sql) {
      statements.push(String(sql));
      if (String(sql).startsWith('SELECT * FROM user_email_preferences')) {
        return { rows: [{ user_id: 123, email_all_off: true, booking_confirmation: false, password_reset: false }] };
      }
      return { rows: [] };
    },
  };

  await updatePrefs(123, {
    email_all_off: true,
    booking_confirmation: false,
    password_reset: false,
    account_approved: false,
    profile_change: false,
  }, fakeDb);

  const updateStatement = statements.find((sql) => sql.startsWith('UPDATE user_email_preferences SET'));
  assert.ok(updateStatement, 'expected update statement');
  assert.match(updateStatement, /email_all_off/);
  assert.match(updateStatement, /booking_confirmation/);
  assert.doesNotMatch(updateStatement, /password_reset/);
  assert.doesNotMatch(updateStatement, /account_approved/);
  assert.doesNotMatch(updateStatement, /profile_change/);
}

function testProfileRouterHandlesLegacyCfiPathBeforeCatchAll() {
  const cfiRouteIndex = profileRoutes.stack.findIndex((layer) => layer.route?.path === '/cfi-profile');
  const catchAllIndex = profileRoutes.stack.findIndex((layer) => !layer.route);
  assert.ok(cfiRouteIndex >= 0, 'expected profile router to define /cfi-profile');
  assert.ok(catchAllIndex >= 0, 'expected profile router catch-all');
  assert.ok(cfiRouteIndex < catchAllIndex, 'legacy CFI profile route must be before catch-all 404');
}

function testBookingDateMovePreservesSchoolLocalTime() {
  const booking = {
    start_time: '2026-09-10T02:00:00.000Z', // 10:00 PM ET on Sep 9
    end_time: '2026-09-10T03:30:00.000Z',
  };
  const moved = bookingTimesForFlightDate(booking, '2026-09-11');
  assert.strictEqual(calendarDateFromDate(moved.startTime), '2026-09-11');
  assert.strictEqual(timeHmFromDate(moved.startTime), '22:00');
  assert.strictEqual(timeHmFromDate(moved.endTime), '23:30');
  assert.strictEqual(new Date(moved.endTime) - new Date(moved.startTime), 90 * 60 * 1000);
}

function testHistoryPatchDoesNotCorruptTimesOrBillingForInstructors() {
  const booking = {
    id: 42,
    instructor_id: 7,
    start_time: '2026-09-10T02:00:00.000Z',
    end_time: '2026-09-10T03:30:00.000Z',
    current_flight_date: '2026-09-09',
    lesson_type: 'Dual Instruction',
    booking_type: 'dual',
  };
  assert.strictEqual(currentFlightDateForBooking(booking), '2026-09-09');
  const patch = buildHistoryFlightSyncPatch({
    booking,
    role: 'instructor',
    userId: 7,
    hStart: 100,
    hEnd: 101.5,
    tStart: null,
    tEnd: null,
    dualHrs: 1.5,
    body: {
      flight_date: '2026-09-09',
      lesson_type: 'Discovery Flight',
      aircraft_charge_amount: 0,
      instruction_charge_amount: 0,
    },
  });
  assert.strictEqual(patch.flight_date, undefined);
  assert.strictEqual(patch.lesson_type, 'Dual Instruction');
  assert.strictEqual(patch.aircraft_charge_amount, undefined);
  assert.strictEqual(patch.instruction_charge_amount, undefined);

  const adminPatch = buildHistoryFlightSyncPatch({
    booking,
    role: 'admin',
    userId: 1,
    hStart: 100,
    hEnd: 101.5,
    tStart: null,
    tEnd: null,
    dualHrs: 1.5,
    body: {
      flight_date: '2026-09-10',
      lesson_type: 'Discovery Flight',
      aircraft_charge_amount: 0,
      instruction_charge_amount: 0,
    },
  });
  assert.strictEqual(adminPatch.flight_date, '2026-09-10');
  assert.strictEqual(adminPatch.lesson_type, 'Discovery Flight');
  assert.strictEqual(adminPatch.aircraft_charge_amount, 0);
  assert.strictEqual(adminPatch.instruction_charge_amount, 0);
}

function testInstructorHoursSyncDoesNotPropagateRatesForInstructors() {
  const bookingRow = {
    start_time: '2026-09-10T02:00:00.000Z',
    end_time: '2026-09-10T03:30:00.000Z',
    flight_date: '2026-09-09',
  };
  const instructorPatch = buildPatchFromInstructorHoursRow({
    entry_date: '2026-09-09',
    instruction_hours: 1.5,
    instructor_rate: 1,
    aircraft_rate: 1,
    allow_rate_overrides: false,
  }, bookingRow);
  assert.strictEqual(instructorPatch.flight_date, undefined);
  assert.strictEqual(instructorPatch.instructor_rate_override, undefined);
  assert.strictEqual(instructorPatch.aircraft_rate_override, undefined);

  const adminPatch = buildPatchFromInstructorHoursRow({
    entry_date: '2026-09-10',
    instruction_hours: 1.5,
    instructor_rate: 1,
    aircraft_rate: 2,
    allow_rate_overrides: true,
  }, bookingRow);
  assert.strictEqual(adminPatch.flight_date, '2026-09-10');
  assert.strictEqual(adminPatch.instructor_rate_override, 1);
  assert.strictEqual(adminPatch.aircraft_rate_override, 2);
}

async function main() {
  await testRequiredAccountEmailsAreNotUserMutable();
  testRequiredEmailsDoNotGetUnsubscribeFooters();
  testUnsubscribeTokensAreBoundToType();
  testUnsubscribeGetRequiresPostConfirmation();
  await testRequiredPreferencePatchesAreIgnored();
  testProfileRouterHandlesLegacyCfiPathBeforeCatchAll();
  testBookingDateMovePreservesSchoolLocalTime();
  testHistoryPatchDoesNotCorruptTimesOrBillingForInstructors();
  testInstructorHoursSyncDoesNotPropagateRatesForInstructors();
  console.log('critical bug regression checks passed');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
