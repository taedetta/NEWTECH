'use strict';

const express = require('express');
const pool = require('../db/index');
const { authenticateToken, requirePermission } = require('../middleware/auth');
const { sendEmail } = require('../email-templates');

const router = express.Router();

router.get('/squawks', authenticateToken, async (req, res) => {
  try {
    const { aircraft_id, status } = req.query;
    let query = `
      SELECT sq.*, a.tail_number, a.make_model,
        u.name as reporter_name, rv.name as reviewer_name
      FROM squawks sq
      JOIN aircraft a ON sq.aircraft_id = a.id
      JOIN users u ON sq.reported_by = u.id
      LEFT JOIN users rv ON sq.reviewed_by = rv.id
      WHERE 1=1
    `;
    const params = [];
    let idx = 1;
    if (aircraft_id) { query += ` AND sq.aircraft_id = $${idx++}`; params.push(aircraft_id); }
    if (status) { query += ` AND sq.status = $${idx++}`; params.push(status); }
    query += ' ORDER BY sq.reported_at DESC';
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    console.error('Squawks list error:', err);
    res.status(500).json({ error: 'Failed to fetch squawks' });
  }
});

router.post('/squawks', authenticateToken, async (req, res) => {
  try {
    const { aircraft_id, description, severity, expected_downtime } = req.body;
    if (!aircraft_id || !description) return res.status(400).json({ error: 'Aircraft and description are required' });
    const validSeverity = ['minor', 'major', 'grounding'].includes(severity) ? severity : 'minor';
    const validDowntimes = ['1 day', '2 days', '3 days', '4 days', '5 days', '1 week', '2 weeks', 'Unknown/TBD'];
    const downtimeValue = (expected_downtime && validDowntimes.includes(expected_downtime)) ? expected_downtime : null;
    const result = await pool.query(
      `INSERT INTO squawks (aircraft_id, reported_by, description, severity, expected_downtime) VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [aircraft_id, req.user.id, description, validSeverity, downtimeValue]
    );
    const squawk = result.rows[0];
    if (validSeverity === 'grounding') {
      try {
        const [acResult, usersResult] = await Promise.all([
          pool.query('SELECT tail_number, make_model FROM aircraft WHERE id = $1', [aircraft_id]),
          pool.query("SELECT email, name FROM users WHERE role IN ('admin', 'owner', 'instructor') AND deleted_at IS NULL AND email IS NOT NULL")
        ]);
        const ac = acResult.rows[0];
        const { groundingSquawkEmail } = require('../email-templates');
        const tpl = groundingSquawkEmail({
          tailNumber: ac ? ac.tail_number : `Aircraft #${aircraft_id}`,
          makeModel: ac ? ac.make_model : '',
          description, reporterName: req.user.name || req.user.email || 'Unknown',
          reportedAt: squawk.reported_at, expectedDowntime: downtimeValue,
        });
        for (const user of usersResult.rows) {
          sendEmail(user.email, tpl.subject, tpl.html, tpl.text).catch(() => {});
        }
      } catch (emailErr) { console.error('Grounding squawk email error:', emailErr.message); }
    }
    res.status(201).json(squawk);
  } catch (err) {
    console.error('Squawk create error:', err);
    res.status(500).json({ error: 'Failed to submit squawk' });
  }
});

router.patch('/squawks/:id', authenticateToken, requirePermission('can_manage_aircraft'), async (req, res) => {
  try {
    const { status, resolution_notes } = req.body;
    const validStatuses = ['open', 'reviewed', 'deferred', 'resolved'];
    if (status && !validStatuses.includes(status)) return res.status(400).json({ error: 'Invalid status' });
    const existing = await pool.query('SELECT * FROM squawks WHERE id = $1', [req.params.id]);
    if (existing.rows.length === 0) return res.status(404).json({ error: 'Squawk not found' });
    const result = await pool.query(
      `UPDATE squawks SET status = COALESCE($1, status), resolution_notes = COALESCE($2, resolution_notes),
       reviewed_by = $3, reviewed_at = CASE WHEN $1 IS NOT NULL AND $1 != 'open' THEN NOW() ELSE reviewed_at END,
       updated_at = NOW() WHERE id = $4 RETURNING *`,
      [status || null, resolution_notes || null, req.user.id, req.params.id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Squawk update error:', err);
    res.status(500).json({ error: 'Failed to update squawk' });
  }
});

router.delete('/squawks/:id', authenticateToken, requirePermission('can_manage_aircraft'), async (req, res) => {
  try {
    const result = await pool.query('DELETE FROM squawks WHERE id = $1 RETURNING id', [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Squawk not found' });
    res.json({ ok: true });
  } catch (err) {
    console.error('Squawk delete error:', err);
    res.status(500).json({ error: 'Failed to delete squawk' });
  }
});

// GET /api/hours-audit — global hours audit log across ALL aircraft (owner/admin only)
router.get('/hours-audit', authenticateToken, async (req, res) => {
  try {
    const allowedRoles = ['owner', 'admin'];
    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Access denied: owner/admin role required', role: req.user.role });
    }
    const { aircraft_id, start_date, end_date, user_id } = req.query;
    const conditions = [];
    const params = [];
    let idx = 1;
    if (aircraft_id) { conditions.push(`h.aircraft_id = $${idx++}`); params.push(parseInt(aircraft_id)); }
    if (user_id) { conditions.push(`h.changed_by = $${idx++}`); params.push(parseInt(user_id)); }
    if (start_date) { conditions.push(`h.created_at >= $${idx++}`); params.push(start_date); }
    if (end_date) { conditions.push(`h.created_at <= $${idx++}::date + interval '1 day'`); params.push(end_date); }
    const whereClause = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';
    const result = await pool.query(
      `SELECT h.id, h.aircraft_id, h.field, h.old_value, h.new_value, h.note, h.created_at,
              h.source, h.booking_id, u.name AS changed_by_name, a.tail_number, a.make_model
       FROM aircraft_hours_history h
       LEFT JOIN users u ON h.changed_by = u.id
       JOIN aircraft a ON a.id = h.aircraft_id
       ${whereClause}
       ORDER BY h.created_at DESC LIMIT 500`,
      params
    );
    res.json(result.rows);
  } catch (err) {
    console.error('[hours-audit] Error:', {
      user: req.user?.id,
      role: req.user?.role,
      sqlState: err.code,
      message: err.message
    });
    res.status(500).json({ error: 'Failed to fetch hours audit', detail: err.message, sqlState: err.code });
  }
});

module.exports = router;