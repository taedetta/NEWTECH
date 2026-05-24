/**
 * routes/system-health.js — Admin system health and data integrity endpoint.
 * Owns: GET /api/admin/system-health
 * Does NOT own: health check rendering, non-admin routes.
 */

const express = require('express');
const router = express.Router();
const pool = require('../db/index');
const { authenticateToken, requireRole } = require('../middleware/auth');

// GET /api/admin/system-health — returns data counts and last booking timestamp
// Protected by admin/owner auth
router.get('/', authenticateToken, requireRole('owner', 'admin'), async (req, res) => {
  const result = {
    bookings_count: 0,
    leads_count: 0,
    users_count: 0,
    last_booking_created_at: null,
    last_lead_created_at: null,
    db_ok: false,
    ts: new Date().toISOString(),
  };

  try {
    const [bkCount, leadCount, userCount, lastBooking, lastLead] = await Promise.all([
      pool.query('SELECT COUNT(*) as cnt FROM bookings'),
      pool.query('SELECT COUNT(*) as cnt FROM discovery_flight_leads'),
      pool.query('SELECT COUNT(*) as cnt FROM users WHERE deleted_at IS NULL'),
      pool.query('SELECT created_at FROM bookings ORDER BY created_at DESC LIMIT 1'),
      pool.query('SELECT created_at FROM discovery_flight_leads ORDER BY created_at DESC LIMIT 1'),
    ]);

    result.bookings_count = parseInt(bkCount.rows[0].cnt, 10);
    result.leads_count = parseInt(leadCount.rows[0].cnt, 10);
    result.users_count = parseInt(userCount.rows[0].cnt, 10);
    result.last_booking_created_at = lastBooking.rows[0]?.created_at || null;
    result.last_lead_created_at = lastLead.rows[0]?.created_at || null;
    result.db_ok = true;

    res.json(result);
  } catch (err) {
    console.error('[system-health] error:', err.message);
    res.status(503).json({ ...result, db_ok: false, error: 'Database unavailable' });
  }
});

module.exports = router;