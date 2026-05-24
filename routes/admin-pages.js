'use strict';

// Admin page routes — mounted at /admin, before static file middleware.
// Express static does not auto-append .html; we need explicit routes for page URLs.

const express = require('express');
const path = require('path');

const router = express.Router();

router.get('/analytics', (req, res) => {
  res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.sendFile(path.join(__dirname, '..', 'public', 'admin', 'analytics.html'));
});

module.exports = router;