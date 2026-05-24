'use strict';

/**
 * Cross-check instructor_hours entries against flight_logs / bookings.
 */
const pool = require('../db/index');

const TOLERANCE = 0.15; // hours

async function findMatchingFlights({ instructorId, entryDate, aircraftId, studentName, bookingId }) {
  if (bookingId) {
    const byBooking = await pool.query(`
      SELECT fl.*, b.id AS booking_id, s.name AS student_name, a.tail_number
      FROM flight_logs fl
      JOIN bookings b ON b.id = fl.booking_id
      LEFT JOIN users s ON s.id = fl.student_id
      LEFT JOIN aircraft a ON a.id = fl.aircraft_id
      WHERE fl.booking_id = $1
    `, [bookingId]);
    if (byBooking.rows.length) return byBooking.rows;
  }

  let q = `
    SELECT fl.*, b.id AS booking_id, s.name AS student_name, a.tail_number
    FROM flight_logs fl
    JOIN bookings b ON b.id = fl.booking_id
    LEFT JOIN users s ON s.id = fl.student_id
    LEFT JOIN aircraft a ON a.id = fl.aircraft_id
    WHERE b.status = 'completed'
      AND fl.flight_date = $1::date
      AND (fl.instructor_id = $2 OR b.instructor_id = $2)
  `;
  const params = [entryDate, instructorId];
  if (aircraftId) {
    q += ` AND fl.aircraft_id = $${params.length + 1}`;
    params.push(aircraftId);
  }
  const result = await pool.query(q, params);
  if (!studentName) return result.rows;
  const norm = studentName.trim().toLowerCase();
  const filtered = result.rows.filter((r) => (r.student_name || '').toLowerCase().includes(norm) || norm.includes((r.student_name || '').toLowerCase()));
  return filtered.length ? filtered : result.rows;
}

function sumField(rows, field, fallbackField) {
  return rows.reduce((s, r) => s + parseFloat(r[field] ?? r[fallbackField] ?? 0), 0);
}

/**
 * Compare an instructor hours entry to flight log data. Returns { ok, status, message, details }.
 */
async function auditInstructorHoursEntry({ instructorId, entryDate, aircraftId, aircraftHours, instructionHours, studentName, bookingId }) {
  const flights = await findMatchingFlights({ instructorId, entryDate, aircraftId, studentName, bookingId });
  if (flights.length === 0) {
    return {
      ok: true,
      status: 'unmatched',
      message: 'No matching completed flight log for this date/aircraft — verify entry manually',
      details: { flights: 0 },
    };
  }

  const expectedHobbs = sumField(flights, 'hobbs_delta');
  const expectedDual = sumField(flights, 'dual_instruction_hours', 'hobbs_delta');
  const acHrs = parseFloat(aircraftHours) || 0;
  const instrHrs = parseFloat(instructionHours) || 0;
  const issues = [];

  if (acHrs > 0 && Math.abs(acHrs - expectedHobbs) > TOLERANCE) {
    issues.push(`Aircraft hours logged (${acHrs.toFixed(1)}) ≠ flight log Hobbs (${expectedHobbs.toFixed(1)})`);
  }
  if (instrHrs > 0 && Math.abs(instrHrs - expectedDual) > TOLERANCE) {
    issues.push(`Instruction hours (${instrHrs.toFixed(1)}) ≠ flight log dual/instruction (${expectedDual.toFixed(1)})`);
  }
  if (acHrs === 0 && expectedHobbs > 0) {
    issues.push(`Missing aircraft hours — flight log shows ${expectedHobbs.toFixed(1)} Hobbs`);
  }
  if (instrHrs === 0 && expectedDual > 0) {
    issues.push(`Missing instruction hours — flight log shows ${expectedDual.toFixed(1)} dual hrs`);
  }

  if (issues.length) {
    const tail = flights.map((f) => f.tail_number).filter(Boolean).join(', ');
    return {
      ok: false,
      status: 'flagged',
      message: issues.join('. ') + (tail ? ` (${tail})` : ''),
      details: { expectedHobbs, expectedDual, flightCount: flights.length, issues },
    };
  }

  return {
    ok: true,
    status: 'ok',
    message: null,
    details: { expectedHobbs, expectedDual, flightCount: flights.length },
  };
}

/** List all flagged instructor hour entries + booking/flight mismatches for admin review */
async function listHoursAuditFlags({ instructorId } = {}) {
  const params = [];
  let extra = '';
  if (instructorId) {
    extra = ' AND ih.instructor_id = $1';
    params.push(instructorId);
  }

  const ihResult = await pool.query(`
    SELECT ih.id, ih.entry_date, ih.aircraft_hours, ih.instruction_hours, ih.audit_status, ih.audit_message,
           ih.student_name, u.name AS instructor_name, a.tail_number
    FROM instructor_hours ih
    JOIN users u ON u.id = ih.instructor_id
    LEFT JOIN aircraft a ON a.id = ih.aircraft_id
    WHERE ih.audit_status IN ('flagged', 'unmatched') ${extra}
    ORDER BY ih.entry_date DESC
  `, params);

  return ihResult.rows;
}

module.exports = {
  TOLERANCE,
  auditInstructorHoursEntry,
  listHoursAuditFlags,
  findMatchingFlights,
};
