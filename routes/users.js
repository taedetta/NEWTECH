'use strict';

const express = require('express');
const bcrypt = require('bcryptjs');
const pool = require('../db/index');
const { purgeUserPersonalData } = require('../lib/user-lifecycle');
const { isPlatformAdminEmail } = require('../lib/platform-admin');
const { authenticateToken, requireRole, getUserPermissions } = require('../middleware/auth');
const { inviteEmail, sendEmail } = require('../email-templates');
const { BOOKABLE_INSTRUCTOR_WHERE } = require('../lib/instructors');
const { buildFspWorkbook, buildFspCsv } = require('../lib/fsp-people-export');

const router = express.Router();

// GET /api/users
router.get('/', authenticateToken, async (req, res) => {
  try {
    const { role } = req.query;
    const requesterRole = req.user.role;
    if (['student', 'renter'].includes(requesterRole)) {
      // Renters and students only see instructors/admins/owners in their user list
      const result = await pool.query(
        `SELECT u.id, u.name, u.role, u.is_instructor,
          EXISTS (SELECT 1 FROM instructor_availability WHERE instructor_id = u.id) as has_instructor_availability
         FROM users u
         WHERE ${BOOKABLE_INSTRUCTOR_WHERE}
         ORDER BY u.name`
      );
      return res.json(result.rows);
    }
    let query = `
      SELECT u.id, u.email, u.name, u.role, u.is_instructor, u.created_at,
        u.total_hobbs_hours, u.total_tach_hours, u.instructor_rate, u.phone_number,
        u.medical_certificate_expiry, u.medical_certificate_class,
        (SELECT COUNT(DISTINCT st.student_id)::int FROM student_training st
         WHERE st.instructor_id = u.id AND st.status = 'active') AS assigned_students,
        COALESCE(ip.can_manage_aircraft, false) as can_manage_aircraft,
        COALESCE(ip.can_manage_instructors, false) as can_manage_instructors,
        COALESCE(ip.can_manage_permissions, false) as can_manage_permissions,
        COALESCE(ip.can_manage_students, false) as can_manage_students,
        COALESCE(ip.can_edit_website, false) as can_edit_website,
        EXISTS (SELECT 1 FROM instructor_availability WHERE instructor_id = u.id) as has_instructor_availability
      FROM users u
      LEFT JOIN user_permissions ip ON ip.user_id = u.id
      WHERE u.deleted_at IS NULL
    `;
    const params = [];
    if (role === 'instructor') {
      query += ` AND (u.is_instructor = TRUE OR u.role = 'instructor')`;
    } else if (role) {
      query += ' AND u.role = $1';
      params.push(role);
    }
    query += ' ORDER BY u.name';
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    console.error('Users list error:', err);
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

// GET /api/users/export/fsp — Flight Schedule Pro people import file
router.get('/export/fsp', authenticateToken, async (req, res) => {
  try {
    const requesterRole = req.user.role;
    if (['student', 'renter'].includes(requesterRole)) {
      return res.status(403).json({ error: 'Not authorized to export users' });
    }
    const requesterPerms = await getUserPermissions(req.user.id, requesterRole);
    const canExport = ['owner', 'admin'].includes(requesterRole)
      || requesterPerms.can_manage_permissions
      || requesterPerms.can_manage_students
      || requesterPerms.can_manage_instructors;
    if (!canExport) {
      return res.status(403).json({ error: 'You need user management permissions to export people' });
    }

    const location = String(req.query.location || '').trim();
    if (!location) {
      return res.status(400).json({
        error: 'Location is required — enter the location name used in your scheduling software.',
      });
    }
    const defaultLocation = String(req.query.default_location || '').trim();
    const companyName = String(req.query.company_name || 'New Tech Aviation').trim();
    const format = String(req.query.format || 'xlsx').toLowerCase() === 'csv' ? 'csv' : 'xlsx';
    const { role } = req.query;

    let query = `
      SELECT u.id, u.email, u.name, u.role, u.is_instructor, u.phone_number, u.approval_status
      FROM users u
      WHERE u.deleted_at IS NULL
    `;
    const params = [];
    if (role === 'instructor') {
      query += ` AND (u.is_instructor = TRUE OR u.role = 'instructor')`;
    } else if (role && role !== 'all') {
      params.push(role);
      query += ` AND u.role = $${params.length}`;
    }
    query += ' ORDER BY u.name';

    const result = await pool.query(query, params);
    const users = result.rows.filter(u => u.approval_status !== 'rejected');

    const exportOptions = { location, defaultLocation, companyName };
    const dateStamp = new Date().toISOString().slice(0, 10);
    const filterSuffix = role && role !== 'all' ? `-${role}` : '';
    const baseName = `people-export${filterSuffix}-${dateStamp}`;

    if (format === 'csv') {
      const buf = buildFspCsv(users, exportOptions);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${baseName}.csv"`);
      return res.send(buf);
    }

    const buf = buildFspWorkbook(users, exportOptions);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${baseName}.xlsx"`);
    return res.send(buf);
  } catch (err) {
    console.error('FSP people export error:', err);
    res.status(500).json({ error: 'Failed to export people' });
  }
});

// POST /api/users/invite
router.post('/invite', authenticateToken, async (req, res) => {
  try {
    const { email, name, role, password } = req.body;
    if (!email || !name || !password) {
      return res.status(400).json({ error: 'Email, name, and password are required' });
    }
    const validRoles = ['student', 'instructor'];
    const targetRole = validRoles.includes(role) ? role : 'student';
    const requesterPerms = await getUserPermissions(req.user.id, req.user.role);
    if (req.user.role !== 'owner') {
      if (targetRole === 'instructor' && !requesterPerms.can_manage_instructors) {
        return res.status(403).json({ error: 'You need the "Manage Instructors" permission to add instructors' });
      }
      if (targetRole === 'student' && !requesterPerms.can_manage_students) {
        return res.status(403).json({ error: 'You need the "Manage Students" permission to add students' });
      }
    }
    const existing = await pool.query(
      'SELECT id FROM users WHERE LOWER(email) = LOWER($1) AND deleted_at IS NULL',
      [email]
    );
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'An account with this email already exists' });
    }
    const passwordHash = await bcrypt.hash(password, 12);
    const isInstructorRole = targetRole === 'instructor';
    const result = await pool.query(
      `INSERT INTO users (email, name, password_hash, role, is_instructor, approval_status)
       VALUES ($1, $2, $3, $4, $5, 'approved') RETURNING id, email, name, role, created_at`,
      [email.toLowerCase(), name, passwordHash, targetRole, isInstructorRole]
    );
    res.status(201).json(result.rows[0]);
    const { subject, html, text } = inviteEmail({
      name,
      email: email.toLowerCase(),
      password,
      role: targetRole,
      invitedByName: req.user.name || null,
    });
    sendEmail(email.toLowerCase(), subject, html, text).catch(err => console.error('[invite-email] error:', err.message));
  } catch (err) {
    console.error('Invite user error:', err);
    res.status(500).json({ error: 'Failed to create user' });
  }
});

// PATCH /api/users/:id/rate
router.patch('/:id/rate', authenticateToken, async (req, res) => {
  try {
    if (!['owner', 'admin'].includes(req.user.role)) return res.status(403).json({ error: 'Only the owner or admin can set instructor rates' });
    const targetId = parseInt(req.params.id);
    const { instructor_rate } = req.body;
    if (instructor_rate === undefined) return res.status(400).json({ error: 'instructor_rate is required' });
    const result = await pool.query(
      `UPDATE users SET instructor_rate = $1, updated_at = NOW() WHERE id = $2 RETURNING id, name, instructor_rate`,
      [parseFloat(instructor_rate), targetId]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'User not found' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Instructor rate error:', err);
    res.status(500).json({ error: 'Failed to update instructor rate' });
  }
});

// DELETE /api/users/:id
router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    const targetId = parseInt(req.params.id);
    if (targetId === req.user.id) return res.status(403).json({ error: 'Cannot delete your own account' });
    const targetResult = await pool.query(
      'SELECT id, role, name, email, deleted_at FROM users WHERE id = $1', [targetId]
    );
    if (targetResult.rows.length === 0) return res.status(404).json({ error: 'User not found' });
    if (targetResult.rows[0].deleted_at) return res.status(404).json({ error: 'User not found' });
    const target = targetResult.rows[0];
    if (isPlatformAdminEmail(target.email)) {
      return res.status(403).json({ error: 'Cannot remove the platform administrator account' });
    }
    const requesterResult = await pool.query(
      'SELECT role FROM users WHERE id = $1 AND deleted_at IS NULL', [req.user.id]
    );
    const requesterRole = requesterResult.rows[0]?.role;
    if (target.role === 'owner' && !['owner', 'admin'].includes(requesterRole)) {
      return res.status(403).json({ error: 'Only owners and admins can remove owner accounts' });
    }
    const requesterPerms = await getUserPermissions(req.user.id, requesterRole);
    const allowed = ['owner', 'admin'].includes(requesterRole) ||
      (target.role === 'instructor' && requesterPerms.can_manage_instructors) ||
      (target.role === 'student' && requesterPerms.can_manage_students);
    if (!allowed) return res.status(403).json({ error: 'Insufficient permissions to remove this user' });
    const futureBookings = await pool.query(
      `SELECT COUNT(*) FROM bookings WHERE (student_id = $1 OR instructor_id = $1) AND end_time > NOW() AND status != 'cancelled'`,
      [targetId]
    );
    if (parseInt(futureBookings.rows[0].count) > 0) {
      await pool.query(
        `UPDATE bookings SET status = 'cancelled', updated_at = NOW()
         WHERE (student_id = $1 OR instructor_id = $1)
           AND end_time > NOW()
           AND status != 'cancelled'`,
        [targetId]
      );
    }
    await purgeUserPersonalData(pool, targetId);
    await pool.query(
      `UPDATE users SET deleted_at = NOW(), password_hash = NULL, updated_at = NOW() WHERE id = $1`,
      [targetId]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error('Delete user error:', err);
    res.status(500).json({ error: 'Failed to remove user' });
  }
});

// PATCH /api/users/:id/privileges — toggle admin/owner access (owners manage both; admins/perm-managers manage admin only)
router.patch('/:id/privileges', authenticateToken, async (req, res) => {
  try {
    const requesterResult = await pool.query(
      'SELECT role FROM users WHERE id = $1 AND deleted_at IS NULL',
      [req.user.id]
    );
    if (!requesterResult.rows.length) {
      return res.status(403).json({ error: 'Not authorized' });
    }
    const requesterRole = requesterResult.rows[0].role;
    const requesterPerms = await getUserPermissions(req.user.id, requesterRole);
    const canGrantAdmin = ['owner', 'admin'].includes(requesterRole) || requesterPerms.can_manage_permissions;
    const canGrantOwner = requesterRole === 'owner';

    const targetId = parseInt(req.params.id, 10);
    if (!Number.isFinite(targetId)) {
      return res.status(400).json({ error: 'Invalid user id' });
    }
    if (targetId === req.user.id) {
      return res.status(403).json({ error: 'You cannot change your own privileges' });
    }

    const { admin_access, owner_access } = req.body;
    if (admin_access === undefined && owner_access === undefined) {
      return res.status(400).json({ error: 'Provide admin_access and/or owner_access' });
    }
    if (owner_access !== undefined && !canGrantOwner) {
      return res.status(403).json({ error: 'Only owners can grant or revoke owner access' });
    }
    if (admin_access !== undefined && !canGrantAdmin) {
      return res.status(403).json({ error: 'Insufficient permissions to change admin access' });
    }

    const targetResult = await pool.query(
      'SELECT id, role, name, email, is_instructor FROM users WHERE id = $1 AND deleted_at IS NULL',
      [targetId]
    );
    if (targetResult.rows.length === 0) return res.status(404).json({ error: 'User not found' });
    const target = targetResult.rows[0];

    if (isPlatformAdminEmail(target.email) && owner_access === true) {
      return res.status(403).json({ error: 'This account stays Admin/Instructor in the UI; it already has full management access' });
    }

    let newRole = target.role;

    if (owner_access === true) {
      newRole = 'owner';
    } else if (owner_access === false && target.role === 'owner') {
      const ownerCount = await pool.query(
        "SELECT COUNT(*) FROM users WHERE role = 'owner' AND deleted_at IS NULL"
      );
      if (parseInt(ownerCount.rows[0].count, 10) <= 1) {
        return res.status(403).json({ error: 'Cannot remove the last owner' });
      }
      newRole = target.is_instructor ? 'instructor' : 'admin';
    } else if (admin_access === true && target.role !== 'owner') {
      newRole = 'admin';
    } else if (admin_access === false && target.role === 'admin') {
      newRole = target.is_instructor ? 'instructor' : 'student';
    }

    if (newRole === target.role) {
      return res.json({
        ok: true,
        id: targetId,
        role: newRole,
        admin_access: newRole === 'admin' || newRole === 'owner',
        owner_access: newRole === 'owner',
        unchanged: true,
      });
    }

    if (target.role === 'owner' && newRole !== 'owner') {
      const ownerCount = await pool.query(
        "SELECT COUNT(*) FROM users WHERE role = 'owner' AND deleted_at IS NULL"
      );
      if (parseInt(ownerCount.rows[0].count, 10) <= 1) {
        return res.status(403).json({ error: 'Cannot remove the last owner' });
      }
    }

    const setInstructor = newRole === 'instructor';
    await pool.query(
      `UPDATE users SET role = $1,
        is_instructor = CASE WHEN $3 THEN TRUE ELSE is_instructor END,
        updated_at = NOW()
       WHERE id = $2`,
      [newRole, targetId, setInstructor]
    );
    pool.query(
      `INSERT INTO admin_audit_log (action, performed_by, details) VALUES ($1, $2, $3)`,
      ['change_privileges', req.user.id, JSON.stringify({
        user_id: targetId,
        user_name: target.name,
        from: target.role,
        to: newRole,
        admin_access,
        owner_access,
      })]
    ).catch(e => console.error('[audit] privilege change log failed:', e.message));

    res.json({
      ok: true,
      id: targetId,
      role: newRole,
      admin_access: newRole === 'admin' || newRole === 'owner',
      owner_access: newRole === 'owner',
    });
  } catch (err) {
    console.error('Privilege change error:', err);
    res.status(500).json({ error: 'Failed to update privileges' });
  }
});

// PATCH /api/users/:id/role — owner/admin: change a user's role
router.patch('/:id/role', authenticateToken, async (req, res) => {
  try {
    const requester = await pool.query(
      'SELECT role FROM users WHERE id = $1 AND deleted_at IS NULL',
      [req.user.id]
    );
    if (!requester.rows.length || !['owner', 'admin'].includes(requester.rows[0].role)) {
      return res.status(403).json({ error: 'Only owners and admins can change user roles' });
    }
    const targetId = parseInt(req.params.id, 10);
    if (!Number.isFinite(targetId)) {
      return res.status(400).json({ error: 'Invalid user id' });
    }
    if (targetId === req.user.id) {
      return res.status(403).json({ error: 'You cannot change your own role' });
    }
    const { role } = req.body;
    const validRoles = ['student', 'instructor', 'admin', 'renter', 'owner', 'maintenance'];
    if (!role || !validRoles.includes(role)) {
      return res.status(400).json({ error: 'Invalid role. Must be one of: ' + validRoles.join(', ') });
    }
    const targetResult = await pool.query(
      'SELECT id, role, name, email FROM users WHERE id = $1 AND deleted_at IS NULL', [targetId]
    );
    if (targetResult.rows.length === 0) return res.status(404).json({ error: 'User not found' });
    const target = targetResult.rows[0];
    if (isPlatformAdminEmail(target.email) && role === 'owner') {
      return res.status(403).json({ error: 'This account stays Admin/Instructor in the UI; it already has full management access' });
    }
    if (target.role === role) {
      return res.json({ ok: true, id: targetId, role, unchanged: true });
    }
    // Protect last owner
    if (target.role === 'owner' && role !== 'owner') {
      const ownerCount = await pool.query(
        "SELECT COUNT(*) FROM users WHERE role = 'owner' AND deleted_at IS NULL"
      );
      if (parseInt(ownerCount.rows[0].count, 10) <= 1) {
        return res.status(403).json({ error: 'Cannot change the last owner\'s role' });
      }
    }
    const setInstructor = role === 'instructor';
    await pool.query(
      `UPDATE users SET role = $1,
        is_instructor = CASE WHEN $3 THEN TRUE ELSE is_instructor END,
        updated_at = NOW()
       WHERE id = $2`,
      [role, targetId, setInstructor]
    );
    pool.query(
      `INSERT INTO admin_audit_log (action, performed_by, details) VALUES ($1, $2, $3)`,
      ['change_role', req.user.id, JSON.stringify({ user_id: targetId, user_name: target.name, from: target.role, to: role })]
    ).catch(e => console.error('[audit] role change log failed:', e.message));
    res.json({ ok: true, id: targetId, role });
  } catch (err) {
    console.error('Role change error:', err);
    res.status(500).json({ error: 'Failed to change role' });
  }
});

// PATCH /api/users/:id/instructor-status — owner/admin: toggle is_instructor boolean
// Instructor status is independent of role — any user can be marked as an instructor
// regardless of their role (student can be CFI, owner can be non-instructor, etc.)
router.patch('/:id/instructor-status', authenticateToken, async (req, res) => {
  try {
    const requester = await pool.query(
      'SELECT role FROM users WHERE id = $1 AND deleted_at IS NULL',
      [req.user.id]
    );
    if (!requester.rows.length || !['owner', 'admin'].includes(requester.rows[0].role)) {
      return res.status(403).json({ error: 'Only owners and admins can change instructor status' });
    }
    const targetId = parseInt(req.params.id, 10);
    if (!Number.isFinite(targetId)) {
      return res.status(400).json({ error: 'Invalid user id' });
    }
    if (targetId === req.user.id) {
      return res.status(403).json({ error: 'You cannot change your own instructor status' });
    }
    const { is_instructor } = req.body;
    if (typeof is_instructor !== 'boolean') {
      return res.status(400).json({ error: 'is_instructor must be a boolean' });
    }
    const targetResult = await pool.query(
      'SELECT id, name, role FROM users WHERE id = $1 AND deleted_at IS NULL', [targetId]
    );
    if (targetResult.rows.length === 0) return res.status(404).json({ error: 'User not found' });
    const target = targetResult.rows[0];
    await pool.query('UPDATE users SET is_instructor = $1, updated_at = NOW() WHERE id = $2', [is_instructor, targetId]);
    pool.query(
      `INSERT INTO admin_audit_log (action, performed_by, details) VALUES ($1, $2, $3)`,
      ['change_instructor_status', req.user.id, JSON.stringify({ user_id: targetId, user_name: target.name, is_instructor })]
    ).catch(e => console.error('[audit] instructor status change log failed:', e.message));
    res.json({ ok: true, id: targetId, is_instructor });
  } catch (err) {
    console.error('Instructor status change error:', err);
    res.status(500).json({ error: 'Failed to change instructor status' });
  }
});

// PUT /api/users/:id/hours — admin/owner: manually set student cumulative hours
router.put('/:id/hours', authenticateToken, async (req, res) => {
  try {
    if (!['owner', 'admin'].includes(req.user.role)) {
      return res.status(403).json({ error: 'Only owners and admins can edit student hours' });
    }
    const userId = parseInt(req.params.id);
    const { total_hobbs_hours, total_tach_hours } = req.body;
    if (total_hobbs_hours === undefined && total_tach_hours === undefined) {
      return res.status(400).json({ error: 'No hours provided' });
    }
    const updates = [];
    const vals = [];
    let idx = 1;
    if (total_hobbs_hours !== undefined) { updates.push(`total_hobbs_hours = $${idx++}`); vals.push(parseFloat(total_hobbs_hours)); }
    if (total_tach_hours !== undefined)  { updates.push(`total_tach_hours = $${idx++}`);  vals.push(parseFloat(total_tach_hours)); }
    vals.push(userId);
    const result = await pool.query(
      `UPDATE users SET ${updates.join(', ')} WHERE id = $${idx} RETURNING id, name, total_hobbs_hours, total_tach_hours`,
      vals
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'User not found' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('User hours update error:', err);
    res.status(500).json({ error: 'Failed to update user hours' });
  }
});

module.exports = router;