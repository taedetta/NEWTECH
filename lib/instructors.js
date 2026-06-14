'use strict';

/** SQL fragment: users who can appear as instructors in booking/scheduling. */
const BOOKABLE_INSTRUCTOR_WHERE = `
  u.deleted_at IS NULL
  AND COALESCE(u.approval_status, 'approved') = 'approved'
  AND (u.is_instructor = TRUE OR u.role = 'instructor')
`;

/** Normalize HH:MM or HH:MM:SS for PostgreSQL TIME columns. */
function normalizeTimeValue(t) {
  if (t == null || t === '') return null;
  const s = String(t).trim();
  if (/^\d{2}:\d{2}:\d{2}$/.test(s)) return s;
  if (/^\d{1,2}:\d{2}$/.test(s)) {
    const [h, m] = s.split(':');
    return `${h.padStart(2, '0')}:${m}:00`;
  }
  return s.slice(0, 8);
}

/** Compare-friendly time string from DB TIME value. */
function timeToComparable(t) {
  if (t == null) return '';
  if (typeof t === 'string') return normalizeTimeValue(t) || '';
  if (t instanceof Date) {
    return `${String(t.getUTCHours()).padStart(2, '0')}:${String(t.getUTCMinutes()).padStart(2, '0')}:00`;
  }
  return normalizeTimeValue(String(t)) || '';
}

function roleShouldBeInstructor(role) {
  return role === 'instructor';
}

const { dayOfWeekFromCalendarDate } = require('./school-timezone');

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

module.exports = {
  BOOKABLE_INSTRUCTOR_WHERE,
  normalizeTimeValue,
  timeToComparable,
  roleShouldBeInstructor,
  dayOfWeekFromCalendarDate,
  DAY_NAMES,
};
