'use strict';

const NON_BLOCKING_STATUSES = new Set(['cancelled', 'completed']);

function normalizeStatus(status) {
  return String(status || 'confirmed').toLowerCase();
}

function bookingBlocksSchedule(status) {
  return !NON_BLOCKING_STATUSES.has(normalizeStatus(status));
}

function toIso(value) {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function normId(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = parseInt(value, 10);
  return Number.isFinite(n) ? n : null;
}

function bookingScheduleChanged(existing, next) {
  return normId(next.aircraft_id) !== normId(existing.aircraft_id)
    || normId(next.instructor_id) !== normId(existing.instructor_id)
    || normId(next.student_id) !== normId(existing.student_id)
    || toIso(next.start_time) !== toIso(existing.start_time)
    || toIso(next.end_time) !== toIso(existing.end_time);
}

function shouldCheckScheduleConflicts(existing, next) {
  const nextStatus = next.status !== undefined && next.status !== null && next.status !== ''
    ? next.status
    : existing.status;
  if (!bookingBlocksSchedule(nextStatus)) return false;
  return bookingScheduleChanged(existing, next) || !bookingBlocksSchedule(existing.status);
}

module.exports = {
  bookingBlocksSchedule,
  bookingScheduleChanged,
  shouldCheckScheduleConflicts,
};
