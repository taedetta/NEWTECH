'use strict';

const pool = require('../db/index');

/**
 * CFI utilization stats for a date range.
 */
async function getInstructorUtilization({ startDate, endDate }) {
  const params = [startDate, endDate];

  const instructors = await pool.query(
    `SELECT u.id, u.name, u.email, u.instructor_rate,
       (SELECT COUNT(DISTINCT st.student_id)::int
        FROM student_training st
        WHERE st.instructor_id = u.id AND st.status = 'active') AS assigned_students
     FROM users u
     WHERE u.deleted_at IS NULL
       AND (u.role = 'instructor' OR u.is_instructor = TRUE)
     ORDER BY u.name`
  );

  const result = [];
  for (const instr of instructors.rows) {
    const booked = await pool.query(
      `SELECT COALESCE(SUM(EXTRACT(EPOCH FROM (LEAST(end_time, $2::timestamptz) - GREATEST(start_time, $1::timestamptz))) / 3600), 0) AS booked_hours,
              COUNT(*)::int AS booking_count
       FROM bookings
       WHERE instructor_id = $3 AND status IN ('confirmed', 'completed')
         AND start_time < $2::timestamptz AND end_time > $1::timestamptz`,
      [startDate, endDate, instr.id]
    );

    const completed = await pool.query(
      `SELECT COALESCE(SUM(fl.hobbs_delta), 0) AS dual_hobbs,
              COUNT(DISTINCT fl.id)::int AS flights_logged
       FROM flight_logs fl
       WHERE fl.instructor_id = $1
         AND fl.flight_date >= $2::date AND fl.flight_date <= $3::date`,
      [instr.id, startDate.slice(0, 10), endDate.slice(0, 10)]
    );

    const availWindows = await pool.query(
      `SELECT day_of_week, start_time, end_time FROM instructor_availability WHERE instructor_id = $1`,
      [instr.id]
    );

    const weeks = Math.max(1, (new Date(endDate) - new Date(startDate)) / (7 * 86400000));
    let weeklyAvailHours = 0;
    for (const w of availWindows.rows) {
      const [sh, sm] = w.start_time.split(':').map(Number);
      const [eh, em] = w.end_time.split(':').map(Number);
      weeklyAvailHours += (eh + em / 60) - (sh + sm / 60);
    }
    const availableHours = weeklyAvailHours * weeks;
    const bookedHours = parseFloat(booked.rows[0].booked_hours) || 0;
    const utilizationPct = availableHours > 0
      ? Math.min(100, Math.round((bookedHours / availableHours) * 100))
      : (bookedHours > 0 ? 100 : 0);

    const dualHobbs = parseFloat(completed.rows[0].dual_hobbs) || 0;
    const rate = parseFloat(instr.instructor_rate) || 0;

    result.push({
      id: instr.id,
      name: instr.name,
      email: instr.email,
      assigned_students: instr.assigned_students,
      booked_hours: Math.round(bookedHours * 10) / 10,
      available_hours: Math.round(availableHours * 10) / 10,
      utilization_pct: utilizationPct,
      booking_count: booked.rows[0].booking_count,
      dual_hobbs_logged: Math.round(dualHobbs * 10) / 10,
      flights_logged: completed.rows[0].flights_logged,
      est_instruction_revenue: Math.round(dualHobbs * rate * 100) / 100,
    });
  }

  return result;
}

module.exports = { getInstructorUtilization };
