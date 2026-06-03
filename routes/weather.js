/**
 * Weather routes — METAR/TAF data per ICAO station (default KPSK).
 * Does NOT own auth middleware or database pool construction.
 *
 * Three-tier resilience:
 *   1. In-memory cache (fast, 15 min TTL, per station)
 *   2. aviationweather.gov API (primary source)
 *   3. api.weather.gov fallback (if primary returns HTML/errors)
 *   4. Persistent DB cache (survives restarts, shows stale data with timestamp)
 */
const express = require('express');
const { getCachedWeather, setCachedWeather, normalizeStation } = require('../db/weather');
const { getTafFallbackStation } = require('../lib/weather-taf');

const router = express.Router();

// ── In-memory cache (per station) ────────────────────────────────────────────
const memCacheByStation = new Map();
const MEM_TTL_MS = 15 * 60 * 1000; // 15 minutes

function getMemCache(station) {
  if (!memCacheByStation.has(station)) {
    memCacheByStation.set(station, { data: null, fetchedAt: 0 });
  }
  return memCacheByStation.get(station);
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Safely parse a fetch response as JSON. Returns [] on any failure. */
async function safeJson(res, label) {
  if (!res.ok) {
    console.warn(`[weather] ${label} HTTP ${res.status}`);
    return [];
  }
  const ct = res.headers.get('content-type') || '';
  if (!ct.includes('json')) {
    const preview = await res.text().then((t) => t.slice(0, 200));
    console.warn(`[weather] ${label} non-JSON (${ct}): ${preview.slice(0, 80)}`);
    return [];
  }
  try {
    return await res.json();
  } catch (e) {
    console.warn(`[weather] ${label} JSON parse failed: ${e.message}`);
    return [];
  }
}

/** Normalize aviationweather.gov field names to frontend expectations. */
function normalizeMetar(metar, station) {
  if (!metar) return null;
  if (metar.fltCat && !metar.flightCategory) {
    metar.flightCategory = metar.fltCat;
  }
  if (metar.altim != null && metar.altim > 100) {
    metar.altim = (metar.altim * 0.02953).toFixed(2);
  }
  if (!metar.icaoId) metar.icaoId = station;
  return metar;
}

async function fetchTafForStation(station) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(`https://aviationweather.gov/api/data/taf?ids=${station}&format=json`, {
      signal: controller.signal,
      headers: { 'User-Agent': 'FlightSlate/1.0 (weather@newtechaviation.com)' },
    });
    const tafArr = await safeJson(res, `adds-taf-${station}`);
    if (Array.isArray(tafArr) && tafArr.length > 0) {
      return { taf: tafArr[0], tafStation: station };
    }
    return { taf: null, tafStation: station };
  } catch (err) {
    console.warn(`[weather] TAF fetch failed (${station}): ${err.message}`);
    return { taf: null, tafStation: station };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Primary source: aviationweather.gov (ADDS API).
 * Returns { metar, taf, tafStation } or null on failure.
 */
async function fetchFromAviationWeather(station) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  try {
    const metarRes = await fetch(`https://aviationweather.gov/api/data/metar?ids=${station}&format=json`, {
      signal: controller.signal,
      headers: { 'User-Agent': 'FlightSlate/1.0 (weather@newtechaviation.com)' },
    });

    const metarArr = await safeJson(metarRes, 'adds-metar');
    const metar = Array.isArray(metarArr) && metarArr.length > 0 ? normalizeMetar(metarArr[0], station) : null;

    let { taf, tafStation } = await fetchTafForStation(station);
    if (!taf) {
      const fallback = getTafFallbackStation(station);
      if (fallback && fallback !== station) {
        console.log(`[weather] No TAF for ${station} — using ${fallback}`);
        const fb = await fetchTafForStation(fallback);
        if (fb.taf) {
          taf = fb.taf;
          tafStation = fallback;
        }
      }
    }

    if (metar || taf) return { metar, taf, tafStation };
    return null;
  } catch (err) {
    console.warn(`[weather] aviationweather.gov failed (${station}): ${err.message}`);
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Fallback source: api.weather.gov (NOAA NWS).
 */
async function fetchFromNWS(station) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  try {
    const res = await fetch(`https://api.weather.gov/stations/${station}/observations/latest`, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'NewTechAviation/1.0 (weather@newtechaviation.com)',
        Accept: 'application/json',
      },
    });

    const arr = await safeJson(res, 'nws-obs');
    if (!arr || !arr.properties) return null;

    const p = arr.properties;
    const clouds = (p.cloudLayers || []).map((layer) => ({
      cover: layer.amount || 'FEW',
      base: layer.base?.value != null ? Math.round(layer.base.value * 3.28084) : 0,
    }));

    const metar = {
      icaoId: station,
      temp: p.temperature?.value != null ? parseFloat(p.temperature.value.toFixed(1)) : null,
      dewp: p.dewpoint?.value != null ? parseFloat(p.dewpoint.value.toFixed(1)) : null,
      wdir: p.windDirection?.value != null ? Math.round(p.windDirection.value) : null,
      wspd: p.windSpeed?.value != null ? Math.round(p.windSpeed.value * 0.539957) : null,
      wgst: p.windGust?.value != null ? Math.round(p.windGust.value * 0.539957) : null,
      visib: p.visibility?.value != null ? (p.visibility.value / 1609.34).toFixed(1) : null,
      altim: p.barometricPressure?.value != null ? (p.barometricPressure.value / 3386.39).toFixed(2) : null,
      clouds,
      rawOb: p.rawMessage || null,
      flightCategory: mapNWSCategory(p),
      obsTime: p.timestamp ? Math.floor(new Date(p.timestamp).getTime() / 1000) : null,
      reportTime: p.timestamp || null,
      _source: 'nws',
    };

    return { metar, taf: null };
  } catch (err) {
    console.warn(`[weather] api.weather.gov fallback failed (${station}): ${err.message}`);
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

/** Map NWS cloud layers to a rough flight category. */
function mapNWSCategory(props) {
  const visMiles = props.visibility?.value != null ? props.visibility.value / 1609.34 : 99;
  const clouds = props.cloudLayers || [];
  let ceilingFt = 99999;
  for (const layer of clouds) {
    if (['BKN', 'OVC'].includes(layer.amount) && layer.base?.value != null) {
      const ft = layer.base.value * 3.28084;
      if (ft < ceilingFt) ceilingFt = ft;
    }
  }

  if (visMiles < 1 || ceilingFt < 500) return 'LIFR';
  if (visMiles < 3 || ceilingFt < 1000) return 'IFR';
  if (visMiles <= 5 || ceilingFt <= 3000) return 'MVFR';
  return 'VFR';
}

// ── Route ───────────────────────────────────────────────────────────────────

/**
 * GET /api/weather?station=KPSK
 * Auth required. Returns { metar, taf, fetchedAt, station, stale? }
 */
router.get('/', async (req, res) => {
  try {
    const station = normalizeStation(req.query.station);
    const now = Date.now();
    const memCache = getMemCache(station);

    if (memCache.data && (now - memCache.fetchedAt) < MEM_TTL_MS) {
      return res.json(memCache.data);
    }

    let result = await fetchFromAviationWeather(station);
    if (!result) {
      result = await fetchFromNWS(station);
    }

    if (result) {
      const payload = {
        station,
        tafStation: result.tafStation || station,
        metar: result.metar,
        taf: result.taf,
        fetchedAt: new Date().toISOString(),
      };
      memCache.data = payload;
      memCache.fetchedAt = now;

      setCachedWeather(result.metar, result.taf, station).catch((e) =>
        console.warn(`[weather] DB cache write failed: ${e.message}`)
      );

      return res.json(payload);
    }

    if (memCache.data) {
      return res.json({ ...memCache.data, stale: true });
    }

    const dbCache = await getCachedWeather(station);
    if (dbCache) {
      memCache.data = { ...dbCache, station: dbCache.station || station };
      memCache.fetchedAt = 0;
      return res.json({ ...memCache.data, stale: true });
    }

    res.json({ station, metar: null, taf: null, fetchedAt: null, unavailable: true });
  } catch (err) {
    console.error('[weather] unexpected error:', err.message);
    const station = normalizeStation(req.query.station);
    const memCache = getMemCache(station);
    if (memCache.data) return res.json({ ...memCache.data, stale: true });
    res.status(502).json({ error: 'Weather data unavailable' });
  }
});

module.exports = router;
