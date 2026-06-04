'use strict';

/** True when URL is a reachable public HTTPS (or production HTTP) download link. */
function isPublicUploadUrl(url) {
  if (!url || typeof url !== 'string') return false;
  try {
    const u = new URL(url);
    if (['localhost', '127.0.0.1', '0.0.0.0', '[::1]'].includes(u.hostname)) return false;
    if (u.hostname.endsWith('.railway.internal')) return false;
    if (u.protocol === 'https:') return true;
    if (u.protocol === 'http:' && !/^10\.|^192\.168\.|^172\.(1[6-9]|2\d|3[01])\./.test(u.hostname)) {
      return !u.hostname.includes('localhost');
    }
    return false;
  } catch {
    return false;
  }
}

/** Strip dev/local URLs so emails never link to localhost. */
function sanitizeUploadUrl(url) {
  return isPublicUploadUrl(url) ? url : null;
}

module.exports = { isPublicUploadUrl, sanitizeUploadUrl };
