'use strict';

/** New Tech Aviation — all wall-clock times are US Eastern (Virginia). */
const SCHOOL_TZ = 'America/New_York';
const SCHOOL_TZ_LABEL = 'ET';

function getParts(date, timeZone = SCHOOL_TZ) {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return null;
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  const map = {};
  for (const p of fmt.formatToParts(d)) {
    if (p.type !== 'literal') map[p.type] = p.value;
  }
  return {
    year: +map.year,
    month: +map.month,
    day: +map.day,
    hour: +map.hour === 24 ? 0 : +map.hour,
    minute: +map.minute,
    second: +map.second,
  };
}

function calendarDateFromDate(date, timeZone = SCHOOL_TZ) {
  const p = getParts(date, timeZone);
  if (!p) return '';
  return `${String(p.year).padStart(4, '0')}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

/** Day of week (0=Sun … 6=Sat) for a YYYY-MM-DD calendar date. */
function dayOfWeekFromCalendarDate(dateStr) {
  const dateOnly = typeof dateStr === 'string' && dateStr.includes('T') ? dateStr.slice(0, 10) : String(dateStr);
  const [y, m, d] = dateOnly.split('-').map(Number);
  if (!y || !m || !d) return 0;
  return new Date(y, m - 1, d).getDay();
}

function addCalendarDays(dateStr, days) {
  const [y, m, d] = dateStr.slice(0, 10).split('-').map(Number);
  const tmp = new Date(y, m - 1, d + days);
  return `${tmp.getFullYear()}-${String(tmp.getMonth() + 1).padStart(2, '0')}-${String(tmp.getDate()).padStart(2, '0')}`;
}

function normalizeWallTime(timeStr) {
  if (!timeStr) return '00:00:00';
  if (timeStr === '24:00') return '00:00:00';
  return timeStr.length === 5 ? `${timeStr}:00` : timeStr;
}

/** Interpret YYYY-MM-DD + HH:MM as Eastern wall clock → UTC Date. */
function wallClockToUtc(dateStr, timeStr, timeZone = SCHOOL_TZ) {
  let day = dateStr.slice(0, 10);
  let t = timeStr;
  if (t === '24:00' || t === '24:00:00') {
    t = '00:00';
    day = addCalendarDays(day, 1);
  }
  const normalized = normalizeWallTime(t);
  const [y, m, d] = day.split('-').map(Number);
  const [hh, mm, ss = 0] = normalized.split(':').map(Number);

  let utcMs = Date.UTC(y, m - 1, d, hh, mm, ss);
  for (let i = 0; i < 5; i++) {
    const parts = getParts(new Date(utcMs), timeZone);
    if (!parts) break;
    const dayDiffMin = Math.round(
      (Date.UTC(y, m - 1, d) - Date.UTC(parts.year, parts.month - 1, parts.day)) / 60000
    );
    const timeDiffMin = (hh - parts.hour) * 60 + (mm - parts.minute);
    const totalDiffMin = dayDiffMin + timeDiffMin;
    if (totalDiffMin === 0) break;
    utcMs += totalDiffMin * 60 * 1000;
  }
  return new Date(utcMs);
}

function wallClockToUtcIso(dateStr, timeStr, timeZone = SCHOOL_TZ) {
  return wallClockToUtc(dateStr, timeStr, timeZone).toISOString();
}

function timeHmFromDate(date, timeZone = SCHOOL_TZ) {
  const p = getParts(date, timeZone);
  if (!p) return '00:00';
  return `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`;
}

function formatTime(date, opts = {}) {
  const d = date instanceof Date ? date : new Date(date);
  return d.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: SCHOOL_TZ,
    ...opts,
  });
}

function formatTime24(date) {
  const p = getParts(date instanceof Date ? date : new Date(date));
  if (!p) return '';
  return `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`;
}

function formatDate(date, opts = {}) {
  const d = date instanceof Date ? date : new Date(date);
  return d.toLocaleDateString('en-US', {
    timeZone: SCHOOL_TZ,
    ...opts,
  });
}

function formatDateTime(date) {
  return `${formatDate(date, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })} at ${formatTime(date)} ${SCHOOL_TZ_LABEL}`;
}

function formatDateTimeShort(date) {
  return `${formatDate(date, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })} ${SCHOOL_TZ_LABEL}`;
}

function todayCalendarDate() {
  const p = getParts(new Date());
  return new Date(p.year, p.month - 1, p.day);
}

function easternDayBoundsUtc(year, monthIndex, day) {
  const dateStr = `${year}-${String(monthIndex + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  return {
    start: wallClockToUtc(dateStr, '00:00'),
    end: wallClockToUtc(addCalendarDays(dateStr, 1), '00:00'),
  };
}

function civilDateFromParts(year, monthIndex, day) {
  const tmp = new Date(year, monthIndex, day);
  return `${tmp.getFullYear()}-${String(tmp.getMonth() + 1).padStart(2, '0')}-${String(tmp.getDate()).padStart(2, '0')}`;
}

module.exports = {
  SCHOOL_TZ,
  SCHOOL_TZ_LABEL,
  getParts,
  calendarDateFromDate,
  dayOfWeekFromCalendarDate,
  addCalendarDays,
  wallClockToUtc,
  wallClockToUtcIso,
  timeHmFromDate,
  formatTime,
  formatTime24,
  formatDate,
  formatDateTime,
  formatDateTimeShort,
  todayCalendarDate,
  easternDayBoundsUtc,
  civilDateFromParts,
};
