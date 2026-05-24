/**
 * Weather routes — METAR/TAF data for KPSK (New River Valley Airport).
 * Does NOT own auth middleware or database pool construction.
 *
 * Three-tier resilience:
 *   1. In-memory cache (fast, 15 min TTL)
 *   2. aviationweather.gov API (primary source)
 *   3. api.weather.gov fallback (if primary returns HTML/errors)
 *   4. Persistent DB cache (survives restarts, shows stale data with timestamp)
 */
const express = require('express');
const { getCachedWeather, setCachedWeather } = require('../db/weather');

const router = express.Router();

// ── In-memory cache ─────────────────────────────────────────────────────────
const memCache = { data: null, fetchedAt: 0 };
const MEM_TTL_MS = 15 * 60 * 1000; // 15 minutes

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Safely parse a fetch response as JSON. Returns [] on any failure. */
async function safeJson(res, label) {
  if (!res.ok) {
    console.warn(`[weather] ${label} HTTP ${res.status}`);
    return [];
  }
  const ct = res.headers.get('content-type') || '';
  if (!ct.includes('json')) {
    // API returned HTML (maintenance page, rate limit, etc.)
    const preview = await res.text().then(t => t.slice(0, 200));
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
function normalizeMetar(metar) {
  if (!metar) return null;
  // fltCat → flightCategory
  if (metar.fltCat && !metar.flightCategory) {
    metar.flightCategory = metar.fltCat;
  }
  // altimeter hPa → inHg (API returns hPa when value > 100)
  if (metar.altim != null && metar.altim > 100) {
    metar.altim = (metar.altim * 0.02953).toFixed(2);
  }
  return metar;
}

/**
 * Primary source: aviationweather.gov (ADDS API).
 * Returns { metar, taf } or null on failure.
 */
async function fetchFromAviationWeather() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000); // 8s timeout

  try {
    const [metarRes, tafRes] = await Promise.all([
      fetch('https://aviationweather.gov/api/data/metar?ids=KPSK&format=json', { signal: controller.signal }),
      fetch('https://aviationweather.gov/api/data/taf?ids=KPSK&format=json', { signal: controller.signal })
    ]);

    const [metarArr, tafArr] = await Promise.all([
      safeJson(metarRes, 'adds-metar'),
      safeJson(tafRes, 'adds-taf')
    ]);

    const metar = Array.isArray(metarArr) && metarArr.length > 0 ? normalizeMetar(metarArr[0]) : null;
    const taf = Array.isArray(tafArr) && tafArr.length > 0 ? tafArr[0] : null;

    if (metar || taf) return { metar, taf };
    return null; // both empty — treat as failure
  } catch (err) {
    console.warn(`[weather] aviationweather.gov failed: ${err.message}`);
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Fallback source: api.weather.gov (NOAA NWS).
 * Uses the observation endpoint for KPSK. Returns simplified { metar, taf: null }.
 * Different response format — we map it to match our frontend schema.
 */
async function fetchFromNWS() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  try {
    const res = await fetch('https://api.weather.gov/stations/KPSK/observations/latest', {
      signal: controller.signal,
      headers: { 'User-Agent': 'NewTechAviation/1.0 (weather@newtechaviation.com)', 'Accept': 'application/json' }
    });

    const arr = await safeJson(res, 'nws-obs');
    if (!arr || !arr.properties) return null;

    const p = arr.properties;

    // Map NWS cloud layers — base stored in raw feet (consistent with aviationweather.gov format)
    const clouds = (p.cloudLayers || []).map(layer => ({
      cover: layer.amount || 'FEW',
      base: layer.base?.value != null ? Math.round(layer.base.value * 3.28084) : 0
    }));

    // Map NWS fields to our METAR format
    const metar = {
      icaoId: 'KPSK',
      temp: p.temperature?.value != null ? parseFloat(p.temperature.value.toFixed(1)) : null,
      dewp: p.dewpoint?.value != null ? parseFloat(p.dewpoint.value.toFixed(1)) : null,
      wdir: p.windDirection?.value != null ? Math.round(p.windDirection.value) : null,
      wspd: p.windSpeed?.value != null ? Math.round(p.windSpeed.value * 0.539957) : null, // m/s → knots
      wgst: p.windGust?.value != null ? Math.round(p.windGust.value * 0.539957) : null,
      visib: p.visibility?.value != null ? (p.visibility.value / 1609.34).toFixed(1) : null, // meters → SM
      altim: p.barometricPressure?.value != null ? (p.barometricPressure.value / 3386.39).toFixed(2) : null, // Pa → inHg
      clouds,
      rawOb: p.rawMessage || null,
      flightCategory: mapNWSCategory(p),
      obsTime: p.timestamp ? Math.floor(new Date(p.timestamp).getTime() / 1000) : null,
      reportTime: p.timestamp || null,
      _source: 'nws'
    };

    return { metar, taf: null };
  } catch (err) {
    console.warn(`[weather] api.weather.gov fallback failed: ${err.message}`);
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

/** Map NWS cloud layers to a rough flight category. */
function mapNWSCategory(props) {
  // NWS doesn't give flight category directly — derive from visibility + ceiling
  const visMiles = props.visibility?.value != null ? props.visibility.value / 1609.34 : 99;
  const clouds = props.cloudLayers || [];
  let ceilingFt = 99999;
  for (const layer of clouds) {
    if (['BKN', 'OVC'].includes(layer.amount) && layer.base?.value != null) {
      const ft = layer.base.value * 3.28084; // meters → feet
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
 * GET /api/weather
 * Auth required. Returns { metar, taf, fetchedAt, stale? }
 */
router.get('/', async (req, res) => {
  try {
    const now = Date.now();

    // 1. Serve from memory if fresh
    if (memCache.data && (now - memCache.fetchedAt) < MEM_TTL_MS) {
      return res.json(memCache.data);
    }

    // 2. Try primary API (aviationweather.gov)
    let result = await fetchFromAviationWeather();

    // 3. If primary fails, try NWS fallback
    if (!result) {
      result = await fetchFromNWS();
    }

    // 4. If we got fresh data, cache it everywhere and return
    if (result) {
      const payload = { metar: result.metar, taf: result.taf, fetchedAt: new Date().toISOString() };
      memCache.data = payload;
      memCache.fetchedAt = now;

      // Persist to DB (fire-and-forget — don't block response)
      setCachedWeather(result.metar, result.taf).catch(e =>
        console.warn(`[weather] DB cache write failed: ${e.message}`)
      );

      return res.json(payload);
    }

    // 5. Both APIs failed — try stale memory cache
    if (memCache.data) {
      return res.json({ ...memCache.data, stale: true });
    }

    // 6. No memory cache — try DB (persistent across restarts)
    const dbCache = await getCachedWeather();
    if (dbCache) {
      // Reload into memory cache so subsequent requests don't hit DB
      memCache.data = dbCache;
      memCache.fetchedAt = 0; // mark as stale so next request retries API
      return res.json({ ...dbCache, stale: true });
    }

    // 7. Truly nothing — return graceful empty state
    res.json({ metar: null, taf: null, fetchedAt: null, unavailable: true });
  } catch (err) {
    console.error('[weather] unexpected error:', err.message);
    // Last resort: stale cache
    if (memCache.data) return res.json({ ...memCache.data, stale: true });
    res.status(502).json({ error: 'Weather data unavailable' });
  }
});

module.exports = router;
