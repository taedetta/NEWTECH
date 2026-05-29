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

const router = express.Router();

// Approval decisions must remain with account administrators.
const canApprove = [authenticateToken, requireRole('owner', 'admin')];

// GET /api/approvals/pending — list all pending users
router.get('/pending', ...canApprove, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, name, email, role, created_at
       FROM users
       WHERE approval_status = 'pending' AND deleted_at IS NULL
       ORDER BY created_at ASC`
    );
    res.json({ users: result.rows });
  } catch (err) {
    console.error('[approvals] list error:', err.message);
    res.status(500).json({ error: 'Failed to fetch pending approvals' });
  }
});

// GET /api/approvals/count — badge count for sidebar notification
router.get('/count', ...canApprove, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT COUNT(*) AS cnt FROM users WHERE approval_status = 'pending' AND deleted_at IS NULL`
    );
    res.json({ count: parseInt(result.rows[0].cnt, 10) });
  } catch (err) {
    console.error('[approvals] count error:', err.message);
    res.status(500).json({ error: 'Failed to count pending approvals' });
  }
});

// POST /api/approvals/:id/approve — approve a pending user
router.post('/:id/approve', ...canApprove, async (req, res) => {
  try {
    const { id } = req.params;
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
    sendEmail(approvedUser.email, subject, html, text).catch(err => console.error('[approval-email] send error:', err.message));

    res.json({ ok: true, user: approvedUser });
  } catch (err) {
    console.error('[approvals] approve error:', err.message);
    res.status(500).json({ error: 'Failed to approve user' });
  }
});

// POST /api/approvals/:id/reject — reject (soft-delete) a pending user
router.post('/:id/reject', ...canApprove, async (req, res) => {
  try {
    const { id } = req.params;
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
    sendEmail(rejectedUser.email, subject, html, text).catch(err => console.error('[rejection-email] send error:', err.message));

    res.json({ ok: true, user: rejectedUser });
  } catch (err) {
    console.error('[approvals] reject error:', err.message);
    res.status(500).json({ error: 'Failed to reject user' });
  }
});

module.exports = router;
