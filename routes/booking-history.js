'use strict';
// Booking history — GET listing (flights + ground sessions), DELETE, manual entry.
// Does NOT own live/upcoming bookings (see routes/bookings-routes.js).

const express = require('express');
const pool = require('../db/index');
const { authenticateToken } = require('../middleware/auth');
const { applyAircraftMeterReadings } = require('../lib/aircraft-meter');
const { resolveFlightCharges } = require('../lib/flight-charges');
const { syncInstructorHoursFromFlight } = require('../lib/sync-instructor-hours');

const router = express.Router();

// GET /api/booking-history — completed flights + ground sessions, role-scoped, with totals
router.get('/', authenticateToken, async (req, res) => {
  try {
    const { period, specific_date, sort, aircraft_id, student_id, instructor_id, status, scope } = req.query;
    const { role, id: userId } = req.user;
    const historyScope = scope || 'mine';

    // Date range from period preset
    let startDate = null, endDate = null;
    const now = new Date();

    if (period === 'day') {
      const d = specific_date || now.toISOString().slice(0, 10);
      startDate = d;
      endDate = d;
    } else if (period === 'week') {
      const s = new Date(now);
      s.setDate(s.getDate() - s.getDay());
      startDate = s.toISOString().slice(0, 10);
      const e = new Date(s);
      e.setDate(e.getDate() + 6);
      endDate = e.toISOString().slice(0, 10);
    } else if (period === 'year') {
      startDate = `${now.getFullYear()}-01-01`;
      endDate = `${now.getFullYear()}-12-31`;
    } else if (period === 'all') {
      // no date filter
    } else {
      // month (default)
      const y = now.getFullYear();
      const m = String(now.getMonth() + 1).padStart(2, '0');
      startDate = `${y}-${m}-01`;
      const lastDay = new Date(y, now.getMonth() + 1, 0).getDate();
      endDate = `${y}-${m}-${String(lastDay).padStart(2, '0')}`;
    }

    // --- Flights ---
    let fq = `
      SELECT b.id, 'flight'::text AS session_type,
        COALESCE(fl.flight_date, b.start_time::date) as flight_date,
        s.name as student_name, i.name as instructor_name,
        a.tail_number, a.make_model,
        b.status, b.cancellation_reason, b.booking_type, b.lesson_type,
        COALESCE(fl.hobbs_delta, CASE WHEN b.hobbs_end IS NOT NULL AND b.hobbs_start IS NOT NULL THEN b.hobbs_end - b.hobbs_start END) as hobbs_delta,
        fl.tach_delta,
        COALESCE(fl.dual_instruction_hours,
          CASE WHEN b.booking_type = 'dual' THEN COALESCE(fl.hobbs_delta, b.hobbs_end - b.hobbs_start) END) as dual_instruction_hours,
        COALESCE(fl.aircraft_charge_amount,
          CASE WHEN b.lesson_type ~* '^discovery(\s*flight)?$' THEN 185
          ELSE COALESCE(fl.hobbs_delta, b.hobbs_end - b.hobbs_start) * a.hourly_rate END) as aircraft_charge_amount,
        COALESCE(fl.instruction_charge_amount,
          CASE WHEN b.lesson_type ~* '^discovery(\s*flight)?$' THEN 0
          ELSE COALESCE(fl.dual_instruction_hours,
            CASE WHEN b.booking_type = 'dual' THEN COALESCE(fl.hobbs_delta, b.hobbs_end - b.hobbs_start) END
          ) * COALESCE(i.instructor_rate, 0) END) as instruction_charge_amount,
        COALESCE(fl.aircraft_charge_amount,
          CASE WHEN b.lesson_type ~* '^discovery(\s*flight)?$' THEN 185
          ELSE COALESCE(fl.hobbs_delta, b.hobbs_end - b.hobbs_start) * a.hourly_rate END, 0)
          + COALESCE(fl.instruction_charge_amount,
            CASE WHEN b.lesson_type ~* '^discovery(\s*flight)?$' THEN 0
            ELSE COALESCE(fl.dual_instruction_hours,
              CASE WHEN b.booking_type = 'dual' THEN COALESCE(fl.hobbs_delta, b.hobbs_end - b.hobbs_start) END
            ) * COALESCE(i.instructor_rate, 0) END, 0) as total_charge,
        COALESCE(fl.hobbs_start, b.hobbs_start) as hobbs_start,
        COALESCE(fl.hobbs_end, b.hobbs_end) as hobbs_end,
        COALESCE(fl.tach_start, b.tach_start) as tach_start,
        COALESCE(fl.tach_end, b.tach_end) as tach_end,
        fl.id as flight_log_id
      FROM bookings b
      LEFT JOIN users s ON b.student_id = s.id
      LEFT JOIN users i ON b.instructor_id = i.id
      JOIN aircraft a ON b.aircraft_id = a.id
      LEFT JOIN flight_logs fl ON fl.booking_id = b.id
      WHERE b.status IN ('completed', 'cancelled')`;
    const fp = [];
    let fi = 1;
    // Apply status filter — default to all (completed + cancelled)
    const statusFilter = status || 'all';
    if (statusFilter !== 'all') { fq += ` AND b.status = $${fi++}`; fp.push(statusFilter); }
    if (startDate) { fq += ` AND COALESCE(fl.flight_date, b.start_time::date) >= $${fi++}`; fp.push(startDate); }
    if (endDate) { fq += ` AND COALESCE(fl.flight_date, b.start_time::date) <= $${fi++}`; fp.push(endDate); }
    if (aircraft_id) { fq += ` AND b.aircraft_id = $${fi++}`; fp.push(parseInt(aircraft_id)); }
    if (student_id) { fq += ` AND b.student_id = $${fi++}`; fp.push(parseInt(student_id)); }
    if (instructor_id) { fq += ` AND b.instructor_id = $${fi++}`; fp.push(parseInt(instructor_id)); }
    if (['student', 'renter'].includes(role)) { fq += ` AND b.student_id = $${fi++}`; fp.push(userId); }
    else if (role === 'instructor') { fq += ` AND b.instructor_id = $${fi++}`; fp.push(userId); }
    else if (['owner', 'admin'].includes(role) && historyScope === 'mine') {
      fq += ` AND (b.instructor_id = $${fi++} OR b.student_id = $${fi++})`;
      fp.push(userId, userId);
    }

    // --- Ground sessions ---
    let gq = `
      SELECT gs.id, 'ground'::text AS session_type,
        gs.session_date as flight_date,
        s.name as student_name, i.name as instructor_name,
        NULL::text as tail_number, NULL::text as make_model,
        'completed'::text as status,
        NULL::text as cancellation_reason,
        NULL::text as booking_type,
        NULL::decimal as hobbs_delta, NULL::decimal as tach_delta,
        gs.ground_hours as dual_instruction_hours,
        NULL::decimal as aircraft_charge_amount,
        gs.instruction_charge_amount,
        COALESCE(gs.instruction_charge_amount, 0) as total_charge,
        NULL::decimal as hobbs_start, NULL::decimal as hobbs_end,
        NULL::decimal as tach_start, NULL::decimal as tach_end
      FROM ground_sessions gs
      LEFT JOIN users s ON gs.student_id = s.id
      LEFT JOIN users i ON gs.instructor_id = i.id
      WHERE 1=1`;
    const gp = [];
    let gi = 1;
    if (startDate) { gq += ` AND gs.session_date >= $${gi++}`; gp.push(startDate); }
    if (endDate) { gq += ` AND gs.session_date <= $${gi++}`; gp.push(endDate); }
    if (student_id) { gq += ` AND gs.student_id = $${gi++}`; gp.push(parseInt(student_id)); }
    if (instructor_id) { gq += ` AND gs.instructor_id = $${gi++}`; gp.push(parseInt(instructor_id)); }
    if (['student', 'renter'].includes(role)) { gq += ` AND gs.student_id = $${gi++}`; gp.push(userId); }
    else if (role === 'instructor') { gq += ` AND gs.instructor_id = $${gi++}`; gp.push(userId); }
    else if (['owner', 'admin'].includes(role) && historyScope === 'mine') {
      gq += ` AND (gs.instructor_id = $${gi++} OR gs.student_id = $${gi++})`;
      gp.push(userId, userId);
    }

    const [flightRes, groundRes] = await Promise.all([
      pool.query(fq, fp),
      pool.query(gq, gp)
    ]);

    const rows = [...flightRes.rows, ...groundRes.rows];
    const dir = sort === 'asc' ? 1 : -1;
    rows.sort((a, b) => dir * (new Date(a.flight_date) - new Date(b.flight_date)));

    const totals = {
      count: rows.length,
      hobbs_hours: rows.reduce((sum, r) => sum + parseFloat(r.hobbs_delta || 0), 0),
      tach_hours: rows.reduce((sum, r) => sum + parseFloat(r.tach_delta || 0), 0),
      instruction_hours: rows.reduce((sum, r) => sum + parseFloat(r.dual_instruction_hours || 0), 0),
      revenue: rows.reduce((sum, r) => sum + parseFloat(r.total_charge || 0), 0)
    };

    res.json({ rows, totals });
  } catch (err) {
    console.error('Booking history GET error:', err);
    res.status(500).json({ error: 'Failed to load booking history' });
  }
});

// PATCH /api/booking-history/flights/:id — admin/owner: edit a completed flight booking by booking id
router.patch('/flights/:id', authenticateToken, async (req, res) => {
  try {
    const { role, id: userId } = req.user;
    if (!['owner', 'admin'].includes(role)) {
      return res.status(403).json({ error: 'Only admins and owners can edit booking history records' });
    }
    const bookingId = parseInt(req.params.id, 10);
    if (!Number.isFinite(bookingId)) return res.status(400).json({ error: 'Invalid booking id' });

    const bkResult = await pool.query(
      `SELECT b.*, a.hourly_rate
       FROM bookings b
       JOIN aircraft a ON b.aircraft_id = a.id
       WHERE b.id = $1`,
      [bookingId]
    );
    if (bkResult.rows.length === 0) return res.status(404).json({ error: 'Booking not found' });
    const b = bkResult.rows[0];

    const {
      flight_date,
      hobbs_start,
      hobbs_end,
      tach_start,
      tach_end,
      dual_instruction_hours,
      aircraft_charge_amount,
      instruction_charge_amount,
      lesson_type,
    } = req.body;

    const hStart = hobbs_start != null ? parseFloat(hobbs_start) : (b.hobbs_start != null ? parseFloat(b.hobbs_start) : null);
    const hEnd = hobbs_end != null ? parseFloat(hobbs_end) : (b.hobbs_end != null ? parseFloat(b.hobbs_end) : null);
    if (hStart == null || hEnd == null || Number.isNaN(hStart) || Number.isNaN(hEnd)) {
      return res.status(400).json({ error: 'hobbs_start and hobbs_end are required' });
    }
    if (hEnd <= hStart) return res.status(400).json({ error: 'hobbs_end must be greater than hobbs_start' });

    const tStart = tach_start != null ? parseFloat(tach_start) : (b.tach_start != null ? parseFloat(b.tach_start) : null);
    const tEnd = tach_end != null ? parseFloat(tach_end) : (b.tach_end != null ? parseFloat(b.tach_end) : null);
    if ((tStart != null) !== (tEnd != null)) {
      return res.status(400).json({ error: 'Provide both tach_start and tach_end, or leave both empty' });
    }
    if (tStart != null && tEnd != null && tEnd <= tStart) {
      return res.status(400).json({ error: 'tach_end must be greater than tach_start' });
    }

    const hobbsDelta = parseFloat((hEnd - hStart).toFixed(2));
    const tachDelta = (tStart != null && tEnd != null) ? parseFloat((tEnd - tStart).toFixed(2)) : null;
    const dualHrs = dual_instruction_hours != null ? parseFloat(dual_instruction_hours) : 0;
    const effectiveLessonType = lesson_type !== undefined && lesson_type !== ''
      ? lesson_type
      : b.lesson_type;
    const instrRate = b.instructor_id
      ? (await pool.query('SELECT instructor_rate FROM users WHERE id = $1', [b.instructor_id])).rows[0]?.instructor_rate
      : null;
    const { aircraftChargeAmount: acCharge, instructionChargeAmount: instrCharge } = resolveFlightCharges({
      lessonType: effectiveLessonType,
      hobbsDelta,
      dualHrs,
      hourlyRate: b.hourly_rate,
      instructorRate: instrRate,
      aircraftChargeAmount,
      instructionChargeAmount,
    });
    const dateVal = flight_date
      || (b.start_time ? new Date(b.start_time).toISOString().slice(0, 10) : null)
      || new Date().toISOString().slice(0, 10);

    const client = await pool.connect();
    let inTxn = false;
    try {
      await client.query('BEGIN');
      inTxn = true;

      const startTime = new Date(dateVal + 'T12:00:00Z');
      const endTime = new Date(startTime.getTime() + 60 * 60 * 1000);
      await client.query(
        `UPDATE bookings SET
           start_time = $1, end_time = $2,
           hobbs_start = $3, hobbs_end = $4, tach_start = $5, tach_end = $6,
           lesson_type = CASE WHEN $7::text IS NOT NULL AND $7::text <> '' THEN $7 ELSE lesson_type END,
           updated_at = NOW()
         WHERE id = $8`,
        [startTime.toISOString(), endTime.toISOString(), hStart, hEnd, tStart, tEnd,
         lesson_type !== undefined ? lesson_type : null, bookingId]
      );

      const bkAfter = await client.query('SELECT * FROM bookings WHERE id = $1', [bookingId]);
      const updatedBooking = bkAfter.rows[0];

      const existingLog = await client.query('SELECT id FROM flight_logs WHERE booking_id = $1', [bookingId]);
      if (existingLog.rows.length > 0) {
        await client.query(
          `UPDATE flight_logs SET
            flight_date = $1, hobbs_start = $2, hobbs_end = $3, hobbs_delta = $4,
            tach_start = $5, tach_end = $6, tach_delta = $7,
            dual_instruction_hours = $8, aircraft_charge_amount = $9, instruction_charge_amount = $10,
            student_id = $11, instructor_id = $12, aircraft_id = $13, booking_type = $14,
            updated_at = NOW()
           WHERE booking_id = $15`,
          [dateVal, hStart, hEnd, hobbsDelta, tStart, tEnd, tachDelta, dualHrs, acCharge, instrCharge,
           updatedBooking.student_id, updatedBooking.instructor_id, updatedBooking.aircraft_id,
           updatedBooking.booking_type || 'dual', bookingId]
        );
      } else {
        await client.query(
          `INSERT INTO flight_logs
            (booking_id, aircraft_id, student_id, instructor_id, booking_type,
             flight_date, hobbs_start, hobbs_end, hobbs_delta, tach_start, tach_end, tach_delta,
             dual_instruction_hours, submitted_by, aircraft_charge_amount, instruction_charge_amount)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
          [bookingId, updatedBooking.aircraft_id, updatedBooking.student_id, updatedBooking.instructor_id,
           updatedBooking.booking_type || 'dual',
           dateVal, hStart, hEnd, hobbsDelta, tStart, tEnd, tachDelta, dualHrs, userId, acCharge, instrCharge]
        );
      }

      if (updatedBooking.instructor_id) {
        let studentName = null;
        if (updatedBooking.student_id) {
          const sn = await client.query('SELECT name FROM users WHERE id = $1', [updatedBooking.student_id]);
          studentName = sn.rows[0]?.name || null;
        }
        try {
          await syncInstructorHoursFromFlight(client, {
            booking: updatedBooking,
            hobbsFlown: hobbsDelta,
            dualHrs,
            flightDate: dateVal,
            studentName,
          });
        } catch (syncErr) {
          console.error('[booking-history] instructor hours sync warning:', syncErr.message);
        }
      } else {
        await client.query('DELETE FROM instructor_hours WHERE booking_id = $1', [bookingId]).catch(() => {});
      }

      await client.query('COMMIT');
      inTxn = false;
      res.json({ ok: true, booking_id: bookingId, aircraft_charge_amount: acCharge, instruction_charge_amount: instrCharge });
    } catch (err) {
      if (inTxn) await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('Booking history flight update error:', err);
    res.status(500).json({ error: err.message || 'Failed to update booking record' });
  }
});

// PATCH /api/booking-history/ground-sessions/:id — admin/owner: edit a ground session
router.patch('/ground-sessions/:id', authenticateToken, async (req, res) => {
  try {
    const { role } = req.user;
    if (!['owner', 'admin'].includes(role)) {
      return res.status(403).json({ error: 'Only admins and owners can edit booking history records' });
    }
    const sessionId = parseInt(req.params.id, 10);
    if (!Number.isFinite(sessionId)) return res.status(400).json({ error: 'Invalid session id' });

    const existing = await pool.query('SELECT * FROM ground_sessions WHERE id = $1', [sessionId]);
    if (existing.rows.length === 0) return res.status(404).json({ error: 'Ground session not found' });
    const gs = existing.rows[0];

    const { flight_date, dual_instruction_hours, instruction_charge_amount } = req.body;
    const sessionDate = flight_date || gs.session_date;
    const groundHours = dual_instruction_hours != null ? parseFloat(dual_instruction_hours) : parseFloat(gs.ground_hours);
    if (!groundHours || groundHours <= 0) {
      return res.status(400).json({ error: 'Instruction hours must be greater than 0' });
    }
    const instrCharge = instruction_charge_amount != null
      ? parseFloat(instruction_charge_amount)
      : (gs.instructor_rate != null
        ? Math.round(groundHours * parseFloat(gs.instructor_rate) * 100) / 100
        : gs.instruction_charge_amount);

    await pool.query(
      `UPDATE ground_sessions SET session_date = $1, ground_hours = $2, instruction_charge_amount = $3 WHERE id = $4`,
      [sessionDate, groundHours, instrCharge, sessionId]
    );
    res.json({ ok: true, ground_session_id: sessionId });
  } catch (err) {
    console.error('Booking history ground session update error:', err);
    res.status(500).json({ error: 'Failed to update ground session record' });
  }
});

// DELETE /api/booking-history/flights/:id — permanently delete a booking record (any status)
router.delete('/flights/:id', authenticateToken, async (req, res) => {
  try {
    const { role } = req.user;
    if (!['owner', 'admin'].includes(role)) return res.status(403).json({ error: 'Only admins and owners can delete booking history records' });
    const bookingId = parseInt(req.params.id);
    const existing = await pool.query('SELECT id, status FROM bookings WHERE id = $1', [bookingId]);
    if (existing.rows.length === 0) return res.status(404).json({ error: 'Booking not found' });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      // Clean up all related records before deleting the booking.
      // flight_hobbs_readings & flight_discrepancies have ON DELETE CASCADE,
      // but admin_audit_log.booking_id has no cascade — NULL it to preserve the audit trail.
      await client.query('DELETE FROM flight_logs WHERE booking_id = $1', [bookingId]);
      await client.query('DELETE FROM aircraft_hours_history WHERE booking_id = $1', [bookingId]);
      // Null out FK refs in audit/training tables (default RESTRICT would block delete)
      await client.query('UPDATE admin_audit_log SET booking_id = NULL WHERE booking_id = $1', [bookingId]);
      await client.query('UPDATE training_progress SET booking_id = NULL WHERE booking_id = $1', [bookingId]);
      await client.query('DELETE FROM bookings WHERE id = $1', [bookingId]);
      await client.query('COMMIT');
      res.json({ ok: true });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('Booking history delete error:', err);
    res.status(500).json({ error: 'Failed to delete booking history record' });
  }
});

// DELETE /api/booking-history/ground-sessions/:id — delete a ground session (admin/owner only)
router.delete('/ground-sessions/:id', authenticateToken, async (req, res) => {
  try {
    const { role } = req.user;
    if (!['owner', 'admin'].includes(role)) return res.status(403).json({ error: 'Only admins and owners can delete ground session records' });
    const sessionId = parseInt(req.params.id);
    const existing = await pool.query('SELECT id FROM ground_sessions WHERE id = $1', [sessionId]);
    if (existing.rows.length === 0) return res.status(404).json({ error: 'Ground session not found' });
    await pool.query('DELETE FROM ground_sessions WHERE id = $1', [sessionId]);
    res.json({ ok: true });
  } catch (err) {
    console.error('Ground session history delete error:', err);
    res.status(500).json({ error: 'Failed to delete ground session record' });
  }
});

// POST /api/booking-history/manual — manually create a completed booking or ground session
router.post('/manual', authenticateToken, async (req, res) => {
  try {
    const { role, id: userId } = req.user;
    if (!['owner', 'admin'].includes(role)) return res.status(403).json({ error: 'Only admins and owners can add manual history entries' });
    const { session_type, flight_date, student_id, instructor_id, aircraft_id, hobbs_start, hobbs_end, tach_start, tach_end, dual_instruction_hours, ground_hours, lesson_type, notes } = req.body;
    if (!session_type || !flight_date || !student_id) return res.status(400).json({ error: 'session_type, flight_date, and student_id are required' });
    if (!['flight', 'ground'].includes(session_type)) return res.status(400).json({ error: 'session_type must be "flight" or "ground"' });
    const sid = parseInt(student_id);
    const iid = instructor_id ? parseInt(instructor_id) : null;
    const acId = aircraft_id ? parseInt(aircraft_id) : null;
    const startTime = new Date(flight_date + 'T12:00:00Z');
    if (session_type === 'flight') {
      if (!acId || hobbs_start == null || hobbs_end == null) return res.status(400).json({ error: 'Aircraft, hobbs_start, and hobbs_end are required for flight sessions' });
      const hStart = parseFloat(hobbs_start);
      const hEnd = parseFloat(hobbs_end);
      if (hEnd <= hStart) return res.status(400).json({ error: 'hobbs_end must be greater than hobbs_start' });
      const tStart = tach_start != null ? parseFloat(tach_start) : null;
      const tEnd = tach_end != null ? parseFloat(tach_end) : null;
      const tS = tStart != null ? tStart : null;
      const tE = tEnd != null ? tEnd : null;
      const hDelta = hEnd - hStart;
      const tDelta = (tS != null && tE != null) ? (tE - tS) : null;
      const dualHrs = dual_instruction_hours != null ? parseFloat(dual_instruction_hours) : 0;
      const endTime = new Date(startTime.getTime() + 60 * 60 * 1000);
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const bkResult = await client.query(
          `INSERT INTO bookings (student_id, instructor_id, aircraft_id, start_time, end_time, status, lesson_type, notes, created_by, booking_type, hobbs_start, hobbs_end)
           VALUES ($1, $2, $3, $4, $5, 'completed', $6, $7, $8, $9, $10, $11) RETURNING id`,
          [sid, iid, acId, startTime.toISOString(), endTime.toISOString(), lesson_type || null, notes || null, userId, iid ? 'dual' : 'student_solo', hStart, hEnd]
        );
        const bkId = bkResult.rows[0].id;
        await client.query(
          `INSERT INTO flight_logs (booking_id, flight_date, hobbs_start, hobbs_end, hobbs_delta, tach_start, tach_end, tach_delta, dual_instruction_hours, notes)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [bkId, flight_date, hStart, hEnd, hDelta, tS, tE, tDelta, dualHrs, notes || null]
        );
        if (acId) {
          await applyAircraftMeterReadings(client, acId, {
            hobbsEnd: hEnd,
            tachEnd: tE,
            bookingId: bkId,
            source: 'manual_entry',
          });
        }
        await client.query(`UPDATE users SET total_hobbs_hours = total_hobbs_hours + $1, total_tach_hours = total_tach_hours + $2 WHERE id = $3`, [hDelta, tDelta || 0, sid]);
        await client.query('COMMIT');
        res.json({ booking_id: bkId });
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    } else {
      if (!iid) return res.status(400).json({ error: 'instructor_id is required for ground sessions' });
      if (!ground_hours || parseFloat(ground_hours) <= 0) return res.status(400).json({ error: 'ground_hours must be > 0' });
      const hrs = parseFloat(ground_hours);
      const instrRate = (await pool.query('SELECT instructor_rate FROM users WHERE id = $1', [iid])).rows[0]?.instructor_rate;
      const chargeAmount = instrRate != null ? Math.round(hrs * parseFloat(instrRate) * 100) / 100 : 0;
      const gsResult = await pool.query(
        `INSERT INTO ground_sessions (student_id, instructor_id, session_date, ground_hours, instructor_rate, instruction_charge_amount, notes) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
        [sid, iid, flight_date, hrs, instrRate != null ? parseFloat(instrRate) : null, chargeAmount, notes || null]
      );
      res.json({ ground_session_id: gsResult.rows[0].id });
    }
  } catch (err) {
    console.error('Manual history entry error:', err);
    res.status(500).json({ error: 'Failed to create manual history entry' });
  }
});

module.exports = router;