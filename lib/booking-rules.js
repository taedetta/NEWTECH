'use strict';

/**
 * Shared booking validation rules — hard blocks and soft warnings.
 */
const pool = require('../db/index');
const { isInstructorAvailable } = require('./instructor-availability');
const { getInspectionHours, hoursUntilDue } = require('./aircraft-inspection-hours');

const DEFAULTS = {
  min_booking_duration_minutes: 30,
  min_lead_time_hours: 0,
  min_cancel_notice_hours: 0,
  business_hours_start: 6,
  business_hours_end: 21,
  max_advance_booking_days: 90,
};

async function getPolicySettings() {
  const keys = Object.keys(DEFAULTS).map((k) => `booking_${k}`);
  const legacy = ['min_booking_duration_minutes', 'min_lead_time_hours', 'min_cancel_notice_hours',
    'business_hours_start', 'business_hours_end', 'max_advance_booking_days'];
  const result = await pool.query(
    `SELECT key, value FROM school_settings WHERE key = ANY($1)`,
    [keys]
  );
  const out = { ...DEFAULTS };
  for (const row of result.rows) {
    const short = row.key.replace(/^booking_/, '');
    if (short in out) out[short] = parseFloat(row.value);
  }
  // Also accept non-prefixed keys for backwards compat
  const legacyRes = await pool.query(
    `SELECT key, value FROM school_settings WHERE key = ANY($1)`,
    [legacy]
  );
  for (const row of legacyRes.rows) {
    if (row.key in out) out[row.key] = parseFloat(row.value);
  }
  // No advance notice or business-hours restrictions
  out.min_lead_time_hours = 0;
  out.min_cancel_notice_hours = 0;
  out.business_hours_start = 0;
  out.business_hours_end = 24;
  return out;
}

function parseLocalHM(isoOrDate, localStart, localEnd) {
  if (localStart && localEnd) {
    const [sh, sm] = localStart.split(':').map(Number);
    const [eh, em] = localEnd.split(':').map(Number);
    return { startH: sh, startM: sm || 0, endH: eh, endM: em || 0 };
  }
  const start = new Date(isoOrDate.start);
  const end = new Date(isoOrDate.end);
  return {
    startH: start.getHours(),
    startM: start.getMinutes(),
    endH: end.getHours(),
    endM: end.getMinutes(),
  };
}

function calendarDateOnly(value) {
  if (!value) return null;
  const s = String(value).slice(0, 10);
  const [y, m, d] = s.split('-').map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}

function todayCalendarDate() {
  const n = new Date();
  return new Date(n.getFullYear(), n.getMonth(), n.getDate());
}

function daysBetweenCalendar(a, b) {
  return Math.round((b.getTime() - a.getTime()) / 86400000);
}

function isDiscoveryLessonType(lessonType) {
  if (!lessonType) return false;
  return /^discovery(\s*flight)?$/i.test(String(lessonType).trim());
}

function canBookPastTimes(userRole, isAdmin) {
  return isAdmin || ['owner', 'admin', 'instructor', 'maintenance'].includes(userRole);
}

function validateBookingTimes({ start, end, local_start, local_end, policy, userRole, isAdmin, booking_type, lesson_type }) {
  const errors = [];
  const warnings = [];
  const durationMin = (end - start) / 60000;
  const now = new Date();
  const graceMs = 60 * 1000; // 1 min grace for last-minute submissions

  if (isDiscoveryLessonType(lesson_type)) {
    if (Math.abs(durationMin - 20) > 0.5) {
      errors.push('Discovery flights must be booked in exactly 20-minute blocks');
    }
  } else if (durationMin < policy.min_booking_duration_minutes) {
    errors.push(`Booking must be at least ${policy.min_booking_duration_minutes} minutes`);
  }

  const maxAdvance = policy.max_advance_booking_days * 24 * 60 * 60 * 1000;
  if (start.getTime() - now.getTime() > maxAdvance) {
    errors.push(`Cannot book more than ${policy.max_advance_booking_days} days in advance`);
  }

  if (!canBookPastTimes(userRole, isAdmin) && start.getTime() < now.getTime() - graceMs) {
    errors.push('Start time must not be in the past');
  }

  // Rentals and all flight bookings: 24/7 — no business-hours restriction

  return { errors, warnings };
}

function validateCancellation({ bookingStart, userRole, isAdmin, policy }) {
  if (isAdmin || ['owner', 'admin', 'instructor'].includes(userRole)) {
    return { allowed: true };
  }
  const noticeHrs = parseFloat(policy.min_cancel_notice_hours) || 0;
  if (noticeHrs <= 0) return { allowed: true };
  const hoursUntil = (new Date(bookingStart).getTime() - Date.now()) / 3600000;
  if (hoursUntil < noticeHrs) {
    return {
      allowed: false,
      error: `Cancellations require at least ${noticeHrs} hours notice. Contact the office to cancel.`,
    };
  }
  return { allowed: true };
}

async function checkGroundingSquawk(client, aircraftId) {
  const db = client || pool;
  const result = await db.query(
    `SELECT id, description FROM squawks
     WHERE aircraft_id = $1 AND status IN ('open','reviewed') AND severity = 'grounding'
     LIMIT 1`,
    [aircraftId]
  );
  if (result.rows.length > 0) {
    return { blocked: true, reason: result.rows[0].description || 'Open grounding squawk' };
  }
  return { blocked: false };
}

async function checkStudentSoloEligible() {
  return { allowed: true };
}

async function runPreflightChecks(client, { aircraft_id, student_id, instructor_id, start_time, end_time, booking_type, lesson_type, local_start, local_end }, userRole) {
  const policy = await getPolicySettings();
  const start = new Date(start_time);
  const end = new Date(end_time);
  const isAdmin = ['owner', 'admin'].includes(userRole);
  const { errors, warnings } = validateBookingTimes({
    start, end, local_start, local_end, policy, userRole, isAdmin, booking_type, lesson_type,
  });

  if (aircraft_id) {
    const ac = await (client || pool).query(
      'SELECT tail_number, status, current_tach, total_tach_hours, next_100hr_due, next_annual_due FROM aircraft WHERE id = $1',
      [aircraft_id]
    );
    if (ac.rows.length === 0) errors.push('Aircraft not found');
    else {
      const a = ac.rows[0];
      if (a.status !== 'available') errors.push(`Aircraft is ${a.status}`);
      const tach = getInspectionHours(a);
      const due100 = parseFloat(a.next_100hr_due || 0);
      if (due100 > 0 && tach != null) {
        const remaining = hoursUntilDue(a, due100);
        if (remaining <= 0) {
          errors.push(`${a.tail_number} is past due for 100-hour inspection (${tach.toFixed(1)} / ${due100.toFixed(1)} Tach)`);
        } else if (remaining <= 10) {
          warnings.push(`${a.tail_number} 100-hour inspection due in ${remaining.toFixed(1)} Tach hrs`);
        }
      }
      if (a.next_annual_due) {
        const annualDue = calendarDateOnly(a.next_annual_due);
        const today = todayCalendarDate();
        if (annualDue && today > annualDue) {
          errors.push(`${a.tail_number} annual inspection is overdue (due ${annualDue.toLocaleDateString()})`);
        } else if (annualDue && daysBetweenCalendar(today, annualDue) <= 30) {
          warnings.push(`${a.tail_number} annual inspection due ${annualDue.toLocaleDateString()}`);
        }
      }
      const grounding = await checkGroundingSquawk(client, aircraft_id);
      if (grounding.blocked) errors.push(`Aircraft grounded: ${grounding.reason}`);
    }
  }

  if (booking_type === 'student_solo' && student_id) {
    const solo = await checkStudentSoloEligible(client, student_id);
    if (!solo.allowed) errors.push(solo.error);
  }

  if (student_id) {
    const med = await (client || pool).query(
      'SELECT name, medical_certificate_expiry FROM users WHERE id = $1',
      [student_id]
    );
    if (med.rows[0]?.medical_certificate_expiry) {
      const exp = calendarDateOnly(med.rows[0].medical_certificate_expiry);
      const today = todayCalendarDate();
      if (exp && today > exp) errors.push('Student medical certificate is expired');
      else if (exp && daysBetweenCalendar(today, exp) <= 30) {
        warnings.push('Student medical certificate expires within 30 days');
      }
    }
  }

  if (instructor_id && !isAdmin) {
    const localOpts = (local_start && local_end)
      ? { localDate: start.toISOString().slice(0, 10), localStart: local_start, localEnd: local_end }
      : {};
    const avail = await isInstructorAvailable(client, instructor_id, start_time, end_time, localOpts);
    if (!avail.available) {
      const instr = await (client || pool).query('SELECT name FROM users WHERE id = $1', [instructor_id]);
      const name = instr.rows[0]?.name || 'Instructor';
      errors.push(`${name} is not available: ${avail.reason || 'Outside scheduled hours'}`);
    }
  }

  return { ok: errors.length === 0, errors, warnings, policy };
}

module.exports = {
  DEFAULTS,
  getPolicySettings,
  isDiscoveryLessonType,
  canBookPastTimes,
  validateBookingTimes,
  validateCancellation,
  checkGroundingSquawk,
  checkStudentSoloEligible,
  runPreflightChecks,
};
