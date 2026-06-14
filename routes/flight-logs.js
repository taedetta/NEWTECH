'use strict';
// Flight logs route — owns GET (query), PUT (edit), DELETE (remove) for individual flight log entries.
// Does NOT own booking creation or aircraft hours — those live in bookings-completion.js.

const express = require('express');
const pool = require('../db/index');
const { authenticateToken } = require('../middleware/auth');
const { syncFlightRecord } = require('../lib/sync-flight-record');

const router = express.Router();

// GET /api/flight-logs — query flight log entries with optional filters
// Admin/owner: see all. Instructor: see own sessions. Student/renter: see own sessions.
router.get('/', authenticateToken, async (req, res) => {
  try {
    const { aircraft_id, person_id, start_date, end_date } = req.query;
    const { role, id: userId } = req.user;
    const params = [];
    let idx = 1;
    let where = [];

    // Scope by role — non-admin users only see their own logs
    if (!['owner', 'admin'].includes(role)) {
      where.push(`(fl.student_id = $${idx} OR fl.instructor_id = $${idx})`);
      params.push(userId);
      idx++;
    }

    if (aircraft_id) { where.push(`fl.aircraft_id = $${idx++}`); params.push(parseInt(aircraft_id)); }
    if (person_id)   { where.push(`(fl.student_id = $${idx} OR fl.instructor_id = $${idx})`); params.push(parseInt(person_id)); idx++; }
    if (start_date)  { where.push(`fl.flight_date >= $${idx++}`); params.push(start_date); }
    if (end_date)    { where.push(`fl.flight_date <= $${idx++}`); params.push(end_date); }

    const whereClause = where.length > 0 ? 'WHERE ' + where.join(' AND ') : '';
    const result = await pool.query(`
      SELECT fl.*,
        a.tail_number, a.make_model,
        s.name AS student_name,
        i.name AS instructor_name
      FROM flight_logs fl
      LEFT JOIN aircraft a ON a.id = fl.aircraft_id
      LEFT JOIN users s ON s.id = fl.student_id
      LEFT JOIN users i ON i.id = fl.instructor_id
      ${whereClause}
      ORDER BY fl.flight_date DESC, fl.id DESC
      LIMIT 500
    `, params);
    res.json(result.rows);
  } catch (err) {
    console.error('Flight log fetch error:', err);
    res.status(500).json({ error: 'Failed to fetch flight logs' });
  }
});

// PUT /api/flight-logs/:id — admin/owner: update a flight log entry
router.put('/:id', authenticateToken, async (req, res) => {
  const client = await pool.connect();
  try {
    if (!['owner', 'admin'].includes(req.user.role)) return res.status(403).json({ error: 'Only owners and admins can edit flight log entries' });
    const logId = parseInt(req.params.id, 10);
    const existing = await client.query('SELECT * FROM flight_logs WHERE id = $1', [logId]);
    if (existing.rows.length === 0) return res.status(404).json({ error: 'Flight log entry not found' });
    if (!existing.rows[0].booking_id) return res.status(400).json({ error: 'Flight log is not linked to a booking' });

    const { flight_date, hobbs_start, hobbs_end, tach_start, tach_end, dual_instruction_hours, aircraft_charge_amount, instruction_charge_amount, notes, lesson_type } = req.body;

    await client.query('BEGIN');
    const synced = await syncFlightRecord(client, existing.rows[0].booking_id, {
      flight_date,
      hobbs_start,
      hobbs_end,
      tach_start,
      tach_end,
      dual_instruction_hours,
      aircraft_charge_amount,
      instruction_charge_amount,
      lesson_type,
      submitted_by: req.user.id,
    });
    if (notes !== undefined) {
      await client.query('UPDATE flight_logs SET notes = $1, updated_at = NOW() WHERE id = $2', [notes || null, logId]);
    }
    await client.query('COMMIT');
    res.json(synced.flightLog || synced.booking);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Flight log update error:', err);
    res.status(500).json({ error: err.message || 'Failed to update flight log entry' });
  } finally {
    client.release();
  }
});

// DELETE /api/flight-logs/:id — admin/owner: delete a single flight log entry
router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    if (!['owner', 'admin'].includes(req.user.role)) return res.status(403).json({ error: 'Only owners and admins can delete flight log entries' });
    const logId = parseInt(req.params.id);
    const result = await pool.query('DELETE FROM flight_logs WHERE id = $1 RETURNING id', [logId]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Flight log entry not found' });
    res.json({ ok: true });
  } catch (err) {
    console.error('Flight log delete error:', err);
    res.status(500).json({ error: 'Failed to delete flight log entry' });
  }
});

module.exports = router;
