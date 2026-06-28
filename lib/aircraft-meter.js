'use strict';

const MAX_METER_READING = 99999;
const NUMERIC_READING_RE = /^-?(?:\d+\.?\d*|\.\d+)$/;

/** Last Hobbs meter reading on any aircraft row. */
function getMeterHobbs(aircraft) {
  if (!aircraft) return null;
  const raw = aircraft.current_hobbs ?? aircraft.total_hobbs_hours;
  if (raw == null || raw === '') return null;
  const n = parseFloat(raw);
  return Number.isFinite(n) ? n : null;
}

/** Last Tach meter reading on any aircraft row. */
function getMeterTach(aircraft) {
  if (!aircraft) return null;
  const raw = aircraft.current_tach ?? aircraft.total_tach_hours;
  if (raw == null || raw === '') return null;
  const n = parseFloat(raw);
  return Number.isFinite(n) ? n : null;
}

function parseMeterReading(value, fieldName) {
  let n;
  if (typeof value === 'number') {
    n = value;
  } else if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed || !NUMERIC_READING_RE.test(trimmed)) {
      return { error: `${fieldName} must be a valid number` };
    }
    n = Number(trimmed);
  } else {
    return { error: `${fieldName} must be a valid number` };
  }

  if (!Number.isFinite(n)) return { error: `${fieldName} must be a valid number` };
  if (n < 0) return { error: `${fieldName} cannot be negative` };
  if (n > MAX_METER_READING) return { error: `${fieldName} exceeds maximum allowed value` };
  return { value: n };
}

function parseOptionalMeterReading(value, fieldName) {
  if (value === undefined) return { provided: false, value: null };
  if (value === null || value === '') return { provided: true, value: null };
  const parsed = parseMeterReading(value, fieldName);
  if (parsed.error) return parsed;
  return { provided: true, value: parsed.value };
}

/**
 * Set aircraft meter to pilot-entered end readings (same logic for every tail number).
 * Updates both current_* and total_* so fleet, maintenance, and post-flight wizard stay aligned.
 */
async function applyAircraftMeterReadings(client, aircraftId, { hobbsEnd, tachEnd, bookingId = null, source = 'flight_complete' }) {
  const acResult = await client.query(
    'SELECT current_hobbs, current_tach, total_hobbs_hours, total_tach_hours FROM aircraft WHERE id = $1',
    [aircraftId]
  );
  if (acResult.rows.length === 0) return;
  const row = acResult.rows[0];
  const oldHobbs = getMeterHobbs(row) ?? 0;
  const oldTach = getMeterTach(row) ?? 0;

  if (tachEnd != null) {
    await client.query(
      `UPDATE aircraft SET total_hobbs_hours = $1, current_hobbs = $1, total_tach_hours = $2, current_tach = $2, updated_at = NOW() WHERE id = $3`,
      [hobbsEnd, tachEnd, aircraftId]
    );
    await client.query(
      `INSERT INTO aircraft_hours_history (aircraft_id, booking_id, field, old_value, new_value, source) VALUES ($1, $2, 'tach', $3, $4, $5)`,
      [aircraftId, bookingId, oldTach, tachEnd, source]
    );
  } else {
    await client.query(
      `UPDATE aircraft SET total_hobbs_hours = $1, current_hobbs = $1, updated_at = NOW() WHERE id = $2`,
      [hobbsEnd, aircraftId]
    );
  }
  await client.query(
    `INSERT INTO aircraft_hours_history (aircraft_id, booking_id, field, old_value, new_value, source) VALUES ($1, $2, 'hobbs', $3, $4, $5)`,
    [aircraftId, bookingId, oldHobbs, hobbsEnd, source]
  );
}

/** Align current/total meter fields for all aircraft (idempotent — runs on deploy). */
async function syncAllAircraftMeterFields(pool) {
  const result = await pool.query(`
    UPDATE aircraft
    SET
      current_hobbs = COALESCE(current_hobbs, total_hobbs_hours),
      current_tach = COALESCE(current_tach, total_tach_hours),
      total_hobbs_hours = COALESCE(current_hobbs, total_hobbs_hours),
      total_tach_hours = COALESCE(current_tach, total_tach_hours),
      updated_at = NOW()
    WHERE COALESCE(status, 'available') != 'deleted'
    RETURNING id, tail_number
  `);
  if (result.rowCount > 0) {
    console.log(`[aircraft-meter] Aligned Hobbs/Tach meter fields for ${result.rowCount} aircraft`);
  }
  return result.rowCount;
}

module.exports = {
  MAX_METER_READING,
  getMeterHobbs,
  getMeterTach,
  parseMeterReading,
  parseOptionalMeterReading,
  applyAircraftMeterReadings,
  syncAllAircraftMeterFields,
};
