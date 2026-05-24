'use strict';

// routes/discrepancies.js
// Owns: GET/POST endpoints for flight Hobbs discrepancies (list, count badge, resolve).
// Does NOT own: flight_logs, bookings completion, billing — those live in their own route files.

const express = require('express');
const { authenticateToken, requireRole } = require('../middleware/auth');
const {
  listDiscrepancies,
  countPendingDiscrepancies,
  resolveDiscrepancy,
  hasUnresolvedDiscrepancy,
  deleteDiscrepancy,
} = require('../db/discrepancies');

const router = express.Router();

// GET /api/discrepancies — list all discrepancies (owner/admin only)
router.get('/', authenticateToken, requireRole(['owner', 'admin']), async (req, res) => {
  try {
    const { status } = req.query; // 'pending' | 'resolved' | 'all' (default all)
    const rows = await listDiscrepancies({ status: status || 'all' });
    res.json(rows);
  } catch (err) {
    console.error('[discrepancies] list error:', err.message);
    res.status(500).json({ error: 'Failed to load discrepancies' });
  }
});

// GET /api/discrepancies/count — count pending (for nav badge)
router.get('/count', authenticateToken, requireRole(['owner', 'admin']), async (req, res) => {
  try {
    const count = await countPendingDiscrepancies();
    res.json({ count });
  } catch (err) {
    console.error('[discrepancies] count error:', err.message);
    res.status(500).json({ error: 'Failed to count discrepancies' });
  }
});

// GET /api/discrepancies/check/:bookingId — check if booking has an unresolved discrepancy
router.get('/check/:bookingId', authenticateToken, async (req, res) => {
  try {
    const blocked = await hasUnresolvedDiscrepancy(parseInt(req.params.bookingId));
    res.json({ blocked });
  } catch (err) {
    console.error('[discrepancies] check error:', err.message);
    res.status(500).json({ error: 'Failed to check discrepancy status' });
  }
});

// POST /api/discrepancies/:id/resolve — owner/admin resolves a discrepancy
router.post('/:id/resolve', authenticateToken, requireRole(['owner', 'admin']), async (req, res) => {
  try {
    const { resolution_reading, resolution_note } = req.body;
    if (!resolution_reading || !['student', 'instructor'].includes(resolution_reading)) {
      return res.status(400).json({ error: 'resolution_reading must be "student" or "instructor"' });
    }
    const updated = await resolveDiscrepancy(
      parseInt(req.params.id),
      req.user.id,
      resolution_reading,
      resolution_note
    );
    res.json(updated);
  } catch (err) {
    if (err.statusCode === 404) return res.status(404).json({ error: 'Discrepancy not found' });
    console.error('[discrepancies] resolve error:', err.message);
    res.status(500).json({ error: 'Failed to resolve discrepancy' });
  }
});

// DELETE /api/discrepancies/:id — delete a discrepancy record (admin/owner only)
router.delete('/:id', authenticateToken, requireRole(['owner', 'admin']), async (req, res) => {
  try {
    await deleteDiscrepancy(parseInt(req.params.id));
    res.json({ ok: true });
  } catch (err) {
    if (err.statusCode === 404) return res.status(404).json({ error: 'Discrepancy not found' });
    console.error('[discrepancies] delete error:', err.message);
    res.status(500).json({ error: 'Failed to delete discrepancy' });
  }
});

module.exports = router;
