'use strict';

/** Normalize TIME / string to HH:MM for local wall-clock comparisons. */
function timeToHHMM(t) {
  if (!t) return null;
  const s = String(t);
  return s.length >= 5 ? s.slice(0, 5) : s;
}

/** True when downtime blocks the full calendar day(s) with no time window. */
function isAllDayDowntime(row) {
  if (!row) return false;
  if (row.all_day === true) return true;
  if (row.all_day === false) return false;
  return !row.start_time && !row.end_time;
}

/**
 * Build local Date bounds for a downtime row.
 * Multi-day all-day: start_date 00:00 through end_date 23:59:59.
 * Timed: start_date+start_time through end_date+end_time (defaults 00:00 / 23:59).
 */
function downtimeBounds(row) {
  if (!row?.start_date || !row?.end_date) return null;
  const startDate = String(row.start_date).slice(0, 10);
  const endDate = String(row.end_date).slice(0, 10);
  const allDay = isAllDayDowntime(row);

  const startHHMM = allDay ? '00:00' : (timeToHHMM(row.start_time) || '00:00');
  const endHHMM = allDay ? '23:59' : (timeToHHMM(row.end_time) || '23:59');

  const start = new Date(`${startDate}T${startHHMM}:00`);
  let end = new Date(`${endDate}T${endHHMM}:00`);
  if (allDay || endHHMM === '23:59') {
    end.setSeconds(59, 999);
  }
  return { start, end, allDay };
}

function rangesOverlap(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && aEnd > bStart;
}

function downtimeOverlapsBooking(row, bookingStart, bookingEnd) {
  const bounds = downtimeBounds(row);
  if (!bounds) return false;
  const bStart = bookingStart instanceof Date ? bookingStart : new Date(bookingStart);
  const bEnd = bookingEnd instanceof Date ? bookingEnd : new Date(bookingEnd);
  if (Number.isNaN(bStart.getTime()) || Number.isNaN(bEnd.getTime())) return false;
  return rangesOverlap(bStart, bEnd, bounds.start, bounds.end);
}

/** Whether downtime touches a calendar date (for list/filter hints). */
function downtimeTouchesDate(row, dateStr) {
  if (!row?.start_date || !row?.end_date || !dateStr) return false;
  const d = String(dateStr).slice(0, 10);
  const start = String(row.start_date).slice(0, 10);
  const end = String(row.end_date).slice(0, 10);
  return d >= start && d <= end;
}

function formatDowntimeLabel(row) {
  if (!row) return '';
  const start = String(row.start_date).slice(0, 10);
  const end = String(row.end_date).slice(0, 10);
  if (isAllDayDowntime(row)) {
    return start === end ? `${start} (all day)` : `${start} → ${end} (all day)`;
  }
  const st = timeToHHMM(row.start_time) || '00:00';
  const et = timeToHHMM(row.end_time) || '23:59';
  if (start === end) return `${start} ${st}–${et}`;
  return `${start} ${st} → ${end} ${et}`;
}

module.exports = {
  timeToHHMM,
  isAllDayDowntime,
  downtimeBounds,
  downtimeOverlapsBooking,
  downtimeTouchesDate,
  formatDowntimeLabel,
};
