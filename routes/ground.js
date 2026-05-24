'use strict';

const express = require('express');
const pool = require('../db/index');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

router.post('/', authenticateToken, async (req, res) => {
  try {
    const { role, id: userId } = req.user;
    if (role === 'student') return res.status(403).json({ error: 'Students cannot submit ground sessions' });
    const { student_id, session_date, ground_hours, notes } = req.body;
    if (!student_id) return res.status(400).json({ error: 'student_id is required' });
    if (!ground_hours || parseFloat(ground_hours) <= 0) return res.status(400).json({ error: 'ground_hours must be greater than 0' });
    let instructorId = userId;
    if ((role === 'owner' || role === 'admin') && req.body.instructor_id) instructorId = parseInt(req.body.instructor_id);
    const instructorCheck = await pool.query('SELECT id, is_instructor, instructor_rate FROM users WHERE id = $1 AND deleted_at IS NULL', [instructorId]);
    if (instructorCheck.rows.length === 0) return res.status(404).json({ error: 'Instructor not found' });
    if (!instructorCheck.rows[0].is_instructor) return res.status(400).json({ error: 'User is not an instructor' });
    const studentCheck = await pool.query("SELECT id FROM users WHERE id = $1 AND role = 'student' AND deleted_at IS NULL", [parseInt(student_id)]);
    if (studentCheck.rows.length === 0) return res.status(404).json({ error: 'Student not found' });
    const instrRate = instructorCheck.rows[0].instructor_rate;
    const hrs = parseFloat(ground_hours);
    const chargeAmount = instrRate != null ? Math.round(hrs * parseFloat(instrRate) * 100) / 100 : 0;
    const result = await pool.query(`
      INSERT INTO ground_sessions (student_id, instructor_id, session_date, ground_hours, instructor_rate, instruction_charge_amount, notes)
      VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [parseInt(student_id), instructorId, session_date || new Date().toISOString().slice(0, 10), hrs,
       instrRate != null ? parseFloat(instrRate) : null, chargeAmount, notes || null]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Ground session create error:', err);
    res.status(500).json({ error: 'Failed to create ground session' });
  }
});

router.get('/', authenticateToken, async (req, res) => {
  try {
    const { role, id: userId } = req.user;
    const { student_id, instructor_id, start_date, end_date } = req.query;
    const conditions = [];
    const params = [];
    let pi = 1;
    if (role === 'student') { conditions.push(`gs.student_id = $${pi++}`); params.push(userId); }
    else {
      if (role === 'instructor') { conditions.push(`gs.instructor_id = $${pi++}`); params.push(userId); }
      else if (instructor_id) { conditions.push(`gs.instructor_id = $${pi++}`); params.push(parseInt(instructor_id)); }
      if (student_id) { conditions.push(`gs.student_id = $${pi++}`); params.push(parseInt(student_id)); }
    }
    if (start_date) { conditions.push(`gs.session_date >= $${pi++}`); params.push(start_date); }
    if (end_date) { conditions.push(`gs.session_date <= $${pi++}`); params.push(end_date); }
    const where = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';
    const result = await pool.query(`
      SELECT gs.id, gs.session_date, gs.ground_hours, gs.instructor_rate, gs.instruction_charge_amount, gs.notes, gs.created_at,
             gs.student_id, gs.instructor_id, s.name as student_name, inst.name as instructor_name
      FROM ground_sessions gs
      JOIN users s ON s.id = gs.student_id
      JOIN users inst ON inst.id = gs.instructor_id
      ${where}
      ORDER BY gs.session_date DESC, gs.created_at DESC
    `, params);
    res.json(result.rows);
  } catch (err) {
    console.error('Ground sessions list error:', err);
    res.status(500).json({ error: 'Failed to fetch ground sessions' });
  }
});

router.delete('/clear', authenticateToken, async (req, res) => {
  try {
    const { role } = req.user;
    if (!['owner', 'admin'].includes(role)) return res.status(403).json({ error: 'Only admins and owners can clear ground sessions' });
    const { instructor_id } = req.query;
    if (!instructor_id) return res.status(400).json({ error: 'instructor_id is required' });
    const result = await pool.query('DELETE FROM ground_sessions WHERE instructor_id = $1 RETURNING id', [parseInt(instructor_id)]);
    res.json({ ok: true, deleted: result.rowCount });
  } catch (err) {
    console.error('Ground sessions clear error:', err);
    res.status(500).json({ error: 'Failed to clear ground sessions' });
  }
});

router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    const { role, id: userId } = req.user;
    if (role === 'student') return res.status(403).json({ error: 'Access denied' });
    const sessionId = parseInt(req.params.id);
    const existing = await pool.query('SELECT instructor_id FROM ground_sessions WHERE id = $1', [sessionId]);
    if (existing.rows.length === 0) return res.status(404).json({ error: 'Ground session not found' });
    if (role === 'instructor' && existing.rows[0].instructor_id !== userId) return res.status(403).json({ error: "Cannot delete another instructor's session" });
    await pool.query('DELETE FROM ground_sessions WHERE id = $1', [sessionId]);
    res.json({ ok: true });
  } catch (err) {
    console.error('Ground session delete error:', err);
    res.status(500).json({ error: 'Failed to delete ground session' });
  }
});

router.put('/:id', authenticateToken, async (req, res) => {
  try {
    const { role } = req.user;
    if (!['owner', 'admin'].includes(role)) return res.status(403).json({ error: 'Only admins and owners can edit ground sessions' });
    const sessionId = parseInt(req.params.id);
    const existing = await pool.query('SELECT * FROM ground_sessions WHERE id = $1', [sessionId]);
    if (existing.rows.length === 0) return res.status(404).json({ error: 'Ground session not found' });
    const { session_date, ground_hours, notes } = req.body;
    if (!ground_hours || parseFloat(ground_hours) <= 0) return res.status(400).json({ error: 'ground_hours must be greater than 0' });
    const hrs = parseFloat(ground_hours);
    const instrRate = existing.rows[0].instructor_rate;
    const chargeAmount = instrRate != null ? Math.round(hrs * parseFloat(instrRate) * 100) / 100 : 0;
    const result = await pool.query(`
      UPDATE ground_sessions SET session_date = COALESCE($1, session_date), ground_hours = $2,
        instruction_charge_amount = $3, notes = $4, updated_at = NOW()
      WHERE id = $5 RETURNING *`,
      [session_date || null, hrs, chargeAmount, notes !== undefined ? (notes || null) : existing.rows[0].notes, sessionId]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Ground session update error:', err);
    res.status(500).json({ error: 'Failed to update ground session' });
  }
});

module.exports = router;