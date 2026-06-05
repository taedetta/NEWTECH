'use strict';

const CANONICAL_HOST = (process.env.CANONICAL_HOST || 'www.newtechaviation.com').toLowerCase();

/** Hostnames that should 301 to the canonical www site (production only). */
const LEGACY_REDIRECT_HOSTS = new Set([
  'newtechaviation.com',
  'newtech-zek5.onrender.com',
]);

function shouldApplyCanonicalRedirect() {
  if (process.env.APP_ENV === 'staging') return false;
  if (process.env.NODE_ENV !== 'production') return false;
  return true;
}

/**
 * Redirect bare domain, HTTP, and legacy Render hostnames to https://www.newtechaviation.com
 */
function canonicalHostRedirect(req, res, next) {
  if (!shouldApplyCanonicalRedirect()) return next();

  const host = (req.headers.host || '').split(':')[0].toLowerCase();
  if (!host || host.includes('railway.internal')) return next();

  const proto = (req.headers['x-forwarded-proto'] || req.protocol || 'https').split(',')[0].trim();
  const path = req.originalUrl || req.url || '/';

  if (LEGACY_REDIRECT_HOSTS.has(host) || host.endsWith('.onrender.com')) {
    return res.redirect(301, `https://${CANONICAL_HOST}${path}`);
  }

  if (host === CANONICAL_HOST && proto === 'http') {
    return res.redirect(301, `https://${CANONICAL_HOST}${path}`);
  }

  return next();
}

module.exports = { canonicalHostRedirect, CANONICAL_HOST, LEGACY_REDIRECT_HOSTS };
