'use strict';
/**
 * Track Flights route — maintenance-focused flight board.
 * Owns: live in-progress flights from internal DB, per-aircraft maintenance schedule.
 * Does NOT own: FlightAware GPS tracking (routes/flightaware.js), booking CRUD.
 */

const express = require('express');
const pool = require('../db/index');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

// GET /api/track-flights/live — bookings currently in progress
// "In progress" = confirmed, start_time <= now, end_time >= now OR hobbs_start set but no hobbs_end
router.get('/live', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT
         b.id,
         b.start_time,
         b.end_time,
         b.status,
         b.lesson_type,
         b.hobbs_start,
         b.hobbs_end,
         b.notes,
         s.id   AS student_id,
         s.name AS student_name,
         i.id   AS instructor_id,
         i.name AS instructor_name,
         a.id         AS aircraft_id,
         a.tail_number,
         a.make_model,
         a.status     AS aircraft_status
       FROM bookings b
       JOIN users s ON s.id = b.student_id
       JOIN users i ON i.id = b.instructor_id
       JOIN aircraft a ON a.id = b.aircraft_id
       WHERE b.status = 'confirmed'
         AND b.start_time <= NOW()
         AND b.end_time   >= NOW()
       ORDER BY b.start_time ASC`
    );
    res.json({ flights: result.rows });
  } catch (err) {
    console.error('[track-flights] live error:', err.message);
    res.status(500).json({ error: 'Failed to fetch live flights' });
  }
});

// GET /api/track-flights/recent — flights completed in the last 8 hours
router.get('/recent', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT
         b.id,
         b.start_time,
         b.end_time,
         b.completed_at,
         b.status,
         b.lesson_type,
         b.hobbs_start,
         b.hobbs_end,
         b.tach_start,
         b.tach_end,
         s.name AS student_name,
         i.name AS instructor_name,
         a.tail_number,
         a.make_model
       FROM bookings b
       JOIN users s ON s.id = b.student_id
       JOIN users i ON i.id = b.instructor_id
       JOIN aircraft a ON a.id = b.aircraft_id
       WHERE b.status = 'completed'
         AND b.completed_at >= NOW() - INTERVAL '8 hours'
       ORDER BY b.completed_at DESC
       LIMIT 20`
    );
    res.json({ flights: result.rows });
  } catch (err) {
    console.error('[track-flights] recent error:', err.message);
    res.status(500).json({ error: 'Failed to fetch recent flights' });
  }
});

// GET /api/track-flights/maintenance-schedule — per-aircraft maintenance status
router.get('/maintenance-schedule', authenticateToken, async (req, res) => {
  try {
    // Aircraft with hours and upcoming maintenance
    const aircraft = await pool.query(
      `SELECT
         a.id,
         a.tail_number,
         a.make_model,
         a.status,
         a.current_hobbs,
         a.total_hobbs_hours,
         a.total_tach_hours,
         a.next_100hr_due,
         a.next_annual_due,
         a.maintenance_reason
       FROM aircraft a
       WHERE a.status != 'deleted'
       ORDER BY a.tail_number`
    );

    // Open squawks per aircraft
    const squawks = await pool.query(
      `SELECT
         s.id,
         s.aircraft_id,
         s.description,
         s.severity,
         s.status,
         s.reported_at,
         s.expected_downtime,
         s.resolution_notes,
         u.name AS reported_by_name
       FROM squawks s
       JOIN users u ON u.id = s.reported_by
       WHERE s.status IN ('open', 'reviewed', 'deferred')
       ORDER BY s.reported_at DESC`
    );

    // Last resolved squawk per aircraft as proxy for "last maintenance"
    const lastResolved = await pool.query(
      `SELECT DISTINCT ON (s.aircraft_id)
         s.aircraft_id,
         s.description,
         s.reviewed_at AS performed_at,
         u.name AS performed_by_name
       FROM squawks s
       LEFT JOIN users u ON u.id = s.reviewed_by
       WHERE s.status = 'resolved'
       ORDER BY s.aircraft_id, s.reviewed_at DESC NULLS LAST`
    );

    // Group squawks by aircraft_id
    const squawksByAircraft = {};
    for (const sq of squawks.rows) {
      if (!squawksByAircraft[sq.aircraft_id]) squawksByAircraft[sq.aircraft_id] = [];
      squawksByAircraft[sq.aircraft_id].push(sq);
    }

    // Build last-resolved lookup
    const lastMaintByAircraft = {};
    for (const lm of lastResolved.rows) {
      lastMaintByAircraft[lm.aircraft_id] = lm;
    }

    const schedule = aircraft.rows.map(ac => {
      const hobbs = parseFloat(ac.current_hobbs || ac.total_hobbs_hours || 0);
      const next100hr = parseFloat(ac.next_100hr_due || 0);
      const hoursUntil100hr = next100hr > 0 ? Math.max(0, next100hr - hobbs) : null;

      // Color-code: red = open squawk or overdue, yellow = due within 10hrs or 30 days, green = all good
      const openSquawks = (squawksByAircraft[ac.id] || []).filter(s => s.status === 'open' || s.severity === 'grounding');
      const groundingSquawk = openSquawks.some(s => s.severity === 'grounding');

      let scheduleStatus = 'good';
      if (groundingSquawk || ac.status === 'maintenance') {
        scheduleStatus = 'critical';
      } else if (
        (hoursUntil100hr !== null && hoursUntil100hr <= 10) ||
        (ac.next_annual_due && new Date(ac.next_annual_due) <= new Date(Date.now() + 30 * 24 * 60 * 60 * 1000))
      ) {
        scheduleStatus = 'warning';
      } else if (openSquawks.length > 0) {
        scheduleStatus = 'warning';
      }

      return {
        ...ac,
        hobbs,
        hours_until_100hr: hoursUntil100hr,
        schedule_status: scheduleStatus,
        open_squawks: squawksByAircraft[ac.id] || [],
        last_maintenance: lastMaintByAircraft[ac.id] || null,
      };
    });

    res.json({ schedule });
  } catch (err) {
    console.error('[track-flights] maintenance-schedule error:', err.message);
    res.status(500).json({ error: 'Failed to fetch maintenance schedule' });
  }
});

module.exports = router;
