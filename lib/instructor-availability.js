'use strict';

const pool = require('../db/index');
const { timeToComparable, BOOKABLE_INSTRUCTOR_WHERE, DAY_NAMES } = require('./instructors');
const {
  dayOfWeekFromCalendarDate,
  calendarDateFromDate,
  timeHmFromDate,
  wallClockToUtc,
} = require('./school-timezone');

function resolveAvailabilityContext(startTime, endTime, { localDate, localStart, localEnd } = {}) {
  if (localDate && localStart && localEnd) {
    return {
      dayOfWeek: dayOfWeekFromCalendarDate(localDate),
      startTimeStr: localStart.length === 5 ? localStart + ':00' : localStart,
      endTimeStr: localEnd.length === 5 ? localEnd + ':00' : localEnd,
      dateStr: localDate.slice(0, 10),
    };
  }
  const start = new Date(startTime);
  const end = new Date(endTime);
  return {
    dayOfWeek: dayOfWeekFromCalendarDate(calendarDateFromDate(start)),
    startTimeStr: `${timeHmFromDate(start)}:00`,
    endTimeStr: `${timeHmFromDate(end)}:00`,
    dateStr: calendarDateFromDate(start),
  };
}

function formatTimeWindow(row) {
  const start = typeof row.start_time === 'string' ? row.start_time : timeToComparable(row.start_time);
  const end = typeof row.end_time === 'string' ? row.end_time : timeToComparable(row.end_time);
  return { start: start.slice(0, 5), end: end.slice(0, 5) };
}

/** Effective availability windows for one instructor on a calendar date. */
async function getInstructorDayAvailability(db, instructorId, dateStr) {
  const dayOfWeek = dayOfWeekFromCalendarDate(dateStr);

  const overrides = await db.query(
    `SELECT is_available, start_time, end_time, reason FROM instructor_availability_overrides
     WHERE instructor_id = $1 AND start_date <= $2::date AND end_date >= $2::date`,
    [instructorId, dateStr]
  );

  const fullyBlocked = overrides.rows.some((o) => !o.is_available && !o.start_time && !o.end_time);
  if (fullyBlocked) {
    return {
      dayOfWeek,
      dayName: DAY_NAMES[dayOfWeek],
      hasConfig: true,
      fullyBlocked: true,
      available: false,
      reason: overrides.rows.find((o) => !o.is_available && !o.start_time)?.reason || 'Instructor is unavailable on this date',
      windows: [],
      blocked: [],
    };
  }

  const fullDayAvailable = overrides.rows.some((o) => o.is_available && !o.start_time && !o.end_time);

  const weekly = await db.query(
    `SELECT start_time, end_time FROM instructor_availability
     WHERE instructor_id = $1 AND day_of_week = $2 ORDER BY start_time`,
    [instructorId, dayOfWeek]
  );

  const anyConfig = await db.query(
    `SELECT 1 FROM instructor_availability WHERE instructor_id = $1 LIMIT 1`,
    [instructorId]
  );
  const hasConfig = anyConfig.rows.length > 0;

  if (!hasConfig) {
    return {
      dayOfWeek,
      dayName: DAY_NAMES[dayOfWeek],
      hasConfig: false,
      fullyBlocked: false,
      available: true,
      noConfig: true,
      windows: [],
      blocked: [],
    };
  }

  const windows = weekly.rows.map(formatTimeWindow);
  const extraWindows = overrides.rows
    .filter((o) => o.is_available && o.start_time && o.end_time)
    .map(formatTimeWindow);
  const blocked = overrides.rows
    .filter((o) => !o.is_available && o.start_time && o.end_time)
    .map((o) => ({ ...formatTimeWindow(o), reason: o.reason }));

  const allWindows = [...windows, ...extraWindows];

  if (fullDayAvailable && allWindows.length === 0) {
    return {
      dayOfWeek,
      dayName: DAY_NAMES[dayOfWeek],
      hasConfig: true,
      fullyBlocked: false,
      available: true,
      windows: [{ start: '00:00', end: '23:59' }],
      blocked,
    };
  }

  if (allWindows.length === 0) {
    return {
      dayOfWeek,
      dayName: DAY_NAMES[dayOfWeek],
      hasConfig: true,
      fullyBlocked: false,
      available: false,
      reason: `No availability set for ${DAY_NAMES[dayOfWeek]}`,
      windows: [],
      blocked,
    };
  }

  return {
    dayOfWeek,
    dayName: DAY_NAMES[dayOfWeek],
    hasConfig: true,
    fullyBlocked: false,
    available: true,
    windows: allWindows,
    blocked,
  };
}

async function getAllInstructorsDayAvailability(db, dateStr) {
  const instructors = await db.query(
    `SELECT id, name, email, phone_number FROM users u WHERE ${BOOKABLE_INSTRUCTOR_WHERE} ORDER BY name`
  );
  const dayOfWeek = dayOfWeekFromCalendarDate(dateStr);
  const result = [];
  for (const inst of instructors.rows) {
    const day = await getInstructorDayAvailability(db, inst.id, dateStr);
    result.push({
      id: inst.id,
      name: inst.name,
      email: inst.email || null,
      phone_number: inst.phone_number || null,
      has_config: day.hasConfig,
      fully_blocked: day.fullyBlocked,
      windows: day.windows,
      blocked: day.blocked,
    });
  }
  return { date: dateStr, day: DAY_NAMES[dayOfWeek], instructors: result };
}

/** Instructor availability check — fail-open if no availability configured */
async function isInstructorAvailable(client, instructorId, startTime, endTime, { localDate, localStart, localEnd } = {}) {
  const db = client || pool;
  const { dayOfWeek, startTimeStr, endTimeStr, dateStr } = resolveAvailabilityContext(startTime, endTime, {
    localDate, localStart, localEnd,
  });

  const overrides = await db.query(
    `SELECT is_available, start_time, end_time, reason FROM instructor_availability_overrides
     WHERE instructor_id = $1 AND start_date <= $2::date AND end_date >= $2::date`,
    [instructorId, dateStr]
  );
  for (const ov of overrides.rows) {
    if (ov.start_time && ov.end_time) {
      const ovStart = timeToComparable(ov.start_time);
      const ovEnd = timeToComparable(ov.end_time);
      if (startTimeStr < ovEnd && endTimeStr > ovStart) {
        if (!ov.is_available) return { available: false, reason: ov.reason || 'Instructor has a time block override' };
        if (startTimeStr >= ovStart && endTimeStr <= ovEnd) return { available: true };
      }
    } else {
      if (!ov.is_available) return { available: false, reason: ov.reason || 'Instructor is unavailable on this date' };
      if (ov.is_available) return { available: true };
    }
  }

  const weekly = await db.query(
    `SELECT start_time, end_time FROM instructor_availability
     WHERE instructor_id = $1 AND day_of_week = $2`,
    [instructorId, dayOfWeek]
  );
  const anyConfig = await db.query(
    `SELECT 1 FROM instructor_availability WHERE instructor_id = $1 LIMIT 1`,
    [instructorId]
  );
  if (anyConfig.rows.length === 0) return { available: true };

  for (const slot of weekly.rows) {
    const slotStart = timeToComparable(slot.start_time);
    const slotEnd = timeToComparable(slot.end_time);
    if (startTimeStr >= slotStart && endTimeStr <= slotEnd) return { available: true };
  }
  return { available: false, reason: 'Outside instructor scheduled availability hours' };
}

module.exports = {
  isInstructorAvailable,
  getInstructorDayAvailability,
  getAllInstructorsDayAvailability,
  dayOfWeekFromCalendarDate,
};
