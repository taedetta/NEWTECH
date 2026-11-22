'use strict';

const assert = require('assert');
const {
  isHistoricalBookingStatus,
  isScheduleBlockingStatus,
  shouldRunUpdateConflictCheck,
  shouldSyncCompletedBookingSideEffects,
} = require('../lib/booking-status');
const { bookingsOverlap } = require('../lib/booking-overlap');

function testBookingUpdateConflictGuards() {
  assert.strictEqual(isScheduleBlockingStatus('confirmed'), true);
  assert.strictEqual(isScheduleBlockingStatus('cancelled'), false);
  assert.strictEqual(isScheduleBlockingStatus('completed'), false);
  assert.strictEqual(isHistoricalBookingStatus('completed'), true);
  assert.strictEqual(isHistoricalBookingStatus('cancelled'), true);
  assert.strictEqual(isHistoricalBookingStatus('confirmed'), false);

  assert.strictEqual(
    shouldRunUpdateConflictCheck({ scheduleChanged: true, statusChanged: false, nextStatus: 'confirmed' }),
    true,
    'active admin/staff schedule edits must be conflict-checked'
  );
  assert.strictEqual(
    shouldRunUpdateConflictCheck({ scheduleChanged: false, statusChanged: true, nextStatus: 'confirmed' }),
    true,
    'reactivating a cancelled/completed booking must be conflict-checked'
  );
  assert.strictEqual(
    shouldRunUpdateConflictCheck({ scheduleChanged: true, statusChanged: false, nextStatus: 'completed' }),
    false,
    'completed bookings do not block the active schedule'
  );
}

function testCompletedSideEffectGuards() {
  assert.strictEqual(
    shouldSyncCompletedBookingSideEffects({
      nextStatus: 'completed',
      lessonTypeChanged: false,
      scheduleChanged: false,
      participantChanged: false,
      aircraftChanged: false,
      bookingTypeChanged: false,
    }),
    false,
    'notes-only completed booking edits must not recalculate billing side effects'
  );
  assert.strictEqual(
    shouldSyncCompletedBookingSideEffects({
      nextStatus: 'completed',
      lessonTypeChanged: true,
      scheduleChanged: false,
      participantChanged: false,
      aircraftChanged: false,
      bookingTypeChanged: false,
    }),
    true,
    'completed booking lesson type changes must sync completed-flight records'
  );
}

function testBackToBackOverlapSemantics() {
  assert.strictEqual(
    bookingsOverlap('2026-06-19T17:00:00Z', '2026-06-19T18:00:00Z', '2026-06-19T18:00:00Z', '2026-06-19T19:00:00Z'),
    false,
    'back-to-back bookings should not overlap'
  );
  assert.strictEqual(
    bookingsOverlap('2026-06-19T17:00:00Z', '2026-06-19T18:00:00Z', '2026-06-19T17:59:00Z', '2026-06-19T19:00:00Z'),
    true,
    'true time overlap should still conflict'
  );
}

testBookingUpdateConflictGuards();
testCompletedSideEffectGuards();
testBackToBackOverlapSemantics();

console.log('critical bug regression checks passed');
