'use strict';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'critical-bug-test-secret';
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://user:pass@localhost:5432/flightslate_test';
process.env.SKIP_DB_VERIFY = 'true';

const assert = require('assert');
const jwt = require('jsonwebtoken');

const {
  bookingUpdateNeedsConflictCheck,
  bookingsOverlap,
} = require('../lib/booking-overlap');
const {
  normalizeUnsubscribeType,
  signUnsubscribeToken,
  verifyUnsubscribeToken,
} = require('../lib/unsubscribe-token');
const {
  EMAIL_TYPES,
  appendUnsubscribeFooter,
  getPreferenceCatalog,
  shouldSendEmail,
} = require('../lib/notification-prefs');
const { rowToPrefs, WRITABLE_PREF_COLUMNS } = require('../db/notification-prefs');
const { readUnsubscribeRequest } = require('../routes/email-unsubscribe');

assert.strictEqual(
  bookingsOverlap('2026-09-19T13:00:00Z', '2026-09-19T14:00:00Z', '2026-09-19T14:00:00Z', '2026-09-19T15:00:00Z'),
  false,
  'back-to-back bookings should not overlap'
);

assert.strictEqual(
  bookingsOverlap('2026-09-19T13:00:00Z', '2026-09-19T14:00:00Z', '2026-09-19T13:59:00Z', '2026-09-19T15:00:00Z'),
  true,
  'true time overlaps should be detected'
);

assert.strictEqual(
  bookingUpdateNeedsConflictCheck({ previousStatus: 'confirmed', nextStatus: 'confirmed', scheduleChanged: true }),
  true,
  'active booking schedule edits must check conflicts, including admin edits'
);

assert.strictEqual(
  bookingUpdateNeedsConflictCheck({ previousStatus: 'confirmed', nextStatus: 'confirmed', scheduleChanged: false }),
  false,
  'metadata-only edits of active bookings do not need conflict checks'
);

assert.strictEqual(
  bookingUpdateNeedsConflictCheck({ previousStatus: 'completed', nextStatus: 'completed', scheduleChanged: true }),
  false,
  'completed bookings remain non-blocking and can be corrected without conflict checks'
);

assert.strictEqual(
  bookingUpdateNeedsConflictCheck({ previousStatus: 'cancelled', nextStatus: 'confirmed', scheduleChanged: false }),
  true,
  'reactivating a cancelled booking must check conflicts even if times are unchanged'
);

assert.strictEqual(
  bookingUpdateNeedsConflictCheck({ previousStatus: 'completed', nextStatus: 'cancelled', scheduleChanged: true }),
  false,
  'updates that remain non-blocking do not need conflict checks'
);

const signedTypeToken = signUnsubscribeToken(42, EMAIL_TYPES.preflight_reminder);
assert.deepStrictEqual(
  verifyUnsubscribeToken(signedTypeToken),
  { userId: 42, type: EMAIL_TYPES.preflight_reminder, legacyTypeInQuery: false },
  'new unsubscribe tokens must bind the preference type'
);

assert.strictEqual(
  readUnsubscribeRequest({ query: { token: signedTypeToken, type: 'all' }, body: {} }).error,
  'invalid_type',
  'signed unsubscribe type cannot be widened by editing the query string'
);

const legacySignedTypeToken = jwt.sign(
  { uid: 43, type: EMAIL_TYPES.booking_confirmation },
  process.env.JWT_SECRET,
  { expiresIn: '365d' }
);
assert.deepStrictEqual(
  verifyUnsubscribeToken(legacySignedTypeToken),
  { userId: 43, type: EMAIL_TYPES.booking_confirmation, legacyTypeInQuery: false },
  'pre-audience legacy unsubscribe tokens should still work when they carried a signed type'
);

const transitionalToken = jwt.sign(
  { uid: 44, aud: 'email-unsub' },
  process.env.JWT_SECRET,
  { expiresIn: '365d' }
);
assert.deepStrictEqual(
  readUnsubscribeRequest({ query: { token: transitionalToken, type: EMAIL_TYPES.flight_completed }, body: {} }),
  {
    token: transitionalToken,
    rawType: EMAIL_TYPES.flight_completed,
    verified: { userId: 44, type: null, legacyTypeInQuery: true },
  },
  'transitional user-only tokens should fall back to the URL type for existing emails'
);

assert.strictEqual(
  normalizeUnsubscribeType(EMAIL_TYPES.password_reset),
  null,
  'required email types cannot be directly unsubscribed'
);

const requiredTypeTransitionalToken = jwt.sign(
  { uid: 45, aud: 'email-unsub' },
  process.env.JWT_SECRET,
  { expiresIn: '365d' }
);
assert.strictEqual(
  readUnsubscribeRequest({ query: { token: requiredTypeTransitionalToken, type: EMAIL_TYPES.password_reset }, body: {} }).error,
  'invalid_type',
  'unsubscribe route rejects required email types'
);

const textOnly = appendUnsubscribeFooter(null, 'Body', 42, EMAIL_TYPES.endorsement_expiry);
assert.strictEqual(textOnly.html, null, 'text-only optional emails should remain text-only');
assert.ok(textOnly.text.includes('Unsubscribe from Endorsement expiry alerts'), 'text-only footer is appended');

const requiredFooter = appendUnsubscribeFooter('<p>Reset</p>', 'Reset', 42, EMAIL_TYPES.password_reset);
assert.deepStrictEqual(requiredFooter, { html: '<p>Reset</p>', text: 'Reset' }, 'required emails have no unsubscribe footer');

assert.strictEqual(
  getPreferenceCatalog('student', false).some((cat) => cat.types.some((type) => type.key === EMAIL_TYPES.password_reset)),
  false,
  'required email types are hidden from the preference catalog'
);

assert.strictEqual(rowToPrefs({ password_reset: false }).password_reset, true, 'required prefs always read as enabled');
assert.strictEqual(WRITABLE_PREF_COLUMNS.includes('password_reset'), false, 'required prefs cannot be directly written');

shouldSendEmail(123, EMAIL_TYPES.password_reset)
  .then((value) => {
    assert.strictEqual(value, true, 'required emails bypass opt-out preferences');
    console.log('critical bug regressions passed');
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
