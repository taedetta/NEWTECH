'use strict';

const HISTORICAL_STATUSES = new Set(['cancelled', 'completed']);
const ADMIN_ROLES = new Set(['owner', 'admin']);

function normalizeStatus(status) {
  return status == null ? '' : String(status).toLowerCase();
}

function isAdminRole(role) {
  return ADMIN_ROLES.has(String(role || '').toLowerCase());
}

function isHistoricalStatus(status) {
  return HISTORICAL_STATUSES.has(normalizeStatus(status));
}

function bookingBlocksSchedule(status) {
  return !isHistoricalStatus(status);
}

function requiresBookingConflictCheck({ scheduleChanged, currentStatus, nextStatus }) {
  const currentBlocksSchedule = bookingBlocksSchedule(currentStatus);
  const nextBlocksSchedule = bookingBlocksSchedule(nextStatus);

  // A booking that will block the active schedule must be checked when its
  // schedule changes or when it is reactivated from a non-blocking status.
  return nextBlocksSchedule && (Boolean(scheduleChanged) || !currentBlocksSchedule);
}

function isAssignedInstructor(user, booking) {
  if (!user || !booking || String(user.role || '').toLowerCase() !== 'instructor') return false;
  return Number(user.id) === Number(booking.instructor_id);
}

function canAccessHistoricalBookingEdit(user, booking) {
  if (isAdminRole(user?.role)) return true;
  return isAssignedInstructor(user, booking);
}

function hasHistoricalRestrictedChange(update) {
  if (!update || typeof update !== 'object') return false;
  const restrictedFields = [
    'student_id',
    'instructor_id',
    'aircraft_id',
    'start_time',
    'end_time',
    'lesson_type',
    'status',
    'booking_type',
  ];
  return restrictedFields.some((field) => Object.prototype.hasOwnProperty.call(update, field));
}

module.exports = {
  bookingBlocksSchedule,
  canAccessHistoricalBookingEdit,
  hasHistoricalRestrictedChange,
  isAdminRole,
  isAssignedInstructor,
  isHistoricalStatus,
  requiresBookingConflictCheck,
};
