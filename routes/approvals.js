'use strict';
/**
 * Approvals route — manages new user approval queue.
 * Owns: listing/approving/rejecting pending user accounts.
 * Does NOT own: user creation, authentication tokens, role assignment.
 */

const express = require('express');
const pool = require('../db/index');
const { authenticateToken, requireRole } = require('../middleware/auth');
const { sendEmail, approvalConfirmationEmail, rejectionEmail } = require('../email-templates');
const { sendEmailToUser, EMAIL_TYPES } = require('../lib/notification-prefs');

const router = express.Router();

// All approval endpoints require auth. Instructors may help onboard students/renters,
// but only owners/admins may process staff-level accounts.
const canViewApprovals = [authenticateToken, requireRole('owner', 'admin', 'instructor')];
const INSTRUCTOR_APPROVABLE_ROLES = new Set(['student', 'renter']);

function canProcessPendingUser(actor, pendingUser) {
  if (['owner', 'admin'].includes(actor.role)) return true;
  return actor.role === 'instructor' && INSTRUCTOR_APPROVABLE_ROLES.has(pendingUser.role);
}

function approvalRoleWhere(user, alias = '') {
  if (['owner', 'admin'].includes(user.role)) return '';
  const prefix = alias ? `${alias}.` : '';
  return ` AND ${prefix}role IN ('student', 'renter')`;
}

// GET /api/approvals/pending — list all pending users
router.get('/pending', ...canViewApprovals, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, name, email, role, created_at
       FROM users
       WHERE approval_status = 'pending' AND deleted_at IS NULL
       ${approvalRoleWhere(req.user)}
       ORDER BY created_at ASC`
    );
    res.json({ users: result.rows });
  } catch (err) {
    console.error('[approvals] list error:', err.message);
    res.status(500).json({ error: 'Failed to fetch pending approvals' });
  }
});

// GET /api/approvals/count — badge count for sidebar notification
router.get('/count', ...canViewApprovals, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT COUNT(*) AS cnt FROM users WHERE approval_status = 'pending' AND deleted_at IS NULL${approvalRoleWhere(req.user)}`
    );
    res.json({ count: parseInt(result.rows[0].cnt, 10) });
  } catch (err) {
    console.error('[approvals] count error:', err.message);
    res.status(500).json({ error: 'Failed to count pending approvals' });
  }
});

// POST /api/approvals/:id/approve — approve a pending user
router.post('/:id/approve', ...canViewApprovals, async (req, res) => {
  try {
    const { id } = req.params;
    const pending = await pool.query(
      `SELECT id, name, email, role
       FROM users
       WHERE id = $1 AND approval_status = 'pending' AND deleted_at IS NULL`,
      [id]
    );
    if (pending.rows.length === 0) {
      return res.status(404).json({ error: 'User not found or already approved' });
    }
    if (!canProcessPendingUser(req.user, pending.rows[0])) {
      return res.status(403).json({ error: 'Only owners or admins can approve staff accounts' });
    }
    const result = await pool.query(
      `UPDATE users
       SET approval_status = 'approved',
           is_instructor = CASE WHEN role = 'instructor' THEN TRUE ELSE is_instructor END,
           updated_at = NOW()
       WHERE id = $1 AND approval_status = 'pending'
       RETURNING id, name, email, role, is_instructor`,
      [id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found or already approved' });
    }
    const approvedUser = result.rows[0];
    console.log(`[approvals] Approved user ${id} by ${req.user.email}`);

    // Send approval confirmation email to the user
    const { subject, html, text } = approvalConfirmationEmail({
      name: approvedUser.name,
      role: approvedUser.role,
      approvedBy: req.user.name,
    });
    sendEmailToUser(approvedUser.id, approvedUser.email, EMAIL_TYPES.account_approved, subject, html, text)
      .catch(err => console.error('[approval-email] send error:', err.message));

    res.json({ ok: true, user: approvedUser });
  } catch (err) {
    console.error('[approvals] approve error:', err.message);
    res.status(500).json({ error: 'Failed to approve user' });
  }
});

// POST /api/approvals/:id/reject — reject (soft-delete) a pending user
router.post('/:id/reject', ...canViewApprovals, async (req, res) => {
  try {
    const { id } = req.params;
    const pending = await pool.query(
      `SELECT id, name, email, role
       FROM users
       WHERE id = $1 AND approval_status = 'pending' AND deleted_at IS NULL`,
      [id]
    );
    if (pending.rows.length === 0) {
      return res.status(404).json({ error: 'User not found or already processed' });
    }
    if (!canProcessPendingUser(req.user, pending.rows[0])) {
      return res.status(403).json({ error: 'Only owners or admins can reject staff accounts' });
    }
    const result = await pool.query(
      `UPDATE users
       SET approval_status = 'rejected', deleted_at = NOW(), updated_at = NOW()
       WHERE id = $1 AND approval_status = 'pending'
       RETURNING id, name, email, role`,
      [id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found or already processed' });
    }
    const rejectedUser = result.rows[0];
    console.log(`[approvals] Rejected user ${id} by ${req.user.email}`);

    // Send rejection email to the user
    const { subject, html, text } = rejectionEmail({ name: rejectedUser.name });
    sendEmailToUser(rejectedUser.id, rejectedUser.email, EMAIL_TYPES.account_rejected, subject, html, text)
      .catch(err => console.error('[rejection-email] send error:', err.message));

    res.json({ ok: true, user: rejectedUser });
  } catch (err) {
    console.error('[approvals] reject error:', err.message);
    res.status(500).json({ error: 'Failed to reject user' });
  }
});

module.exports = router;
