'use strict';

const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../db/index');
const { authenticateToken } = require('../middleware/auth');
const { getPrefs, updatePrefs, ensureDefaultPrefs } = require('../db/notification-prefs');
const { EMAIL_TYPES, getPreferenceCatalog } = require('../lib/notification-prefs');
const { sendEmailToUser } = require('../lib/notification-prefs');
const { isRequiredEmailType } = require('../lib/email-types');
const { profileChangeEmail } = require('../email-templates');

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'REDACTED';

function formatPhone(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (digits.length !== 10) return null;
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}

router.get('/profile', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, email, name, role, phone_number, is_instructor
       FROM users WHERE id = $1 AND deleted_at IS NULL`,
      [req.user.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'User not found' });
    const u = result.rows[0];
    res.json({
      profile: {
        id: u.id,
        email: u.email,
        name: u.name,
        phone_number: u.phone_number || '',
        role: u.role,
        is_instructor: !!u.is_instructor,
      },
    });
  } catch (err) {
    console.error('[profile] GET error:', err.message);
    res.status(500).json({ error: 'Failed to load profile' });
  }
});

router.patch('/profile', authenticateToken, async (req, res) => {
  try {
    const { name, email, phone_number } = req.body || {};
    const before = await pool.query(
      'SELECT email, phone_number, name FROM users WHERE id = $1 AND deleted_at IS NULL',
      [req.user.id]
    );
    if (before.rows.length === 0) return res.status(404).json({ error: 'User not found' });
    const prev = before.rows[0];

    const updates = [];
    const vals = [];
    let i = 1;

    if (name !== undefined) {
      const trimmed = String(name).trim();
      if (!trimmed) return res.status(400).json({ error: 'Name is required' });
      updates.push(`name = $${i++}`);
      vals.push(trimmed);
    }

    if (email !== undefined) {
      const trimmed = String(email).trim().toLowerCase();
      if (!trimmed || !trimmed.includes('@')) {
        return res.status(400).json({ error: 'A valid email address is required' });
      }
      const dup = await pool.query(
        'SELECT id FROM users WHERE LOWER(email) = LOWER($1) AND id != $2 AND deleted_at IS NULL',
        [trimmed, req.user.id]
      );
      if (dup.rows.length > 0) {
        return res.status(409).json({ error: 'An account with this email already exists' });
      }
      updates.push(`email = $${i++}`);
      vals.push(trimmed);
    }

    if (phone_number !== undefined) {
      const formatted = formatPhone(phone_number);
      if (!formatted) {
        return res.status(400).json({ error: 'Please enter a valid 10-digit US phone number' });
      }
      updates.push(`phone_number = $${i++}`);
      vals.push(formatted);
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No changes provided' });
    }

    updates.push('updated_at = NOW()');
    vals.push(req.user.id);
    const result = await pool.query(
      `UPDATE users SET ${updates.join(', ')} WHERE id = $${i} AND deleted_at IS NULL
       RETURNING id, email, name, role, phone_number, is_instructor`,
      vals
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'User not found' });

    const u = result.rows[0];
    let token = null;
    if (email !== undefined) {
      token = jwt.sign(
        { id: u.id, email: u.email, name: u.name, role: u.role },
        JWT_SECRET,
        { expiresIn: '7d' }
      );
      res.cookie('token', token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 7 * 24 * 60 * 60 * 1000,
      });
    }

    const changes = [];
    if (email !== undefined && u.email !== prev.email) {
      changes.push({ label: 'Email', value: u.email });
    }
    if (phone_number !== undefined && u.phone_number !== prev.phone_number) {
      changes.push({ label: 'Phone', value: u.phone_number || '' });
    }
    if (changes.length > 0) {
      const tpl = profileChangeEmail({ name: u.name, changes });
      sendEmailToUser(u.id, u.email, EMAIL_TYPES.profile_change, tpl.subject, tpl.html, tpl.text)
        .catch((err) => console.error('[profile] profile-change email error:', err.message));
    }

    res.json({
      profile: {
        id: u.id,
        email: u.email,
        name: u.name,
        phone_number: u.phone_number || '',
        role: u.role,
        is_instructor: !!u.is_instructor,
      },
      token,
    });
  } catch (err) {
    console.error('[profile] PATCH error:', err.message);
    if (err.code === '23505') {
      return res.status(409).json({ error: 'An account with this email already exists' });
    }
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

router.post('/change-password', authenticateToken, async (req, res) => {
  try {
    const { current_password, new_password } = req.body || {};
    if (!current_password || !new_password) {
      return res.status(400).json({ error: 'Current and new password are required' });
    }
    if (String(new_password).length < 8) {
      return res.status(400).json({ error: 'New password must be at least 8 characters' });
    }

    const result = await pool.query(
      'SELECT password_hash FROM users WHERE id = $1 AND deleted_at IS NULL',
      [req.user.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'User not found' });

    const ok = await bcrypt.compare(current_password, result.rows[0].password_hash);
    if (!ok) return res.status(401).json({ error: 'Current password is incorrect' });

    const passwordHash = await bcrypt.hash(new_password, 12);
    await pool.query(
      'UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2',
      [passwordHash, req.user.id]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error('[profile] change-password error:', err.message);
    res.status(500).json({ error: 'Failed to change password' });
  }
});

router.get('/email-preferences', authenticateToken, async (req, res) => {
  try {
    const userRow = await pool.query(
      'SELECT role, is_instructor FROM users WHERE id = $1 AND deleted_at IS NULL',
      [req.user.id]
    );
    if (userRow.rows.length === 0) return res.status(404).json({ error: 'User not found' });
    const { role, is_instructor } = userRow.rows[0];
    const prefs = await getPrefs(req.user.id);
    const categories = getPreferenceCatalog(role, is_instructor);
    res.json({ preferences: prefs, categories });
  } catch (err) {
    console.error('[profile] GET email-preferences error:', err.message, err.stack);
    res.status(500).json({ error: 'Failed to load email preferences' });
  }
});

router.patch('/email-preferences', authenticateToken, async (req, res) => {
  try {
    const body = req.body || {};
    const patch = {};
    if (body.email_all_off !== undefined) patch.email_all_off = !!body.email_all_off;
    for (const key of Object.keys(EMAIL_TYPES)) {
      if (isRequiredEmailType(key)) continue;
      if (body[key] !== undefined) patch[key] = !!body[key];
    }
    if (Object.keys(patch).length === 0) {
      return res.status(400).json({ error: 'No preference changes provided' });
    }
    const prefs = await updatePrefs(req.user.id, patch);
    res.json({ preferences: prefs });
  } catch (err) {
    console.error('[profile] PATCH email-preferences error:', err.message);
    res.status(500).json({ error: 'Failed to update email preferences' });
  }
});

router.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

module.exports = router;
module.exports.ensureDefaultPrefs = ensureDefaultPrefs;
