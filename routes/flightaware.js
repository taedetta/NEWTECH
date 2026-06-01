'use strict';

const express = require('express');
const https = require('https');
const pool = require('../db/index');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

// Personal tier: GET /flights/{ident} returns ~14 days of flights in one result set (no extra calls).
const FA_HISTORY_DAYS = 14;
const HISTORY_TRACK_LIMIT = 5;

// In-memory cache — fleet is small; position polls faster when aircraft are airborne.
const flightAwareCache = new Map();
const airportCache = new Map();
const localTrackActive = new Map();
const localTrackArchive = new Map();
const FA_CACHE_TTL = 60 * 1000;
const FA_POSITION_CACHE_TTL = 15 * 1000;
const FA_TRACK_ACTIVE_TTL = 30 * 1000;
const FA_TRACK_STATIC_TTL = 15 * 60 * 1000;
const AIRPORT_CACHE_TTL = 7 * 24 * 60 * 60 * 1000;
const LOCAL_TRACK_MAX = 600;

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

function mapTrackPoints(positions) {
  return (positions || [])
    .map(mapPosition)
    .filter(Boolean);
}

function mapAirport(ap) {
  if (!ap) return null;
  return {
    code: ap.code,
    name: ap.name,
    city: ap.city,
    latitude: ap.latitude ?? null,
    longitude: ap.longitude ?? null,
  };
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
    fa_track: [],
    local_track: [],
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

function archiveLocalTrack(session, summary) {
  if (!session?.fa_flight_id || !session.points?.length) return;
  localTrackArchive.set(session.fa_flight_id, {
    tail: session.tail,
    fa_flight_id: session.fa_flight_id,
    points: [...session.points],
    departure_time: summary?.departure_time || session.departure_time || null,
    arrival_time: summary?.arrival_time || session.arrival_time || null,
    archived_at: Date.now(),
  });
}

function recordLocalTrack(tail, summary) {
  if (!summary?.fa_flight_id) return getLocalTrack(tail, summary?.fa_flight_id);

  for (const [key, session] of [...localTrackActive.entries()]) {
    if (session.tail === tail && session.fa_flight_id !== summary.fa_flight_id) {
      archiveLocalTrack(session, summary);
      localTrackActive.delete(key);
    }
  }

  const key = `${tail}:${summary.fa_flight_id}`;
  let session = localTrackActive.get(key);
  if (!session) {
    const archived = localTrackArchive.get(summary.fa_flight_id);
    session = {
      tail,
      fa_flight_id: summary.fa_flight_id,
      points: archived?.points ? [...archived.points] : [],
    };
    localTrackActive.set(key, session);
  }

  const pos = summary.last_position;
  if (pos) {
    const last = session.points[session.points.length - 1];
    if (!last || last.latitude !== pos.latitude || last.longitude !== pos.longitude) {
      session.points.push({ ...pos });
      if (session.points.length > LOCAL_TRACK_MAX) session.points.shift();
    }
  }

  if (summary.flight_status === 'on_ground' && session.points.length > 0) {
    archiveLocalTrack(session, summary);
    localTrackActive.delete(key);
  }

  return getLocalTrack(tail, summary.fa_flight_id);
}

function getLocalTrack(tail, faFlightId) {
  if (!faFlightId) return [];
  const active = localTrackActive.get(`${tail}:${faFlightId}`);
  if (active?.points?.length) return active.points;
  const archived = localTrackArchive.get(faFlightId);
  if (archived?.tail === tail || !archived?.tail) return archived?.points || [];
  return archived?.points || [];
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
    req.setTimeout(15000, () => { req.destroy(); resolve({ __error: 'timeout' }); });
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
  if (cached && Date.now() - cached.ts < FA_POSITION_CACHE_TTL) return cached.data;

  const result = await flightAwareRequest(`/aeroapi/flights/${encodeURIComponent(faFlightId)}/position`);
  if (!result.__error) flightAwareCache.set(cacheKey, { data: result, ts: Date.now() });
  return result.__error ? null : result;
}

async function fetchFlightTrack(faFlightId, { inFlight = false } = {}) {
  if (!faFlightId) return [];
  const cacheKey = `track:${faFlightId}`;
  const ttl = inFlight ? FA_TRACK_ACTIVE_TTL : FA_TRACK_STATIC_TTL;
  const cached = flightAwareCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < ttl) return cached.data;

  const result = await flightAwareRequest(`/aeroapi/flights/${encodeURIComponent(faFlightId)}/track`);
  const points = result.__error ? [] : mapTrackPoints(result.positions);
  flightAwareCache.set(cacheKey, { data: points, ts: Date.now() });
  return points;
}

async function fetchAirport(code) {
  if (!code) return null;
  const cacheKey = `airport:${code}`;
  const cached = airportCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < AIRPORT_CACHE_TTL) return cached.data;

  const result = await flightAwareRequest(`/aeroapi/airports/${encodeURIComponent(code)}`);
  if (result.__error || result.latitude == null) return null;
  const data = {
    code: result.airport_code || result.code_icao || code,
    name: result.name,
    city: result.city,
    latitude: result.latitude,
    longitude: result.longitude,
  };
  airportCache.set(cacheKey, { data, ts: Date.now() });
  return data;
}

async function enrichAirports(summary) {
  if (!summary) return summary;
  if (summary.origin?.code && summary.origin.latitude == null) {
    const ap = await fetchAirport(summary.origin.code);
    if (ap) summary.origin = { ...summary.origin, ...ap };
  }
  if (summary.destination?.code && summary.destination.latitude == null) {
    const ap = await fetchAirport(summary.destination.code);
    if (ap) summary.destination = { ...summary.destination, ...ap };
  }
  return summary;
}

async function enrichInFlightPosition(summary) {
  if (!summary || summary.flight_status !== 'in_flight' || !summary.fa_flight_id) {
    return summary;
  }
  const positionData = await fetchFlightPosition(summary.fa_flight_id);
  return positionData ? mergePositionSummary(summary, positionData) : summary;
}

async function enrichWithTracks(tail, summary) {
  if (!summary?.fa_flight_id) return summary;
  const inFlight = summary.flight_status === 'in_flight';
  summary.local_track = recordLocalTrack(tail, summary);
  summary.fa_track = await fetchFlightTrack(summary.fa_flight_id, { inFlight });
  if (!summary.last_position && summary.fa_track.length) {
    summary.last_position = summary.fa_track[summary.fa_track.length - 1];
  }
  return summary;
}

function attachHistoryTracks(tail, history) {
  return history.map((item) => {
    const h = { ...item, fa_track: item.fa_track || [], local_track: [] };
    const archived = localTrackArchive.get(h.fa_flight_id);
    if (archived?.points?.length) {
      h.local_track = archived.points;
      h.departure_time = h.departure_time || archived.departure_time;
      h.arrival_time = h.arrival_time || archived.arrival_time;
    } else {
      h.local_track = getLocalTrack(tail, h.fa_flight_id);
    }
    return h;
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
          if (flightInfo.flight_status === 'in_flight') {
            flightInfo = await enrichInFlightPosition(flightInfo);
          }
          flightInfo = await enrichAirports(flightInfo);
          flightInfo = await enrichWithTracks(ac.tail_number, flightInfo);
          history[0] = flightInfo;
          history = attachHistoryTracks(ac.tail_number, history);
          for (let i = 0; i < Math.min(history.length, HISTORY_TRACK_LIMIT); i++) {
            history[i] = await enrichAirports(history[i]);
          }
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
      refresh_seconds: FA_POSITION_CACHE_TTL / 1000,
      aircraft: trackingData,
    });
  } catch (err) {
    console.error('[tracking] Error:', err.message);
    res.status(500).json({ error: 'Failed to fetch tracking data' });
  }
});

// GET /api/flights/track/:faFlightId — on-demand track for a history flight
router.get('/track/:faFlightId', authenticateToken, async (req, res) => {
  try {
    if (!process.env.FLIGHTAWARE_API_KEY) {
      return res.status(503).json({ error: 'FlightAware not configured' });
    }
    const { faFlightId } = req.params;
    const tail = req.query.tail || '';
    const fa_track = await fetchFlightTrack(faFlightId, { inFlight: false });
    let local_track = getLocalTrack(tail, faFlightId);
    const archived = localTrackArchive.get(faFlightId);
    if (archived?.points?.length) local_track = archived.points;
    res.json({ fa_flight_id: faFlightId, fa_track, local_track });
  } catch (err) {
    console.error('[tracking] track fetch error:', err.message);
    res.status(500).json({ error: 'Failed to fetch flight track' });
  }
});

module.exports = router;
