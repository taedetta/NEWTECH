'use strict';

const FULL_PERMISSIONS = {
  can_manage_aircraft: true,
  can_manage_instructors: true,
  can_manage_permissions: true,
  can_manage_students: true,
  can_edit_website: true,
};

async function upsertFullUserPermissions(pool, userId) {
  const existing = await pool.query('SELECT user_id FROM user_permissions WHERE user_id = $1', [userId]);
  if (existing.rows.length) {
    await pool.query(
      `UPDATE user_permissions SET
         can_manage_aircraft = TRUE,
         can_manage_instructors = TRUE,
         can_manage_permissions = TRUE,
         can_manage_students = TRUE,
         can_edit_website = TRUE,
         updated_at = NOW()
       WHERE user_id = $1`,
      [userId]
    );
  } else {
    await pool.query(
      `INSERT INTO user_permissions
         (user_id, can_manage_aircraft, can_manage_instructors, can_manage_permissions, can_manage_students, can_edit_website)
       VALUES ($1, TRUE, TRUE, TRUE, TRUE, TRUE)`,
      [userId]
    );
  }
}

module.exports = { FULL_PERMISSIONS, upsertFullUserPermissions };
