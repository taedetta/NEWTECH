'use strict';

const express = require('express');
const https = require('https');
const pool = require('../db/index');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

// Personal tier: GET /flights/{ident} returns ~14 days of flights in one result set (no extra calls).
const FA_HISTORY_DAYS = 14;

// In-memory cache (60s TTL — fleet is small, rate limits are generous)
const flightAwareCache = new Map();
const FA_CACHE_TTL = 60 * 1000;

function deriveFlightStatus(f) {
  const pos = f.last_position;
  if (f.progress_percent != null && f.progress_percent < 100 && pos) return 'in_flight';
  if (f.actual_in || f.actual_on) return 'on_ground';
  if ((f.actual_out || f.actual_off) && !(f.actual_in || f.actual_on)) return 'in_flight';
  if (f.status === 'En Route') return 'in_flight';
  if (f.status === 'Arrived' || f.status === 'Completed') return 'on_ground';
  return 'unknown';
}

function mapFlightSummary(f, { isCurrent = false } = {}) {
  const pos = f.last_position;
  const departure_time = f.actual_out || f.actual_off || f.estimated_off || f.scheduled_out;
  const arrival_time = f.actual_in || f.actual_on || f.estimated_on || f.scheduled_on;

  return {
    ident: f.ident,
    fa_flight_id: f.fa_flight_id,
    status: f.status,
    flight_status: deriveFlightStatus(f),
    progress_percent: f.progress_percent,
    origin: f.origin ? { code: f.origin.code, name: f.origin.name, city: f.origin.city } : null,
    destination: f.destination ? { code: f.destination.code, name: f.destination.name, city: f.destination.city } : null,
    departure_time,
    arrival_time,
    is_current: isCurrent,
    last_position: pos ? {
      latitude: pos.latitude,
      longitude: pos.longitude,
      altitude: pos.altitude,
      groundspeed: pos.groundspeed,
      heading: pos.heading,
      timestamp: pos.timestamp,
    } : null,
  };
}

async function fetchFlightAwareData(tailNumber) {
  const apiKey = process.env.FLIGHTAWARE_API_KEY;
  if (!apiKey) return { __error: 'no_api_key' };

  const cached = flightAwareCache.get(tailNumber);
  if (cached && Date.now() - cached.ts < FA_CACHE_TTL) return cached.data;

  return new Promise((resolve) => {
    const options = {
      hostname: 'aeroapi.flightaware.com',
      path: `/aeroapi/flights/${encodeURIComponent(tailNumber)}`,
      method: 'GET',
      headers: { 'x-apikey': apiKey, Accept: 'application/json' },
    };
    const req = https.request(options, (res) => {
      let raw = '';
      res.on('data', (c) => { raw += c; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(raw);
          const result = { statusCode: res.statusCode, ...parsed };
          flightAwareCache.set(tailNumber, { data: result, ts: Date.now() });
          resolve(result);
        } catch { resolve({ __error: 'parse_error' }); }
      });
    });
    req.on('error', () => resolve({ __error: 'network_error' }));
    req.setTimeout(10000, () => { req.destroy(); resolve({ __error: 'timeout' }); });
    req.end();
  });
}

// GET /api/flights/tracking — live fleet tracking (all authenticated roles)
router.get('/tracking', authenticateToken, async (req, res) => {
  try {
    const apiKeyConfigured = !!process.env.FLIGHTAWARE_API_KEY;
    if (!apiKeyConfigured) {
      return res.json({ api_key_configured: false, aircraft: [] });
    }

    const result = await pool.query(
      `SELECT id, tail_number, make_model, type, status FROM aircraft
       WHERE status IS DISTINCT FROM 'inactive' ORDER BY tail_number`
    );

    const trackingData = await Promise.all(
      result.rows.map(async (ac) => {
        const raw = await fetchFlightAwareData(ac.tail_number);
        let flightInfo = null;
        let flightStatus = 'unknown';
        let history = [];

        if (!raw.__error && Array.isArray(raw.flights) && raw.flights.length > 0) {
          history = raw.flights.map((f, idx) => mapFlightSummary(f, { isCurrent: idx === 0 }));
          flightInfo = history[0];
          flightStatus = flightInfo.flight_status;
        } else if (raw.__error) {
          flightStatus = 'unknown';
        }

        return {
          aircraft: ac,
          flight_status: flightInfo ? flightInfo.flight_status : flightStatus,
          flight: flightInfo,
          history,
          error: raw.__error || null,
        };
      })
    );

    res.json({
      api_key_configured: true,
      history_days: FA_HISTORY_DAYS,
      aircraft: trackingData,
    });
  } catch (err) {
    console.error('[tracking] Error:', err.message);
    res.status(500).json({ error: 'Failed to fetch tracking data' });
  }
});

module.exports = router;
