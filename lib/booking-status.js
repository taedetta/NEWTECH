'use strict';

const NON_BLOCKING_STATUSES = new Set(['cancelled', 'completed']);

function normalizeStatus(status) {
  return String(status || '').trim().toLowerCase();
}

function statusBlocksSchedule(status) {
  return !NON_BLOCKING_STATUSES.has(normalizeStatus(status));
}

function shouldCheckBookingConflicts({ existingStatus, nextStatus, scheduleChanged }) {
  const existingBlocks = statusBlocksSchedule(existingStatus);
  const nextBlocks = statusBlocksSchedule(nextStatus !== undefined ? nextStatus : existingStatus);
  return nextBlocks && (Boolean(scheduleChanged) || !existingBlocks);
}

module.exports = {
  statusBlocksSchedule,
  shouldCheckBookingConflicts,
};
