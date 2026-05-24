/**
 * Weather cache persistence — reads/writes cached METAR/TAF data to Postgres.
 * Survives server restarts, unlike in-memory cache.
 * Does NOT own weather fetching logic — that lives in routes/weather.js.
 */
const pool = require('./index');

/**
 * Get the most recent cached weather data.
 * Returns { metar, taf, fetched_at } or null if no cache exists.
 */
async function getCachedWeather() {
  const { rows } = await pool.query(
    `SELECT metar_json, taf_json, fetched_at
     FROM weather_cache
     ORDER BY fetched_at DESC
     LIMIT 1`
  );
  if (rows.length === 0) return null;
  return {
    metar: rows[0].metar_json,
    taf: rows[0].taf_json,
    fetchedAt: rows[0].fetched_at.toISOString()
  };
}

/**
 * Upsert weather cache. Keeps only the single most recent entry.
 */
async function setCachedWeather(metar, taf) {
  await pool.query(
    `INSERT INTO weather_cache (station_id, metar_json, taf_json, fetched_at)
     VALUES ('KPSK', $1, $2, NOW())
     ON CONFLICT (station_id)
     DO UPDATE SET metar_json = $1, taf_json = $2, fetched_at = NOW()`,
    [metar ? JSON.stringify(metar) : null, taf ? JSON.stringify(taf) : null]
  );
}

module.exports = { getCachedWeather, setCachedWeather };
