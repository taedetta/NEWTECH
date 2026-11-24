'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const { shouldRunUpdateConflictCheck } = require('../lib/booking-status');

function testBookingUpdateConflictDecision() {
  assert.strictEqual(
    shouldRunUpdateConflictCheck({
      scheduleChanged: true,
      statusChanged: false,
      nextStatus: 'confirmed',
    }),
    true,
    'active booking schedule edits must run conflict checks'
  );

  assert.strictEqual(
    shouldRunUpdateConflictCheck({
      scheduleChanged: false,
      statusChanged: true,
      nextStatus: 'confirmed',
    }),
    true,
    'reactivating a historical booking must run conflict checks'
  );

  assert.strictEqual(
    shouldRunUpdateConflictCheck({
      scheduleChanged: true,
      statusChanged: false,
      nextStatus: 'completed',
    }),
    false,
    'historical edits that remain non-blocking should not run schedule conflicts'
  );

  const bookingsSrc = fs.readFileSync(path.join(__dirname, '..', 'routes', 'bookings-routes.js'), 'utf8');
  assert(
    bookingsSrc.includes("const { shouldRunUpdateConflictCheck } = require('../lib/booking-status');")
      && bookingsSrc.includes('shouldRunUpdateConflictCheck({ scheduleChanged, statusChanged, nextStatus })'),
    'booking PUT must use the shared conflict-check decision'
  );
  assert(
    bookingsSrc.includes('const isStaffHistoricalEdit = isHistoricalBooking && (isAdmin || isAssignedInstructor);'),
    'active admin booking edits must not be treated as historical edits'
  );
}

function main() {
  testBookingUpdateConflictDecision();
  console.log('critical bug regression checks passed');
}

main();
