'use strict';

/**
 * Shared booking validation rules — hard blocks and soft warnings.
 */
const pool = require('../db/index');

const DEFAULTS = {
  min_booking_duration_minutes: 30,
  min_lead_time_hours: 2,
  min_cancel_notice_hours: 2,
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

function validateBookingTimes({ start, end, local_start, local_end, policy, userRole, isAdmin }) {
  const errors = [];
  const warnings = [];
  const durationMin = (end - start) / 60000;
  const now = new Date();

  if (durationMin < policy.min_booking_duration_minutes) {
    errors.push(`Booking must be at least ${policy.min_booking_duration_minutes} minutes`);
  }

  const maxAdvance = policy.max_advance_booking_days * 24 * 60 * 60 * 1000;
  if (start.getTime() - now.getTime() > maxAdvance) {
    errors.push(`Cannot book more than ${policy.max_advance_booking_days} days in advance`);
  }

  if (start < now) {
    errors.push('Start time must be in the future');
  }

  const leadMs = policy.min_lead_time_hours * 3600000;
  if (!isAdmin && ['student', 'renter'].includes(userRole) && start.getTime() - now.getTime() < leadMs) {
    errors.push(`Bookings require at least ${policy.min_lead_time_hours} hours advance notice`);
  }

  const hm = parseLocalHM({ start, end }, local_start, local_end);
  const startDec = hm.startH + hm.startM / 60;
  let endDec = hm.endH + hm.endM / 60;
  if (endDec <= startDec) endDec += 24; // cross-midnight
  if (startDec < policy.business_hours_start || endDec > policy.business_hours_end) {
    errors.push(`Flights must be within business hours (${policy.business_hours_start}:00–${policy.business_hours_end}:00)`);
  }

  return { errors, warnings };
}

function validateCancellation({ bookingStart, userRole, isAdmin, policy }) {
  if (isAdmin || ['owner', 'admin', 'instructor'].includes(userRole)) {
    return { allowed: true };
  }
  const hoursUntil = (new Date(bookingStart).getTime() - Date.now()) / 3600000;
  if (hoursUntil < policy.min_cancel_notice_hours) {
    return {
      allowed: false,
      error: `Cancellations require at least ${policy.min_cancel_notice_hours} hours notice. Contact the office to cancel.`,
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

async function checkStudentSoloEligible(client, studentId) {
  if (!studentId) return { allowed: true };
  const db = client || pool;
  const userRes = await db.query('SELECT role FROM users WHERE id = $1 AND deleted_at IS NULL', [studentId]);
  if (userRes.rows.length === 0) return { allowed: false, error: 'User not found' };
  // Renters may self-book aircraft without a solo endorsement
  if (userRes.rows[0].role === 'renter') return { allowed: true };

  const result = await db.query(
    `SELECT id, expiration_date FROM endorsements
     WHERE student_id = $1
       AND template_key IN ('solo_flight_90day', 'pre_solo_flight')
       AND (expiration_date IS NULL OR expiration_date >= CURRENT_DATE)
     ORDER BY endorsement_date DESC LIMIT 1`,
    [studentId]
  );
  if (result.rows.length === 0) {
    return { allowed: false, error: 'Student does not have a valid solo endorsement on file' };
  }
  return { allowed: true };
}

async function runPreflightChecks(client, { aircraft_id, student_id, instructor_id, start_time, end_time, booking_type, local_start, local_end }, userRole) {
  const policy = await getPolicySettings();
  const start = new Date(start_time);
  const end = new Date(end_time);
  const isAdmin = ['owner', 'admin'].includes(userRole);
  const { errors, warnings } = validateBookingTimes({
    start, end, local_start, local_end, policy, userRole, isAdmin,
  });

  if (aircraft_id) {
    const ac = await (client || pool).query(
      'SELECT tail_number, status, current_hobbs, next_100hr_due FROM aircraft WHERE id = $1',
      [aircraft_id]
    );
    if (ac.rows.length === 0) errors.push('Aircraft not found');
    else {
      const a = ac.rows[0];
      if (a.status !== 'available') errors.push(`Aircraft is ${a.status}`);
      const hobbs = parseFloat(a.current_hobbs || 0);
      const due = parseFloat(a.next_100hr_due || 0);
      if (due > 0 && due - hobbs <= 10) {
        warnings.push(`${a.tail_number} 100-hour inspection due in ${(due - hobbs).toFixed(1)} Hobbs hrs`);
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
      const exp = new Date(med.rows[0].medical_certificate_expiry);
      if (exp < new Date()) errors.push('Student medical certificate is expired');
      else if (exp.getTime() - Date.now() < 30 * 86400000) {
        warnings.push('Student medical certificate expires within 30 days');
      }
    }
  }

  return { ok: errors.length === 0, errors, warnings, policy };
}

module.exports = {
  DEFAULTS,
  getPolicySettings,
  validateBookingTimes,
  validateCancellation,
  checkGroundingSquawk,
  checkStudentSoloEligible,
  runPreflightChecks,
};
