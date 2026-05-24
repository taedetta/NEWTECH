'use strict';

const express = require('express');
const pool = require('../db/index');
const { authenticateToken, requireRole, requirePermission } = require('../middleware/auth');
const { addSourceFilter } = require('../db/source-wrapper');

const router = express.Router();

router.get('/', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM aircraft ORDER BY tail_number');
    res.json(result.rows);
  } catch (err) {
    console.error('Aircraft list error:', err);
    res.status(500).json({ error: 'Failed to fetch aircraft' });
  }
});

router.post('/', authenticateToken, requirePermission('can_manage_aircraft'), async (req, res) => {
  try {
    const { tail_number, make_model, type, year, hourly_rate, notes } = req.body;
    if (!tail_number || !make_model) {
      return res.status(400).json({ error: 'Tail number and make/model are required' });
    }
    const result = await pool.query(
      `INSERT INTO aircraft (tail_number, make_model, type, year, hourly_rate, notes)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [tail_number.toUpperCase(), make_model, type || 'single_engine', year, hourly_rate, notes]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Aircraft with this tail number already exists' });
    }
    console.error('Aircraft create error:', err);
    res.status(500).json({ error: 'Failed to create aircraft' });
  }
});

router.put('/:id', authenticateToken, requirePermission('can_manage_aircraft'), async (req, res) => {
  try {
    const { tail_number, make_model, type, year, hourly_rate, status, notes } = req.body;
    const result = await pool.query(
      `UPDATE aircraft SET tail_number = COALESCE($1, tail_number), make_model = COALESCE($2, make_model),
       type = COALESCE($3, type), year = COALESCE($4, year), hourly_rate = COALESCE($5, hourly_rate),
       status = COALESCE($6, status), notes = COALESCE($7, notes), updated_at = NOW()
       WHERE id = $8 RETURNING *`,
      [tail_number?.toUpperCase(), make_model, type, year, hourly_rate, status, notes, req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Aircraft not found' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Aircraft update error:', err);
    res.status(500).json({ error: 'Failed to update aircraft' });
  }
});

// DELETE /api/aircraft/:id — Owner/Admin only. Cancels future bookings, removes related downtime/squawks, then deletes the aircraft.
router.delete('/:id', authenticateToken, requireRole('owner', 'admin'), async (req, res) => {
  const client = await pool.connect();
  try {
    // Source-filtered lookup of the aircraft record (maintains source isolation boundary)
    const { sql: aircraftSql, params: aircraftParams } = addSourceFilter(
      'SELECT id, tail_number FROM aircraft WHERE id = $1',
      [req.params.id]
    );
    const aircraft = await client.query(aircraftSql, aircraftParams);
    if (aircraft.rows.length === 0) {
      return res.status(404).json({ error: 'Aircraft not found' });
    }
    const tailNumber = aircraft.rows[0].tail_number;

    await client.query('BEGIN');

    // Cancel future uncancelled bookings with reason — aircraft_id scoping is sufficient
    const cancelBookingsSql = `UPDATE bookings SET status = 'cancelled', cancellation_reason = $1, updated_at = NOW()
       WHERE aircraft_id = $2 AND end_time > NOW() AND status NOT IN ('cancelled', 'completed')`;
    await client.query(cancelBookingsSql, ['Aircraft removed from fleet', req.params.id]);

    // Count affected bookings for response
    const cancelledBookings = await client.query(
      `SELECT COUNT(*) FROM bookings WHERE aircraft_id = $1 AND end_time > NOW() AND status = 'cancelled' AND cancellation_reason = 'Aircraft removed from fleet'`,
      [req.params.id]
    );

    // Delete related downtime records — aircraft_id scoping is sufficient
    await client.query('DELETE FROM aircraft_downtime WHERE aircraft_id = $1', [req.params.id]);

    // Delete related squawk records — aircraft_id scoping is sufficient
    await client.query('DELETE FROM squawks WHERE aircraft_id = $1', [req.params.id]);

    // Delete the aircraft — source filter maintains isolation boundary
    const { sql: deleteSql, params: deleteParams } = addSourceFilter(
      'DELETE FROM aircraft WHERE id = $1',
      [req.params.id]
    );
    await client.query(deleteSql, deleteParams);

    await client.query('COMMIT');

    res.json({
      ok: true,
      tail_number: tailNumber,
      cancelled_bookings: parseInt(cancelledBookings.rows[0].count) || 0
    });
  } catch (err) {
    console.error('[DELETE aircraft] ROLLBACK due to error:', err.message, '| code:', err.code, '| detail:', err.detail);
    try { await client.query('ROLLBACK'); } catch (e) { /* already rolled back */ }
    res.status(500).json({ error: 'Failed to delete aircraft' });
  } finally {
    client.release();
  }
});

// PATCH /api/aircraft/:id/maintenance
router.patch('/:id/maintenance', authenticateToken, requirePermission('can_manage_aircraft'), async (req, res) => {
  try {
    const { status, reason } = req.body;
    if (!['available', 'maintenance'].includes(status)) {
      return res.status(400).json({ error: 'Status must be "available" or "maintenance"' });
    }
    const result = await pool.query(
      `UPDATE aircraft SET status = $1, maintenance_reason = $2, updated_at = NOW()
       WHERE id = $3 RETURNING *`,
      [status, status === 'maintenance' ? (reason || null) : null, req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Aircraft not found' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Maintenance status error:', err);
    res.status(500).json({ error: 'Failed to update maintenance status' });
  }
});

// PATCH /api/aircraft/:id/hobbs
router.patch('/:id/hobbs', authenticateToken, async (req, res) => {
  if (!['owner', 'instructor', 'admin'].includes(req.user.role)) {
    return res.status(403).json({ error: 'Only instructors and above can update aircraft hours' });
  }
  const { hobbs, tach, note } = req.body;
  if (hobbs == null && tach == null) {
    return res.status(400).json({ error: 'hobbs or tach value is required' });
  }
  const client = await pool.connect();
  try {
    const current = await client.query(
      'SELECT total_hobbs_hours, total_tach_hours FROM aircraft WHERE id = $1',
      [req.params.id]
    );
    if (current.rows.length === 0) return res.status(404).json({ error: 'Aircraft not found' });
    await client.query('BEGIN');
    const sets = [];
    const vals = [];
    let idx = 1;
    if (hobbs != null) {
      const hVal = parseFloat(hobbs);
      sets.push(`total_hobbs_hours = $${idx++}`, `current_hobbs = $${idx++}`);
      vals.push(hVal, hVal);
    }
    if (tach != null) {
      const tVal = parseFloat(tach);
      sets.push(`total_tach_hours = $${idx++}`, `current_tach = $${idx++}`);
      vals.push(tVal, tVal);
    }
    sets.push('updated_at = NOW()');
    vals.push(req.params.id);
    const result = await client.query(
      `UPDATE aircraft SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`,
      vals
    );
    if (hobbs != null) {
      await client.query(
        `INSERT INTO aircraft_hours_history (aircraft_id, changed_by, field, old_value, new_value, note, source)
         VALUES ($1, $2, 'hobbs', $3, $4, $5, 'manual_edit')`,
        [req.params.id, req.user.id, current.rows[0].total_hobbs_hours, parseFloat(hobbs), note || null]
      );
    }
    if (tach != null) {
      await client.query(
        `INSERT INTO aircraft_hours_history (aircraft_id, changed_by, field, old_value, new_value, note, source)
         VALUES ($1, $2, 'tach', $3, $4, $5, 'manual_edit')`,
        [req.params.id, req.user.id, current.rows[0].total_tach_hours, parseFloat(tach), note || null]
      );
    }
    await client.query('COMMIT');
    res.json(result.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Hours update error:', err);
    res.status(500).json({ error: 'Failed to update hours' });
  } finally {
    client.release();
  }
});

// GET /api/aircraft/:id/hours-history
router.get('/:id/hours-history', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT h.id, h.field, h.old_value, h.new_value, h.note, h.created_at,
              h.source, h.booking_id,
              u.name AS changed_by_name
       FROM aircraft_hours_history h
       LEFT JOIN users u ON h.changed_by = u.id
       WHERE h.aircraft_id = $1
       ORDER BY h.created_at DESC
       LIMIT 100`,
      [req.params.id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Hours history error:', err);
    res.status(500).json({ error: 'Failed to fetch hours history' });
  }
});

// PUT /api/aircraft/:id/inspections
router.put('/:id/inspections', authenticateToken, requirePermission('can_manage_aircraft'), async (req, res) => {
  try {
    const { next_100hr_due, next_annual_due } = req.body;
    const result = await pool.query(
      `UPDATE aircraft
       SET next_100hr_due = $1, next_annual_due = $2, updated_at = NOW()
       WHERE id = $3 RETURNING *`,
      [
        next_100hr_due != null ? parseFloat(next_100hr_due) : null,
        next_annual_due || null,
        req.params.id
      ]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Aircraft not found' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Inspections update error:', err);
    res.status(500).json({ error: 'Failed to update inspections' });
  }
});

// GET /api/aircraft/:id/ads
router.get('/:id/ads', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM airworthiness_directives WHERE aircraft_id = $1 ORDER BY created_at DESC',
      [req.params.id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('ADs list error:', err);
    res.status(500).json({ error: 'Failed to fetch ADs' });
  }
});

// POST /api/aircraft/:id/ads
router.post('/:id/ads', authenticateToken, requirePermission('can_manage_aircraft'), async (req, res) => {
  try {
    const { ad_number, description, due_date, due_hobbs } = req.body;
    if (!description) return res.status(400).json({ error: 'Description is required' });
    const result = await pool.query(
      `INSERT INTO airworthiness_directives (aircraft_id, ad_number, description, due_date, due_hobbs)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [req.params.id, ad_number || null, description, due_date || null, due_hobbs ? parseFloat(due_hobbs) : null]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('AD create error:', err);
    res.status(500).json({ error: 'Failed to create AD' });
  }
});

// PATCH /api/aircraft/:id/ads/:adId
router.patch('/:id/ads/:adId', authenticateToken, requirePermission('can_manage_aircraft'), async (req, res) => {
  try {
    const { status, description, due_date, due_hobbs, ad_number } = req.body;
    const result = await pool.query(
      `UPDATE airworthiness_directives
       SET status = COALESCE($1, status),
           description = COALESCE($2, description),
           due_date = COALESCE($3, due_date),
           due_hobbs = COALESCE($4, due_hobbs),
           ad_number = COALESCE($5, ad_number),
           updated_at = NOW()
       WHERE id = $6 AND aircraft_id = $7 RETURNING *`,
      [status || null, description || null, due_date || null, due_hobbs ? parseFloat(due_hobbs) : null, ad_number || null, req.params.adId, req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'AD not found' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('AD update error:', err);
    res.status(500).json({ error: 'Failed to update AD' });
  }
});

// DELETE /api/aircraft/:id/ads/:adId
router.delete('/:id/ads/:adId', authenticateToken, requirePermission('can_manage_aircraft'), async (req, res) => {
  try {
    const result = await pool.query(
      'DELETE FROM airworthiness_directives WHERE id = $1 AND aircraft_id = $2 RETURNING id',
      [req.params.adId, req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'AD not found' });
    res.json({ ok: true });
  } catch (err) {
    console.error('AD delete error:', err);
    res.status(500).json({ error: 'Failed to delete AD' });
  }
});

module.exports = router;