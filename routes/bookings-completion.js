'use strict';

// routes/bookings-completion.js — Flight completion + end-early.
// Owns: PATCH /:id/complete, PATCH /:id/end-early, GET /:id (single booking).
// Does NOT own: booking creation, listing, cancellation — those stay in bookings-routes.js.

const express = require('express');
const pool = require('../db/index');
const { authenticateToken } = require('../middleware/auth');
const { recordHobbsReading } = require('../db/discrepancies');
const { flightCompletedEmail } = require('../email-templates');
const { sendEmailToUser, EMAIL_TYPES } = require('../lib/notification-prefs');
const { syncInstructorHoursFromFlight } = require('../lib/sync-instructor-hours');
const { computeFlightCharges } = require('../lib/flight-charges');
const { syncFlightRecord } = require('../lib/sync-flight-record');
const { getMeterHobbs, getMeterTach, applyAircraftMeterReadings } = require('../lib/aircraft-meter');

const router = express.Router();
const MAX_COMPLETION_FLIGHT_HOURS = 12;

function canAccessBooking(user, booking) {
  if (!user || !booking) return false;
  if (['owner', 'admin'].includes(user.role)) return true;
  if (user.id === booking.student_id || user.id === booking.instructor_id) return true;
  return false;
}

// ── Hobbs submission rate limiter: >5 failed attempts in 10 min → block 15 min ──
const hobbsFailMap = new Map();
const HOBBS_FAIL_WINDOW = 10 * 60 * 1000; // 10 minutes
const HOBBS_FAIL_MAX = 5;
const HOBBS_BLOCK_DURATION = 15 * 60 * 1000; // 15 minutes

function checkHobbsRateLimit(userId) {
  const key = String(userId);
  const now = Date.now();
  const entry = hobbsFailMap.get(key);
  if (entry && entry.blockedUntil && now < entry.blockedUntil) {
    return { blocked: true, retryAfter: Math.ceil((entry.blockedUntil - now) / 1000) };
  }
  return { blocked: false };
}

function recordHobbsFail(userId) {
  const key = String(userId);
  const now = Date.now();
  let entry = hobbsFailMap.get(key) || { attempts: [], blockedUntil: null };
  entry.attempts = entry.attempts.filter(t => now - t < HOBBS_FAIL_WINDOW);
  entry.attempts.push(now);
  if (entry.attempts.length > HOBBS_FAIL_MAX) {
    entry.blockedUntil = now + HOBBS_BLOCK_DURATION;
    console.warn(`[security] Hobbs rate limit triggered for user ${userId}`);
  }
  hobbsFailMap.set(key, entry);
}

// Prune stale entries every 30 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of hobbsFailMap.entries()) {
    const fresh = entry.attempts.filter(t => now - t < HOBBS_FAIL_WINDOW);
    if (fresh.length === 0 && (!entry.blockedUntil || now >= entry.blockedUntil)) {
      hobbsFailMap.delete(key);
    } else {
      entry.attempts = fresh;
    }
  }
}, 30 * 60 * 1000);

// Numeric validation helper — rejects NaN, negative, and impossibly large values
function validateHobbsValue(val, fieldName) {
  const num = parseFloat(val);
  if (isNaN(num)) return `${fieldName} must be a valid number`;
  if (num < 0) return `${fieldName} cannot be negative`;
  if (num > 99999) return `${fieldName} exceeds maximum allowed value`;
  return null;
}

/** When a flight finishes before its scheduled end, shrink end_time so the slot can be rebooked. */
function completionEndTime(booking) {
  const now = new Date();
  const scheduledEnd = new Date(booking.end_time);
  const start = new Date(booking.start_time);
  const effective = scheduledEnd > now ? now : scheduledEnd;
  if (effective <= start) return start.toISOString();
  return effective.toISOString();
}

router.patch('/:id/end-early', authenticateToken, async (req, res) => {
  const client = await pool.connect();
  try {
    const { actual_end_time } = req.body;
    if (!actual_end_time) return res.status(400).json({ error: 'actual_end_time is required' });
    const endTime = new Date(actual_end_time);
    if (isNaN(endTime.getTime())) return res.status(400).json({ error: 'actual_end_time must be a valid date' });
    await client.query('BEGIN');
    const result = await client.query('SELECT * FROM bookings WHERE id = $1 FOR UPDATE', [req.params.id]);
    if (result.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Booking not found' });
    }
    const b = result.rows[0];
    const isAdmin = ['owner', 'admin'].includes(req.user.role);
    if (!isAdmin && req.user.id !== b.instructor_id && req.user.id !== b.student_id) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'Access denied' });
    }
    if (b.status !== 'confirmed') {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Only confirmed bookings can be ended early' });
    }
    const originalEnd = new Date(b.end_time);
    const start = new Date(b.start_time);
    if (endTime <= start) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'actual_end_time must be after the booking start time' });
    }
    if (endTime >= originalEnd) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'actual_end_time must be before the scheduled end time' });
    }
    const newEndIso = endTime.toISOString();
    const updated = await client.query(
      `UPDATE bookings SET end_time = $1, updated_at = NOW()
       WHERE id = $2 AND status = 'confirmed'
       RETURNING *`,
      [newEndIso, req.params.id]
    );
    if (updated.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Booking was changed by another request' });
    }
    await client.query('COMMIT');
    res.json({ ok: true, new_end_time: newEndIso, booking: updated.rows[0] });
  } catch (err) {
    await client.query('ROLLBACK');
    const ts = new Date().toISOString();
    console.error(`[bookings-completion] [${ts}] PATCH /:id/end-early — user=${req.user?.id} error: ${err.message}`);
    res.status(500).json({ code: 'END_EARLY_ERROR', message: 'Booking temporarily unavailable, please try again.' });
  } finally {
    client.release();
  }
});

router.patch('/:id/hours', authenticateToken, async (req, res) => {
  const client = await pool.connect();
  try {
    const bookingId = parseInt(req.params.id, 10);
    const existing = await client.query('SELECT id, status, instructor_id FROM bookings WHERE id = $1', [bookingId]);
    if (existing.rows.length === 0) return res.status(404).json({ error: 'Booking not found' });
    const bookingRow = existing.rows[0];
    const isAdmin = ['owner', 'admin'].includes(req.user.role);
    const isAssignedInstructor = req.user.role === 'instructor' && bookingRow.instructor_id === req.user.id;
    if (!isAdmin && !isAssignedInstructor) {
      return res.status(403).json({ error: 'Only owners, admins, or the assigned instructor can edit completed booking hours' });
    }
    if (bookingRow.status !== 'completed') {
      return res.status(400).json({ error: 'Only completed bookings support direct hour edits' });
    }

    const { hobbs_start, hobbs_end, tach_start, tach_end, dual_instruction_hours, lesson_type, flight_date } = req.body;
    if (hobbs_start != null && hobbs_end != null && parseFloat(hobbs_end) <= parseFloat(hobbs_start)) {
      return res.status(400).json({ error: 'hobbs_end must be greater than hobbs_start' });
    }

    await client.query('BEGIN');
    const synced = await syncFlightRecord(client, bookingId, {
      hobbs_start,
      hobbs_end,
      tach_start,
      tach_end,
      dual_instruction_hours,
      lesson_type,
      flight_date,
      submitted_by: req.user.id,
    });
    await client.query('COMMIT');
    res.json({ ok: true, booking: synced.booking, flight_log: synced.flightLog });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[bookings-completion] PATCH /:id/hours error:', err.message);
    res.status(500).json({ error: err.message || 'Failed to update booking hours' });
  } finally {
    client.release();
  }
});

router.patch('/:id/complete', authenticateToken, async (req, res) => {
  const client = await pool.connect();
  try {
    const { hobbs_start, hobbs_end, tach_start, tach_end, dual_instruction_hours, notes, no_change,
            is_night, is_xc, is_instrument, is_solo } = req.body;

    // Re-verify user role from DB — don't trust JWT alone for critical operations
    const dbUser = await client.query('SELECT id, role FROM users WHERE id = $1 AND deleted_at IS NULL', [req.user.id]);
    if (dbUser.rows.length === 0) return res.status(401).json({ error: 'User account not found' });
    const verifiedRole = dbUser.rows[0].role;

    await client.query('BEGIN');
    const rollbackAndRespond = async (status, payload) => {
      await client.query('ROLLBACK').catch(() => {});
      return res.status(status).json(payload);
    };

    const bResult = await client.query('SELECT * FROM bookings WHERE id = $1 FOR UPDATE', [req.params.id]);
    if (bResult.rows.length === 0) return rollbackAndRespond(404, { error: 'Booking not found' });
    const b = bResult.rows[0];
    if (b.status !== 'confirmed') return rollbackAndRespond(400, { error: 'Only confirmed bookings can be completed' });
    const isAdmin = ['owner', 'admin'].includes(verifiedRole);
    if (!isAdmin) {
      if (b.instructor_id) {
        if (req.user.id !== b.instructor_id) {
          return rollbackAndRespond(403, {
            error: 'Only the assigned instructor (or admin) can complete this flight and enter Hobbs/Tach hours.',
          });
        }
      } else if (req.user.id !== b.student_id && req.user.id !== b.instructor_id) {
        return rollbackAndRespond(403, { error: 'Access denied' });
      }
    }

    // "No change" bypass — mark complete without recording hours or updating totals
    if (no_change) {
      const finishedEnd = completionEndTime(b);
      const noChangeUpdate = await client.query(
        `UPDATE bookings SET status = 'completed', end_time = $1, updated_at = NOW()
         WHERE id = $2 AND status = 'confirmed'
         RETURNING *`,
        [finishedEnd, req.params.id]
      );
      if (noChangeUpdate.rows.length === 0) return rollbackAndRespond(409, { error: 'Booking was changed by another request' });
      await client.query('COMMIT');
      res.json({ booking: noChangeUpdate.rows[0], log_id: null });

      // Send flight completed email (no_change — no hobbs/tach data)
      sendFlightCompletedEmail(req.params.id, req.user.id, req.user.role, null, null, null);
      return;
    }

    // ── Hobbs rate limit check — block after repeated bad submissions ──
    const rlCheck = checkHobbsRateLimit(req.user.id);
    if (rlCheck.blocked) {
      return rollbackAndRespond(429, { error: `Too many failed Hobbs submissions. Try again in ${rlCheck.retryAfter} seconds.` });
    }

    // Normal path — validate hobbs before starting transaction
    if (hobbs_start == null || hobbs_end == null) return rollbackAndRespond(400, { error: 'hobbs_start and hobbs_end are required' });

    // ── Input sanitization: reject NaN, negative, impossibly large values ──
    const hStartErr = validateHobbsValue(hobbs_start, 'hobbs_start');
    if (hStartErr) { recordHobbsFail(req.user.id); return rollbackAndRespond(400, { error: hStartErr }); }
    const hEndErr = validateHobbsValue(hobbs_end, 'hobbs_end');
    if (hEndErr) { recordHobbsFail(req.user.id); return rollbackAndRespond(400, { error: hEndErr }); }

    const hStart = parseFloat(hobbs_start);
    const hEnd = parseFloat(hobbs_end);
    if (hEnd <= hStart) { recordHobbsFail(req.user.id); return rollbackAndRespond(400, { error: 'hobbs_end must be greater than hobbs_start' }); }

    // Validate tach values if provided — both or neither
    if ((tach_start != null) !== (tach_end != null)) {
      return rollbackAndRespond(400, { error: 'Both tach_start and tach_end are required when logging tach time' });
    }
    if (tach_start != null) {
      const tStartErr = validateHobbsValue(tach_start, 'tach_start');
      if (tStartErr) return rollbackAndRespond(400, { error: tStartErr });
      const tEndErr = validateHobbsValue(tach_end, 'tach_end');
      if (tEndErr) return rollbackAndRespond(400, { error: tEndErr });
    }
    if (tach_start != null && tach_end != null && parseFloat(tach_end) <= parseFloat(tach_start)) {
      return rollbackAndRespond(400, { error: 'tach_end must be greater than tach_start' });
    }

    const tStart = tach_start != null ? parseFloat(tach_start) : null;
    const tEnd = tach_end != null ? parseFloat(tach_end) : null;

    // ── Server-side meter validation: start cannot be before aircraft current reading ──
    if (b.aircraft_id) {
      const acResult = await client.query(
        'SELECT current_hobbs, current_tach, total_hobbs_hours, total_tach_hours FROM aircraft WHERE id = $1',
        [b.aircraft_id]
      );
      if (acResult.rows.length > 0) {
        const acRow = acResult.rows[0];
        const currentHobbs = getMeterHobbs(acRow);
        if (currentHobbs != null && currentHobbs > 0) {
          if (hStart < currentHobbs - 0.1) {
            recordHobbsFail(req.user.id);
            return rollbackAndRespond(400, {
              error: `Hobbs start (${hStart.toFixed(1)}) cannot be before aircraft current reading (${currentHobbs.toFixed(1)})`,
            });
          }
          if (hStart > currentHobbs + 5) {
            recordHobbsFail(req.user.id);
            return rollbackAndRespond(400, {
              error: `Hobbs start (${hStart.toFixed(1)}) is unusually high vs aircraft reading (${currentHobbs.toFixed(1)}). Verify the meter.`,
            });
          }
        }
        const currentTach = getMeterTach(acRow);
        if (tStart != null && currentTach != null && currentTach > 0) {
          if (tStart < currentTach - 0.1) {
            return rollbackAndRespond(400, {
              error: `Tach start (${tStart.toFixed(1)}) cannot be before aircraft current reading (${currentTach.toFixed(1)})`,
            });
          }
          if (tStart > currentTach + 5) {
            return rollbackAndRespond(400, {
              error: `Tach start (${tStart.toFixed(1)}) is unusually high vs aircraft reading (${currentTach.toFixed(1)}). Verify the meter.`,
            });
          }
        }
      }
    }

    const hobbsFlown = hEnd - hStart;
    if (hobbsFlown > MAX_COMPLETION_FLIGHT_HOURS) {
      recordHobbsFail(req.user.id);
      return rollbackAndRespond(400, { error: `Hobbs time cannot exceed ${MAX_COMPLETION_FLIGHT_HOURS} hours for one completion` });
    }

    // Dual instruction hours may exceed Hobbs (preflight, ground, debrief billed separately)
    if (dual_instruction_hours != null) {
      const dualErr = validateHobbsValue(dual_instruction_hours, 'dual_instruction_hours');
      if (dualErr) return rollbackAndRespond(400, { error: dualErr });
    }
    const tachFlown = (tStart != null && tEnd != null) ? (tEnd - tStart) : null;
    const dualHrs = (dual_instruction_hours != null) ? parseFloat(dual_instruction_hours) : 0;
    const flight_date = new Date(b.start_time).toISOString().slice(0, 10);
    // Flight type flags from post-flight wizard
    const nightFlag = !!is_night;
    const xcFlag = !!is_xc;
    const instrumentFlag = !!is_instrument;
    const soloFlag = !!is_solo || b.booking_type === 'student_solo';
    // Look up rates for billing calculation
    const acRate = b.aircraft_id
      ? (await client.query('SELECT hourly_rate FROM aircraft WHERE id = $1', [b.aircraft_id])).rows[0]
      : null;
    const instrRate = b.instructor_id
      ? (await client.query('SELECT instructor_rate FROM users WHERE id = $1', [b.instructor_id])).rows[0]
      : null;
    const { aircraftChargeAmount: aircraftChargeAmt, instructionChargeAmount: instrChargeAmt } = computeFlightCharges({
      lessonType: b.lesson_type,
      hobbsDelta: hobbsFlown,
      dualHrs,
      hourlyRate: acRate?.hourly_rate,
      instructorRate: instrRate?.instructor_rate,
    });
    // Upsert flight_log — aircraft_id, student_id, instructor_id, booking_type are required
    const existingLog = await client.query('SELECT id FROM flight_logs WHERE booking_id = $1', [req.params.id]);
    let logId;
    if (existingLog.rows.length > 0) {
      await client.query(
        `UPDATE flight_logs SET
          flight_date = $1, hobbs_start = $2, hobbs_end = $3, hobbs_delta = $4,
          tach_start = $5, tach_end = $6, tach_delta = $7,
          dual_instruction_hours = $8, notes = $9,
          is_night = $10, is_xc = $11, is_instrument = $12, is_solo = $13,
          aircraft_charge_amount = $14, instruction_charge_amount = $15,
          updated_at = NOW()
         WHERE booking_id = $16`,
        [flight_date, hStart, hEnd, hobbsFlown, tStart, tEnd, tachFlown, dualHrs, notes || null,
         nightFlag, xcFlag, instrumentFlag, soloFlag, aircraftChargeAmt, instrChargeAmt, req.params.id]
      );
      logId = existingLog.rows[0].id;
    } else {
      const logResult = await client.query(
        `INSERT INTO flight_logs
           (booking_id, aircraft_id, student_id, instructor_id, booking_type,
            flight_date, hobbs_start, hobbs_end, hobbs_delta, tach_start, tach_end, tach_delta,
            dual_instruction_hours, notes, submitted_by,
            is_night, is_xc, is_instrument, is_solo,
            aircraft_charge_amount, instruction_charge_amount)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
         RETURNING id`,
        [req.params.id, b.aircraft_id, b.student_id, b.instructor_id, b.booking_type || 'dual',
         flight_date, hStart, hEnd, hobbsFlown, tStart, tEnd, tachFlown,
         dualHrs, notes || null, req.user.id,
         nightFlag, xcFlag, instrumentFlag, soloFlag,
         aircraftChargeAmt, instrChargeAmt]
      );
      logId = logResult.rows[0].id;
    }
    // Aircraft meter readings — end values entered by pilot (all aircraft use same logic)
    if (b.aircraft_id) {
      await applyAircraftMeterReadings(client, b.aircraft_id, {
        hobbsEnd: hEnd,
        tachEnd: tEnd,
        bookingId: parseInt(req.params.id, 10),
        source: 'flight_complete',
      });
    }
    // Update student cumulative hours
    if (b.student_id) {
      const userHobbs = await client.query('SELECT total_hobbs_hours, total_tach_hours FROM users WHERE id = $1', [b.student_id]);
      if (userHobbs.rows.length > 0) {
        await client.query(
          `UPDATE users SET total_hobbs_hours = total_hobbs_hours + $1, total_tach_hours = total_tach_hours + $2 WHERE id = $3`,
          [hobbsFlown, tachFlown || 0, b.student_id]
        );
      }
    }
    // Update instructor cumulative hours
    if (b.instructor_id) {
      const instrHobbs = await client.query('SELECT total_hobbs_hours, total_tach_hours FROM users WHERE id = $1', [b.instructor_id]);
      if (instrHobbs.rows.length > 0) {
        await client.query(
          `UPDATE users SET total_hobbs_hours = total_hobbs_hours + $1, total_tach_hours = total_tach_hours + $2 WHERE id = $3`,
          [hobbsFlown, tachFlown || 0, b.instructor_id]
        );
      }
    }
    const finishedEnd = completionEndTime(b);
    // Update booking — persist hobbs/tach on booking row for billing queries
    const completionUpdate = await client.query(
      `UPDATE bookings SET status = 'completed', hobbs_start = $1, hobbs_end = $2,
       tach_start = $3, tach_end = $4, end_time = $5, updated_at = NOW()
       WHERE id = $6 AND status = 'confirmed'
       RETURNING *`,
      [hStart, hEnd, tStart, tEnd, finishedEnd, req.params.id]
    );
    if (completionUpdate.rows.length === 0) {
      return rollbackAndRespond(409, { error: 'Booking was changed by another request' });
    }

    // Auto-sync instructor hours log from completed flight
    if (b.instructor_id && (hobbsFlown > 0 || dualHrs > 0)) {
      let studentName = null;
      if (b.student_id) {
        const sn = await client.query('SELECT name FROM users WHERE id = $1', [b.student_id]);
        studentName = sn.rows[0]?.name || null;
      }
      await syncInstructorHoursFromFlight(client, {
        booking: b,
        hobbsFlown,
        dualHrs,
        flightDate: flight_date,
        studentName,
      });
    }

    await client.query('COMMIT');

    // Record Hobbs reading for discrepancy tracking (fire-and-forget — does not affect booking completion)
    const submitterRole = ['owner', 'admin'].includes(req.user.role) ? 'admin' : req.user.role;
    // Map completion to student/instructor side for Hobbs comparison
    let hobbsRole;
    if (req.user.id === b.student_id) hobbsRole = 'student';
    else if (req.user.id === b.instructor_id) hobbsRole = 'instructor';
    else if (b.instructor_id && ['owner', 'admin'].includes(req.user.role)) hobbsRole = 'instructor';
    else hobbsRole = submitterRole;
    recordHobbsReading(parseInt(req.params.id), req.user.id, hobbsRole, hStart, hEnd)
      .catch(e => console.error('[bookings-completion] hobbs reading error:', e.message));

    res.json({ booking: completionUpdate.rows[0], log_id: logId });

    // Send flight completed email to student + instructor (fire-and-forget)
    sendFlightCompletedEmail(req.params.id, req.user.id, req.user.role, hobbsFlown, tachFlown, dualHrs);
  } catch (err) {
    await client.query('ROLLBACK');
    const ts = new Date().toISOString();
    console.error(`[bookings-completion] [${ts}] PATCH /:id/complete — user=${req.user?.id} error: ${err.message}`);
    res.status(500).json({ code: 'COMPLETE_ERROR', error: 'Failed to save flight data — please try again.', message: 'Booking temporarily unavailable, please try again.' });
  } finally {
    client.release();
  }
});

/**
 * Send flight completed notification emails to student and instructor.
 * Called as fire-and-forget after the booking is marked complete.
 */
async function sendFlightCompletedEmail(bookingId, completedById, completedByRole, hobbsFlown, tachFlown, dualHrs) {
  try {
    const result = await pool.query(`
      SELECT b.*, s.name as student_name, s.email as student_email,
             i.name as instructor_name, i.email as instructor_email,
             a.tail_number, a.make_model
      FROM bookings b
      LEFT JOIN users s ON b.student_id = s.id
      LEFT JOIN users i ON b.instructor_id = i.id
      JOIN aircraft a ON b.aircraft_id = a.id
      WHERE b.id = $1
    `, [bookingId]);
    if (result.rows.length === 0) return;
    const b = result.rows[0];
    if (!b.student_email) return;

    const completedByName = await pool.query('SELECT name FROM users WHERE id = $1', [completedById])
      .then(r => r.rows[0]?.name || 'Unknown')
      .catch(() => 'Unknown');

    // Send to student
    const studentEmail = flightCompletedEmail({
      recipientName: b.student_name || 'Student',
      studentName: b.student_name,
      instructorName: b.instructor_name,
      tailNumber: b.tail_number,
      makeModel: b.make_model,
      flightDate: b.start_time,
      startTime: b.start_time,
      endTime: b.end_time,
      hobbsHours: hobbsFlown != null ? hobbsFlown : null,
      tachHours: tachFlown != null ? tachFlown : null,
      completedBy: completedByName,
      completedByRole: completedByRole,
      dualInstructionHours: dualHrs,
    });
    sendEmailToUser(
      b.student_id, b.student_email, EMAIL_TYPES.flight_completed,
      studentEmail.subject, studentEmail.html, studentEmail.text
    )
      .catch(e => console.error('[bookings-completion] student completion email error:', e.message));

    // Send to instructor if assigned
    if (b.instructor_id && b.instructor_email) {
      const instructorEmail = flightCompletedEmail({
        recipientName: b.instructor_name || 'Instructor',
        studentName: b.student_name,
        instructorName: b.instructor_name,
        tailNumber: b.tail_number,
        makeModel: b.make_model,
        flightDate: b.start_time,
        startTime: b.start_time,
        endTime: b.end_time,
        hobbsHours: hobbsFlown != null ? hobbsFlown : null,
        tachHours: tachFlown != null ? tachFlown : null,
        completedBy: completedByName,
        completedByRole: completedByRole,
        dualInstructionHours: dualHrs,
      });
      sendEmailToUser(
        b.instructor_id, b.instructor_email, EMAIL_TYPES.flight_completed,
        instructorEmail.subject, instructorEmail.html, instructorEmail.text
      )
        .catch(e => console.error('[bookings-completion] instructor completion email error:', e.message));
    }
  } catch (err) {
    console.error('[bookings-completion] sendFlightCompletedEmail error:', err.message);
  }
}

router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT b.*, s.name as student_name, i.name as instructor_name,
             a.tail_number, a.make_model, fl.hobbs_start as log_hobbs_start, fl.hobbs_end as log_hobbs_end
      FROM bookings b
      LEFT JOIN users s ON b.student_id = s.id
      LEFT JOIN users i ON b.instructor_id = i.id
      JOIN aircraft a ON b.aircraft_id = a.id
      LEFT JOIN flight_logs fl ON fl.booking_id = b.id
      WHERE b.id = $1
    `, [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Booking not found' });
    if (!canAccessBooking(req.user, result.rows[0])) return res.status(403).json({ error: 'Access denied' });
    res.json(result.rows[0]);
  } catch (err) {
    const ts = new Date().toISOString();
    console.error(`[bookings-completion] [${ts}] GET /:id — user=${req.user?.id} error: ${err.message}`);
    res.status(500).json({ code: 'FETCH_ERROR', message: 'Booking temporarily unavailable, please try again.' });
  }
});

module.exports = router;