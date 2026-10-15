'use strict';

function dateOnly(value) {
  if (!value) return null;
  if (typeof value === 'string') return value.slice(0, 10);
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

function shiftBookingDatePreservingTime({ flightDate, currentStartTime, currentEndTime }) {
  const start = currentStartTime ? new Date(currentStartTime) : null;
  const end = currentEndTime ? new Date(currentEndTime) : null;

  if (!start || Number.isNaN(start.getTime())) {
    const fallbackStart = new Date(flightDate + 'T12:00:00Z');
    return {
      startTime: fallbackStart,
      endTime: new Date(fallbackStart.getTime() + 60 * 60 * 1000),
    };
  }

  const durationMs = end && !Number.isNaN(end.getTime())
    ? Math.max(0, end.getTime() - start.getTime())
    : 60 * 60 * 1000;
  const shiftedStart = new Date(`${flightDate}T${start.toISOString().slice(11)}`);
  return {
    startTime: shiftedStart,
    endTime: new Date(shiftedStart.getTime() + durationMs),
  };
}

module.exports = {
  dateOnly,
  shiftBookingDatePreservingTime,
};
