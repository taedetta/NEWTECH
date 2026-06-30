'use strict';

// routes/bookings-routes.js — Booking CRUD, conflict detection, availability checks.
// Owns: GET /, GET /history, POST /, PUT /:id, DELETE /:id, GET /check-availability.
// Does NOT own: flight completion, Hobbs recording — those stay in bookings-completion.js.

const express = require('express');
const pool = require('../db/index');
const { authenticateToken } = require('../middleware/auth');
const { sendBookingConfirmationEmails, sendBookingCancellationEmails } = require('../lib/booking-notifications');
const {
  getPolicySettings,
  validateBookingTimes,
  validateCancellation,
  checkGroundingSquawk,
  runPreflightChecks,
  isDiscoveryLessonType,
} = require('../lib/booking-rules');
const { BOOKABLE_INSTRUCTOR_WHERE, timeToComparable } = require('../lib/instructors');
const { isInstructorAvailable, getInstructorDayAvailability } = require('../lib/instructor-availability');
const {
  calendarDateFromDate,
  addCalendarDays,
  dayOfWeekFromCalendarDate,
  wallClockToUtc,
  timeHmFromDate,
} = require('../lib/school-timezone');
const { downtimeOverlapsBooking } = require('../lib/downtime-overlap');
const { syncCompletedBookingSideEffects } = require('../lib/sync-completed-booking');
const { overlapWhere } = require('../lib/booking-overlap');

const router = express.Router();

const MAX_BOOKING_DURATION_HOURS = 168; // allow multi-day / overnight rentals (up to 7 days)

// Any non-cancelled, non-completed booking blocks the schedule (matches calendar visibility).
const ACTIVE_BOOKING_SQL = "b.status NOT IN ('cancelled', 'completed')";
const ACTIVE_BOOKING_SQL_NO_ALIAS = "status NOT IN ('cancelled', 'completed')";

/** Serialize concurrent bookings for the same aircraft/instructor/student. */
async function lockBookingResources(client, { aircraft_id, instructor_id, student_id }) {
  const acId = aircraft_id != null ? parseInt(aircraft_id, 10) : null;
  const iid = instructor_id != null ? parseInt(instructor_id, 10) : null;
  const sid = student_id != null ? parseInt(student_id, 10) : null;
  if (Number.isFinite(acId)) await client.query('SELECT pg_advisory_xact_lock($1, $2)', [1, acId]);
  if (Number.isFinite(iid)) await client.query('SELECT pg_advisory_xact_lock($1, $2)', [2, iid]);
  if (Number.isFinite(sid)) await client.query('SELECT pg_advisory_xact_lock($1, $2)', [3, sid]);
}

async function findOverlappingDowntime(client, aircraftId, bookingStart, bookingEnd) {
  const db = client || pool;
  const startDate = new Date(bookingStart).toISOString().slice(0, 10);
  const endDate = new Date(bookingEnd).toISOString().slice(0, 10);
  const result = await db.query(
    `SELECT id, reason, start_date, end_date, start_time, end_time, all_day
     FROM aircraft_downtime
     WHERE aircraft_id = $1 AND start_date <= $3::date AND end_date >= $2::date`,
    [aircraftId, startDate, endDate]
  );
  return result.rows.find((row) => downtimeOverlapsBooking(row, bookingStart, bookingEnd)) || null;
}

function normBookingUserId(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = parseInt(v, 10);
  return Number.isNaN(n) ? null : n;
}

/** Who may view/update/cancel a booking (staff or assigned participant). */
function canAccessBooking(user, booking) {
  if (['owner', 'admin', 'maintenance'].includes(user.role)) return true;
  return user.id === booking.instructor_id || user.id === booking.student_id;
}

async function deriveBookingType(client, studentId, instructorId) {
  if (studentId && instructorId) return 'dual';
  if (studentId && !instructorId) {
    const roleRes = await client.query('SELECT role FROM users WHERE id = $1', [studentId]);
    return roleRes.rows[0]?.role === 'renter' ? 'renter_solo' : 'student_solo';
  }
  if (!studentId && instructorId) return 'instructor_solo';
  return 'dual';
}

router.get('/', authenticateToken, async (req, res) => {
  try {
    const { start, end, instructor_id, student_id, aircraft_id } = req.query;
    let query = `
      SELECT b.*,
        s.name as student_name, s.email as student_email,
        i.name as instructor_name, i.email as instructor_email,
        a.tail_number, a.make_model
      FROM bookings b
      LEFT JOIN users s ON b.student_id = s.id
      LEFT JOIN users i ON b.instructor_id = i.id
      JOIN aircraft a ON b.aircraft_id = a.id
      WHERE b.status NOT IN ('cancelled', 'completed')
    `;
    const params = [];
    let paramIdx = 1;
    if (start && end) {
      query += ` AND ${overlapWhere('b', '$' + paramIdx, '$' + (paramIdx + 1))}`;
      params.push(start, end);
      paramIdx += 2;
    } else if (start) {
      query += ` AND b.end_time > $${paramIdx++}`;
      params.push(start);
    } else if (end) {
      query += ` AND b.start_time < $${paramIdx++}`;
      params.push(end);
    }
    if (instructor_id) { query += ` AND b.instructor_id = $${paramIdx++}`; params.push(instructor_id); }
    if (student_id) { query += ` AND b.student_id = $${paramIdx++}`; params.push(student_id); }
    if (aircraft_id) { query += ` AND b.aircraft_id = $${paramIdx++}`; params.push(aircraft_id); }
    // Schedule calendar: all roles see every active booking so students/renters/maintenance
    // can tell which aircraft, instructors, and time slots are already taken.
    query += ' ORDER BY b.start_time';
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    const ts = new Date().toISOString();
    console.error(`[bookings] [${ts}] GET / — user=${req.user?.id} error: ${err.message}`);
    res.status(500).json({ code: 'FETCH_ERROR', message: 'Booking temporarily unavailable, please try again.' });
  }
});

router.get('/history', authenticateToken, async (req, res) => {
  try {
    const { start, end, instructor_id, student_id, aircraft_id, status } = req.query;
    let query = `
      SELECT b.*,
        s.name as student_name, s.email as student_email,
        i.name as instructor_name, i.email as instructor_email,
        a.tail_number, a.make_model,
        a.hourly_rate as aircraft_hourly_rate,
        COALESCE(i.instructor_rate, 0) as instructor_hourly_rate,
        fl.hobbs_delta as actual_hobbs_hours,
        fl.tach_delta,
        fl.tach_start as tach_start,
        fl.tach_end as tach_end,
        fl.dual_instruction_hours,
        COALESCE(fl.aircraft_charge_amount,
          CASE WHEN b.lesson_type ~* '^discovery(\s*flight)?$' THEN 185
          ELSE fl.hobbs_delta * a.hourly_rate END) as aircraft_charge_amount,
        COALESCE(fl.instruction_charge_amount,
          CASE WHEN b.lesson_type ~* '^discovery(\s*flight)?$' THEN 0
          ELSE fl.dual_instruction_hours * COALESCE(i.instructor_rate, 0) END) as instruction_charge_amount
      FROM bookings b
      LEFT JOIN users s ON b.student_id = s.id
      LEFT JOIN users i ON b.instructor_id = i.id
      JOIN aircraft a ON b.aircraft_id = a.id
      LEFT JOIN flight_logs fl ON fl.booking_id = b.id
      WHERE b.status = $1
    `;
    const params = [status || 'completed'];
    let paramIdx = 2;
    if (start && end) {
      query += ` AND ${overlapWhere('b', '$' + paramIdx, '$' + (paramIdx + 1))}`;
      params.push(start, end);
      paramIdx += 2;
    } else if (start) {
      query += ` AND b.end_time > $${paramIdx++}`;
      params.push(start);
    } else if (end) {
      query += ` AND b.start_time < $${paramIdx++}`;
      params.push(end);
    }
    if (instructor_id) { query += ` AND b.instructor_id = $${paramIdx++}`; params.push(instructor_id); }
    if (student_id) { query += ` AND b.student_id = $${paramIdx++}`; params.push(student_id); }
    if (aircraft_id) { query += ` AND b.aircraft_id = $${paramIdx++}`; params.push(aircraft_id); }
    if (req.user.role === 'student' || req.user.role === 'renter') {
      query += ` AND b.student_id = $${paramIdx++}`;
      params.push(req.user.id);
    }
    query += ' ORDER BY b.start_time DESC';
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    const ts = new Date().toISOString();
    console.error(`[bookings] [${ts}] GET /history — user=${req.user?.id} error: ${err.message}`);
    res.status(500).json({ code: 'FETCH_ERROR', message: 'Booking temporarily unavailable, please try again.' });
  }
});

// Conflict detection — only checks fields that are non-null
async function checkConflicts(client, { aircraft_id, instructor_id, student_id, start_time, end_time, excludeBookingId }) {
  const conflicts = [];
  const excludeId = excludeBookingId != null && excludeBookingId !== ''
    ? parseInt(excludeBookingId, 10)
    : null;
  const acId = aircraft_id != null ? parseInt(aircraft_id, 10) : null;
  const iid = instructor_id != null ? parseInt(instructor_id, 10) : null;
  const sid = student_id != null ? parseInt(student_id, 10) : null;
  const st = new Date(start_time).toISOString();
  const et = new Date(end_time).toISOString();
  if (Number.isFinite(acId)) {
    const params = [st, et, acId];
    if (excludeId) params.push(excludeId);
    const result = await client.query(
      `SELECT b.id, a.tail_number, b.start_time, b.end_time,
              COALESCE(s.name, i.name, 'Someone') AS booked_by
       FROM bookings b JOIN aircraft a ON a.id = b.aircraft_id
       LEFT JOIN users s ON b.student_id = s.id
       LEFT JOIN users i ON b.instructor_id = i.id
       WHERE b.aircraft_id = $3 AND ${ACTIVE_BOOKING_SQL}
         AND b.start_time < $2 AND b.end_time > $1
         ${excludeId ? 'AND b.id != $4' : ''}
       LIMIT 1`,
      params
    );
    if (result.rows.length > 0) {
      const r = result.rows[0];
      conflicts.push({ type: 'aircraft', entity: r.tail_number, start_time: r.start_time, end_time: r.end_time, booked_by: r.booked_by });
    }
  }
  if (Number.isFinite(iid)) {
    const params = [st, et, iid];
    if (excludeId) params.push(excludeId);
    const result = await client.query(
      `SELECT b.id, u.name as instructor_name, b.start_time, b.end_time
       FROM bookings b JOIN users u ON b.instructor_id = u.id
       WHERE b.instructor_id = $3 AND ${ACTIVE_BOOKING_SQL}
         AND b.start_time < $2 AND b.end_time > $1
         ${excludeId ? 'AND b.id != $4' : ''}
       LIMIT 1`,
      params
    );
    if (result.rows.length > 0) {
      const r = result.rows[0];
      conflicts.push({ type: 'instructor', entity: r.instructor_name, start_time: r.start_time, end_time: r.end_time });
    }
  }
  if (Number.isFinite(sid)) {
    const params = [st, et, sid];
    if (excludeId) params.push(excludeId);
    const result = await client.query(
      `SELECT b.id, u.name as student_name, b.start_time, b.end_time
       FROM bookings b JOIN users u ON b.student_id = u.id
       WHERE b.student_id = $3 AND ${ACTIVE_BOOKING_SQL}
         AND b.start_time < $2 AND b.end_time > $1
         ${excludeId ? 'AND b.id != $4' : ''}
       LIMIT 1`,
      params
    );
    if (result.rows.length > 0) {
      const r = result.rows[0];
      conflicts.push({ type: 'student', entity: r.student_name, start_time: r.start_time, end_time: r.end_time });
    }
  }
  return conflicts;
}

async function findNextAvailableSlots(client, instructorId, afterTime, durationMinutes, count) {
  const slots = [];
  const after = new Date(afterTime);
  let baseDateStr = calendarDateFromDate(after);
  for (let dayOffset = 0; dayOffset < 14 && slots.length < count; dayOffset++) {
    const dateStr = addCalendarDays(baseDateStr, dayOffset);
    const dayOfWeek = dayOfWeekFromCalendarDate(dateStr);
    const dayBlock = await client.query(
      `SELECT 1 FROM instructor_availability_overrides
       WHERE instructor_id = $1 AND start_date <= $2::date AND end_date >= $2::date
         AND is_available = false AND start_time IS NULL`,
      [instructorId, dateStr]
    );
    if (dayBlock.rows.length > 0) continue;
    const windows = await client.query(
      `SELECT start_time, end_time FROM instructor_availability
       WHERE instructor_id = $1 AND day_of_week = $2 ORDER BY start_time`,
      [instructorId, dayOfWeek]
    );
    for (const win of windows.rows) {
      const winStartStr = String(win.start_time).slice(0, 5);
      const winEndStr = String(win.end_time).slice(0, 5);
      let slotStart = wallClockToUtc(dateStr, winStartStr);
      const winEnd = wallClockToUtc(dateStr, winEndStr);
      if (dayOffset === 0 && slotStart <= after) {
        slotStart = new Date(after);
        const mins = parseInt(timeHmFromDate(slotStart).split(':')[1], 10);
        const hrs = parseInt(timeHmFromDate(slotStart).split(':')[0], 10);
        const roundedMin = mins % 30 !== 0 ? mins + (30 - (mins % 30)) : mins;
        slotStart = wallClockToUtc(dateStr, `${String(hrs).padStart(2, '0')}:${String(roundedMin).padStart(2, '0')}`);
        if (slotStart < after) slotStart = new Date(after);
      }
      while (slots.length < count) {
        const slotEnd = new Date(slotStart.getTime() + durationMinutes * 60000);
        if (slotEnd > winEnd) break;
        const conflict = await client.query(
          `SELECT 1 FROM bookings WHERE instructor_id = $1 AND ${ACTIVE_BOOKING_SQL_NO_ALIAS}
           AND start_time < $2 AND end_time > $3 LIMIT 1`,
          [instructorId, slotEnd.toISOString(), slotStart.toISOString()]
        );
        if (conflict.rows.length === 0) {
          slots.push({
            start_time: slotStart.toISOString(),
            end_time: slotEnd.toISOString(),
            date: dateStr,
            day: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][dayOfWeek],
            local_start: timeHmFromDate(slotStart),
            local_end: timeHmFromDate(slotEnd),
          });
        }
        slotStart = new Date(slotStart.getTime() + 30 * 60000);
      }
    }
  }
  return slots;
}

router.get('/check-availability', authenticateToken, async (req, res) => {
  const client = await pool.connect();
  try {
    const { instructor_id, date } = req.query;
    if (!instructor_id || !date) return res.json({ available: true, windows: [] });
    const iid = parseInt(instructor_id);
    const day = await getInstructorDayAvailability(client, iid, date);
    if (day.noConfig) return res.json({ available: true, windows: [], no_config: true });
    if (!day.available) {
      return res.json({ available: false, reason: day.reason, windows: [] });
    }
    return res.json({
      available: true,
      windows: day.windows,
      blocked: day.blocked,
      day: day.dayName,
    });
  } catch (err) {
    console.error('Availability check error:', err);
    return res.json({ available: true, windows: [] });
  } finally {
    client.release();
  }
});

// ─── Booking policy (public to authenticated users) ───
router.get('/policy', authenticateToken, async (req, res) => {
  try {
    const policy = await getPolicySettings();
    res.json(policy);
  } catch (err) {
    res.status(500).json({ error: 'Failed to load booking policy' });
  }
});

// ─── Preflight validation preview (before submit) ───
router.get('/preflight-check', authenticateToken, async (req, res) => {
  try {
    const { aircraft_id, student_id, instructor_id, start_time, end_time, local_date, local_start, local_end, lesson_type, exclude_booking_id } = req.query;
    if (!aircraft_id || !start_time || !end_time) {
      return res.status(400).json({ error: 'aircraft_id, start_time, end_time required' });
    }
    const sid = student_id ? parseInt(student_id, 10) : null;
    const iid = instructor_id ? parseInt(instructor_id, 10) : null;
    const excludeId = exclude_booking_id ? parseInt(exclude_booking_id, 10) : null;
    const isReschedule = Number.isFinite(excludeId);
    const isAdmin = ['owner', 'admin'].includes(req.user.role);
    const editStatus = (req.query.booking_status || '').toLowerCase();
    const isHistoricalEdit = editStatus === 'completed' || editStatus === 'cancelled';
    let booking_type = 'dual';
    if (sid && !iid) booking_type = 'student_solo';
    else if (!sid && iid) booking_type = 'instructor_solo';
    const isDiscovery = isDiscoveryLessonType(lesson_type);
    const result = await runPreflightChecks(null, {
      aircraft_id: parseInt(aircraft_id, 10),
      student_id: sid,
      instructor_id: iid,
      start_time,
      end_time,
      booking_type,
      lesson_type: lesson_type || null,
      local_date,
      local_start,
      local_end,
      skipPastTimeCheck: isReschedule || isAdmin || isHistoricalEdit,
      skipInstructorAvailability: isReschedule || isAdmin || isHistoricalEdit,
      skipDiscoveryDurationCheck: !isDiscovery && (isReschedule || isAdmin || isHistoricalEdit),
    }, req.user.role);
    if (!isAdmin && !isHistoricalEdit) {
      const client = await pool.connect();
      try {
        const conflicts = await checkConflicts(client, {
          aircraft_id: parseInt(aircraft_id, 10),
          instructor_id: iid,
          student_id: sid,
          start_time,
          end_time,
          excludeBookingId: isReschedule ? excludeId : null,
        });
        for (const c of conflicts) {
          const who = c.type === 'aircraft' ? 'Aircraft' : c.type === 'instructor' ? 'Instructor' : 'Student';
          result.errors.push(`${who} conflict: ${c.entity} is already booked during this time`);
        }
        result.ok = result.errors.length === 0;
      } finally {
        client.release();
      }
    }
    res.json(result);
  } catch (err) {
    console.error('[bookings] preflight-check error:', err.message);
    res.status(500).json({ error: 'Preflight check failed' });
  }
});

// ─── Daily roster (dispatch board) ───
router.get('/roster', authenticateToken, async (req, res) => {
  try {
    if (!['owner', 'admin', 'instructor', 'maintenance'].includes(req.user.role)) {
      return res.status(403).json({ error: 'Access denied' });
    }
    const date = req.query.date || new Date().toISOString().slice(0, 10);
    const dayStart = `${date}T00:00:00.000Z`;
    const dayEnd = `${date}T23:59:59.999Z`;
    let query = `
      SELECT b.id, b.start_time, b.end_time, b.status, b.booking_type, b.lesson_type,
             s.name AS student_name, i.name AS instructor_name,
             a.tail_number, a.make_model, a.status AS aircraft_status
      FROM bookings b
      LEFT JOIN users s ON b.student_id = s.id
      LEFT JOIN users i ON b.instructor_id = i.id
      JOIN aircraft a ON b.aircraft_id = a.id
      WHERE b.status NOT IN ('cancelled')
        AND ${overlapWhere('b', '$1', '$2')}
    `;
    const params = [dayStart, dayEnd];
    if (req.user.role === 'instructor') {
      query += ' AND b.instructor_id = $3';
      params.push(req.user.id);
    }
    query += ' ORDER BY b.start_time';
    const result = await pool.query(query, params);
    res.json({ date, bookings: result.rows });
  } catch (err) {
    console.error('[bookings] roster error:', err.message);
    res.status(500).json({ error: 'Failed to load roster' });
  }
});

// ─── Past flights awaiting Hobbs / completion ───
router.get('/completable', authenticateToken, async (req, res) => {
  try {
    let query = `
      SELECT b.*,
        s.name AS student_name, i.name AS instructor_name,
        a.tail_number, a.make_model, a.current_hobbs
      FROM bookings b
      LEFT JOIN users s ON b.student_id = s.id
      LEFT JOIN users i ON b.instructor_id = i.id
      JOIN aircraft a ON b.aircraft_id = a.id
      LEFT JOIN flight_logs fl ON fl.booking_id = b.id
      WHERE b.status = 'confirmed'
        AND b.end_time < NOW()
        AND fl.id IS NULL
    `;
    const params = [];
    let idx = 1;
    const role = req.user.role;
    if (role === 'student') {
      query += ` AND b.student_id = $${idx++} AND b.instructor_id IS NULL`;
      params.push(req.user.id);
    } else if (role === 'renter') {
      query += ` AND b.student_id = $${idx++} AND b.instructor_id IS NULL`;
      params.push(req.user.id);
    } else if (role === 'instructor') {
      query += ` AND b.instructor_id = $${idx++}`;
      params.push(req.user.id);
    } else if (role === 'maintenance') {
      return res.json([]);
    }
    query += ' ORDER BY b.end_time DESC LIMIT 50';
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    console.error('[bookings] completable error:', err.message);
    res.status(500).json({ error: 'Failed to load pending flights' });
  }
});

// ─── iCal export for current user's upcoming bookings ───
router.get('/ical/me', authenticateToken, async (req, res) => {
  try {
    let query = `
      SELECT b.*, a.tail_number, s.name AS student_name, i.name AS instructor_name
      FROM bookings b
      JOIN aircraft a ON a.id = b.aircraft_id
      LEFT JOIN users s ON b.student_id = s.id
      LEFT JOIN users i ON b.instructor_id = i.id
      WHERE b.status = 'confirmed' AND b.end_time >= NOW()
    `;
    const params = [];
    if (req.user.role === 'student' || req.user.role === 'renter') {
      query += ' AND b.student_id = $1';
      params.push(req.user.id);
    } else if (req.user.role === 'instructor') {
      query += ' AND b.instructor_id = $1';
      params.push(req.user.id);
    }
    query += ' ORDER BY b.start_time LIMIT 200';
    const result = await pool.query(query, params);
    const lines = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//FlightSlate//EN',
      'CALSCALE:GREGORIAN',
    ];
    for (const b of result.rows) {
      const uid = `booking-${b.id}@flightslate`;
      const dtStart = new Date(b.start_time).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
      const dtEnd = new Date(b.end_time).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
      const summary = `${b.tail_number} — ${b.lesson_type || b.booking_type || 'Flight'}`;
      const desc = [b.student_name && `Student: ${b.student_name}`, b.instructor_name && `CFI: ${b.instructor_name}`].filter(Boolean).join('\\n');
      lines.push('BEGIN:VEVENT', `UID:${uid}`, `DTSTART:${dtStart}`, `DTEND:${dtEnd}`, `SUMMARY:${summary}`, `DESCRIPTION:${desc}`, 'END:VEVENT');
    }
    lines.push('END:VCALENDAR');
    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="flightslate-schedule.ics"');
    res.send(lines.join('\r\n'));
  } catch (err) {
    console.error('[bookings] ical error:', err.message);
    res.status(500).json({ error: 'Failed to export calendar' });
  }
});

// ─── Duplicate booking (+7 days default) ───
router.post('/duplicate/:id', authenticateToken, async (req, res) => {
  const client = await pool.connect();
  try {
    if (!['owner', 'admin', 'instructor'].includes(req.user.role)) {
      return res.status(403).json({ error: 'Only staff can duplicate bookings' });
    }
    const existing = await client.query('SELECT * FROM bookings WHERE id = $1', [req.params.id]);
    if (existing.rows.length === 0) return res.status(404).json({ error: 'Booking not found' });
    const b = existing.rows[0];
    if (b.status === 'cancelled') return res.status(400).json({ error: 'Cannot duplicate cancelled booking' });
    const offsetDays = parseInt(req.body.offset_days, 10) || 7;
    const start = new Date(b.start_time);
    const end = new Date(b.end_time);
    start.setDate(start.getDate() + offsetDays);
    end.setDate(end.getDate() + offsetDays);
    const start_time = start.toISOString();
    const end_time = end.toISOString();
    const policy = await getPolicySettings();
    const isAdmin = ['owner', 'admin'].includes(req.user.role);
    const timeCheck = validateBookingTimes({
      start, end, policy, userRole: req.user.role, isAdmin, lesson_type: b.lesson_type,
    });
    if (timeCheck.errors.length) return res.status(400).json({ error: timeCheck.errors[0], errors: timeCheck.errors });

    const grounding = await checkGroundingSquawk(client, b.aircraft_id);
    if (grounding.blocked) return res.status(409).json({ error: 'Aircraft grounded', reason: grounding.reason });

    await client.query('BEGIN');
    await lockBookingResources(client, {
      aircraft_id: b.aircraft_id,
      instructor_id: b.instructor_id,
      student_id: b.student_id,
    });
    const conflicts = await checkConflicts(client, {
      aircraft_id: b.aircraft_id,
      instructor_id: b.instructor_id,
      student_id: b.student_id,
      start_time,
      end_time,
    });
    if (conflicts.length) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Scheduling conflict', conflicts });
    }
    const ins = await client.query(
      `INSERT INTO bookings (student_id, instructor_id, aircraft_id, start_time, end_time, lesson_type, notes, created_by, booking_type)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [b.student_id, b.instructor_id, b.aircraft_id, start_time, end_time, b.lesson_type,
        b.notes ? `(Copy) ${b.notes}` : 'Duplicated booking', req.user.id, b.booking_type]
    );
    await client.query('COMMIT');
    res.status(201).json(ins.rows[0]);
    sendBookingConfirmationEmails(ins.rows[0].id).catch((err) => console.error('[booking-email] duplicate:', err.message));
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: 'Failed to duplicate booking' });
  } finally {
    client.release();
  }
});

// ─── Recurring weekly bookings ───
router.post('/recurring', authenticateToken, async (req, res) => {
  const client = await pool.connect();
  try {
    const {
      student_id, instructor_id, aircraft_id, start_time, end_time,
      lesson_type, notes, local_date, local_start, local_end, weeks = 4,
    } = req.body;
    if (!['owner', 'admin', 'instructor'].includes(req.user.role)) {
      return res.status(403).json({ error: 'Only staff can create recurring bookings' });
    }
    const weekCount = Math.min(Math.max(parseInt(weeks, 10) || 4, 1), 12);
    const created = [];
    const skipped = [];
    const baseStart = new Date(start_time);
    const baseEnd = new Date(end_time);
    const durationMs = baseEnd - baseStart;

    for (let w = 0; w < weekCount; w++) {
      const st = new Date(baseStart.getTime() + w * 7 * 86400000);
      const et = new Date(st.getTime() + durationMs);
      const body = {
        student_id, instructor_id, aircraft_id,
        start_time: st.toISOString(),
        end_time: et.toISOString(),
        lesson_type, notes,
        local_date: local_date || st.toISOString().slice(0, 10),
        local_start, local_end,
        force_booking: req.body.force_booking,
      };
      try {
        // Inline create logic — reuse validation via internal helper
        const fakeReq = { body, user: req.user };
        const result = await createBookingInternal(client, fakeReq);
        if (result.error) skipped.push({ week: w + 1, reason: result.error });
        else {
          created.push(result.booking);
          sendBookingConfirmationEmails(result.booking.id, client).catch((err) => console.error('[booking-email] recurring:', err.message));
        }
      } catch (e) {
        skipped.push({ week: w + 1, reason: e.message });
      }
    }
    res.status(201).json({ created: created.length, skipped, bookings: created });
  } catch (err) {
    console.error('[bookings] recurring error:', err.message);
    res.status(500).json({ error: 'Failed to create recurring bookings' });
  } finally {
    client.release();
  }
});

async function createBookingInternal(client, req) {
  const { student_id, instructor_id, aircraft_id, start_time, end_time, lesson_type, notes, local_date, local_start, local_end } = req.body;
  let sid = student_id ? parseInt(student_id, 10) : null;
  const iid = instructor_id ? parseInt(instructor_id, 10) : null;
  if (['student', 'renter'].includes(req.user.role)) sid = req.user.id;
  if (!aircraft_id || !start_time || !end_time) return { error: 'Missing required fields' };
  const start = new Date(start_time);
  const end = new Date(end_time);
  if (end <= start) return { error: 'End time must be after start time' };
  const policy = await getPolicySettings();
  const isAdmin = ['owner', 'admin'].includes(req.user.role);
  const timeCheck = validateBookingTimes({ start, end, local_start, local_end, policy, userRole: req.user.role, isAdmin, lesson_type });
  if (timeCheck.errors.length) return { error: timeCheck.errors[0] };

  const grounding = await checkGroundingSquawk(client, aircraft_id);
  if (grounding.blocked) return { error: `Aircraft grounded: ${grounding.reason}` };

  const downtimeHit = await findOverlappingDowntime(client, aircraft_id, start_time, end_time);
  if (downtimeHit) return { error: 'Aircraft is scheduled for maintenance during this period' };

  let booking_type = 'dual';
  if (sid && !iid) {
    const roleRes = await client.query('SELECT role FROM users WHERE id = $1', [sid]);
    booking_type = roleRes.rows[0]?.role === 'renter' ? 'renter_solo' : 'student_solo';
  } else if (!sid && iid) booking_type = 'instructor_solo';

  const aircraft = await client.query('SELECT status FROM aircraft WHERE id = $1', [aircraft_id]);
  if (aircraft.rows.length === 0) return { error: 'Aircraft not found' };
  if (aircraft.rows[0].status !== 'available') return { error: `Aircraft is ${aircraft.rows[0].status}` };

  const acId = parseInt(aircraft_id, 10);
  if (!Number.isFinite(acId)) return { error: 'Invalid aircraft' };

  await client.query('BEGIN');
  try {
    await lockBookingResources(client, { aircraft_id: acId, instructor_id: iid, student_id: sid });
    const conflicts = await checkConflicts(client, { aircraft_id: acId, instructor_id: iid, student_id: sid, start_time, end_time });
    if (conflicts.length) {
      await client.query('ROLLBACK');
      return { error: 'Scheduling conflict', conflicts };
    }
    const result = await client.query(
      `INSERT INTO bookings (student_id, instructor_id, aircraft_id, start_time, end_time, lesson_type, notes, created_by, booking_type)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
      [sid, iid, acId, start_time, end_time, lesson_type || null, notes || null, req.user.id, booking_type]
    );
    await client.query('COMMIT');
    sendBookingConfirmationEmails(result.rows[0].id, client).catch((err) => console.error('[booking-email] create:', err.message));
    return { booking: result.rows[0] };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  }
}

router.post('/', authenticateToken, async (req, res) => {
  const client = await pool.connect();
  try {
    const { student_id, instructor_id, aircraft_id, start_time, end_time, lesson_type, notes, local_date, local_start, local_end } = req.body;
    let sid = student_id ? parseInt(student_id) : null;
    const iid = instructor_id ? parseInt(instructor_id) : null;
    if (['student', 'renter'].includes(req.user.role)) {
      sid = req.user.id;
      if (student_id && parseInt(student_id) !== req.user.id) {
        return res.status(403).json({ error: 'Students and renters can only create bookings for themselves' });
      }
    }
    if (!sid && !iid) return res.status(400).json({ error: 'At least one person (student or instructor) is required' });
    if (!aircraft_id || !start_time || !end_time) return res.status(400).json({ error: 'Aircraft, start time, and end time are required' });
    const start = new Date(start_time);
    const end = new Date(end_time);
    if (isNaN(start.getTime()) || isNaN(end.getTime())) return res.status(400).json({ error: 'Invalid date format for start or end time' });
    if (end <= start) return res.status(400).json({ error: 'End time must be after start time' });
    // Duration cap — multi-day rentals up to 7 days
    const durationHrs = (end - start) / (1000 * 60 * 60);
    if (durationHrs > MAX_BOOKING_DURATION_HOURS) return res.status(400).json({ error: `Booking cannot exceed ${MAX_BOOKING_DURATION_HOURS} hours` });
    const policy = await getPolicySettings();
    const isAdmin = ['owner', 'admin'].includes(req.user.role);
    const timeCheck = validateBookingTimes({ start, end, local_start, local_end, policy, userRole: req.user.role, isAdmin, lesson_type });
    if (timeCheck.errors.length) return res.status(400).json({ error: timeCheck.errors[0], errors: timeCheck.errors });

    let booking_type = 'dual';
    if (sid && !iid) {
      const roleRes = await client.query('SELECT role FROM users WHERE id = $1', [sid]);
      booking_type = roleRes.rows[0]?.role === 'renter' ? 'renter_solo' : 'student_solo';
    } else if (!sid && iid) booking_type = 'instructor_solo';

    const grounding = await checkGroundingSquawk(client, aircraft_id);
    if (grounding.blocked) return res.status(409).json({ error: 'Aircraft is grounded due to open squawk', reason: grounding.reason });

    if (booking_type === 'student_solo') {
      /* solo endorsement not required */
    }

    // Check aircraft downtime overlap (date + optional time window)
    if (aircraft_id) {
      const downtimeHit = await findOverlappingDowntime(client, aircraft_id, start_time, end_time);
      if (downtimeHit) {
        return res.status(409).json({ error: 'Aircraft is scheduled for maintenance during this period', reason: downtimeHit.reason });
      }
    }

    const preflight = await runPreflightChecks(client, {
      aircraft_id: parseInt(aircraft_id, 10),
      student_id: sid,
      instructor_id: iid,
      start_time,
      end_time,
      booking_type,
      lesson_type: lesson_type || null,
      local_date,
      local_start,
      local_end,
    }, req.user.role);
    if (!preflight.ok) {
      return res.status(409).json({ error: preflight.errors[0], errors: preflight.errors, warnings: preflight.warnings });
    }
    const aircraft = await client.query('SELECT status FROM aircraft WHERE id = $1', [aircraft_id]);
    if (aircraft.rows.length === 0) return res.status(404).json({ error: 'Aircraft not found' });
    if (aircraft.rows[0].status !== 'available') {
      return res.status(409).json({ error: `Aircraft is currently ${aircraft.rows[0].status}` });
    }
    const acId = parseInt(aircraft_id, 10);
    if (!Number.isFinite(acId)) return res.status(400).json({ error: 'Invalid aircraft' });
    await client.query('BEGIN');
    await lockBookingResources(client, { aircraft_id: acId, instructor_id: iid, student_id: sid });
    const conflicts = await checkConflicts(client, { aircraft_id: acId, instructor_id: iid, student_id: sid, start_time, end_time });
    if (conflicts.length > 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Scheduling conflict', conflicts });
    }
    const selfService = ['student', 'renter', 'instructor'].includes(req.user.role);
    if (iid && req.body.force_booking !== true && req.body.force_booking !== 'true') {
      const localOpts = (local_date && local_start && local_end) ? { localDate: local_date, localStart: local_start, localEnd: local_end } : {};
      const availCheck = await isInstructorAvailable(client, iid, start_time, end_time, localOpts);
      if (!availCheck.available) {
        const startDt = new Date(start_time);
        const durationMinutes = Math.round((new Date(end_time) - startDt) / 60000);
        const nextSlots = await findNextAvailableSlots(client, iid, start_time, durationMinutes, 3);
        const instrName = (await client.query('SELECT name FROM users WHERE id=$1', [iid])).rows[0]?.name || 'Instructor';
        const allInst = await client.query(
          `SELECT id, name FROM users u WHERE ${BOOKABLE_INSTRUCTOR_WHERE} AND u.id != $1`, [iid]
        );
        const alternatives = [];
        for (const inst of allInst.rows) {
          const { available: altAvail } = await isInstructorAvailable(client, inst.id, start_time, end_time, localOpts);
          if (altAvail) {
            const conf = await client.query(
              `SELECT id FROM bookings WHERE instructor_id=$1 AND ${ACTIVE_BOOKING_SQL_NO_ALIAS} AND start_time<$2 AND end_time>$3 LIMIT 1`,
              [inst.id, end_time, start_time]
            );
            if (conf.rows.length === 0) alternatives.push(inst);
          }
        }
        await client.query('ROLLBACK');
        return res.status(409).json({
          error: 'Instructor not available',
          availability_conflict: true,
          reason: availCheck.reason,
          instructor_name: instrName,
          next_slots: nextSlots,
          alternative_instructors: alternatives,
          can_force: ['owner', 'admin'].includes(req.user.role)
        });
      }
    }
    const result = await client.query(
      `INSERT INTO bookings (student_id, instructor_id, aircraft_id, start_time, end_time, lesson_type, notes, created_by, booking_type)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
      [sid, iid, acId, start_time, end_time, lesson_type || null, notes || null, req.user.id, booking_type]
    );
    await client.query('COMMIT');
    const booking = await pool.query(
      `SELECT b.*, s.name as student_name, i.name as instructor_name, a.tail_number, a.make_model
       FROM bookings b
       LEFT JOIN users s ON b.student_id = s.id
       LEFT JOIN users i ON b.instructor_id = i.id
       JOIN aircraft a ON b.aircraft_id = a.id
       WHERE b.id = $1`,
      [result.rows[0].id]
    );
    res.status(201).json(booking.rows[0]);
    sendBookingConfirmationEmails(result.rows[0].id).catch((err) => console.error('[booking-email] error:', err.message));
  } catch (err) {
    await client.query('ROLLBACK');
    const ts = new Date().toISOString();
    console.error(`[bookings] [${ts}] POST / — user=${req.user?.id} error: ${err.message}`);
    res.status(500).json({ code: 'CREATE_ERROR', message: 'Booking temporarily unavailable, please try again.' });
  } finally {
    client.release();
  }
});

router.put('/:id', authenticateToken, async (req, res) => {
  const client = await pool.connect();
  try {
    const { student_id, instructor_id, aircraft_id, start_time, end_time, lesson_type, notes, status } = req.body;
    const bookingId = parseInt(req.params.id, 10);
    if (!Number.isFinite(bookingId)) return res.status(400).json({ error: 'Invalid booking id' });
    const existing = await client.query('SELECT * FROM bookings WHERE id = $1', [bookingId]);
    if (existing.rows.length === 0) return res.status(404).json({ error: 'Booking not found' });
    const b = existing.rows[0];
    const isAdmin = ['owner', 'admin'].includes(req.user.role);
    const isHistoricalBooking = b.status === 'completed' || b.status === 'cancelled';
    const isAssignedInstructor = req.user.role === 'instructor' && b.instructor_id === req.user.id;
    const isStaffHistoricalEdit = isAdmin || isHistoricalBooking || (isAssignedInstructor && isHistoricalBooking);
    if (!canAccessBooking(req.user, b)) return res.status(403).json({ error: 'Access denied' });
    const rescheduleRequested = start_time !== undefined || end_time !== undefined || aircraft_id !== undefined;
    const sid = student_id !== undefined ? normBookingUserId(student_id) : b.student_id;
    const iid = instructor_id !== undefined ? normBookingUserId(instructor_id) : b.instructor_id;
    if (!isAdmin && (sid !== b.student_id || iid !== b.instructor_id)) {
      return res.status(403).json({ error: 'Cannot change student or instructor on an existing booking' });
    }
    if (!isAdmin && rescheduleRequested) {
      if (b.status !== 'confirmed' && !(isAssignedInstructor && isHistoricalBooking)) {
        return res.status(400).json({ error: 'Only confirmed bookings can be rescheduled' });
      }
    }
    if (status && !isAdmin) return res.status(403).json({ error: 'Only admins can change booking status' });
    const acId = aircraft_id !== undefined ? parseInt(aircraft_id, 10) : b.aircraft_id;
    const stIso = new Date(start_time !== undefined ? start_time : b.start_time).toISOString();
    const etIso = new Date(end_time !== undefined ? end_time : b.end_time).toISOString();
    const stTime = new Date(stIso);
    const enTime = new Date(etIso);
    if (isNaN(stTime.getTime()) || isNaN(enTime.getTime())) return res.status(400).json({ error: 'Invalid date format' });
    if (enTime <= stTime) return res.status(400).json({ error: 'End time must be after start time' });
    // Duration cap on updates
    const updDurationHrs = (enTime - stTime) / (1000 * 60 * 60);
    if (updDurationHrs > MAX_BOOKING_DURATION_HOURS) return res.status(400).json({ error: `Booking cannot exceed ${MAX_BOOKING_DURATION_HOURS} hours` });
    const effectiveLessonType = lesson_type !== undefined ? lesson_type : b.lesson_type;
    const isDiscovery = isDiscoveryLessonType(effectiveLessonType);
    const policy = await getPolicySettings();
    const timeCheck = validateBookingTimes({
      start: stTime, end: enTime, policy, userRole: req.user.role, isAdmin, lesson_type: effectiveLessonType,
      skipDiscoveryDurationCheck: !isDiscovery && isStaffHistoricalEdit,
      skipPastTimeCheck: isStaffHistoricalEdit,
    });
    if (timeCheck.errors.length) return res.status(400).json({ error: timeCheck.errors[0], errors: timeCheck.errors });
    // Downtime check on updates — time-aware overlap (staff may override past maintenance windows)
    if (acId && !isStaffHistoricalEdit) {
      const downtimeHit = await findOverlappingDowntime(client, acId, stIso, etIso);
      if (downtimeHit) {
        return res.status(409).json({ error: 'Aircraft is scheduled for maintenance during this period', reason: downtimeHit.reason });
      }
    }
    const scheduleChanged = acId !== b.aircraft_id
      || sid !== b.student_id
      || iid !== b.instructor_id
      || stIso !== new Date(b.start_time).toISOString()
      || etIso !== new Date(b.end_time).toISOString();
    const skipConflictCheck = isStaffHistoricalEdit;
    const needsConflictCheck = scheduleChanged && !skipConflictCheck;
    if (needsConflictCheck || (scheduleChanged && isAdmin)) {
      await client.query('BEGIN');
      try {
        if (needsConflictCheck) {
          await lockBookingResources(client, { aircraft_id: acId, instructor_id: iid, student_id: sid });
          const conflicts = await checkConflicts(client, { aircraft_id: acId, instructor_id: iid, student_id: sid, start_time: stIso, end_time: etIso, excludeBookingId: bookingId });
          if (conflicts.length > 0) {
            await client.query('ROLLBACK');
            return res.status(409).json({ error: 'Scheduling conflict', conflicts });
          }
        }
        const timeChanged = stIso !== new Date(b.start_time).toISOString() || etIso !== new Date(b.end_time).toISOString();
        let booking_type = await deriveBookingType(client, sid, iid);
        if (isAdmin && req.body.booking_type) {
          const allowed = ['dual', 'student_solo', 'renter_solo', 'instructor_solo'];
          if (allowed.includes(req.body.booking_type)) booking_type = req.body.booking_type;
        }
        const result = await client.query(
          `UPDATE bookings SET student_id = $1, instructor_id = $2, aircraft_id = $3,
           start_time = $4, end_time = $5, lesson_type = COALESCE($6, lesson_type),
           notes = COALESCE($7, notes), status = COALESCE($8, status),
           booking_type = $9,
           reminder_sent = ${timeChanged ? 'false' : 'reminder_sent'},
           updated_at = NOW()
           WHERE id = $10 RETURNING *`,
          [sid, iid, acId, stIso, etIso, lesson_type, notes, status, booking_type, bookingId]
        );
        const updated = result.rows[0];
        await syncCompletedBookingSideEffects(client, updated, effectiveLessonType);
        await client.query('COMMIT');
        return res.json(updated);
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      }
    }
    await client.query('BEGIN');
    // Metadata-only updates (lesson type, notes) — no conflict check needed
    const timeChanged = stIso !== new Date(b.start_time).toISOString() || etIso !== new Date(b.end_time).toISOString();
    let booking_type = await deriveBookingType(client, sid, iid);
    if (isAdmin && req.body.booking_type) {
      const allowed = ['dual', 'student_solo', 'renter_solo', 'instructor_solo'];
      if (allowed.includes(req.body.booking_type)) booking_type = req.body.booking_type;
    }
    const result = await client.query(
      `UPDATE bookings SET student_id = $1, instructor_id = $2, aircraft_id = $3,
       start_time = $4, end_time = $5, lesson_type = COALESCE($6, lesson_type),
       notes = COALESCE($7, notes), status = COALESCE($8, status),
       booking_type = $9,
       reminder_sent = ${timeChanged ? 'false' : 'reminder_sent'},
       updated_at = NOW()
       WHERE id = $10 RETURNING *`,
      [sid, iid, acId, stIso, etIso, lesson_type, notes, status, booking_type, bookingId]
    );
    const updated = result.rows[0];
    await syncCompletedBookingSideEffects(client, updated, effectiveLessonType);
    await client.query('COMMIT');
    res.json(updated);
  } catch (err) {
    await client.query('ROLLBACK');
    const ts = new Date().toISOString();
    console.error(`[bookings] [${ts}] PUT /:id — user=${req.user?.id} error: ${err.message}`);
    res.status(500).json({ code: 'UPDATE_ERROR', message: 'Booking temporarily unavailable, please try again.' });
  } finally {
    client.release();
  }
});

router.delete('/:id', authenticateToken, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const existing = await client.query('SELECT * FROM bookings WHERE id = $1 FOR UPDATE', [req.params.id]);
    if (existing.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Booking not found' });
    }
    const b = existing.rows[0];
    const isAdmin = ['owner', 'admin'].includes(req.user.role);
    if (!canAccessBooking(req.user, b)) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'Access denied' });
    }
    if (b.status === 'completed') {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Cannot cancel a completed booking' });
    }
    if (b.status === 'cancelled') {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Booking is already cancelled' });
    }
    const policy = await getPolicySettings();
    const cancelCheck = validateCancellation({ bookingStart: b.start_time, userRole: req.user.role, isAdmin, policy });
    if (!cancelCheck.allowed) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: cancelCheck.error });
    }
    const reason = req.body?.reason || null;
    await client.query(
      `UPDATE bookings SET status = 'cancelled', cancellation_reason = $1, updated_at = NOW() WHERE id = $2`,
      [reason, req.params.id]
    );
    await client.query('COMMIT');
    res.json({ ok: true });

    // Send cancellation email to student + instructor (fire-and-forget)
    sendBookingCancellationEmails(req.params.id, req.user.id, req.user.role, reason).catch((err) => console.error('[bookings] cancellation email error:', err.message));
  } catch (err) {
    await client.query('ROLLBACK');
    const ts = new Date().toISOString();
    console.error(`[bookings] [${ts}] DELETE /:id — user=${req.user?.id} error: ${err.message}`);
    res.status(500).json({ code: 'CANCEL_ERROR', message: 'Booking temporarily unavailable, please try again.' });
  } finally {
    client.release();
  }
});

module.exports = router;
module.exports.checkConflicts = checkConflicts;
module.exports.lockBookingResources = lockBookingResources;
module.exports.ACTIVE_BOOKING_SQL = ACTIVE_BOOKING_SQL;
module.exports.isInstructorAvailable = isInstructorAvailable;
module.exports.findNextAvailableSlots = findNextAvailableSlots;