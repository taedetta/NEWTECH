'use strict';

const assert = require('assert');
const { getBookingUpdatePolicy } = require('../lib/booking-update-policy');

function assertPolicy(name, input, expected) {
  const actual = getBookingUpdatePolicy(input);
  for (const [key, value] of Object.entries(expected)) {
    assert.strictEqual(actual[key], value, `${name}: expected ${key}=${value}, got ${actual[key]}`);
  }
}

assertPolicy(
  'active confirmed reschedule must re-check resources',
  { existingStatus: 'confirmed', requestedStatus: undefined, scheduleChanged: true },
  { resultingActive: true, reactivating: false, needsConflictCheck: true, needsDowntimeCheck: true }
);

assertPolicy(
  'inactive historical edit can avoid schedule resource checks',
  { existingStatus: 'completed', requestedStatus: undefined, scheduleChanged: true },
  { resultingActive: false, reactivating: false, needsConflictCheck: false, needsDowntimeCheck: false }
);

assertPolicy(
  'reactivating completed booking must re-check resources even without moving it',
  { existingStatus: 'completed', requestedStatus: 'confirmed', scheduleChanged: false },
  { resultingActive: true, reactivating: true, needsConflictCheck: true, needsDowntimeCheck: true }
);

assertPolicy(
  'marking active booking completed does not need schedule checks',
  { existingStatus: 'confirmed', requestedStatus: 'completed', scheduleChanged: false },
  { resultingActive: false, reactivating: false, needsConflictCheck: false, needsDowntimeCheck: false }
);

console.log('critical bug regressions passed');
