'use strict';

const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const pool = require('../db/index');
const { authenticateToken, getUserPermissions } = require('../middleware/auth');
const { checkPasswordResetRateLimit } = require('../middleware/rate-limiter');
const { sendEmail, passwordResetEmail, adminApprovalNotificationEmail, pendingApprovalEmail, ADMIN_NOTIFICATION_EMAILS } = require('../email-templates');

const JWT_SECRET = process.env.JWT_SECRET || 'REDACTED';

const router = express.Router();

/** Fire-and-forget signup emails: pending notice to user + admin alert */
function notifySignupPending({ name, email, role }) {
  const signupDate = new Date().toISOString();
  const pending = pendingApprovalEmail({ name, role });
  sendEmail(email, pending.subject, pending.html, pending.text)
    .catch(err => console.error('[signup-pending-email] error:', err.message));

  const admin = adminApprovalNotificationEmail({ userName: name, userEmail: email, userRole: role, signupDate });
  ADMIN_NOTIFICATION_EMAILS.forEach(addr => {
    sendEmail(addr, admin.subject, admin.html, admin.text)
      .catch(err => console.error('[admin-approval-notify] error:', err.message));
  });
}

// Prevent CDN/proxy caching of all auth responses
router.use((req, res, next) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  next();
});

router.post('/register', async (req, res) => {
  try {
    const { email, password, name, role, phone } = req.body;
    if (!email || !password || !name) {
      return res.status(400).json({ error: 'Email, password, and name are required' });
    }
    // Phone required for all roles
    if (!phone || !phone.trim()) {
      return res.status(400).json({ error: 'Phone number is required' });
    }
    const phoneDigits = (phone || '').replace(/\D/g, '');
    if (phoneDigits.length !== 10) {
      return res.status(400).json({ error: 'Please enter a valid 10-digit US phone number' });
    }
    const formattedPhone = `(${phoneDigits.slice(0,3)}) ${phoneDigits.slice(3,6)}-${phoneDigits.slice(6)}`;
    const validRoles = ['student', 'instructor', 'maintenance', 'renter'];
    const userRole = validRoles.includes(role) ? role : 'student';
    // Only block ACTIVE (non-deleted) accounts — soft-deleted users can re-signup
    const existingActive = await pool.query(
      'SELECT id, email, name, role FROM users WHERE LOWER(email) = LOWER($1) AND deleted_at IS NULL',
      [email]
    );
    if (existingActive.rows.length > 0) {
      return res.status(409).json({ error: 'An account with this email already exists' });
    }
    // Reuse a soft-deleted user's email: undelete them and treat as new pending signup
    const existingDeleted = await pool.query(
      'SELECT id, email, name, role FROM users WHERE LOWER(email) = LOWER($1) AND deleted_at IS NOT NULL',
      [email]
    );
    if (existingDeleted.rows.length > 0) {
      const oldUser = existingDeleted.rows[0];
      const passwordHash = await bcrypt.hash(password, 12);
      const formattedPhone = `(${phoneDigits.slice(0,3)}) ${phoneDigits.slice(3,6)}-${phoneDigits.slice(6)}`;
      await pool.query(
        `UPDATE users SET deleted_at = NULL, password_hash = $1, name = $2, phone_number = $3,
         role = $4, approval_status = 'pending', updated_at = NOW() WHERE id = $5`,
        [passwordHash, name, formattedPhone, userRole, oldUser.id]
      );
      res.json({
        user: { id: oldUser.id, email: oldUser.email, name, role: userRole, approval_status: 'pending' },
        pending: true,
        reactivated: true
      });
      // Reactivate as pending — notify user + admins
      notifySignupPending({ name, email, role: userRole });
      return;
    }
    const passwordHash = await bcrypt.hash(password, 12);
    const result = await pool.query(
      `INSERT INTO users (email, name, password_hash, role, phone_number, approval_status)
       VALUES ($1, $2, $3, $4, $5, 'pending')
       RETURNING id, email, name, role, phone_number, approval_status`,
      [email.toLowerCase(), name, passwordHash, userRole, formattedPhone]
    );
    const user = result.rows[0];
    // New users land on pending-approval screen — no token issued, no app access
    res.json({ user: { id: user.id, email: user.email, name: user.name, role: user.role, approval_status: 'pending' }, pending: true });

    // Notify user (pending) and admins of new signup
    notifySignupPending({ name: user.name, email: user.email, role: user.role });
  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ error: 'Registration failed' });
  }
});

// GET /login → JSON 405 (POST only)
router.get('/login', (req, res) => {
  res.status(405).json({ error: 'Method not allowed. Use POST with email and password.' });
});

// Diagnostic endpoint — unique response to verify route reaches Express
router.get('/diagnostic', (req, res) => {
  res.json({ express: true, timestamp: new Date().toISOString(), path: '/api/auth/diagnostic' });
});

// Test GET route — for debugging route registration
router.get('/debug-test', (req, res) => {
  res.json({ ok: true, msg: 'debug route works' });
});

router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }
    const result = await pool.query(
      'SELECT id, email, name, password_hash, role, deleted_at, approval_status, is_instructor FROM users WHERE LOWER(email) = LOWER($1)',
      [email]
    );
    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }
    const user = result.rows[0];
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }
    // Reactivate soft-deleted account on successful login
    if (user.deleted_at) {
      await pool.query('UPDATE users SET deleted_at = NULL, updated_at = NOW() WHERE id = $1', [user.id]);
      console.log(`[auth] Reactivated soft-deleted account: ${user.email} (id=${user.id})`);
    }
    // Account pending approval — correct credentials but not yet activated
    if (user.approval_status === 'pending') {
      return res.status(403).json({ error: 'pending_approval', message: 'Your account is pending approval by an administrator.' });
    }
    const token = jwt.sign(
      { id: user.id, email: user.email, name: user.name, role: user.role },
      JWT_SECRET,
      { expiresIn: '7d' }
    );
    const permissions = await getUserPermissions(user.id, user.role);
    res.cookie('token', token, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', maxAge: 7 * 24 * 60 * 60 * 1000 });
    const response = { user: { id: user.id, email: user.email, name: user.name, role: user.role, is_instructor: !!user.is_instructor, permissions }, token };
    console.log(`[auth] Login OK: ${user.email} (role=${user.role}, id=${user.id})`);
    res.json(response);
  } catch (err) {
    console.error('[auth] Login error:', err.message, err.stack);
    res.status(500).json({ error: 'Login failed' });
  }
});

router.post('/logout', (req, res) => {
  res.clearCookie('token');
  res.json({ ok: true });
});

router.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email is required' });
    if (!checkPasswordResetRateLimit(email)) return res.status(429).json({ error: 'Too many requests. Please wait before trying again.' });
    const result = await pool.query(
      'SELECT id, name, email, deleted_at FROM users WHERE LOWER(email) = LOWER($1)',
      [email]
    );
    if (result.rows.length === 0) {
      // Silent return — don't reveal whether email exists (security)
      // Frontend always shows "check your inbox" anyway
      res.json({ ok: true });
      return;
    }
    const user = result.rows[0];
    // Skip if permanently deleted (approval_status = 'rejected')
    if (user.approval_status === 'rejected') {
      res.json({ ok: true });
      return;
    }
    await pool.query(
      'UPDATE password_reset_tokens SET used_at = NOW() WHERE user_id = $1 AND used_at IS NULL',
      [user.id]
    );
    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
    await pool.query(
      'INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)',
      [user.id, tokenHash, expiresAt]
    );
    const appUrl = process.env.APP_URL || 'https://www.newtechaviation.com';
    const resetUrl = `${appUrl}/app?reset=${rawToken}`;
    const { subject, html, text } = passwordResetEmail({ name: user.name, resetUrl });
    sendEmail(user.email, subject, html, text).catch(err => console.error('[forgot-password] sendEmail error:', err.message));
    res.json({ ok: true });
  } catch (err) {
    console.error('[forgot-password] error:', err.message);
    res.json({ ok: true }); // Still return success even if error — don't reveal internals
  }
});

router.post('/reset-password', async (req, res) => {
  try {
    const { token, password } = req.body;
    if (!token || !password) {
      return res.status(400).json({ error: 'Token and new password are required' });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const result = await pool.query(
      `SELECT prt.id, prt.user_id, prt.expires_at, u.email, u.name
       FROM password_reset_tokens prt
       JOIN users u ON u.id = prt.user_id
       WHERE prt.token_hash = $1 AND prt.used_at IS NULL`,
      [tokenHash]
    );
    if (result.rows.length === 0) {
      return res.status(400).json({ error: 'Invalid or expired reset link. Please request a new one.' });
    }
    const row = result.rows[0];
    if (new Date(row.expires_at) < new Date()) {
      return res.status(400).json({ error: 'This reset link has expired. Please request a new one.' });
    }
    const passwordHash = await bcrypt.hash(password, 12);
    await pool.query('UPDATE users SET password_hash = $1, deleted_at = NULL, updated_at = NOW() WHERE id = $2', [passwordHash, row.user_id]);
    await pool.query('UPDATE password_reset_tokens SET used_at = NOW() WHERE id = $1', [row.id]);
    console.log(`[auth] Password reset + account reactivation for user_id=${row.user_id} (${row.email})`);
    res.json({ ok: true });
  } catch (err) {
    console.error('[reset-password] error:', err.message);
    res.status(500).json({ error: 'Password reset failed' });
  }
});

router.get('/me', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT u.id, u.email, u.name, u.role, u.deleted_at, u.approval_status, u.is_instructor,
         u.total_hobbs_hours, u.total_tach_hours, u.phone_number,
         ip.can_manage_aircraft, ip.can_manage_instructors,
         ip.can_manage_permissions, ip.can_manage_students,
         COALESCE(ip.can_edit_website, false) as can_edit_website
       FROM users u
       LEFT JOIN user_permissions ip ON ip.user_id = u.id
       WHERE u.id = $1`,
      [req.user.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'User not found' });
    if (result.rows[0].deleted_at) return res.status(401).json({ error: 'Account has been deleted' });
    const u = result.rows[0];
    const permissions = ['owner', 'admin'].includes(u.role)
      ? { can_manage_aircraft: true, can_manage_instructors: true, can_manage_permissions: true, can_manage_students: true, can_edit_website: true }
      : {
          can_manage_aircraft: u.can_manage_aircraft || false,
          can_manage_instructors: u.can_manage_instructors || false,
          can_manage_permissions: u.can_manage_permissions || false,
          can_manage_students: u.can_manage_students || false,
          can_edit_website: u.can_edit_website || false,
        };
    let freshToken = null;
    if (u.role !== req.user.role) {
      freshToken = jwt.sign(
        { id: u.id, email: u.email, name: u.name, role: u.role },
        JWT_SECRET,
        { expiresIn: '7d' }
      );
      res.cookie('token', freshToken, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', maxAge: 7 * 24 * 60 * 60 * 1000 });
    }
    const ownerCheck = await pool.query("SELECT id FROM users WHERE role = 'owner' LIMIT 1");
    const response = { user: { id: u.id, email: u.email, name: u.name, role: u.role, is_instructor: !!u.is_instructor, permissions,
      approval_status: u.approval_status || 'approved',
      total_hobbs_hours: u.total_hobbs_hours || 0,
      total_tach_hours: u.total_tach_hours || 0,
      phone_number: u.phone_number || null
    }, hasOwner: ownerCheck.rows.length > 0 };
    if (freshToken) response.token = freshToken;
    res.json(response);
  } catch (err) {
    console.error('[auth] /me error:', err.message, err.stack);
    res.status(500).json({ error: 'Failed to fetch user' });
  }
});

router.post('/claim-owner', authenticateToken, async (req, res) => {
  try {
    const ownerCheck = await pool.query("SELECT id FROM users WHERE role = 'owner'");
    if (ownerCheck.rows.length > 0) {
      return res.status(409).json({ error: 'An owner already exists' });
    }
    const currentRole = await pool.query('SELECT role FROM users WHERE id = $1', [req.user.id]);
    if (['student', 'renter'].includes(currentRole.rows[0]?.role)) {
      return res.status(403).json({ error: 'Students and renters cannot claim owner role' });
    }
    const result = await pool.query(
      "UPDATE users SET role = 'owner', updated_at = NOW() WHERE id = $1 RETURNING id, email, name, role",
      [req.user.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'User not found' });
    const user = result.rows[0];
    const permissions = { can_manage_aircraft: true, can_manage_instructors: true, can_manage_permissions: true, can_manage_students: true };
    const newToken = jwt.sign({ id: user.id, email: user.email, name: user.name, role: 'owner' }, JWT_SECRET, { expiresIn: '7d' });
    res.cookie('token', newToken, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', maxAge: 7 * 24 * 60 * 60 * 1000 });
    res.json({ user: { ...user, permissions }, token: newToken });
  } catch (err) {
    console.error('Claim owner error:', err);
    res.status(500).json({ error: 'Failed to claim owner role' });
  }
});

// Catch-all for unmatched auth routes — ensures all 404s return proper JSON
router.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

module.exports = router;