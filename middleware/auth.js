'use strict';

const jwt = require('jsonwebtoken');
const pool = require('../db/index');

const JWT_SECRET = process.env.JWT_SECRET || 'REDACTED';

async function authenticateToken(req, res, next) {
  const token = req.cookies?.token || req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Authentication required' });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const result = await pool.query(
      `SELECT id, email, name, role, is_instructor, approval_status
       FROM users
       WHERE id = $1
         AND deleted_at IS NULL
         AND COALESCE(approval_status, 'approved') = 'approved'`,
      [decoded.id]
    );
    if (result.rows.length === 0) {
      res.clearCookie?.('token');
      return res.status(401).json({ error: 'Account is no longer active' });
    }
    const liveUser = result.rows[0];
    req.user = {
      ...decoded,
      id: liveUser.id,
      email: liveUser.email,
      name: liveUser.name,
      role: liveUser.role,
      is_instructor: !!liveUser.is_instructor,
      approval_status: liveUser.approval_status || 'approved',
    };
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    next();
  };
}

async function getUserPermissions(userId, role) {
  if (role === 'owner' || role === 'admin') {
    return {
      can_manage_aircraft: true,
      can_manage_instructors: true,
      can_manage_permissions: true,
      can_manage_students: true,
      can_edit_website: true,
    };
  }
  if (role === 'maintenance') {
    return {
      can_manage_aircraft: true,
      can_manage_instructors: false,
      can_manage_permissions: false,
      can_manage_students: false,
      can_edit_website: false,
    };
  }
  if (role !== 'instructor') {
    return {
      can_manage_aircraft: false,
      can_manage_instructors: false,
      can_manage_permissions: false,
      can_manage_students: false,
      can_edit_website: false,
    };
  }
  const result = await pool.query(
    `SELECT can_manage_aircraft, can_manage_instructors, can_manage_permissions, can_manage_students,
            COALESCE(can_edit_website, false) as can_edit_website
     FROM user_permissions WHERE user_id = $1`,
    [userId]
  );
  if (result.rows.length === 0) {
    return { can_manage_aircraft: false, can_manage_instructors: false, can_manage_permissions: false, can_manage_students: false, can_edit_website: false };
  }
  return result.rows[0];
}

function requirePermission(permKey) {
  return async (req, res, next) => {
    try {
      if (['owner', 'admin'].includes(req.user.role)) return next();
      if (req.user.role === 'maintenance') {
        if (permKey === 'can_manage_aircraft') return next();
        return res.status(403).json({ error: 'Insufficient permissions' });
      }
      if (req.user.role !== 'instructor') {
        return res.status(403).json({ error: 'Insufficient permissions' });
      }
      const perms = await getUserPermissions(req.user.id, req.user.role);
      if (!perms[permKey]) {
        return res.status(403).json({ error: 'Insufficient permissions' });
      }
      next();
    } catch (err) {
      console.error('Permission check error:', err);
      res.status(500).json({ error: 'Permission check failed' });
    }
  };
}

module.exports = { authenticateToken, requireRole, requirePermission, getUserPermissions };