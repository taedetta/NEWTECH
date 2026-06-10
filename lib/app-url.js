'use strict';

const STAGING_DEFAULT = 'https://flightslate-staging-production.up.railway.app';
const PRODUCTION_DEFAULT = 'https://www.newtechaviation.com';

function normalizeUrl(url) {
  return (url || '').trim().replace(/\/$/, '');
}

function isLocalhostUrl(url) {
  if (!url) return true;
  return /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/i.test(url);
}

/**
 * Resolve the public app base URL for emails and links.
 * In production, never use localhost from APP_URL — prefer platform URL or the request host.
 */
function getAppUrl(req) {
  const isProd = process.env.NODE_ENV === 'production';
  const isStaging = process.env.APP_ENV === 'staging';
  const envUrl = normalizeUrl(process.env.APP_URL);

  // Staging uses the Railway default URL unless APP_URL is explicitly set to something else.
  if (isStaging) {
    if (envUrl && !isLocalhostUrl(envUrl) && !envUrl.includes('staging.newtechaviation.com')) {
      return envUrl;
    }
    const railwayDomain = normalizeUrl(process.env.RAILWAY_PUBLIC_DOMAIN && `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`);
    if (railwayDomain) return railwayDomain;
    return STAGING_DEFAULT;
  }

  if (envUrl && !(isProd && isLocalhostUrl(envUrl))) {
    return envUrl;
  }

  const railwayDomain = normalizeUrl(process.env.RAILWAY_PUBLIC_DOMAIN && `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`);
  if (railwayDomain) return railwayDomain;

  if (req) {
    const host = (req.get('x-forwarded-host') || req.get('host') || '').split(',')[0].trim();
    const proto = (req.get('x-forwarded-proto') || req.protocol || 'https').split(',')[0].trim();
    if (host && !/localhost|127\.0\.0\.1/i.test(host)) {
      return `${proto}://${host}`;
    }
  }

  if (!isProd && envUrl) return envUrl;
  if (!isProd) return 'http://localhost:3000';

  return PRODUCTION_DEFAULT;
}

module.exports = { getAppUrl, PRODUCTION_DEFAULT };
