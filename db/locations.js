'use strict';

const pool = require('./index');

async function listLocations() {
  const result = await pool.query(
    'SELECT * FROM locations ORDER BY is_default DESC, name ASC'
  );
  return result.rows;
}

async function getDefaultLocationId() {
  const result = await pool.query(
    'SELECT id FROM locations WHERE is_default = true ORDER BY id LIMIT 1'
  );
  return result.rows[0]?.id || null;
}

async function createLocation({ code, name, timezone, weather_station, is_default }) {
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
  listLocations,
  getDefaultLocationId,
  createLocation,
  updateLocation,
};
