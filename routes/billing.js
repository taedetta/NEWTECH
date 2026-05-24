'use strict';

const express = require('express');
const pool = require('../db/index');
const { authenticateToken } = require('../middleware/auth');
const { listHoursAuditFlags } = require('../lib/hours-audit');

const router = express.Router();

const BILLABLE_FLIGHT_SQL = `
  FROM bookings b
  INNER JOIN users u ON u.id = b.student_id AND u.deleted_at IS NULL
  LEFT JOIN aircraft a ON a.id = b.aircraft_id
  LEFT JOIN users inst ON inst.id = b.instructor_id
  LEFT JOIN flight_logs fl ON fl.booking_id = b.id
  WHERE b.status = 'completed'
    AND COALESCE(b.billing_voided, FALSE) = FALSE
    AND b.student_id IS NOT NULL
`;

function hobbsExpr() {
  return 'COALESCE(fl.hobbs_delta, CASE WHEN b.hobbs_end IS NOT NULL AND b.hobbs_start IS NOT NULL THEN b.hobbs_end - b.hobbs_start END)';
}

function dualHrsExpr() {
  return `COALESCE(fl.dual_instruction_hours, CASE WHEN b.booking_type = 'dual' THEN ${hobbsExpr()} END)`;
}

function acChargeExpr() {
  return `COALESCE(fl.aircraft_charge_amount, ${hobbsExpr()} * COALESCE(a.hourly_rate, 0))`;
}

function instrChargeExpr() {
  return `COALESCE(fl.instruction_charge_amount, ${dualHrsExpr()} * COALESCE(inst.instructor_rate, 0))`;
}

router.get('/summary', authenticateToken, async (req, res) => {
  try {
    if (req.user.role === 'student') return res.status(403).json({ error: 'Access denied' });
    if (req.user.role === 'renter') return res.status(403).json({ error: 'Access denied' });
    let extra = '';
    const params = [];
    if (req.user.role === 'instructor') {
      extra = ' AND b.instructor_id = $1';
      params.push(req.user.id);
    }

    let sql = `
      SELECT u.id, u.name, u.role,
        COUNT(DISTINCT b.id)::int AS flight_count,
        COALESCE(SUM(${hobbsExpr()}), 0) AS total_hours,
        COALESCE(SUM(${acChargeExpr()}), 0) AS total_rental,
        COALESCE(SUM(${instrChargeExpr()}), 0) AS total_instruction
      ${BILLABLE_FLIGHT_SQL}
      ${extra}
      GROUP BY u.id, u.name, u.role
      HAVING COUNT(DISTINCT b.id) > 0
      ORDER BY u.name
    `;
    const result = await pool.query(sql, params);
    res.json(result.rows);
  } catch (err) {
    console.error('Billing summary error:', err);
    res.status(500).json({ error: 'Failed to fetch billing summary' });
  }
});

router.get('/my-activity', authenticateToken, async (req, res) => {
  try {
    if (!['owner', 'admin', 'instructor'].includes(req.user.role)) {
      return res.status(403).json({ error: 'Access denied' });
    }
    const uid = req.user.id;
    const sql = `
      SELECT b.id, b.start_time, b.end_time, b.booking_type,
        COALESCE(fl.hobbs_start, b.hobbs_start) AS hobbs_start,
        COALESCE(fl.hobbs_end, b.hobbs_end) AS hobbs_end,
        ${hobbsExpr()} AS hobbs_hours,
        ${dualHrsExpr()} AS dual_instruction_hours,
        a.tail_number, a.make_model,
        s.name AS student_name, inst.name AS instructor_name,
        ${acChargeExpr()} AS aircraft_charge_amount,
        ${instrChargeExpr()} AS instruction_charge_amount,
        CASE WHEN b.instructor_id = $1 THEN 'instructor' WHEN b.student_id = $1 THEN 'student' END AS my_role
      ${BILLABLE_FLIGHT_SQL}
        AND (b.instructor_id = $1 OR b.student_id = $1)
      ORDER BY b.start_time DESC
    `;
    const result = await pool.query(sql, [uid]);
    res.json(result.rows);
  } catch (err) {
    console.error('Billing my-activity error:', err);
    res.status(500).json({ error: 'Failed to fetch billing activity' });
  }
});

router.get('/audit-flags', authenticateToken, async (req, res) => {
  try {
    if (!['owner', 'admin', 'instructor'].includes(req.user.role)) {
      return res.status(403).json({ error: 'Access denied' });
    }
    const instructorId = req.user.role === 'instructor' ? req.user.id : (req.query.instructor_id ? parseInt(req.query.instructor_id, 10) : null);
    const flags = await listHoursAuditFlags({ instructorId });
    res.json(flags);
  } catch (err) {
    console.error('Billing audit flags error:', err);
    res.status(500).json({ error: 'Failed to load audit flags' });
  }
});

router.get('/:studentId', authenticateToken, async (req, res) => {
  try {
    const studentId = parseInt(req.params.studentId, 10);
    if (req.user.role === 'student' && req.user.id !== studentId) {
      return res.status(403).json({ error: 'Access denied' });
    }
    if (req.user.role === 'renter' && req.user.id !== studentId) {
      return res.status(403).json({ error: 'Access denied' });
    }
    let extra = '';
    const params = [studentId];
    if (req.user.role === 'instructor') {
      extra = ' AND b.instructor_id = $2';
      params.push(req.user.id);
    }

    let sql = `
      SELECT b.id, b.start_time, b.end_time, b.booking_type,
        COALESCE(fl.hobbs_start, b.hobbs_start) AS hobbs_start,
        COALESCE(fl.hobbs_end, b.hobbs_end) AS hobbs_end,
        COALESCE(fl.tach_start, b.tach_start) AS tach_start,
        COALESCE(fl.tach_end, b.tach_end) AS tach_end,
        ${hobbsExpr()} AS hobbs_hours,
        ${dualHrsExpr()} AS dual_instruction_hours,
        b.aircraft_id, a.tail_number, a.make_model,
        a.hourly_rate AS aircraft_rate,
        COALESCE(inst.instructor_rate, 0) AS instructor_rate,
        inst.name AS instructor_name,
        ${acChargeExpr()} AS aircraft_charge_amount,
        ${instrChargeExpr()} AS instruction_charge_amount
      ${BILLABLE_FLIGHT_SQL}
        AND b.student_id = $1
        ${extra}
      ORDER BY b.start_time DESC
    `;
    const result = await pool.query(sql, params);

    const gsParams = [studentId];
    let gsExtra = '';
    if (req.user.role === 'instructor') {
      gsExtra = ' AND gs.instructor_id = $2';
      gsParams.push(req.user.id);
    }
    const gsResult = await pool.query(`
      SELECT gs.id, gs.session_date, gs.ground_hours, gs.instructor_rate,
        gs.instruction_charge_amount, gs.notes, inst.id AS instructor_id, inst.name AS instructor_name
      FROM ground_sessions gs
      JOIN users inst ON inst.id = gs.instructor_id
      WHERE gs.student_id = $1 ${gsExtra}
      ORDER BY gs.session_date DESC
    `, gsParams);

    res.json({ flights: result.rows, groundSessions: gsResult.rows });
  } catch (err) {
    console.error('Billing detail error:', err);
    res.status(500).json({ error: 'Failed to fetch billing data' });
  }
});

router.delete('/flights/:bookingId', authenticateToken, async (req, res) => {
  const client = await pool.connect();
  try {
    if (!['owner', 'admin'].includes(req.user.role)) return res.status(403).json({ error: 'Only owners and admins can void billing entries' });
    const bookingId = parseInt(req.params.bookingId);
    const bookingResult = await client.query('SELECT * FROM bookings WHERE id = $1', [bookingId]);
    if (bookingResult.rows.length === 0) return res.status(404).json({ error: 'Booking not found' });
    const b = bookingResult.rows[0];
    if (b.billing_voided) return res.status(400).json({ error: 'Already voided' });
    await client.query('BEGIN');
    const hobbsDelta = (b.hobbs_end != null && b.hobbs_start != null) ? parseFloat(b.hobbs_end) - parseFloat(b.hobbs_start) : 0;
    const tachDelta = (b.tach_end != null && b.tach_start != null) ? parseFloat(b.tach_end) - parseFloat(b.tach_start) : 0;
    if (hobbsDelta !== 0 || tachDelta !== 0) {
      if (b.student_id) await client.query(
        `UPDATE users SET total_hobbs_hours = total_hobbs_hours - $1, total_tach_hours = total_tach_hours - $2 WHERE id = $3`,
        [hobbsDelta, tachDelta, b.student_id]
      );
      if (b.instructor_id) await client.query(
        `UPDATE users SET total_hobbs_hours = total_hobbs_hours - $1, total_tach_hours = total_tach_hours - $2 WHERE id = $3`,
        [hobbsDelta, tachDelta, b.instructor_id]
      );
      if (b.aircraft_id) await client.query(
        `UPDATE aircraft SET total_hobbs_hours = total_hobbs_hours - $1, total_tach_hours = total_tach_hours - $2 WHERE id = $3`,
        [hobbsDelta, tachDelta, b.aircraft_id]
      );
    }
    await client.query(`UPDATE bookings SET billing_voided = TRUE, updated_at = NOW() WHERE id = $1`, [bookingId]);
    await client.query('COMMIT');
    res.json({ ok: true });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Billing void error:', err);
    res.status(500).json({ error: 'Failed to void billing entry' });
  } finally {
    client.release();
  }
});

router.delete('/ground/:gsId', authenticateToken, async (req, res) => {
  try {
    if (!['owner', 'admin'].includes(req.user.role)) return res.status(403).json({ error: 'Only owners and admins can delete ground sessions' });
    const gsId = parseInt(req.params.gsId);
    const result = await pool.query(`DELETE FROM ground_sessions WHERE id = $1 RETURNING id`, [gsId]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Ground session not found' });
    res.json({ ok: true });
  } catch (err) {
    console.error('Ground session delete error:', err);
    res.status(500).json({ error: 'Failed to delete ground session' });
  }
});

router.put('/flights/:bookingId', authenticateToken, async (req, res) => {
  try {
    if (!['owner', 'admin'].includes(req.user.role)) return res.status(403).json({ error: 'Only owners and admins can edit billing entries' });
    const bookingId = parseInt(req.params.bookingId);
    const { aircraft_charge_amount, instruction_charge_amount, dual_instruction_hours, flight_date } = req.body;
    const updates = [];
    const vals = [];
    let idx = 1;
    if (aircraft_charge_amount !== undefined) { updates.push(`aircraft_charge_amount = $${idx++}`); vals.push(aircraft_charge_amount); }
    if (instruction_charge_amount !== undefined) { updates.push(`instruction_charge_amount = $${idx++}`); vals.push(instruction_charge_amount); }
    if (dual_instruction_hours !== undefined) { updates.push(`dual_instruction_hours = $${idx++}`); vals.push(dual_instruction_hours); }
    if (flight_date !== undefined) { updates.push(`flight_date = $${idx++}`); vals.push(flight_date); }
    if (updates.length === 0) return res.status(400).json({ error: 'No fields to update' });
    vals.push(bookingId);
    const flResult = await pool.query(
      `UPDATE flight_logs SET ${updates.join(', ')} WHERE booking_id = $${idx} RETURNING id`,
      vals
    );
    if (flResult.rows.length === 0) return res.status(404).json({ error: 'No flight log record found for this booking' });
    res.json({ ok: true });
  } catch (err) {
    console.error('Billing flight update error:', err);
    res.status(500).json({ error: 'Failed to update billing entry' });
  }
});

module.exports = router;
