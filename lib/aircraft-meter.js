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

/**
 * Rebuild an aircraft's current meters from remaining authoritative records.
 * Used after destructive history cleanup so removing the latest booking does
 * not leave fleet meters stranded at a deleted reading.
 */
async function recalculateAircraftMeters(client, aircraftId, { source = 'history_delete_recalc' } = {}) {
  if (!aircraftId) return null;
  const acResult = await client.query(
    'SELECT current_hobbs, current_tach, total_hobbs_hours, total_tach_hours FROM aircraft WHERE id = $1 FOR UPDATE',
    [aircraftId]
  );
  if (acResult.rows.length === 0) return null;

  const current = acResult.rows[0];
  const oldHobbs = getMeterHobbs(current);
  const oldTach = getMeterTach(current);
  const readings = await client.query(
    `WITH meter_values AS (
       SELECT 'hobbs'::text AS field, COALESCE(fl.hobbs_end, b.hobbs_end)::numeric AS value
       FROM bookings b
       LEFT JOIN flight_logs fl ON fl.booking_id = b.id
       WHERE b.aircraft_id = $1 AND b.status = 'completed'
         AND COALESCE(fl.hobbs_end, b.hobbs_end) IS NOT NULL
       UNION ALL
       SELECT 'tach'::text AS field, COALESCE(fl.tach_end, b.tach_end)::numeric AS value
       FROM bookings b
       LEFT JOIN flight_logs fl ON fl.booking_id = b.id
       WHERE b.aircraft_id = $1 AND b.status = 'completed'
         AND COALESCE(fl.tach_end, b.tach_end) IS NOT NULL
       UNION ALL
       SELECT field, new_value::numeric AS value
       FROM aircraft_hours_history
       WHERE aircraft_id = $1
         AND field IN ('hobbs', 'tach')
         AND new_value IS NOT NULL
     )
     SELECT
       MAX(value) FILTER (WHERE field = 'hobbs') AS hobbs,
       MAX(value) FILTER (WHERE field = 'tach') AS tach
     FROM meter_values`,
    [aircraftId]
  );
  const nextHobbs = readings.rows[0]?.hobbs != null ? parseFloat(readings.rows[0].hobbs) : oldHobbs;
  const nextTach = readings.rows[0]?.tach != null ? parseFloat(readings.rows[0].tach) : oldTach;
  if (!Number.isFinite(nextHobbs) && !Number.isFinite(nextTach)) return null;

  const sets = [];
  const values = [];
  let idx = 1;
  if (Number.isFinite(nextHobbs)) {
    sets.push(`total_hobbs_hours = $${idx}`, `current_hobbs = $${idx}`);
    values.push(nextHobbs);
    idx++;
  }
  if (Number.isFinite(nextTach)) {
    sets.push(`total_tach_hours = $${idx}`, `current_tach = $${idx}`);
    values.push(nextTach);
    idx++;
  }
  if (!sets.length) return null;
  sets.push('updated_at = NOW()');
  values.push(aircraftId);
  await client.query(`UPDATE aircraft SET ${sets.join(', ')} WHERE id = $${idx}`, values);

  if (Number.isFinite(nextHobbs) && oldHobbs !== nextHobbs) {
    await client.query(
      `INSERT INTO aircraft_hours_history (aircraft_id, field, old_value, new_value, source)
       VALUES ($1, 'hobbs', $2, $3, $4)`,
      [aircraftId, oldHobbs, nextHobbs, source]
    );
  }
  if (Number.isFinite(nextTach) && oldTach !== nextTach) {
    await client.query(
      `INSERT INTO aircraft_hours_history (aircraft_id, field, old_value, new_value, source)
       VALUES ($1, 'tach', $2, $3, $4)`,
      [aircraftId, oldTach, nextTach, source]
    );
  }
  return { hobbs: Number.isFinite(nextHobbs) ? nextHobbs : null, tach: Number.isFinite(nextTach) ? nextTach : null };
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
  recalculateAircraftMeters,
  syncAllAircraftMeterFields,
};
