'use strict';

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
  const hEnd = hobbsEnd != null ? parseFloat(hobbsEnd) : null;
  const tEnd = tachEnd != null ? parseFloat(tachEnd) : null;
  const updateHobbs = Number.isFinite(hEnd) && hEnd >= oldHobbs - 0.1;
  const updateTach = Number.isFinite(tEnd) && tEnd >= oldTach - 0.1;

  const sets = [];
  const vals = [];
  let idx = 1;
  if (updateHobbs) {
    sets.push(`total_hobbs_hours = $${idx}`, `current_hobbs = $${idx}`);
    vals.push(hEnd);
    idx += 1;
  }
  if (updateTach) {
    sets.push(`total_tach_hours = $${idx}`, `current_tach = $${idx}`);
    vals.push(tEnd);
    idx += 1;
  }
  if (sets.length > 0) {
    sets.push('updated_at = NOW()');
    vals.push(aircraftId);
    await client.query(`UPDATE aircraft SET ${sets.join(', ')} WHERE id = $${idx}`, vals);
  }

  if (updateTach) {
    await client.query(
      `INSERT INTO aircraft_hours_history (aircraft_id, booking_id, field, old_value, new_value, source) VALUES ($1, $2, 'tach', $3, $4, $5)`,
      [aircraftId, bookingId, oldTach, tEnd, source]
    );
  }
  if (updateHobbs) {
    await client.query(
      `INSERT INTO aircraft_hours_history (aircraft_id, booking_id, field, old_value, new_value, source) VALUES ($1, $2, 'hobbs', $3, $4, $5)`,
      [aircraftId, bookingId, oldHobbs, hEnd, source]
    );
  }
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
  getMeterHobbs,
  getMeterTach,
  applyAircraftMeterReadings,
  syncAllAircraftMeterFields,
};
