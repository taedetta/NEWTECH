'use strict';

const ABSOLUTE_HOBBS_DELTA_LIMIT = 24;

function scheduledDurationHours(booking = {}) {
  const start = new Date(booking.start_time);
  const end = new Date(booking.end_time);
  const ms = end.getTime() - start.getTime();
  if (!Number.isFinite(ms) || ms <= 0) return null;
  return ms / (60 * 60 * 1000);
}

function maxReasonableHobbsDelta(booking = {}) {
  const scheduled = scheduledDurationHours(booking);
  if (scheduled == null) return ABSOLUTE_HOBBS_DELTA_LIMIT;
  const scheduleBasedLimit = Math.max((scheduled * 1.25) + 0.25, 0.5);
  return Math.min(scheduleBasedLimit, ABSOLUTE_HOBBS_DELTA_LIMIT);
}

function validateReasonableHobbsDelta(booking, hobbsDelta) {
  const delta = Number(hobbsDelta);
  if (!Number.isFinite(delta) || delta < 0) return 'Hobbs delta must be a non-negative number';
  const limit = maxReasonableHobbsDelta(booking);
  if (delta > limit) {
    return `Hobbs delta (${delta.toFixed(1)} hrs) is too high for the scheduled booking duration (max ${limit.toFixed(1)} hrs). Verify the meter readings.`;
  }
  return null;
}

module.exports = {
  validateReasonableHobbsDelta,
  maxReasonableHobbsDelta,
};
