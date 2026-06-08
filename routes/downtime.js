'use strict';

// Aircraft downtime windows — blocks bookings during scheduled maintenance periods.
// Does NOT own aircraft status, squawks, or inspection dates.

const express = require('express');
const pool = require('../db/index');
const { authenticateToken, requirePermission } = require('../middleware/auth');
const {
  normalizeDateInput,
  timeToHHMM,
  isAllDayDowntime,
  downtimeOverlapsBooking,
  downtimeTouchesDate,
  formatDowntimeLabel,
  findBookingsOverlappingDowntime,
} = require('../lib/downtime-overlap');

const router = express.Router();

function downtimeListQuery(aircraft_id) {
  const base = `
    SELECT d.*,
      a.tail_number, a.make_model,
      u.name as created_by_name
    FROM aircraft_downtime d
    JOIN aircraft a ON d.aircraft_id = a.id
    LEFT JOIN users u ON d.created_by = u.id
  `;
  const params = [];
  let where = '';
  if (aircraft_id) {
    where = ' WHERE d.aircraft_id = $1';
    params.push(parseInt(aircraft_id, 10));
  }
  return { base, where, params };
}

async function queryDowntimeList(pool, aircraft_id) {
  const { base, where, params } = downtimeListQuery(aircraft_id);
  try {
    return await pool.query(
      `${base}${where} ORDER BY d.start_date DESC, d.start_time DESC NULLS LAST, d.created_at DESC`,
      params
    );
  } catch (err) {
    if (!/start_time|end_time|all_day/i.test(err.message)) throw err;
    return pool.query(
      `${base}${where} ORDER BY d.start_date DESC, d.created_at DESC`,
      params
    );
  }
}

function normalizeTimeInput(v) {
  if (!v) return null;
  const s = String(v).trim();
  if (!s) return null;
  return timeToHHMM(s.length === 5 ? `${s}:00` : s);
}

function validateDowntimePayload({ start_date, end_date, start_time, end_time, all_day }) {
  const startDate = normalizeDateInput(start_date);
  const endDate = normalizeDateInput(end_date);
  if (!startDate || !endDate) {
    return { error: 'start_date and end_date are required' };
  }
  if (endDate < startDate) {
    return { error: 'end_date must be on or after start_date' };
  }

  const allDay = all_day === true || all_day === 'true';
  const st = allDay ? null : normalizeTimeInput(start_time);
  const et = allDay ? null : normalizeTimeInput(end_time);

  if (!allDay) {
    if (!st || !et) {
      return { error: 'Start time and end time are required unless blocking entire day(s)' };
    }
    if (startDate === endDate) {
      const startDt = new Date(`${startDate}T${st}:00`);
      const endDt = new Date(`${endDate}T${et}:00`);
      if (endDt <= startDt) {
        return { error: 'End time must be after start time on the same day' };
      }
    } else {
      const startDt = new Date(`${startDate}T${st}:00`);
      const endDt = new Date(`${endDate}T${et}:00`);
      if (endDt <= startDt) {
        return { error: 'End date/time must be after start date/time' };
      }
    }
  }

  return {
    start_date: startDate,
    end_date: endDate,
    start_time: st,
    end_time: et,
    all_day: allDay,
  };
}

// GET /api/downtime?aircraft_id=123 — list all downtime entries
router.get('/', authenticateToken, async (req, res) => {
  try {
    const { aircraft_id } = req.query;
    const result = await queryDowntimeList(pool, aircraft_id);
    res.json(result.rows);
  } catch (err) {
    console.error('Downtime list error:', err);
    res.status(500).json({ error: 'Failed to fetch downtime records' });
  }
});

// GET /api/downtime/check?aircraft_id=123&date=2026-05-25&start_time=10:00&end_time=12:00
router.get('/check', authenticateToken, async (req, res) => {
  try {
    const { aircraft_id, date, start_time, end_time } = req.query;
    if (!aircraft_id || !date) {
      return res.status(400).json({ error: 'aircraft_id and date are required' });
    }
    const result = await pool.query(
      `SELECT * FROM aircraft_downtime
       WHERE aircraft_id = $1 AND start_date <= $2::date AND end_date >= $2::date`,
      [parseInt(aircraft_id, 10), normalizeDateInput(date)]
    );
    const dateStr = normalizeDateInput(date);
    const rows = result.rows.filter((r) => downtimeTouchesDate(r, dateStr));
    if (!start_time || !end_time) {
      const hit = rows.find((r) => isAllDayDowntime(r)) || rows[0];
      if (hit) return res.json({ unavailable: true, downtime: hit, label: formatDowntimeLabel(hit) });
      return res.json({ unavailable: false });
    }
    const bookingStart = new Date(`${dateStr}T${timeToHHMM(start_time) || '00:00'}:00`);
    const bookingEnd = new Date(`${dateStr}T${timeToHHMM(end_time) || '23:59'}:00`);
    const hit = rows.find((r) => downtimeOverlapsBooking(r, bookingStart, bookingEnd));
    if (hit) return res.json({ unavailable: true, downtime: hit, label: formatDowntimeLabel(hit) });
    return res.json({ unavailable: false });
  } catch (err) {
    console.error('Downtime check error:', err);
    res.status(500).json({ error: 'Failed to check downtime' });
  }
});

// GET /api/downtime/by-date?date=2026-05-25
router.get('/by-date', authenticateToken, async (req, res) => {
  try {
    const date = normalizeDateInput(req.query.date);
    if (!date) return res.status(400).json({ error: 'date is required' });
    const result = await pool.query(
      `SELECT d.*, a.tail_number, a.make_model
       FROM aircraft_downtime d
       JOIN aircraft a ON d.aircraft_id = a.id
       WHERE d.start_date <= $1::date AND d.end_date >= $1::date
       ORDER BY d.aircraft_id, d.start_date`,
      [date]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Downtime by-date error:', err);
    res.status(500).json({ error: 'Failed to fetch downtime by date' });
  }
});

// POST /api/downtime — create a downtime entry
router.post('/', authenticateToken, requirePermission('can_manage_aircraft'), async (req, res) => {
  try {
    const { aircraft_id, reason, create_squawk } = req.body;
    const parsed = validateDowntimePayload(req.body);
    if (parsed.error) return res.status(400).json({ error: parsed.error });
    if (!aircraft_id) return res.status(400).json({ error: 'aircraft_id is required' });

    const ac = await pool.query('SELECT id FROM aircraft WHERE id = $1', [parseInt(aircraft_id, 10)]);
    if (ac.rows.length === 0) return res.status(404).json({ error: 'Aircraft not found' });

    let result;
    try {
      result = await pool.query(
        `INSERT INTO aircraft_downtime
           (aircraft_id, start_date, end_date, start_time, end_time, all_day, reason, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
        [
          parseInt(aircraft_id, 10),
          parsed.start_date,
          parsed.end_date,
          parsed.start_time,
          parsed.end_time,
          parsed.all_day,
          reason || null,
          req.user.id,
        ]
      );
    } catch (err) {
      if (!/start_time|end_time|all_day/i.test(err.message)) throw err;
      result = await pool.query(
        `INSERT INTO aircraft_downtime (aircraft_id, start_date, end_date, reason, created_by)
         VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [parseInt(aircraft_id, 10), parsed.start_date, parsed.end_date, reason || null, req.user.id]
      );
    }

    if (reason && create_squawk) {
      await pool.query(
        `INSERT INTO squawks (aircraft_id, description, severity, status, expected_downtime, reported_by)
         VALUES ($1, $2, 'minor', 'scheduled', $3, $4)`,
        [parseInt(aircraft_id, 10), reason, formatDowntimeLabel(result.rows[0]), req.user.id]
      );
    }

    const overlapping_bookings = await findBookingsOverlappingDowntime(pool, parseInt(aircraft_id, 10), result.rows[0]);
    res.status(201).json({
      ...result.rows[0],
      overlapping_bookings,
      preserved_bookings: overlapping_bookings.length,
    });
  } catch (err) {
    console.error('Downtime create error:', err);
    res.status(500).json({ error: 'Failed to create downtime record' });
  }
});

// DELETE /api/downtime/:id
router.delete('/:id', authenticateToken, requirePermission('can_manage_aircraft'), async (req, res) => {
  try {
    const result = await pool.query(
      'DELETE FROM aircraft_downtime WHERE id = $1 RETURNING id',
      [parseInt(req.params.id, 10)]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Downtime record not found' });
    res.json({ ok: true });
  } catch (err) {
    console.error('Downtime delete error:', err);
    res.status(500).json({ error: 'Failed to delete downtime record' });
  }
});

module.exports = router;
