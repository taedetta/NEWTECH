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

function mapPosition(pos) {
  if (!pos || pos.latitude == null || pos.longitude == null) return null;
  return {
    latitude: pos.latitude,
    longitude: pos.longitude,
    altitude: pos.altitude,
    groundspeed: pos.groundspeed,
    heading: pos.heading,
    timestamp: pos.timestamp,
  };
}

function mapAirport(ap) {
  if (!ap) return null;
  return { code: ap.code, name: ap.name, city: ap.city };
}

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
  const departure_time = f.actual_out || f.actual_off || f.estimated_off || f.scheduled_out;
  const arrival_time = f.actual_in || f.actual_on || f.estimated_on || f.scheduled_on;

  return {
    ident: f.ident,
    fa_flight_id: f.fa_flight_id,
    status: f.status,
    flight_status: deriveFlightStatus(f),
    progress_percent: f.progress_percent,
    origin: mapAirport(f.origin),
    destination: mapAirport(f.destination),
    departure_time,
    arrival_time,
    is_current: isCurrent,
    last_position: mapPosition(f.last_position),
  };
}

function mergePositionSummary(summary, positionData) {
  if (!positionData?.last_position) return summary;

  const pos = mapPosition(positionData.last_position);
  const merged = {
    ...summary,
    last_position: pos,
    origin: summary.origin || mapAirport(positionData.origin),
    destination: summary.destination || mapAirport(positionData.destination),
    departure_time: summary.departure_time || positionData.actual_off,
    arrival_time: summary.arrival_time || positionData.actual_on,
  };
  merged.flight_status = deriveFlightStatus({
    last_position: positionData.last_position,
    progress_percent: summary.progress_percent,
    actual_in: positionData.actual_on,
    actual_on: positionData.actual_on,
    actual_out: positionData.actual_off,
    actual_off: positionData.actual_off,
    status: summary.status,
  });
  return merged;
}

function flightAwareRequest(path) {
  const apiKey = process.env.FLIGHTAWARE_API_KEY;
  if (!apiKey) return Promise.resolve({ __error: 'no_api_key' });

  return new Promise((resolve) => {
    const options = {
      hostname: 'aeroapi.flightaware.com',
      path,
      method: 'GET',
      headers: { 'x-apikey': apiKey, Accept: 'application/json' },
    };
    const req = https.request(options, (res) => {
      let raw = '';
      res.on('data', (c) => { raw += c; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(raw);
          if (res.statusCode >= 400) {
            resolve({ __error: 'api_error', statusCode: res.statusCode, ...parsed });
            return;
          }
          resolve({ statusCode: res.statusCode, ...parsed });
        } catch { resolve({ __error: 'parse_error' }); }
      });
    });
    req.on('error', () => resolve({ __error: 'network_error' }));
    req.setTimeout(10000, () => { req.destroy(); resolve({ __error: 'timeout' }); });
    req.end();
  });
}

async function fetchFlightAwareData(tailNumber) {
  const cacheKey = `flights:${tailNumber}`;
  const cached = flightAwareCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < FA_CACHE_TTL) return cached.data;

  const result = await flightAwareRequest(`/aeroapi/flights/${encodeURIComponent(tailNumber)}`);
  if (!result.__error) flightAwareCache.set(cacheKey, { data: result, ts: Date.now() });
  return result;
}

async function fetchFlightPosition(faFlightId) {
  const cacheKey = `position:${faFlightId}`;
  const cached = flightAwareCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < FA_CACHE_TTL) return cached.data;

  const result = await flightAwareRequest(`/aeroapi/flights/${encodeURIComponent(faFlightId)}/position`);
  if (!result.__error) flightAwareCache.set(cacheKey, { data: result, ts: Date.now() });
  return result.__error ? null : result;
}

async function enrichInFlightPosition(summary) {
  if (!summary || summary.flight_status !== 'in_flight' || summary.last_position || !summary.fa_flight_id) {
    return summary;
  }
  const positionData = await fetchFlightPosition(summary.fa_flight_id);
  return mergePositionSummary(summary, positionData);
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
          flightInfo = await enrichInFlightPosition(history[0]);
          history[0] = flightInfo;
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
