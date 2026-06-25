'use strict';

const { resolveFlightCharges } = require('./flight-charges');
const { inferLessonType } = require('./booking-rules');
const { syncInstructorHoursFromFlight } = require('./sync-instructor-hours');

function parseNum(v) {
  if (v == null || v === '') return null;
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

function hobbsDeltaFrom(start, end) {
  const s = parseNum(start);
  const e = parseNum(end);
  if (s == null || e == null) return null;
  return parseFloat((e - s).toFixed(2));
}

function tachDeltaFrom(start, end) {
  const s = parseNum(start);
  const e = parseNum(end);
  if (s == null || e == null) return null;
  return parseFloat((e - s).toFixed(2));
}

function dateOnly(value) {
  if (!value) return null;
  if (typeof value === 'string') return value.slice(0, 10);
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

function shiftBookingDatePreservingTime({ flightDate, currentStartTime, currentEndTime }) {
  const start = currentStartTime ? new Date(currentStartTime) : null;
  const end = currentEndTime ? new Date(currentEndTime) : null;

  if (!start || Number.isNaN(start.getTime())) {
    const fallbackStart = new Date(flightDate + 'T12:00:00Z');
    return {
      startTime: fallbackStart,
      endTime: new Date(fallbackStart.getTime() + 60 * 60 * 1000),
    };
  }

  const durationMs = end && !Number.isNaN(end.getTime())
    ? Math.max(0, end.getTime() - start.getTime())
    : 60 * 60 * 1000;
  const shiftedStart = new Date(`${flightDate}T${start.toISOString().slice(11)}`);
  return {
    startTime: shiftedStart,
    endTime: new Date(shiftedStart.getTime() + durationMs),
  };
}

async function applyUserHoursDelta(client, userId, hobbsDelta, tachDelta) {
  if (!userId) return;
  const h = parseFloat(hobbsDelta) || 0;
  const t = parseFloat(tachDelta) || 0;
  if (h === 0 && t === 0) return;
  await client.query(
    `UPDATE users SET
       total_hobbs_hours = COALESCE(total_hobbs_hours, 0) + $1,
       total_tach_hours = COALESCE(total_tach_hours, 0) + $2
     WHERE id = $3`,
    [h, t, userId]
  );
}

async function adjustCumulativeUserHours(client, {
  oldStudentId,
  oldInstructorId,
  oldHobbsDelta,
  oldTachDelta,
  newStudentId,
  newInstructorId,
  newHobbsDelta,
  newTachDelta,
}) {
  const oldH = parseFloat(oldHobbsDelta) || 0;
  const oldT = parseFloat(oldTachDelta) || 0;
  const newH = parseFloat(newHobbsDelta) || 0;
  const newT = parseFloat(newTachDelta) || 0;

  await applyUserHoursDelta(client, oldStudentId, -oldH, -oldT);
  await applyUserHoursDelta(client, oldInstructorId, -oldH, -oldT);
  await applyUserHoursDelta(client, newStudentId, newH, newT);
  await applyUserHoursDelta(client, newInstructorId, newH, newT);
}

/**
 * Keep bookings, flight_logs, instructor_hours, and user cumulative hours aligned.
 * Call inside an open transaction whenever hours/charges/participants change.
 */
async function syncFlightRecord(client, bookingId, patch = {}) {
  const bkRes = await client.query('SELECT * FROM bookings WHERE id = $1', [bookingId]);
  if (!bkRes.rows.length) throw new Error('Booking not found');
  const bookingBefore = bkRes.rows[0];

  const logRes = await client.query('SELECT * FROM flight_logs WHERE booking_id = $1', [bookingId]);
  const oldLog = logRes.rows[0] || null;

  const oldHobbsDelta = oldLog?.hobbs_delta != null
    ? parseFloat(oldLog.hobbs_delta)
    : hobbsDeltaFrom(bookingBefore.hobbs_start, bookingBefore.hobbs_end) || 0;
  const oldTachDelta = oldLog?.tach_delta != null
    ? parseFloat(oldLog.tach_delta)
    : tachDeltaFrom(bookingBefore.tach_start, bookingBefore.tach_end) || 0;

  const hStart = patch.hobbs_start !== undefined
    ? parseNum(patch.hobbs_start)
    : parseNum(oldLog?.hobbs_start ?? bookingBefore.hobbs_start);
  const hEnd = patch.hobbs_end !== undefined
    ? parseNum(patch.hobbs_end)
    : parseNum(oldLog?.hobbs_end ?? bookingBefore.hobbs_end);
  const tStart = patch.tach_start !== undefined
    ? parseNum(patch.tach_start)
    : parseNum(oldLog?.tach_start ?? bookingBefore.tach_start);
  const tEnd = patch.tach_end !== undefined
    ? parseNum(patch.tach_end)
    : parseNum(oldLog?.tach_end ?? bookingBefore.tach_end);

  const hobbsDelta = hobbsDeltaFrom(hStart, hEnd);
  const tachDelta = tachDeltaFrom(tStart, tEnd);

  const dualHrs = patch.dual_instruction_hours !== undefined
    ? (parseNum(patch.dual_instruction_hours) || 0)
    : (parseNum(oldLog?.dual_instruction_hours) || 0);

  const rawLessonType = patch.lesson_type !== undefined && patch.lesson_type !== ''
    ? patch.lesson_type
    : bookingBefore.lesson_type;
  const lessonType = inferLessonType(rawLessonType, bookingBefore);

  const flightDate = patch.flight_date
    || oldLog?.flight_date
    || (bookingBefore.start_time ? new Date(bookingBefore.start_time).toISOString().slice(0, 10) : null)
    || new Date().toISOString().slice(0, 10);

  const acRate = bookingBefore.aircraft_id
    ? (await client.query('SELECT hourly_rate FROM aircraft WHERE id = $1', [bookingBefore.aircraft_id])).rows[0]
    : null;
  const instrRate = bookingBefore.instructor_id
    ? (await client.query('SELECT instructor_rate FROM users WHERE id = $1', [bookingBefore.instructor_id])).rows[0]
    : null;

  const { aircraftChargeAmount, instructionChargeAmount } = resolveFlightCharges({
    lessonType,
    hobbsDelta: hobbsDelta || 0,
    dualHrs,
    hourlyRate: patch.aircraft_rate_override ?? acRate?.hourly_rate,
    instructorRate: patch.instructor_rate_override ?? instrRate?.instructor_rate,
    aircraftChargeAmount: patch.aircraft_charge_amount,
    instructionChargeAmount: patch.instruction_charge_amount,
  });

  const bookingSets = [];
  const bookingVals = [];
  let bi = 1;

  if (hStart != null) { bookingSets.push(`hobbs_start = $${bi++}`); bookingVals.push(hStart); }
  if (hEnd != null) { bookingSets.push(`hobbs_end = $${bi++}`); bookingVals.push(hEnd); }
  if (patch.tach_start !== undefined) { bookingSets.push(`tach_start = $${bi++}`); bookingVals.push(tStart); }
  if (patch.tach_end !== undefined) { bookingSets.push(`tach_end = $${bi++}`); bookingVals.push(tEnd); }
  if (patch.lesson_type !== undefined && patch.lesson_type !== '') {
    bookingSets.push(`lesson_type = $${bi++}`);
    bookingVals.push(patch.lesson_type);
  } else if (!bookingBefore.lesson_type && lessonType) {
    bookingSets.push(`lesson_type = $${bi++}`);
    bookingVals.push(lessonType);
  }
  if (patch.flight_date && dateOnly(flightDate) !== dateOnly(bookingBefore.start_time)) {
    const { startTime, endTime } = shiftBookingDatePreservingTime({
      flightDate,
      currentStartTime: bookingBefore.start_time,
      currentEndTime: bookingBefore.end_time,
    });
    bookingSets.push(`start_time = $${bi++}`);
    bookingVals.push(startTime.toISOString());
    bookingSets.push(`end_time = $${bi++}`);
    bookingVals.push(endTime.toISOString());
  }
  if (bookingSets.length) {
    bookingSets.push('updated_at = NOW()');
    bookingVals.push(bookingId);
    await client.query(
      `UPDATE bookings SET ${bookingSets.join(', ')} WHERE id = $${bi}`,
      bookingVals
    );
  }

  const bkAfter = await client.query('SELECT * FROM bookings WHERE id = $1', [bookingId]);
  const booking = bkAfter.rows[0];

  if (oldLog) {
    await client.query(
      `UPDATE flight_logs SET
         flight_date = $1, hobbs_start = $2, hobbs_end = $3, hobbs_delta = $4,
         tach_start = $5, tach_end = $6, tach_delta = $7,
         dual_instruction_hours = $8, aircraft_charge_amount = $9, instruction_charge_amount = $10,
         student_id = $11, instructor_id = $12, aircraft_id = $13, booking_type = $14,
         updated_at = NOW()
       WHERE booking_id = $15`,
      [
        flightDate, hStart, hEnd, hobbsDelta, tStart, tEnd, tachDelta, dualHrs,
        aircraftChargeAmount, instructionChargeAmount,
        booking.student_id, booking.instructor_id, booking.aircraft_id,
        booking.booking_type || 'dual', bookingId,
      ]
    );
  } else if (hStart != null && hEnd != null && booking.status === 'completed') {
    await client.query(
      `INSERT INTO flight_logs
         (booking_id, aircraft_id, student_id, instructor_id, booking_type,
          flight_date, hobbs_start, hobbs_end, hobbs_delta, tach_start, tach_end, tach_delta,
          dual_instruction_hours, submitted_by, aircraft_charge_amount, instruction_charge_amount)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
      [
        bookingId, booking.aircraft_id, booking.student_id, booking.instructor_id,
        booking.booking_type || 'dual', flightDate, hStart, hEnd, hobbsDelta,
        tStart, tEnd, tachDelta, dualHrs, patch.submitted_by || null,
        aircraftChargeAmount, instructionChargeAmount,
      ]
    );
  }

  if (booking.status === 'completed' && !booking.billing_voided && hobbsDelta != null) {
    const oldStudentId = oldLog?.student_id != null ? oldLog.student_id : bookingBefore.student_id;
    const oldInstructorId = oldLog?.instructor_id != null ? oldLog.instructor_id : bookingBefore.instructor_id;
    await adjustCumulativeUserHours(client, {
      oldStudentId,
      oldInstructorId,
      oldHobbsDelta,
      oldTachDelta,
      newStudentId: booking.student_id,
      newInstructorId: booking.instructor_id,
      newHobbsDelta: hobbsDelta,
      newTachDelta: tachDelta || 0,
    });
  }

  if (booking.instructor_id && booking.status === 'completed') {
    let studentName = null;
    if (booking.student_id) {
      const sn = await client.query('SELECT name FROM users WHERE id = $1', [booking.student_id]);
      studentName = sn.rows[0]?.name || null;
    }
    const ihExisting = await client.query('SELECT * FROM instructor_hours WHERE booking_id = $1', [bookingId]);
    const preserveRates = patch.preserve_instructor_hours_rates && ihExisting.rows[0]
      ? ihExisting.rows[0]
      : null;
    await syncInstructorHoursFromFlight(client, {
      booking: { ...booking, lesson_type: lessonType },
      hobbsFlown: hobbsDelta || 0,
      dualHrs,
      flightDate,
      studentName,
      preserveRatesRow: preserveRates,
    });
  } else if (booking.status === 'completed') {
    await client.query('DELETE FROM instructor_hours WHERE booking_id = $1', [bookingId]);
  }

  const flAfter = await client.query('SELECT * FROM flight_logs WHERE booking_id = $1', [bookingId]);

  return {
    booking,
    flightLog: flAfter.rows[0] || null,
    aircraftChargeAmount,
    instructionChargeAmount,
    hobbsDelta,
    tachDelta,
  };
}

/** After an instructor_hours row linked to a booking is edited, push hours/charges back. */
async function syncFlightRecordFromInstructorHours(client, instructorHoursRow) {
  if (!instructorHoursRow.booking_id) return null;

  const bkRes = await client.query(
    'SELECT hobbs_start, hobbs_end FROM bookings WHERE id = $1',
    [instructorHoursRow.booking_id]
  );
  const patch = {
    dual_instruction_hours: instructorHoursRow.instruction_hours,
    flight_date: instructorHoursRow.entry_date,
    instructor_rate_override: instructorHoursRow.instructor_rate,
    aircraft_rate_override: instructorHoursRow.aircraft_rate,
    preserve_instructor_hours_rates: true,
  };

  const acHrs = parseFloat(instructorHoursRow.aircraft_hours) || 0;
  const hStart = parseNum(bkRes.rows[0]?.hobbs_start);
  if (hStart != null && acHrs > 0) {
    patch.hobbs_start = hStart;
    patch.hobbs_end = parseFloat((hStart + acHrs).toFixed(2));
  }

  return syncFlightRecord(client, instructorHoursRow.booking_id, patch);
}

module.exports = {
  syncFlightRecord,
  syncFlightRecordFromInstructorHours,
  adjustCumulativeUserHours,
  _private: {
    dateOnly,
    shiftBookingDatePreservingTime,
  },
};
