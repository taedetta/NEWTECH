'use strict';

const assert = require('assert');

const {
  isActiveBookingStatus,
  shouldCheckBookingConflicts,
} = require('../lib/booking-overlap');

function testBookingUpdateConflictDecisions() {
  assert.strictEqual(isActiveBookingStatus('confirmed'), true);
  assert.strictEqual(isActiveBookingStatus('cancelled'), false);
  assert.strictEqual(isActiveBookingStatus('completed'), false);

  assert.strictEqual(
    shouldCheckBookingConflicts({
      currentStatus: 'confirmed',
      nextStatus: 'confirmed',
      scheduleChanged: true,
    }),
    true,
    'active booking reschedules must be conflict checked'
  );

  assert.strictEqual(
    shouldCheckBookingConflicts({
      currentStatus: 'confirmed',
      nextStatus: 'confirmed',
      scheduleChanged: false,
    }),
    false,
    'active metadata-only edits do not need conflict checks'
  );

  assert.strictEqual(
    shouldCheckBookingConflicts({
      currentStatus: 'completed',
      nextStatus: 'completed',
      scheduleChanged: true,
    }),
    false,
    'historical edits can keep past overlapping times'
  );

  assert.strictEqual(
    shouldCheckBookingConflicts({
      currentStatus: 'cancelled',
      nextStatus: 'confirmed',
      scheduleChanged: false,
    }),
    true,
    'reactivating a cancelled booking must be conflict checked'
  );

  assert.strictEqual(
    shouldCheckBookingConflicts({
      currentStatus: 'confirmed',
      nextStatus: 'cancelled',
      scheduleChanged: true,
    }),
    false,
    'cancelling a booking removes it from active conflicts'
  );
}

testBookingUpdateConflictDecisions();
console.log('critical bug regression tests passed');
