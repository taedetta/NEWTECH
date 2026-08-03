'use strict';

function toDateOnly(value) {
  if (!value) return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString().slice(0, 10);
  }
  const str = String(value).trim();
  const direct = str.match(/^(\d{4}-\d{2}-\d{2})/);
  if (direct) return direct[1];
  const parsed = new Date(str);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
}

function shiftIsoDatePreservingTime(value, dateOnly) {
  const date = new Date(value);
  if (!dateOnly || Number.isNaN(date.getTime())) return null;
  return `${dateOnly}${date.toISOString().slice(10)}`;
}

function shiftedBookingTimesForDate(startTime, endTime, flightDate) {
  const dateOnly = toDateOnly(flightDate);
  if (!dateOnly || !startTime || !endTime) return null;
  const currentDate = toDateOnly(startTime);
  if (currentDate === dateOnly) return null;
  const startDate = new Date(startTime);
  const endDate = new Date(endTime);
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) return null;
  const startIso = shiftIsoDatePreservingTime(startDate, dateOnly);
  const endIso = new Date(new Date(startIso).getTime() + (endDate.getTime() - startDate.getTime())).toISOString();
  return { startTime: startIso, endTime: endIso };
}

module.exports = {
  shiftedBookingTimesForDate,
  toDateOnly,
};
