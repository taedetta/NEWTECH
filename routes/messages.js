'use strict';

const express = require('express');
const messagesDb = require('../db/messages');
const { authenticateToken } = require('../middleware/auth');
const { notifyNewMessage } = require('../lib/app-notifications');

const router = express.Router();

router.get('/threads', authenticateToken, async (req, res) => {
  try {
    const threads = await messagesDb.listThreadsForUser(req.user.id, req.user.role);
    res.json({ threads });
  } catch (err) {
    console.error('[messages] list threads:', err.message);
    res.status(500).json({ error: 'Failed to load messages' });
  }
});

router.get('/threads/:id', authenticateToken, async (req, res) => {
  try {
    const data = await messagesDb.getThreadMessages(parseInt(req.params.id, 10), req.user.id, req.user.role);
    if (!data) return res.status(404).json({ error: 'Thread not found' });
    if (data.forbidden) return res.status(403).json({ error: 'Access denied' });
    res.json(data);
  } catch (err) {
    console.error('[messages] get thread:', err.message);
    res.status(500).json({ error: 'Failed to load conversation' });
  }
});

router.post('/threads', authenticateToken, async (req, res) => {
  try {
    const { student_id, instructor_id, body } = req.body;
    if (!body?.trim()) return res.status(400).json({ error: 'Message body is required' });

    let studentId = parseInt(student_id, 10);
    let instructorId = parseInt(instructor_id, 10);

    if (req.user.role === 'student' || req.user.role === 'renter') {
      studentId = req.user.id;
      if (!instructorId) return res.status(400).json({ error: 'instructor_id required' });
    } else if (req.user.role === 'instructor') {
      instructorId = req.user.id;
      if (!studentId) return res.status(400).json({ error: 'student_id required' });
    } else if (!['owner', 'admin'].includes(req.user.role)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const { thread, message } = await messagesDb.startThreadAndMessage({
      studentId, instructorId, senderId: req.user.id, body,
    });

    const recipientId = req.user.id === studentId ? instructorId : studentId;
    const sender = await require('../db/index').query('SELECT name FROM users WHERE id = $1', [req.user.id]);
    notifyNewMessage(recipientId, {
      senderName: sender.rows[0]?.name || 'User',
      preview: body.trim(),
    }).catch(() => {});

    res.status(201).json({ thread, message });
  } catch (err) {
    console.error('[messages] create thread:', err.message);
    res.status(500).json({ error: 'Failed to send message' });
  }
});

router.post('/threads/:id', authenticateToken, async (req, res) => {
  try {
    const threadId = parseInt(req.params.id, 10);
    const { body } = req.body;
    if (!body?.trim()) return res.status(400).json({ error: 'Message body is required' });

    const check = await messagesDb.getThreadMessages(threadId, req.user.id, req.user.role);
    if (!check || check.forbidden) return res.status(403).json({ error: 'Access denied' });

    const message = await messagesDb.postMessage({
      threadId, senderId: req.user.id, body,
    });

    const t = check.thread;
    const recipientId = req.user.id === t.student_id ? t.instructor_id : t.student_id;
    const sender = await require('../db/index').query('SELECT name FROM users WHERE id = $1', [req.user.id]);
    notifyNewMessage(recipientId, {
      senderName: sender.rows[0]?.name || 'User',
      preview: body.trim(),
    }).catch(() => {});

    res.status(201).json({ message });
  } catch (err) {
    console.error('[messages] post message:', err.message);
    res.status(500).json({ error: 'Failed to send message' });
  }
});

module.exports = router;
