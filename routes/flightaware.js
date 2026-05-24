'use strict';

const express = require('express');
const https = require('https');
const pool = require('../db/index');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

// In-memory cache (60s TTL — fleet is small, rate limits are generous)
const flightAwareCache = new Map();
const FA_CACHE_TTL = 60 * 1000;

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
      headers: { 'x-apikey': apiKey, 'Accept': 'application/json' }
    };
    const req = https.request(options, (res) => {
      let raw = '';
      res.on('data', c => raw += c);
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

        if (!raw.__error && Array.isArray(raw.flights) && raw.flights.length > 0) {
          const latest = raw.flights[0];
          const pos = latest.last_position;

          if (latest.progress_percent != null && latest.progress_percent < 100 && pos) {
            flightStatus = 'in_flight';
          } else if (latest.actual_in) {
            flightStatus = 'on_ground';
          } else if (latest.actual_out && !latest.actual_in) {
            flightStatus = 'in_flight';
          } else {
            flightStatus = 'on_ground';
          }

          flightInfo = {
            ident: latest.ident,
            status: latest.status,
            flight_status: flightStatus,
            progress_percent: latest.progress_percent,
            origin: latest.origin ? { code: latest.origin.code, name: latest.origin.name, city: latest.origin.city } : null,
            destination: latest.destination ? { code: latest.destination.code, name: latest.destination.name, city: latest.destination.city } : null,
            departure_time: latest.actual_out || latest.estimated_out,
            arrival_time: latest.actual_in || latest.estimated_in,
            last_position: pos ? {
              latitude: pos.latitude,
              longitude: pos.longitude,
              altitude: pos.altitude,
              groundspeed: pos.groundspeed,
              heading: pos.heading,
              timestamp: pos.timestamp
            } : null
          };
        } else if (raw.__error) {
          flightStatus = 'unknown';
        }

        return {
          aircraft: ac,
          flight_status: flightInfo ? flightInfo.flight_status : flightStatus,
          flight: flightInfo,
          error: raw.__error || null
        };
      })
    );

    res.json({ api_key_configured: true, aircraft: trackingData });
  } catch (err) {
    console.error('[tracking] Error:', err.message);
    res.status(500).json({ error: 'Failed to fetch tracking data' });
  }
});

module.exports = router;