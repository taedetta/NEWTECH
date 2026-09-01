'use strict';

const {
  addCalendarDays,
  calendarDateFromDate,
  timeHmFromDate,
  wallClockToUtc,
} = require('./school-timezone');

function normalizeFlightDate(value) {
  if (!value) return null;
  if (value instanceof Date) return calendarDateFromDate(value);
  const s = String(value);
  const dateOnly = s.includes('T') ? s.slice(0, 10) : s;
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateOnly)) return dateOnly;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : calendarDateFromDate(parsed);
}

function daysBetweenCalendarDates(startDate, endDate) {
  const [sy, sm, sd] = startDate.split('-').map(Number);
  const [ey, em, ed] = endDate.split('-').map(Number);
  return Math.round((Date.UTC(ey, em - 1, ed) - Date.UTC(sy, sm - 1, sd)) / 86400000);
}

function shiftedBookingTimesForFlightDate(startTime, endTime, targetFlightDate) {
  const targetDate = normalizeFlightDate(targetFlightDate);
  if (!targetDate) return null;

  const start = new Date(startTime);
  const end = new Date(endTime);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;

  const currentStartDate = calendarDateFromDate(start);
  if (targetDate === currentStartDate) return null;

  const currentEndDate = calendarDateFromDate(end);
  const endDateOffset = daysBetweenCalendarDates(currentStartDate, currentEndDate);
  const newStart = wallClockToUtc(targetDate, timeHmFromDate(start));
  let newEnd = wallClockToUtc(addCalendarDays(targetDate, endDateOffset), timeHmFromDate(end));

  if (newEnd <= newStart) {
    newEnd = wallClockToUtc(addCalendarDays(targetDate, endDateOffset + 1), timeHmFromDate(end));
  }

  return {
    startIso: newStart.toISOString(),
    endIso: newEnd.toISOString(),
  };
}

module.exports = {
  normalizeFlightDate,
  shiftedBookingTimesForFlightDate,
};
