'use strict';

/**
 * Scheduling overlap: intervals [start, end) — back-to-back is allowed.
 * Existing 5:00–6:00 PM does not block a new booking starting at 6:00 PM.
 */
function bookingsOverlap(startA, endA, startB, endB) {
  const a0 = new Date(startA).getTime();
  const a1 = new Date(endA).getTime();
  const b0 = new Date(startB).getTime();
  const b1 = new Date(endB).getTime();
  if (!Number.isFinite(a0) || !Number.isFinite(a1) || !Number.isFinite(b0) || !Number.isFinite(b1)) {
    return false;
  }
  return a0 < b1 && a1 > b0;
}

/** SQL fragment for table alias `b`: overlaps window [$startParam, $endParam). */
function overlapWhere(alias, startParam, endParam) {
  const p = alias ? `${alias}.` : '';
  return `${p}start_time < ${endParam} AND ${p}end_time > ${startParam}`;
}

function bookingBlocksSchedule(status) {
  return !['cancelled', 'completed'].includes(String(status || '').toLowerCase());
}

function bookingUpdateNeedsConflictCheck({ previousStatus, nextStatus, scheduleChanged }) {
  const wasBlocking = bookingBlocksSchedule(previousStatus);
  const willBlock = bookingBlocksSchedule(nextStatus);
  return willBlock && (scheduleChanged || !wasBlocking);
}

module.exports = {
  bookingsOverlap,
  overlapWhere,
  bookingBlocksSchedule,
  bookingUpdateNeedsConflictCheck,
};
