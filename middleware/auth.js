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
      `SELECT id, email, name, role, deleted_at, approval_status, is_instructor
       FROM users
       WHERE id = $1`,
      [decoded.id]
    );
    if (result.rows.length === 0 || result.rows[0].deleted_at) {
      return res.status(401).json({ error: 'Account is not active' });
    }
    if ((result.rows[0].approval_status || 'approved') !== 'approved') {
      return res.status(403).json({ error: 'Account is not approved' });
    }
    req.user = {
      id: result.rows[0].id,
      email: result.rows[0].email,
      name: result.rows[0].name,
      role: result.rows[0].role,
      is_instructor: !!result.rows[0].is_instructor,
    };
    next();
  } catch (err) {
    if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }
    console.error('Auth verification error:', err.message);
    return res.status(500).json({ error: 'Authentication check failed' });
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