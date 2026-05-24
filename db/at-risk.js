'use strict';

// At-risk student assessment queries.
// Owns: at_risk_assessments, student_interventions, school_settings (at_risk_* keys).
// Does NOT own: users, bookings, flight_logs.

const pool = require('./index');

/** Fetch all at-risk threshold settings from school_settings */
async function getThresholds() {
  const keys = ['at_risk_low_days', 'at_risk_medium_days', 'at_risk_high_days', 'at_risk_critical_days'];
  const result = await pool.query(
    `SELECT key, value FROM school_settings WHERE key = ANY($1)`, [keys]
  );
  const defaults = { at_risk_low_days: 14, at_risk_medium_days: 21, at_risk_high_days: 30, at_risk_critical_days: 45 };
  const out = { ...defaults };
  for (const row of result.rows) {
    out[row.key] = parseInt(row.value, 10);
  }
  return out;
}

/** Save threshold settings */
async function saveThresholds({ at_risk_low_days, at_risk_medium_days, at_risk_high_days, at_risk_critical_days }) {
  const entries = [
    ['at_risk_low_days', at_risk_low_days],
    ['at_risk_medium_days', at_risk_medium_days],
    ['at_risk_high_days', at_risk_high_days],
    ['at_risk_critical_days', at_risk_critical_days],
  ];
  for (const [key, value] of entries) {
    await pool.query(
      `INSERT INTO school_settings (key, value, updated_at) VALUES ($1, $2, NOW())
       ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()`,
      [key, String(value)]
    );
  }
}

/**
 * Compute at-risk students.
 * For every student, find their most recent completed booking or flight log,
 * calculate days since that flight, assign a risk level based on thresholds,
 * upsert into at_risk_assessments, and return enriched results.
 */
async function computeAtRiskStudents() {
  const thresholds = await getThresholds();

  // Get all active students with their most recent flight activity and assigned instructor
  const result = await pool.query(`
    WITH last_activity AS (
      SELECT
        u.id AS student_id,
        u.name AS student_name,
        GREATEST(
          (SELECT MAX(b.start_time) FROM bookings b WHERE b.student_id = u.id AND b.status = 'completed'),
          (SELECT MAX(fl.flight_date) FROM flight_logs fl WHERE fl.student_id = u.id)
        ) AS last_flight_date
      FROM users u
      WHERE u.role = 'student' AND u.deleted_at IS NULL
    ),
    assigned_instructor AS (
      SELECT DISTINCT ON (b.student_id)
        b.student_id,
        b.instructor_id,
        i.name AS instructor_name
      FROM bookings b
      JOIN users i ON i.id = b.instructor_id
      WHERE b.status IN ('confirmed', 'completed')
      ORDER BY b.student_id, b.start_time DESC
    )
    SELECT
      la.student_id,
      la.student_name,
      la.last_flight_date,
      COALESCE(ai.instructor_name, NULL) AS instructor_name,
      ara.manual_override_level,
      ara.manual_override_notes
    FROM last_activity la
    LEFT JOIN assigned_instructor ai ON ai.student_id = la.student_id
    LEFT JOIN at_risk_assessments ara ON ara.student_id = la.student_id
  `);

  const students = [];

  for (const row of result.rows) {
    const daysSince = row.last_flight_date
      ? Math.floor((Date.now() - new Date(row.last_flight_date).getTime()) / (1000 * 60 * 60 * 24))
      : 999; // No flight history — extremely inactive

    // Risk score: 0-100 based on days inactive relative to critical threshold
    const riskScore = Math.min(100, Math.round((daysSince / thresholds.at_risk_critical_days) * 100));

    // Determine computed risk level from thresholds
    let computedLevel = 'none';
    if (daysSince >= thresholds.at_risk_critical_days) computedLevel = 'critical';
    else if (daysSince >= thresholds.at_risk_high_days) computedLevel = 'high';
    else if (daysSince >= thresholds.at_risk_medium_days) computedLevel = 'medium';
    else if (daysSince >= thresholds.at_risk_low_days) computedLevel = 'low';

    // Manual override takes precedence
    const effectiveLevel = row.manual_override_level || computedLevel;

    // Upsert assessment row
    await pool.query(`
      INSERT INTO at_risk_assessments (student_id, risk_level, risk_score, days_since_last_flight, last_flight_date, assessed_at)
      VALUES ($1, $2, $3, $4, $5, NOW())
      ON CONFLICT (student_id) DO UPDATE SET
        risk_level = $2, risk_score = $3, days_since_last_flight = $4,
        last_flight_date = $5, assessed_at = NOW()
    `, [row.student_id, effectiveLevel, riskScore, daysSince, row.last_flight_date]);

    // Only include students who are at risk
    if (effectiveLevel !== 'none') {
      students.push({
        student_id: row.student_id,
        student_name: row.student_name,
        instructor_name: row.instructor_name,
        risk_level: effectiveLevel,
        risk_score: riskScore,
        days_since_last_flight: daysSince,
        last_flight_date: row.last_flight_date,
        manual_override_level: row.manual_override_level || null,
        manual_override_notes: row.manual_override_notes || null,
      });
    }
  }

  // Sort by risk score descending (most at-risk first)
  students.sort((a, b) => b.risk_score - a.risk_score);
  return students;
}

/** Set manual override for a student's risk level */
async function setManualOverride(studentId, level, notes, overrideByUserId) {
  // Ensure assessment row exists first
  await pool.query(`
    INSERT INTO at_risk_assessments (student_id, risk_level, risk_score, days_since_last_flight)
    VALUES ($1, 'none', 0, 0)
    ON CONFLICT (student_id) DO NOTHING
  `, [studentId]);

  await pool.query(`
    UPDATE at_risk_assessments
    SET manual_override_level = $1,
        manual_override_notes = $2,
        manual_override_by = $3,
        manual_override_at = NOW()
    WHERE student_id = $4
  `, [level, notes, overrideByUserId, studentId]);
}

/** Get intervention history for a student */
async function getInterventions(studentId) {
  const result = await pool.query(`
    SELECT si.intervention_type, si.outcome, si.notes, u.name AS logged_by_name, si.occurred_at
    FROM student_interventions si
    JOIN users u ON u.id = si.logged_by
    WHERE si.student_id = $1
    ORDER BY si.occurred_at DESC
  `, [studentId]);
  return result.rows;
}

/** Log a new intervention for a student */
async function logIntervention(studentId, loggedByUserId, interventionType, outcome, notes) {
  await pool.query(`
    INSERT INTO student_interventions (student_id, logged_by, intervention_type, outcome, notes)
    VALUES ($1, $2, $3, $4, $5)
  `, [studentId, loggedByUserId, interventionType, outcome, notes]);
}

module.exports = {
  getThresholds,
  saveThresholds,
  computeAtRiskStudents,
  setManualOverride,
  getInterventions,
  logIntervention,
};
