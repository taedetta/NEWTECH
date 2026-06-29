'use strict';

const assert = require('assert');
const { bookingsOverlap } = require('../lib/booking-overlap');
const {
  isHistoricalBookingEdit,
  shouldCheckBookingUpdateConflicts,
} = require('../lib/booking-update-policy');

function assertConflictPolicy(input, expected, message) {
  assert.strictEqual(
    shouldCheckBookingUpdateConflicts(input),
    expected,
    message
  );
}

assertConflictPolicy(
  { existingStatus: 'confirmed', nextStatus: 'confirmed', scheduleChanged: true },
  true,
  'active booking moves must run conflict checks, including admin/owner edits'
);

assertConflictPolicy(
  { existingStatus: 'confirmed', nextStatus: 'confirmed', scheduleChanged: false },
  false,
  'metadata-only active booking edits do not need conflict checks'
);

assertConflictPolicy(
  { existingStatus: 'cancelled', nextStatus: 'confirmed', scheduleChanged: false },
  true,
  'reactivating cancelled bookings must run conflict checks even without moving'
);

assertConflictPolicy(
  { existingStatus: 'completed', nextStatus: 'completed', scheduleChanged: true },
  false,
  'historical completed edits stay out of active schedule conflict checks'
);

assertConflictPolicy(
  { existingStatus: 'confirmed', nextStatus: 'cancelled', scheduleChanged: true },
  false,
  'cancelling a booking cannot create a new active conflict'
);

assert.strictEqual(
  isHistoricalBookingEdit('completed', 'cancelled'),
  true,
  'completed/cancelled edits are historical corrections'
);

assert.strictEqual(
  bookingsOverlap('2026-07-01T17:00:00Z', '2026-07-01T18:00:00Z', '2026-07-01T18:00:00Z', '2026-07-01T19:00:00Z'),
  false,
  'back-to-back bookings should not overlap'
);

assert.strictEqual(
  bookingsOverlap('2026-07-01T17:00:00Z', '2026-07-01T18:01:00Z', '2026-07-01T18:00:00Z', '2026-07-01T19:00:00Z'),
  true,
  'actual overlapping bookings should conflict'
);

console.log('critical bug regression checks passed');
