'use strict';

const assert = require('assert');

const {
  bookingUpdateNeedsConflictCheck,
  bookingsOverlap,
} = require('../lib/booking-overlap');

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

console.log('critical bug regressions passed');
