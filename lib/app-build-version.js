'use strict';

/** Deploy/build id exposed to clients for cache busting (git SHA on Railway). */
function getAppBuildVersion() {
  const sha = process.env.RAILWAY_GIT_COMMIT_SHA;
  if (sha) return sha.slice(0, 7);
  if (process.env.BUILD_TIMESTAMP) return String(process.env.BUILD_TIMESTAMP);
  return 'dev';
}

module.exports = { getAppBuildVersion };
