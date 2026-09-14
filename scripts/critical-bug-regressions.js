'use strict';

const assert = require('assert');

const {
  bookingBlocksSchedule,
  canEditHistoricalBooking,
  shouldCheckBookingConflict,
} = require('../lib/booking-status');
const { bookingsOverlap } = require('../lib/booking-overlap');
const { REQUIRED_EMAIL_TYPES, TYPE_CATEGORIES } = require('../lib/email-types');
const { buildUnsubscribeUrl, signUnsubscribeToken, verifyUnsubscribeToken } = require('../lib/unsubscribe-token');
const { getPreferenceCatalog, appendUnsubscribeFooter, shouldSendEmail } = require('../lib/notification-prefs');

function user(role, id) {
  return { role, id };
}

function booking(status, studentId = 10, instructorId = 20) {
  return { status, student_id: studentId, instructor_id: instructorId };
}

assert.strictEqual(bookingBlocksSchedule('confirmed'), true, 'confirmed bookings block the schedule');
assert.strictEqual(bookingBlocksSchedule('cancelled'), false, 'cancelled bookings do not block the schedule');
assert.strictEqual(bookingBlocksSchedule('completed'), false, 'completed bookings do not block the schedule');

assert.strictEqual(canEditHistoricalBooking(user('admin', 1), booking('completed')), true, 'admins can edit completed bookings');
assert.strictEqual(canEditHistoricalBooking(user('owner', 1), booking('cancelled')), true, 'owners can edit cancelled bookings');
assert.strictEqual(canEditHistoricalBooking(user('instructor', 20), booking('completed')), true, 'assigned instructor can edit completed bookings');
assert.strictEqual(canEditHistoricalBooking(user('instructor', 21), booking('completed')), false, 'other instructors cannot edit completed bookings');
assert.strictEqual(canEditHistoricalBooking(user('student', 10), booking('completed')), false, 'assigned students cannot edit completed bookings through generic booking PUT');
assert.strictEqual(canEditHistoricalBooking(user('renter', 10), booking('cancelled')), false, 'assigned renters cannot edit cancelled bookings through generic booking PUT');
assert.strictEqual(canEditHistoricalBooking(user('maintenance', 30), booking('completed')), false, 'maintenance users cannot mutate completed booking history');

assert.strictEqual(
  shouldCheckBookingConflict({ previousStatus: 'confirmed', nextStatus: 'confirmed', scheduleChanged: true }),
  true,
  'moving an active booking must check conflicts'
);
assert.strictEqual(
  shouldCheckBookingConflict({ previousStatus: 'completed', nextStatus: 'confirmed', scheduleChanged: false }),
  true,
  'reactivating a completed booking must check conflicts'
);
assert.strictEqual(
  shouldCheckBookingConflict({ previousStatus: 'cancelled', nextStatus: 'confirmed', scheduleChanged: false }),
  true,
  'reactivating a cancelled booking must check conflicts'
);
assert.strictEqual(
  shouldCheckBookingConflict({ previousStatus: 'confirmed', nextStatus: 'cancelled', scheduleChanged: false }),
  false,
  'cancelling an active booking does not need a schedule conflict check'
);
assert.strictEqual(
  shouldCheckBookingConflict({ previousStatus: 'completed', nextStatus: 'completed', scheduleChanged: true }),
  false,
  'editing completed booking history without reactivation does not block the schedule'
);

assert.strictEqual(
  bookingsOverlap('2026-09-14T17:00:00Z', '2026-09-14T18:00:00Z', '2026-09-14T18:00:00Z', '2026-09-14T19:00:00Z'),
  false,
  'back-to-back bookings are allowed'
);
assert.strictEqual(
  bookingsOverlap('2026-09-14T17:00:00Z', '2026-09-14T18:00:00Z', '2026-09-14T17:59:00Z', '2026-09-14T19:00:00Z'),
  true,
  'overlapping bookings are rejected'
);

assert.strictEqual(REQUIRED_EMAIL_TYPES.has('password_reset'), true, 'password reset emails are required');
assert.strictEqual(REQUIRED_EMAIL_TYPES.has('profile_change'), true, 'profile change emails are required');
assert.strictEqual(REQUIRED_EMAIL_TYPES.has('booking_confirmation'), false, 'booking confirmations remain optional');

const catalogTypes = getPreferenceCatalog('student', false).flatMap((cat) => cat.types.map((type) => type.key));
for (const requiredType of REQUIRED_EMAIL_TYPES) {
  assert.strictEqual(catalogTypes.includes(requiredType), false, `${requiredType} is hidden from preference catalog`);
}
assert.strictEqual(catalogTypes.includes('booking_confirmation'), true, 'optional booking confirmations stay configurable');
assert.strictEqual(
  TYPE_CATEGORIES.flatMap((cat) => cat.types).includes('password_reset'),
  true,
  'required account types can remain categorized without becoming configurable'
);

const token = signUnsubscribeToken(123, 'booking_confirmation');
assert.deepStrictEqual(
  verifyUnsubscribeToken(token, 'booking_confirmation'),
  { userId: 123, type: 'booking_confirmation' },
  'unsubscribe token verifies for its signed type'
);
assert.strictEqual(verifyUnsubscribeToken(token, 'all'), null, 'unsubscribe token cannot be replayed for all email');
assert.strictEqual(verifyUnsubscribeToken(signUnsubscribeToken(123, 'all'), 'booking_confirmation'), null, 'all-email token cannot be replayed for one type');
assert.match(buildUnsubscribeUrl(123, 'booking_confirmation'), /type=booking_confirmation$/, 'unsubscribe URL carries signed type');
assert.throws(
  () => signUnsubscribeToken(123, 'password_reset'),
  /Invalid unsubscribe type/,
  'required email types cannot receive unsubscribe tokens'
);

const requiredFooter = appendUnsubscribeFooter('<body>Hello</body>', 'Hello', 123, 'password_reset');
assert.strictEqual(requiredFooter.html, '<body>Hello</body>', 'required emails do not get unsubscribe HTML footer');
assert.strictEqual(requiredFooter.text, 'Hello', 'required emails do not get unsubscribe text footer');

const textOnlyOptional = appendUnsubscribeFooter(null, 'Body', 123, 'endorsement_expiry');
assert.strictEqual(textOnlyOptional.html, null, 'text-only optional emails stay text-only');
assert.match(textOnlyOptional.text, /Unsubscribe from Endorsement expiry alerts:/, 'text-only optional emails receive text footer');

shouldSendEmail(123, 'password_reset').then((sendRequired) => {
  assert.strictEqual(sendRequired, true, 'required emails bypass all opt-out preferences');
  console.log('critical bug regressions passed');
}).catch((err) => {
  console.error(err);
  process.exit(1);
});
