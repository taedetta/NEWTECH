'use strict';

const express = require('express');
const {
  getVapidPublicKey,
  saveSubscription,
  removeSubscription,
} = require('../lib/push-notifications');
const pool = require('../db/index');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

router.get('/vapid-public-key', (req, res) => {
  const key = getVapidPublicKey();
  if (!key) return res.status(503).json({ error: 'Push notifications not configured' });
  res.json({ publicKey: key });
});

router.post('/subscribe', authenticateToken, async (req, res) => {
  try {
    const { subscription } = req.body;
    if (!subscription) return res.status(400).json({ error: 'subscription required' });
    await saveSubscription(req.user.id, subscription, req.headers['user-agent']);
    res.json({ ok: true });
  } catch (err) {
    console.error('[push] subscribe:', err.message);
    res.status(400).json({ error: err.message || 'Subscribe failed' });
  }
});

router.post('/unsubscribe', authenticateToken, async (req, res) => {
  try {
    const { endpoint } = req.body;
    if (!endpoint) return res.status(400).json({ error: 'endpoint required' });
    await removeSubscription(req.user.id, endpoint);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Unsubscribe failed' });
  }
});

router.get('/notifications', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM user_notifications WHERE user_id = $1
       ORDER BY created_at DESC LIMIT 50`,
      [req.user.id]
    );
    res.json({ notifications: result.rows });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load notifications' });
  }
});

router.patch('/notifications/:id/read', authenticateToken, async (req, res) => {
  try {
    await pool.query(
      `UPDATE user_notifications SET read_at = NOW()
       WHERE id = $1 AND user_id = $2`,
      [parseInt(req.params.id, 10), req.user.id]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to mark read' });
  }
});

module.exports = router;
