/**
 * Weather cache persistence — reads/writes cached METAR/TAF data to Postgres.
 * Survives server restarts, unlike in-memory cache.
 * Does NOT own weather fetching logic — that lives in routes/weather.js.
 */
const pool = require('./index');

function normalizeStation(station) {
  const s = String(station || 'KPSK').trim().toUpperCase();
  return /^[A-Z0-9]{3,4}$/.test(s) ? s : 'KPSK';
}

/**
 * Get cached weather for a station (defaults to KPSK).
 * Returns { metar, taf, fetchedAt, station } or null if no cache exists.
 */
async function getCachedWeather(station = 'KPSK') {
  const stationId = normalizeStation(station);
  const { rows } = await pool.query(
    `SELECT metar_json, taf_json, fetched_at, station_id
     FROM weather_cache
     WHERE station_id = $1
     ORDER BY fetched_at DESC
     LIMIT 1`,
    [stationId]
  );
  if (rows.length === 0) return null;
  return {
    station: rows[0].station_id,
    metar: rows[0].metar_json,
    taf: rows[0].taf_json,
    fetchedAt: rows[0].fetched_at.toISOString(),
  };
}

/**
 * Upsert weather cache for a station.
 */
async function setCachedWeather(metar, taf, station = 'KPSK') {
  const stationId = normalizeStation(station);
  await pool.query(
    `INSERT INTO weather_cache (station_id, metar_json, taf_json, fetched_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (station_id)
     DO UPDATE SET metar_json = $2, taf_json = $3, fetched_at = NOW()`,
    [
      stationId,
      metar ? JSON.stringify(metar) : null,
      taf ? JSON.stringify(taf) : null,
    ]
  );
}

module.exports = { getCachedWeather, setCachedWeather, normalizeStation };
