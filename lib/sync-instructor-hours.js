'use strict';

/**
 * Upsert instructor_hours from a completed flight (instructor dual/solo instruction time).
 * Auto-synced entries are authoritative — always marked audit_status = 'ok'.
 */
async function syncInstructorHoursFromFlight(client, { booking, hobbsFlown, dualHrs, flightDate, studentName }) {
  if (!booking.instructor_id) return null;

  const instrHrs = dualHrs > 0 ? dualHrs : (booking.booking_type === 'dual' ? hobbsFlown : 0);
  const acHrs = hobbsFlown;
  if (acHrs <= 0 && instrHrs <= 0) return null;

  const acRateRow = booking.aircraft_id
    ? (await client.query('SELECT hourly_rate FROM aircraft WHERE id = $1', [booking.aircraft_id])).rows[0]
    : null;
  const instrRateRow = (await client.query(
    'SELECT instructor_rate FROM users WHERE id = $1',
    [booking.instructor_id]
  )).rows[0];

  const audit = { status: 'ok', message: null };

  const existing = await client.query('SELECT id FROM instructor_hours WHERE booking_id = $1', [booking.id]);
  const fields = [
    booking.instructor_id,
    booking.aircraft_id || null,
    flightDate,
    acHrs,
    instrHrs,
    acRateRow ? parseFloat(acRateRow.hourly_rate) : null,
    instrRateRow ? parseFloat(instrRateRow.instructor_rate) : null,
    null,
    studentName || null,
    booking.id,
    audit.status,
    audit.message,
  ];

  if (existing.rows.length > 0) {
    await client.query(
      `UPDATE instructor_hours SET
         entry_date = $3, aircraft_hours = $4, instruction_hours = $5,
         aircraft_rate = $6, instructor_rate = $7, notes = $8, student_name = $9,
         audit_status = $11, audit_message = $12, updated_at = NOW()
       WHERE booking_id = $10`,
      fields
    );
    return existing.rows[0].id;
  }

  const ins = await client.query(
    `INSERT INTO instructor_hours
       (instructor_id, aircraft_id, entry_date, aircraft_hours, instruction_hours,
        aircraft_rate, instructor_rate, notes, student_name, booking_id, audit_status, audit_message)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     RETURNING id`,
    fields
  );
  return ins.rows[0].id;
}

module.exports = { syncInstructorHoursFromFlight };
