'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const {
  bookingBlocksSchedule,
  canAccessHistoricalBookingEdit,
  hasHistoricalRestrictedChange,
  requiresBookingConflictCheck,
} = require('../lib/booking-status');

function run() {
  assert.strictEqual(bookingBlocksSchedule('confirmed'), true, 'confirmed bookings block schedule');
  assert.strictEqual(bookingBlocksSchedule('completed'), false, 'completed bookings do not block schedule');
  assert.strictEqual(bookingBlocksSchedule('cancelled'), false, 'cancelled bookings do not block schedule');

  assert.strictEqual(
    requiresBookingConflictCheck({
      scheduleChanged: true,
      currentStatus: 'confirmed',
      nextStatus: 'confirmed',
    }),
    true,
    'active schedule edits must run conflict checks'
  );
  assert.strictEqual(
    requiresBookingConflictCheck({
      scheduleChanged: false,
      currentStatus: 'cancelled',
      nextStatus: 'confirmed',
    }),
    true,
    'reactivating cancelled bookings must run conflict checks even when times/resources are unchanged'
  );
  assert.strictEqual(
    requiresBookingConflictCheck({
      scheduleChanged: false,
      currentStatus: 'completed',
      nextStatus: 'confirmed',
    }),
    true,
    'reactivating completed bookings must run conflict checks even when times/resources are unchanged'
  );
  assert.strictEqual(
    requiresBookingConflictCheck({
      scheduleChanged: true,
      currentStatus: 'completed',
      nextStatus: 'completed',
    }),
    false,
    'completed bookings that remain completed do not block the active schedule'
  );
  assert.strictEqual(
    requiresBookingConflictCheck({
      scheduleChanged: false,
      currentStatus: 'confirmed',
      nextStatus: 'confirmed',
    }),
    false,
    'metadata-only active edits do not need schedule conflict checks'
  );

  const completedBooking = { status: 'completed', instructor_id: 22 };
  assert.strictEqual(
    canAccessHistoricalBookingEdit({ role: 'student', id: 11 }, completedBooking),
    false,
    'students must not edit completed/cancelled bookings through generic booking PUT'
  );
  assert.strictEqual(
    canAccessHistoricalBookingEdit({ role: 'instructor', id: 22 }, completedBooking),
    true,
    'assigned instructors may access limited historical note edits'
  );
  assert.strictEqual(
    hasHistoricalRestrictedChange({ notes: 'debrief note' }),
    false,
    'notes are not schedule/billing changes'
  );
  assert.strictEqual(
    hasHistoricalRestrictedChange({ lesson_type: 'Discovery Flight' }),
    true,
    'lesson type changes on completed/cancelled bookings can rebill flight logs'
  );
  assert.strictEqual(
    hasHistoricalRestrictedChange({ start_time: '2026-10-25T13:00:00.000Z' }),
    true,
    'historical schedule changes are restricted to admins'
  );

  const routeSource = fs.readFileSync(path.join(__dirname, '..', 'routes', 'bookings-routes.js'), 'utf8');
  assert(
    routeSource.includes('requiresBookingConflictCheck({'),
    'booking PUT route must use the shared conflict-check decision helper'
  );
  assert(
    !routeSource.includes('needsConflictCheck || (scheduleChanged && isAdmin)'),
    'admin schedule edits must not bypass the conflict-check body'
  );
}

run();
console.log('critical bug regression checks passed');
