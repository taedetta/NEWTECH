'use strict';

// db/discrepancies.js
// Owns: flight_hobbs_readings and flight_discrepancies queries.
// Does NOT own: bookings, flight_logs, users, billing — those stay in their own modules.

const pool = require('./index');
const { sendEmail } = require('../email-templates');
const { formatDate } = require('../lib/school-timezone');

const DISCREPANCY_THRESHOLD = 0.1; // hours — flag if delta exceeds this
const OWNER_EMAIL = 'blankthe97@gmail.com';

async function ensureHobbsUniqueIndex(client) {
  const db = client || pool;
  await db.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS flight_hobbs_readings_booking_role_unique
    ON flight_hobbs_readings(booking_id, role)
  `);
}

function readingDelta(row) {
  if (row.hobbs_delta != null && row.hobbs_delta !== '') return parseFloat(row.hobbs_delta);
  const start = parseFloat(row.hobbs_start);
  const end = parseFloat(row.hobbs_end);
  if (!isNaN(start) && !isNaN(end)) return end - start;
  return NaN;
}

/**
 * Upsert a Hobbs reading for a booking from a given role.
 * After insert, check if both student + instructor have submitted — if so, run comparison.
 * Returns { reading, discrepancy } where discrepancy is null if none detected.
 */
async function recordHobbsReading(bookingId, submittedBy, role, hobbsStart, hobbsEnd) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await ensureHobbsUniqueIndex(client);

    const hobbsDelta = hobbsEnd - hobbsStart;

    // Upsert the reading
    await client.query(`
      INSERT INTO flight_hobbs_readings (booking_id, submitted_by, role, hobbs_start, hobbs_end, hobbs_delta)
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (booking_id, role) DO UPDATE
        SET hobbs_start = EXCLUDED.hobbs_start,
            hobbs_end   = EXCLUDED.hobbs_end,
            hobbs_delta = EXCLUDED.hobbs_delta,
            entered_at  = NOW()
    `, [bookingId, submittedBy, role, hobbsStart, hobbsEnd, hobbsDelta]);

    // Fetch both student and instructor readings for this booking
    const readingsResult = await client.query(`
      SELECT role, hobbs_start, hobbs_end, hobbs_delta
      FROM flight_hobbs_readings
      WHERE booking_id = $1 AND role IN ('student', 'instructor')
    `, [bookingId]);

    const byRole = {};
    for (const r of readingsResult.rows) byRole[r.role] = r;

    let discrepancy = null;

    // Both readings present — compare
    if (byRole.student && byRole.instructor) {
      const sDelta = readingDelta(byRole.student);
      const iDelta = readingDelta(byRole.instructor);
      if (isNaN(sDelta) || isNaN(iDelta)) {
        await client.query('COMMIT');
        return { discrepancy: null };
      }
      const diff = Math.abs(sDelta - iDelta);

      if (diff > DISCREPANCY_THRESHOLD) {
        // Upsert discrepancy record — ON CONFLICT updates it if readings were corrected
        const discResult = await client.query(`
          INSERT INTO flight_discrepancies
            (booking_id,
             student_hobbs_start, student_hobbs_end, student_hobbs_delta,
             instructor_hobbs_start, instructor_hobbs_end, instructor_hobbs_delta,
             delta_hours, status, email_sent)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'pending',false)
          ON CONFLICT (booking_id) DO UPDATE
            SET student_hobbs_start    = EXCLUDED.student_hobbs_start,
                student_hobbs_end      = EXCLUDED.student_hobbs_end,
                student_hobbs_delta    = EXCLUDED.student_hobbs_delta,
                instructor_hobbs_start = EXCLUDED.instructor_hobbs_start,
                instructor_hobbs_end   = EXCLUDED.instructor_hobbs_end,
                instructor_hobbs_delta = EXCLUDED.instructor_hobbs_delta,
                delta_hours            = EXCLUDED.delta_hours,
                status                 = CASE WHEN flight_discrepancies.status = 'resolved' THEN 'resolved' ELSE 'pending' END,
                flagged_at             = CASE WHEN flight_discrepancies.status = 'pending' THEN flight_discrepancies.flagged_at ELSE NOW() END
          RETURNING *, (xmax = 0) AS inserted
        `, [
          bookingId,
          byRole.student.hobbs_start, byRole.student.hobbs_end, sDelta,
          byRole.instructor.hobbs_start, byRole.instructor.hobbs_end, iDelta,
          diff.toFixed(2),
        ]);

        discrepancy = discResult.rows[0];

        // Send email notification only once (on new insert, not update)
        if (discrepancy.inserted && !discrepancy.email_sent) {
          await client.query('UPDATE flight_discrepancies SET email_sent = true WHERE id = $1', [discrepancy.id]);
          // Fire-and-forget email after commit
          discrepancy._sendEmail = true;
        }
      } else {
        // Readings now agree — clear any stale pending discrepancy for this booking
        await client.query(
          `DELETE FROM flight_discrepancies WHERE booking_id = $1 AND status = 'pending'`,
          [bookingId]
        );
      }
    }

    await client.query('COMMIT');

    // Send notification email outside transaction
    if (discrepancy && discrepancy._sendEmail) {
      const bookingInfo = await pool.query(`
        SELECT b.id, b.start_time, s.name AS student_name, i.name AS instructor_name, a.tail_number
        FROM bookings b
        LEFT JOIN users s ON s.id = b.student_id
        LEFT JOIN users i ON i.id = b.instructor_id
        LEFT JOIN aircraft a ON a.id = b.aircraft_id
        WHERE b.id = $1
      `, [bookingId]);
      const bk = bookingInfo.rows[0] || {};
      sendDiscrepancyEmail(bk, discrepancy).catch(e => console.error('[discrepancies] email error:', e.message));
    }

    return { discrepancy };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Remove pending discrepancies where student and instructor Hobbs readings now agree.
 */
async function purgeStaleDiscrepancies() {
  await pool.query(`
    DELETE FROM flight_discrepancies d
    WHERE d.status = 'pending'
      AND EXISTS (
        SELECT 1
        FROM flight_hobbs_readings s
        JOIN flight_hobbs_readings i ON i.booking_id = s.booking_id
        WHERE s.booking_id = d.booking_id
          AND s.role = 'student'
          AND i.role = 'instructor'
          AND ABS(COALESCE(s.hobbs_delta, s.hobbs_end - s.hobbs_start)
                - COALESCE(i.hobbs_delta, i.hobbs_end - i.hobbs_start)) <= $1
      )
  `, [DISCREPANCY_THRESHOLD]);
}

/**
 * List all discrepancies with booking + user details. Supports filter by status.
 */
async function listDiscrepancies({ status } = {}) {
  await purgeStaleDiscrepancies();
  const conditions = [];
  const params = [];
  if (status && status !== 'all') {
    conditions.push(`d.status = $${params.length + 1}`);
    params.push(status);
  }
  const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
  const result = await pool.query(`
    SELECT
      d.id, d.booking_id, d.status, d.delta_hours, d.flagged_at,
      d.student_hobbs_start, d.student_hobbs_end, d.student_hobbs_delta,
      d.instructor_hobbs_start, d.instructor_hobbs_end, d.instructor_hobbs_delta,
      d.resolved_at, d.resolution_reading, d.resolution_note,
      b.start_time AS flight_date,
      s.name AS student_name,
      i.name AS instructor_name,
      a.tail_number,
      ru.name AS resolved_by_name
    FROM flight_discrepancies d
    JOIN bookings b ON b.id = d.booking_id
    LEFT JOIN users s ON s.id = b.student_id
    LEFT JOIN users i ON i.id = b.instructor_id
    LEFT JOIN aircraft a ON a.id = b.aircraft_id
    LEFT JOIN users ru ON ru.id = d.resolved_by
    ${where}
    ORDER BY d.flagged_at DESC
  `, params);
  return result.rows;
}

/**
 * Count pending (unresolved) discrepancies — used for notification badge.
 */
async function countPendingDiscrepancies() {
  const result = await pool.query(`SELECT COUNT(*) AS count FROM flight_discrepancies WHERE status = 'pending'`);
  return parseInt(result.rows[0].count, 10);
}

/** Instructor hours audit flags formatted for the discrepancies UI */
async function listHoursAuditDiscrepancies({ status } = {}) {
  if (status === 'resolved') return [];
  const result = await pool.query(`
    SELECT ih.id, ih.entry_date AS flight_date, ih.audit_status, ih.audit_message,
           ih.aircraft_hours, ih.instruction_hours, ih.student_name,
           u.name AS instructor_name, a.tail_number,
           ih.created_at
    FROM instructor_hours ih
    JOIN users u ON u.id = ih.instructor_id
    LEFT JOIN aircraft a ON a.id = ih.aircraft_id
    WHERE ih.audit_status IN ('flagged', 'unmatched')
    ORDER BY ih.entry_date DESC, ih.id DESC
  `);
  return result.rows.map((r) => ({
    id: `ih-${r.id}`,
    source: 'hours_audit',
    hours_entry_id: r.id,
    status: 'pending',
    discrepancy_type: r.audit_status === 'flagged' ? 'Hours Mismatch' : 'Unverified Hours',
    flight_date: r.flight_date,
    student_name: r.student_name || '—',
    instructor_name: r.instructor_name || '—',
    tail_number: r.tail_number || '—',
    student_hobbs_delta: r.aircraft_hours != null ? parseFloat(r.aircraft_hours) : null,
    instructor_hobbs_delta: r.instruction_hours != null ? parseFloat(r.instruction_hours) : null,
    delta_hours: null,
    audit_message: r.audit_message,
    flagged_at: r.created_at || r.flight_date,
  }));
}

/**
 * Resolve a discrepancy. resolvedBy = userId, reading = 'student'|'instructor', note = optional string.
 */
async function resolveDiscrepancy(id, resolvedBy, reading, note) {
  const result = await pool.query(`
    UPDATE flight_discrepancies
    SET status = 'resolved', resolved_by = $2, resolved_at = NOW(),
        resolution_reading = $3, resolution_note = $4
    WHERE id = $1
    RETURNING *
  `, [id, resolvedBy, reading, note || null]);
  if (result.rows.length === 0) throw Object.assign(new Error('Not found'), { statusCode: 404 });
  return result.rows[0];
}

/**
 * Delete a discrepancy record (admin/owner only).
 */
async function deleteDiscrepancy(id) {
  const result = await pool.query(
    'DELETE FROM flight_discrepancies WHERE id = $1 RETURNING id',
    [id]
  );
  if (result.rows.length === 0) throw Object.assign(new Error('Not found'), { statusCode: 404 });
  return { ok: true };
}

/**
 * Check if a booking has an unresolved discrepancy (billing gate).
 */
async function hasUnresolvedDiscrepancy(bookingId) {
  const r = await pool.query(`SELECT id FROM flight_discrepancies WHERE booking_id = $1 AND status = 'pending'`, [bookingId]);
  return r.rows.length > 0;
}

// ── Internal email helper ──────────────────────────────────────────────────────

async function sendDiscrepancyEmail(booking, discrepancy) {
  const flightDate = booking.start_time ? formatDate(booking.start_time, { month: 'short', day: 'numeric', year: 'numeric' }) : 'Unknown';
  const subject = `⚠️ Flight Hours Discrepancy Detected — ${booking.tail_number || 'Unknown Aircraft'}`;
  const html = `
    <!DOCTYPE html><html><head><meta charset="UTF-8"></head>
    <body style="margin:0;padding:0;background:#f4f6f9;font-family:Helvetica,Arial,sans-serif;">
      <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6f9;padding:32px 0;">
        <tr><td align="center">
          <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#fff;border-radius:10px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.08);">
            <tr><td style="background:#080E1A;padding:28px 40px;text-align:center;">
              <img src="https://pub-629428d185ca4960a0a73c850d32294b.r2.dev/company_96457/images/6131da51-11d1-4327-8e6f-470c3e242f0b.png" alt="New Tech Aviation" style="height:52px;max-width:220px;object-fit:contain;">
            </td></tr>
            <tr><td style="padding:40px;color:#1a202c;font-size:15px;line-height:1.7;">
              <h2 style="margin:0 0 16px;color:#080E1A;font-size:20px;">⚠️ Flight Hours Discrepancy Detected</h2>
              <p style="margin:0 0 20px;">A discrepancy between student and instructor Hobbs readings was flagged and requires admin review.</p>
              <table style="width:100%;border-collapse:collapse;margin-bottom:24px;font-size:14px;">
                <tr style="background:#f8fafc;"><td style="padding:10px 14px;border:1px solid #e2e8f0;font-weight:600;width:40%;">Flight Date</td><td style="padding:10px 14px;border:1px solid #e2e8f0;">${flightDate}</td></tr>
                <tr><td style="padding:10px 14px;border:1px solid #e2e8f0;font-weight:600;">Student</td><td style="padding:10px 14px;border:1px solid #e2e8f0;">${booking.student_name || 'Unknown'}</td></tr>
                <tr style="background:#f8fafc;"><td style="padding:10px 14px;border:1px solid #e2e8f0;font-weight:600;">Instructor</td><td style="padding:10px 14px;border:1px solid #e2e8f0;">${booking.instructor_name || 'Unknown'}</td></tr>
                <tr><td style="padding:10px 14px;border:1px solid #e2e8f0;font-weight:600;">Aircraft</td><td style="padding:10px 14px;border:1px solid #e2e8f0;">${booking.tail_number || 'Unknown'}</td></tr>
                <tr style="background:#fff3cd;"><td style="padding:10px 14px;border:1px solid #e2e8f0;font-weight:600;">Student Hours</td><td style="padding:10px 14px;border:1px solid #e2e8f0;">${discrepancy.student_hobbs_delta} hrs (${discrepancy.student_hobbs_start}→${discrepancy.student_hobbs_end})</td></tr>
                <tr style="background:#fff3cd;"><td style="padding:10px 14px;border:1px solid #e2e8f0;font-weight:600;">Instructor Hours</td><td style="padding:10px 14px;border:1px solid #e2e8f0;">${discrepancy.instructor_hobbs_delta} hrs (${discrepancy.instructor_hobbs_start}→${discrepancy.instructor_hobbs_end})</td></tr>
                <tr style="background:#fee2e2;"><td style="padding:10px 14px;border:1px solid #e2e8f0;font-weight:700;">Difference</td><td style="padding:10px 14px;border:1px solid #e2e8f0;font-weight:700;color:#dc2626;">${discrepancy.delta_hours} hrs</td></tr>
              </table>
              <p style="margin:0 0 20px;">Please review and resolve this discrepancy in the admin portal before billing is finalized.</p>
              <a href="https://www.newtechaviation.com/app" style="display:inline-block;background:#0EA5E9;color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px;">Review in Admin Portal →</a>
            </td></tr>
            <tr><td style="background:#f8fafc;border-top:1px solid #e2e8f0;padding:24px 40px;text-align:center;">
              <p style="margin:0;font-size:12px;color:#94a3b8;">New Tech Aviation · New Dublin Airport (KPSK) · Dublin, Virginia</p>
            </td></tr>
          </table>
        </td></tr>
      </table>
    </body></html>
  `;
  const text = `Flight Hours Discrepancy — ${booking.tail_number || 'Aircraft'} on ${flightDate}\nStudent: ${booking.student_name} | Instructor: ${booking.instructor_name}\nStudent hours: ${discrepancy.student_hobbs_delta} | Instructor hours: ${discrepancy.instructor_hobbs_delta} | Difference: ${discrepancy.delta_hours} hrs\nReview at https://www.newtechaviation.com/app`;
  await sendEmail(OWNER_EMAIL, subject, html, text);
}

module.exports = {
  recordHobbsReading,
  listDiscrepancies,
  listHoursAuditDiscrepancies,
  countPendingDiscrepancies,
  resolveDiscrepancy,
  hasUnresolvedDiscrepancy,
  deleteDiscrepancy,
};
