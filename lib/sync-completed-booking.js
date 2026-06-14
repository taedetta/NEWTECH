'use strict';

const { computeFlightCharges } = require('./flight-charges');
const { syncInstructorHoursFromFlight } = require('./sync-instructor-hours');

async function syncCompletedBookingSideEffects(client, booking, lessonType) {
  if (booking.status !== 'completed') return;

  const logRes = await client.query('SELECT * FROM flight_logs WHERE booking_id = $1', [booking.id]);
  if (!logRes.rows.length) return;

  const fl = logRes.rows[0];
  const hobbsDelta = fl.hobbs_delta != null
    ? parseFloat(fl.hobbs_delta)
    : (booking.hobbs_end != null && booking.hobbs_start != null
      ? parseFloat(booking.hobbs_end) - parseFloat(booking.hobbs_start)
      : 0);
  const dualHrs = parseFloat(fl.dual_instruction_hours) || 0;

  const acRate = booking.aircraft_id
    ? (await client.query('SELECT hourly_rate FROM aircraft WHERE id = $1', [booking.aircraft_id])).rows[0]
    : null;
  const instrRate = booking.instructor_id
    ? (await client.query('SELECT instructor_rate FROM users WHERE id = $1', [booking.instructor_id])).rows[0]
    : null;

  const effectiveLessonType = lessonType != null ? lessonType : booking.lesson_type;
  const { aircraftChargeAmount, instructionChargeAmount } = computeFlightCharges({
    lessonType: effectiveLessonType,
    hobbsDelta,
    dualHrs,
    hourlyRate: acRate?.hourly_rate,
    instructorRate: instrRate?.instructor_rate,
  });

  const flightDate = fl.flight_date
    || (booking.start_time ? new Date(booking.start_time).toISOString().slice(0, 10) : null);

  await client.query(
    `UPDATE flight_logs SET
       student_id = $1, instructor_id = $2, aircraft_id = $3, booking_type = $4,
       aircraft_charge_amount = $5, instruction_charge_amount = $6,
       updated_at = NOW()
     WHERE booking_id = $7`,
    [
      booking.student_id,
      booking.instructor_id,
      booking.aircraft_id,
      booking.booking_type,
      aircraftChargeAmount,
      instructionChargeAmount,
      booking.id,
    ]
  );

  if (booking.instructor_id) {
    let studentName = null;
    if (booking.student_id) {
      const sn = await client.query('SELECT name FROM users WHERE id = $1', [booking.student_id]);
      studentName = sn.rows[0]?.name || null;
    }
    await syncInstructorHoursFromFlight(client, {
      booking,
      hobbsFlown: hobbsDelta,
      dualHrs,
      flightDate,
      studentName,
    });
  } else {
    await client.query('DELETE FROM instructor_hours WHERE booking_id = $1', [booking.id]);
  }
}

module.exports = { syncCompletedBookingSideEffects };
