'use strict';

const pool = require('./index');

let ensureLocationsTablePromise = null;

async function ensureLocationsTable() {
  if (!ensureLocationsTablePromise) {
    ensureLocationsTablePromise = pool.query(`
      CREATE TABLE IF NOT EXISTS locations (
        id SERIAL PRIMARY KEY,
        code VARCHAR(10) NOT NULL UNIQUE,
        name VARCHAR(255) NOT NULL,
        timezone VARCHAR(64) DEFAULT 'America/New_York',
        weather_station VARCHAR(10),
        is_default BOOLEAN DEFAULT false,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
      ALTER TABLE locations ADD COLUMN IF NOT EXISTS timezone VARCHAR(64) DEFAULT 'America/New_York';
      ALTER TABLE locations ADD COLUMN IF NOT EXISTS weather_station VARCHAR(10);
      ALTER TABLE locations ADD COLUMN IF NOT EXISTS is_default BOOLEAN DEFAULT false;
      ALTER TABLE locations ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();
      INSERT INTO locations (code, name, weather_station, is_default)
      SELECT 'KPSK', 'New River Valley (Dublin, VA)', 'KPSK', true
      WHERE NOT EXISTS (SELECT 1 FROM locations WHERE code = 'KPSK');
    `).catch((err) => {
      ensureLocationsTablePromise = null;
      throw err;
    });
  }
  return ensureLocationsTablePromise;
}

async function listLocations() {
  await ensureLocationsTable();
  const result = await pool.query(
    'SELECT * FROM locations ORDER BY is_default DESC, name ASC'
  );
  return result.rows;
}

async function getDefaultLocationId() {
  await ensureLocationsTable();
  const result = await pool.query(
    'SELECT id FROM locations WHERE is_default = true ORDER BY id LIMIT 1'
  );
  return result.rows[0]?.id || null;
}

async function createLocation({ code, name, timezone, weather_station, is_default }) {
  await ensureLocationsTable();
  if (is_default) {
    await pool.query('UPDATE locations SET is_default = false');
  }
  const result = await pool.query(
    `INSERT INTO locations (code, name, timezone, weather_station, is_default)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [code.toUpperCase(), name, timezone || 'America/New_York', weather_station || code.toUpperCase(), !!is_default]
  );
  return result.rows[0];
}

async function updateLocation(id, fields) {
  await ensureLocationsTable();
  const allowed = ['code', 'name', 'timezone', 'weather_station', 'is_default'];
  const updates = [];
  const vals = [];
  let idx = 1;
  for (const key of allowed) {
    if (fields[key] !== undefined) {
      updates.push(`${key} = $${idx++}`);
      vals.push(key === 'code' ? String(fields[key]).toUpperCase() : fields[key]);
    }
  }
  if (!updates.length) return null;
  if (fields.is_default) await pool.query('UPDATE locations SET is_default = false');
  vals.push(id);
  const result = await pool.query(
    `UPDATE locations SET ${updates.join(', ')} WHERE id = $${idx} RETURNING *`,
    vals
  );
  return result.rows[0];
}

module.exports = {
  ensureLocationsTable,
  listLocations,
  getDefaultLocationId,
  createLocation,
  updateLocation,
};
