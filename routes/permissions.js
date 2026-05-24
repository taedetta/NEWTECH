'use strict';

const express = require('express');
const pool = require('../db/index');
const { authenticateToken, getUserPermissions } = require('../middleware/auth');

const router = express.Router();

// GET /api/permissions
router.get('/', authenticateToken, async (req, res) => {
  try {
    if (!['owner', 'admin'].includes(req.user.role)) {
      const perms = await getUserPermissions(req.user.id, req.user.role);
      if (!perms.can_manage_permissions) {
        return res.status(403).json({ error: 'Insufficient permissions' });
      }
    }
    const result = await pool.query(`
      SELECT u.id, u.name, u.email, u.is_instructor,
        COALESCE(ip.can_manage_aircraft, false) as can_manage_aircraft,
        COALESCE(ip.can_manage_instructors, false) as can_manage_instructors,
        COALESCE(ip.can_manage_permissions, false) as can_manage_permissions,
        COALESCE(ip.can_manage_students, false) as can_manage_students,
        COALESCE(ip.can_edit_website, false) as can_edit_website
      FROM users u
      LEFT JOIN user_permissions ip ON ip.user_id = u.id
      WHERE u.role IN ('instructor', 'admin') OR u.is_instructor = true
      ORDER BY u.name
    `);
    res.json(result.rows);
  } catch (err) {
    console.error('Permissions list error:', err);
    res.status(500).json({ error: 'Failed to fetch permissions' });
  }
});

// PATCH /api/permissions/:userId
router.patch('/:userId', authenticateToken, async (req, res) => {
  try {
    if (!['owner', 'admin'].includes(req.user.role)) {
      const myPerms = await getUserPermissions(req.user.id, req.user.role);
      if (!myPerms.can_manage_permissions) {
        return res.status(403).json({ error: 'Insufficient permissions' });
      }
    }
    const targetId = parseInt(req.params.userId);
    const target = await pool.query('SELECT role FROM users WHERE id = $1', [targetId]);
    if (target.rows.length === 0) return res.status(404).json({ error: 'User not found' });
    if (target.rows[0].role === 'owner') {
      return res.status(403).json({ error: 'Cannot modify owner permissions' });
    }
    if (target.rows[0].role === 'student') {
      return res.status(403).json({ error: 'Students cannot be granted management permissions' });
    }
    const existing = await getUserPermissions(targetId, target.rows[0].role);
    const merged = {
      can_manage_aircraft: req.body.can_manage_aircraft !== undefined ? !!req.body.can_manage_aircraft : existing.can_manage_aircraft,
      can_manage_instructors: req.body.can_manage_instructors !== undefined ? !!req.body.can_manage_instructors : existing.can_manage_instructors,
      can_manage_permissions: req.body.can_manage_permissions !== undefined ? !!req.body.can_manage_permissions : existing.can_manage_permissions,
      can_manage_students: req.body.can_manage_students !== undefined ? !!req.body.can_manage_students : existing.can_manage_students,
      can_edit_website: req.body.can_edit_website !== undefined ? !!req.body.can_edit_website : existing.can_edit_website,
    };
    const result = await pool.query(`
      INSERT INTO user_permissions
        (user_id, can_manage_aircraft, can_manage_instructors, can_manage_permissions, can_manage_students, can_edit_website, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, NOW())
      ON CONFLICT (user_id) DO UPDATE SET
        can_manage_aircraft = $2,
        can_manage_instructors = $3,
        can_manage_permissions = $4,
        can_manage_students = $5,
        can_edit_website = $6,
        updated_at = NOW()
      RETURNING *
    `, [targetId, merged.can_manage_aircraft, merged.can_manage_instructors, merged.can_manage_permissions, merged.can_manage_students, merged.can_edit_website]);
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Permissions update error:', err);
    res.status(500).json({ error: 'Failed to update permissions' });
  }
});

module.exports = router;