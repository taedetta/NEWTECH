'use strict';

/**
 * Remove personal/training data for a user account.
 * Keeps endorsements (instructor-visible) and instructor-owned documents.
 */
async function purgeUserPersonalData(client, userId) {
  const db = client || require('../db/index');

  await db.query('DELETE FROM debrief_grades WHERE debrief_id IN (SELECT id FROM flight_debriefs WHERE student_id = $1)', [userId]);
  await db.query('DELETE FROM flight_debriefs WHERE student_id = $1', [userId]);
  await db.query('DELETE FROM student_maneuver_progress WHERE student_id = $1', [userId]);
  await db.query('DELETE FROM student_training WHERE student_id = $1', [userId]);
  await db.query('DELETE FROM flight_logs WHERE student_id = $1', [userId]);
  await db.query('DELETE FROM billing_entries WHERE student_id = $1', [userId]).catch(() => {});
  await db.query('DELETE FROM at_risk_assessments WHERE student_id = $1', [userId]).catch(() => {});
  await db.query('DELETE FROM student_interventions WHERE student_id = $1', [userId]).catch(() => {});
  await db.query('DELETE FROM ground_sessions WHERE student_id = $1', [userId]).catch(() => {});
  await db.query('DELETE FROM feedback WHERE user_id = $1', [userId]).catch(() => {});

  await db.query(
    `UPDATE bookings SET student_id = NULL, updated_at = NOW()
     WHERE student_id = $1 AND status IN ('completed', 'cancelled')`,
    [userId]
  );

  await db.query(
    `UPDATE users SET total_hobbs_hours = 0, total_tach_hours = 0,
     medical_certificate_expiry = NULL, medical_certificate_class = NULL,
     updated_at = NOW() WHERE id = $1`,
    [userId]
  );
}

module.exports = { purgeUserPersonalData };
