'use strict';

const pool = require('../db/index');
const { timeToComparable } = require('./instructors');

/** Instructor availability check — fail-open if no availability configured */
async function isInstructorAvailable(client, instructorId, startTime, endTime, { localDate, localStart, localEnd } = {}) {
  const db = client || pool;
  let dayOfWeek, startTimeStr, endTimeStr, dateStr;
  if (localDate && localStart && localEnd) {
    const d = new Date(localDate + 'T00:00:00Z');
    dayOfWeek = d.getUTCDay();
    startTimeStr = localStart.length === 5 ? localStart + ':00' : localStart;
    endTimeStr = localEnd.length === 5 ? localEnd + ':00' : localEnd;
    dateStr = localDate;
  } else {
    const start = new Date(startTime);
    const end = new Date(endTime);
    dayOfWeek = start.getUTCDay();
    startTimeStr = start.toISOString().slice(11, 19);
    endTimeStr = end.toISOString().slice(11, 19);
    dateStr = start.toISOString().slice(0, 10);
  }
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
        return { available: true };
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

module.exports = { isInstructorAvailable };
