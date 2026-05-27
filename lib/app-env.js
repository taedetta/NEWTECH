'use strict';

/** Current deployment environment (production | staging). */
function getAppEnv() {
  return process.env.APP_ENV === 'staging' ? 'staging' : 'production';
}

function isStaging() {
  return getAppEnv() === 'staging';
}

function isProduction() {
  return !isStaging();
}

module.exports = { getAppEnv, isStaging, isProduction };
