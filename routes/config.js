'use strict';

const express = require('express');

const router = express.Router();

/**
 * GET /api/config — public app metadata (environment, URLs).
 * Used by frontend to show staging banner and for diagnostics.
 */
router.get('/', (req, res) => {
  const appEnv = process.env.APP_ENV || 'production';
  const staging = appEnv === 'staging';
  res.json({
    appEnv,
    isStaging: staging,
    isProduction: !staging,
    sideEffectsDisabled: staging,
    appUrl: process.env.APP_URL || '',
    version: process.env.RAILWAY_GIT_COMMIT_SHA?.slice(0, 7) || null,
  });
});

module.exports = router;
