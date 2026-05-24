'use strict';

const express = require('express');
const pool = require('../db/index');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

router.get('/summary', authenticateToken, async (req, res) => {
  try {
    if (req.user.role === 'student') return res.status(403).json({ error: 'Access denied' });
    let whereExtra = '';
    const params = [];
    if (req.user.role === 'instructor') { whereExtra = ' AND b.instructor_id = $1'; params.push(req.user.id); }
    const result = await pool.query(`
      SELECT u.id, u.name,
        COUNT(b.id) as flight_count,
        COALESCE(SUM(b.hobbs_end - b.hobbs_start), 0) as total_hours,
        COALESCE(SUM(
          COALESCE(fl.aircraft_charge_amount, (b.hobbs_end - b.hobbs_start) * COALESCE(a.hourly_rate, 0))
        ), 0) as total_rental,
        COALESCE(SUM(
          COALESCE(fl.instruction_charge_amount,
            CASE WHEN b.booking_type = 'dual'
              THEN (b.hobbs_end - b.hobbs_start) * COALESCE(inst.instructor_rate, 0)
              ELSE 0
            END
          )
        ), 0) as total_instruction
      FROM users u
      JOIN bookings b ON b.student_id = u.id AND b.status = 'completed' AND COALESCE(b.billing_voided, FALSE) = FALSE
      LEFT JOIN aircraft a ON a.id = b.aircraft_id
      LEFT JOIN users inst ON inst.id = b.instructor_id
      LEFT JOIN flight_logs fl ON fl.booking_id = b.id
      WHERE u.role = 'student' AND u.deleted_at IS NULL
        AND b.hobbs_start IS NOT NULL AND b.hobbs_end IS NOT NULL
        ${whereExtra}
      GROUP BY u.id, u.name
      ORDER BY u.name
    `, params);
    res.json(result.rows);
  } catch (err) {
    console.error('Billing summary error:', err);
    res.status(500).json({ error: 'Failed to fetch billing summary' });
  }
});

router.get('/:studentId', authenticateToken, async (req, res) => {
  try {
    const { studentId } = req.params;
    if (req.user.role === 'student' && req.user.id !== parseInt(studentId)) {
      return res.status(403).json({ error: 'Access denied' });
    }
    let extraWhere = '';
    const params = [studentId];
    if (req.user.role === 'instructor') { extraWhere = ' AND b.instructor_id = $2'; params.push(req.user.id); }
    const result = await pool.query(`
      SELECT b.id, b.start_time, b.end_time, b.booking_type,
        b.hobbs_start, b.hobbs_end, b.tach_start, b.tach_end,
        b.aircraft_id, a.tail_number, a.make_model,
        a.hourly_rate as aircraft_rate,
        COALESCE(inst.instructor_rate, 0) as instructor_rate,
        inst.name as instructor_name,
        fl.dual_instruction_hours,
        COALESCE(fl.aircraft_charge_amount, (b.hobbs_end - b.hobbs_start) * COALESCE(a.hourly_rate, 0)) as aircraft_charge_amount,
        COALESCE(fl.instruction_charge_amount,
          CASE WHEN b.booking_type = 'dual'
            THEN (b.hobbs_end - b.hobbs_start) * COALESCE(inst.instructor_rate, 0)
            ELSE 0
          END
        ) as instruction_charge_amount
      FROM bookings b
      LEFT JOIN aircraft a ON a.id = b.aircraft_id
      LEFT JOIN users inst ON inst.id = b.instructor_id
      LEFT JOIN flight_logs fl ON fl.booking_id = b.id
      WHERE b.student_id = $1 AND b.status = 'completed'
        AND COALESCE(b.billing_voided, FALSE) = FALSE
        AND (b.hobbs_start IS NOT NULL AND b.hobbs_end IS NOT NULL
          OR (b.booking_type IN ('dual', 'ground') AND b.instructor_id IS NOT NULL))
        ${extraWhere}
      ORDER BY b.start_time DESC
    `, params);
    let gsParams = [studentId];
    let gsExtraWhere = '';
    if (req.user.role === 'instructor') { gsExtraWhere = ' AND gs.instructor_id = $2'; gsParams.push(req.user.id); }
    const gsResult = await pool.query(`
      SELECT gs.id, gs.session_date, gs.ground_hours, gs.instructor_rate,
        gs.instruction_charge_amount, gs.notes, inst.id as instructor_id, inst.name as instructor_name
      FROM ground_sessions gs
      JOIN users inst ON inst.id = gs.instructor_id
      WHERE gs.student_id = $1 ${gsExtraWhere}
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
    const tachDelta  = (b.tach_end  != null && b.tach_start  != null) ? parseFloat(b.tach_end)  - parseFloat(b.tach_start)  : 0;
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