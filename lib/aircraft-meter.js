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
  const submittedHobbs = parseFloat(hobbsEnd);
  if (!Number.isFinite(submittedHobbs)) return;
  const nextHobbs = Math.max(oldHobbs, submittedHobbs);
  const submittedTach = tachEnd != null ? parseFloat(tachEnd) : null;
  const nextTach = Number.isFinite(submittedTach) ? Math.max(oldTach, submittedTach) : null;

  if (nextTach != null) {
    await client.query(
      `UPDATE aircraft SET total_hobbs_hours = $1, current_hobbs = $1, total_tach_hours = $2, current_tach = $2, updated_at = NOW() WHERE id = $3`,
      [nextHobbs, nextTach, aircraftId]
    );
    if (nextTach !== oldTach) {
      await client.query(
        `INSERT INTO aircraft_hours_history (aircraft_id, booking_id, field, old_value, new_value, source) VALUES ($1, $2, 'tach', $3, $4, $5)`,
        [aircraftId, bookingId, oldTach, nextTach, source]
      );
    }
  } else {
    await client.query(
      `UPDATE aircraft SET total_hobbs_hours = $1, current_hobbs = $1, updated_at = NOW() WHERE id = $2`,
      [nextHobbs, aircraftId]
    );
  }
  if (nextHobbs !== oldHobbs) {
    await client.query(
      `INSERT INTO aircraft_hours_history (aircraft_id, booking_id, field, old_value, new_value, source) VALUES ($1, $2, 'hobbs', $3, $4, $5)`,
      [aircraftId, bookingId, oldHobbs, nextHobbs, source]
    );
  }
}

function toFiniteNumber(value) {
  if (value == null || value === '') return null;
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : null;
}

function nearlyEqual(a, b) {
  if (a == null || b == null) return false;
  return Math.abs(a - b) < 0.0001;
}

function maxFinite(values) {
  const finite = values.filter((value) => Number.isFinite(value));
  return finite.length ? Math.max(...finite) : null;
}

async function maxRemainingMeterValue(client, aircraftId, bookingId, field) {
  const history = await client.query(
    `SELECT MAX(new_value)::float AS max_value
     FROM aircraft_hours_history
     WHERE aircraft_id = $1
       AND field = $2
       AND (booking_id IS NULL OR booking_id <> $3)`,
    [aircraftId, field, bookingId]
  );
  const logColumn = field === 'tach' ? 'tach_end' : 'hobbs_end';
  const logs = await client.query(
    `SELECT MAX(${logColumn})::float AS max_value
     FROM flight_logs
     WHERE aircraft_id = $1
       AND (booking_id IS NULL OR booking_id <> $2)
       AND ${logColumn} IS NOT NULL`,
    [aircraftId, bookingId]
  );
  return maxFinite([
    toFiniteNumber(history.rows[0]?.max_value),
    toFiniteNumber(logs.rows[0]?.max_value),
  ]);
}

async function rollbackMeterFieldForDeletedBooking(client, aircraftId, bookingId, field, aircraft, log) {
  const current = field === 'tach' ? getMeterTach(aircraft) : getMeterHobbs(aircraft);
  if (current == null) return null;

  const logStart = field === 'tach' ? toFiniteNumber(log?.tach_start) : toFiniteNumber(log?.hobbs_start);
  const logEnd = field === 'tach' ? toFiniteNumber(log?.tach_end) : toFiniteNumber(log?.hobbs_end);
  const historyResult = await client.query(
    `SELECT old_value, new_value
     FROM aircraft_hours_history
     WHERE aircraft_id = $1 AND booking_id = $2 AND field = $3
     ORDER BY created_at DESC, id DESC
     LIMIT 1`,
    [aircraftId, bookingId, field]
  );
  const history = historyResult.rows[0] || null;
  const deletedNewValue = toFiniteNumber(history?.new_value) ?? logEnd;

  // If a later flight/manual edit has already moved the meter forward, deleting
  // this historical booking must not rewind the live aircraft meter.
  if (!nearlyEqual(current, deletedNewValue)) return null;

  const remainingMax = await maxRemainingMeterValue(client, aircraftId, bookingId, field);
  const replacement = maxFinite([
    toFiniteNumber(history?.old_value),
    logStart,
    remainingMax,
    0,
  ]);
  if (replacement == null || replacement >= current) return null;
  return replacement;
}

async function rollbackAircraftMeterForDeletedBooking(client, aircraftId, bookingId, log = null) {
  if (!aircraftId) return;
  const acResult = await client.query(
    'SELECT current_hobbs, current_tach, total_hobbs_hours, total_tach_hours FROM aircraft WHERE id = $1 FOR UPDATE',
    [aircraftId]
  );
  if (acResult.rows.length === 0) return;
  const aircraft = acResult.rows[0];
  const nextHobbs = await rollbackMeterFieldForDeletedBooking(client, aircraftId, bookingId, 'hobbs', aircraft, log);
  const nextTach = await rollbackMeterFieldForDeletedBooking(client, aircraftId, bookingId, 'tach', aircraft, log);
  const sets = [];
  const params = [];
  let idx = 1;
  if (nextHobbs != null) {
    sets.push(`total_hobbs_hours = $${idx}`, `current_hobbs = $${idx}`);
    params.push(nextHobbs);
    idx += 1;
  }
  if (nextTach != null) {
    sets.push(`total_tach_hours = $${idx}`, `current_tach = $${idx}`);
    params.push(nextTach);
    idx += 1;
  }
  if (!sets.length) return;
  sets.push('updated_at = NOW()');
  params.push(aircraftId);
  await client.query(`UPDATE aircraft SET ${sets.join(', ')} WHERE id = $${idx}`, params);
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
  rollbackAircraftMeterForDeletedBooking,
  syncAllAircraftMeterFields,
};
