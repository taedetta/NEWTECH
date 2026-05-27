'use strict';

const express = require('express');
const { getInstructorUtilization } = require('../lib/instructor-utilization');
const { authenticateToken, requireRole } = require('../middleware/auth');

const router = express.Router();

router.get('/', authenticateToken, requireRole('owner', 'admin', 'instructor'), async (req, res) => {
  try {
    const end = req.query.end ? new Date(req.query.end) : new Date();
    const start = req.query.start
      ? new Date(req.query.start)
      : new Date(end.getTime() - 30 * 86400000);

    let instructors = await getInstructorUtilization({
      startDate: start.toISOString(),
      endDate: end.toISOString(),
    });

    if (req.user.role === 'instructor') {
      instructors = instructors.filter((i) => i.id === req.user.id);
    }

    res.json({
      start: start.toISOString(),
      end: end.toISOString(),
      instructors,
    });
  } catch (err) {
    console.error('[utilization]', err.message);
    res.status(500).json({ error: 'Failed to load utilization data' });
  }
});

module.exports = router;
