'use strict';

const express = require('express');
const { getAppBuildVersion } = require('../lib/app-build-version');
const { isCaptchaEnabled, getTurnstileSiteKey } = require('../lib/captcha');
const { getAppUrl } = require('../lib/app-url');
const { SCHOOL_TZ, SCHOOL_TZ_LABEL } = require('../lib/school-timezone');

const router = express.Router();

/**
 * GET /api/config — public app metadata (environment, URLs).
 * Used by frontend to show staging banner and for diagnostics.
 */
router.get('/', (req, res) => {
  const appEnv = process.env.APP_ENV || 'production';
  const staging = appEnv === 'staging';
  res.set('Cache-Control', 'no-store');
  res.json({
    appEnv,
    isStaging: staging,
    isProduction: !staging,
    sideEffectsDisabled: staging,
    appUrl: getAppUrl(req),
    version: getAppBuildVersion(),
    captchaEnabled: isCaptchaEnabled(),
    turnstileSiteKey: isCaptchaEnabled() ? getTurnstileSiteKey() : '',
    timezone: SCHOOL_TZ,
    timezoneLabel: SCHOOL_TZ_LABEL,
  });
});

module.exports = router;
