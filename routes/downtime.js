'use strict';

// Aircraft downtime windows — blocks bookings on specific dates.
// Does NOT own aircraft status, squawks, or inspection dates.

const express = require('express');
const pool = require('../db/index');
const { authenticateToken, requirePermission } = require('../middleware/auth');

const router = express.Router();

// GET /api/downtime?aircraft_id=123 — list all downtime entries (admin only)
router.get('/', authenticateToken, async (req, res) => {
  try {
    const { aircraft_id } = req.query;
    let query = `
      SELECT d.*,
        a.tail_number, a.make_model,
        u.name as created_by_name
      FROM aircraft_downtime d
      JOIN aircraft a ON d.aircraft_id = a.id
      LEFT JOIN users u ON d.created_by = u.id
    `;
    const params = [];
    if (aircraft_id) {
      query += ' WHERE d.aircraft_id = $1';
      params.push(parseInt(aircraft_id));
    }
    query += ' ORDER BY d.start_date DESC, d.created_at DESC';
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    console.error('Downtime list error:', err);
    res.status(500).json({ error: 'Failed to fetch downtime records' });
  }
});

// GET /api/downtime/check?aircraft_id=123&date=2026-05-25
// Returns whether an aircraft has an active downtime window on the given date
router.get('/check', authenticateToken, async (req, res) => {
  try {
    const { aircraft_id, date } = req.query;
    if (!aircraft_id || !date) {
      return res.status(400).json({ error: 'aircraft_id and date are required' });
    }
    const result = await pool.query(
      `SELECT id, start_date, end_date, reason FROM aircraft_downtime
       WHERE aircraft_id = $1 AND $2::date BETWEEN start_date AND end_date`,
      [parseInt(aircraft_id), date]
    );
    if (result.rows.length > 0) {
      res.json({ unavailable: true, downtime: result.rows[0] });
    } else {
      res.json({ unavailable: false });
    }
  } catch (err) {
    console.error('Downtime check error:', err);
    res.status(500).json({ error: 'Failed to check downtime' });
  }
});

// GET /api/downtime/by-date?date=2026-05-25
// Returns all aircraft with downtime windows covering the given date
router.get('/by-date', authenticateToken, async (req, res) => {
  try {
    const { date } = req.query;
    if (!date) return res.status(400).json({ error: 'date is required' });
    const result = await pool.query(
      `SELECT d.*, a.tail_number, a.make_model
       FROM aircraft_downtime d
       JOIN aircraft a ON d.aircraft_id = a.id
       WHERE $1::date BETWEEN d.start_date AND d.end_date`,
      [date]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Downtime by-date error:', err);
    res.status(500).json({ error: 'Failed to fetch downtime by date' });
  }
});

// POST /api/downtime — create a downtime entry (admin/owner only)
router.post('/', authenticateToken, requirePermission('can_manage_aircraft'), async (req, res) => {
  try {
    const { aircraft_id, start_date, end_date, reason } = req.body;
    if (!aircraft_id || !start_date || !end_date) {
      return res.status(400).json({ error: 'aircraft_id, start_date, and end_date are required' });
    }
    const s = new Date(start_date);
    const e = new Date(end_date);
    if (e < s) return res.status(400).json({ error: 'end_date must be on or after start_date' });

    // Verify aircraft exists
    const ac = await pool.query('SELECT id FROM aircraft WHERE id = $1', [parseInt(aircraft_id)]);
    if (ac.rows.length === 0) return res.status(404).json({ error: 'Aircraft not found' });

    const result = await pool.query(
      `INSERT INTO aircraft_downtime (aircraft_id, start_date, end_date, reason, created_by)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [parseInt(aircraft_id), start_date, end_date, reason || null, req.user.id]
    );

    // Optional nice-to-have: create a squawk entry for scheduled maintenance
    if (reason && req.body.create_squawk) {
      await pool.query(
        `INSERT INTO squawks (aircraft_id, description, severity, status, expected_downtime, reported_by)
         VALUES ($1, $2, 'minor', 'scheduled', $3, $4)`,
        [parseInt(aircraft_id), reason, end_date, req.user.id]
      );
    }

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Downtime create error:', err);
    res.status(500).json({ error: 'Failed to create downtime record' });
  }
});

// DELETE /api/downtime/:id — delete a downtime entry (admin/owner only)
router.delete('/:id', authenticateToken, requirePermission('can_manage_aircraft'), async (req, res) => {
  try {
    const result = await pool.query(
      'DELETE FROM aircraft_downtime WHERE id = $1 RETURNING id',
      [parseInt(req.params.id)]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Downtime record not found' });
    res.json({ ok: true });
  } catch (err) {
    console.error('Downtime delete error:', err);
    res.status(500).json({ error: 'Failed to delete downtime record' });
  }
});

module.exports = router;