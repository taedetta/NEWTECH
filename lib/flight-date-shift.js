'use strict';

const { calendarDateFromDate, timeHmFromDate, wallClockToUtc } = require('./school-timezone');

function dateOnly(value) {
  if (!value) return null;
  if (typeof value === 'string') {
    const match = value.match(/^(\d{4}-\d{2}-\d{2})/);
    if (match) return match[1];
  }
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : calendarDateFromDate(d);
}

function shiftBookingTimesToFlightDate(booking, flightDate) {
  const targetDate = dateOnly(flightDate);
  const currentDate = booking?.start_time ? calendarDateFromDate(booking.start_time) : null;
  if (!targetDate || !currentDate || targetDate === currentDate) return null;

  const currentStart = new Date(booking.start_time);
  const currentEnd = new Date(booking.end_time);
  const durationMs = currentEnd.getTime() - currentStart.getTime();
  if (Number.isNaN(currentStart.getTime()) || Number.isNaN(currentEnd.getTime()) || durationMs <= 0) {
    return null;
  }

  const shiftedStart = wallClockToUtc(targetDate, timeHmFromDate(currentStart));
  const shiftedEnd = new Date(shiftedStart.getTime() + durationMs);
  return { startTime: shiftedStart, endTime: shiftedEnd };
}

module.exports = {
  dateOnly,
  shiftBookingTimesToFlightDate,
};
