'use strict';

const assert = require('assert');

const {
  isScheduleBlockingStatus,
  shouldRunUpdateConflictCheck,
} = require('../lib/booking-status');

assert.strictEqual(isScheduleBlockingStatus('confirmed'), true, 'confirmed bookings must block the schedule');
assert.strictEqual(isScheduleBlockingStatus('cancelled'), false, 'cancelled bookings must not block the schedule');
assert.strictEqual(isScheduleBlockingStatus('completed'), false, 'completed bookings must not block the schedule');

assert.strictEqual(
  shouldRunUpdateConflictCheck({
    scheduleChanged: true,
    statusChanged: false,
    nextStatus: 'confirmed',
  }),
  true,
  'active schedule edits must be conflict checked, including admin/owner edits'
);

assert.strictEqual(
  shouldRunUpdateConflictCheck({
    scheduleChanged: false,
    statusChanged: true,
    nextStatus: 'confirmed',
  }),
  true,
  'reactivating a historical booking must be conflict checked even when times/resources stay the same'
);

assert.strictEqual(
  shouldRunUpdateConflictCheck({
    scheduleChanged: true,
    statusChanged: false,
    nextStatus: 'completed',
  }),
  false,
  'completed historical edits that remain non-blocking should not run schedule conflicts'
);

assert.strictEqual(
  shouldRunUpdateConflictCheck({
    scheduleChanged: true,
    statusChanged: false,
    nextStatus: 'cancelled',
  }),
  false,
  'cancelled historical edits that remain non-blocking should not run schedule conflicts'
);

console.log('critical bug regression checks passed');
