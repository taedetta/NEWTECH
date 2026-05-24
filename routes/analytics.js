'use strict';

const express = require('express');
const crypto = require('crypto');
const { authenticateToken, requireRole } = require('../middleware/auth');
const {
  insertPageView,
  getTotalViews,
  getViewsByPath,
  getTopReferrers,
  getPopularPages,
  getDailyViews,
} = require('../db/analytics');

const router = express.Router();

// ─── PAGE VIEW TRACKING MIDDLEWARE ──────────────────────
// Track all page views on response finish. Excludes:
// - /health (health checks)
// - /api/* (API calls)
// - static assets (.ico, .png, .jpg, .css, .js, .woff, etc.)
// - Bot user agents (Googlebot, Bingbot, etc.)

const BOT_PATTERNS = [
  /googlebot/i, /bingbot/i, /yandex/i, /baiduspider/i,
  /duckduckbot/i, /facebookexternalhit/i, /twitterbot/i,
  /applebot/i, /semrush/i, /ahrefs/i, /mj12bot/i,
  /crawl/i, /spider/i, /bot/i,
];

const EXCLUDED_PATTERNS = [
  /^\/health$/,
  /^\/api\//,
  /\/_next\//,
  /\/_assets\//,
  /\/.well-known\//,
];

const STATIC_EXTENSIONS = /\/(favicon|apple-touch|manifest|\/static\/|\/fonts\/|\/images\/)/i;
const STATIC_FILE_EXT = /\/(.*\/?)([^/]*)\/(favicon|apple-touch-icon|manifest|\/static\/|\/fonts\/|\/images\/)/i;

function shouldTrack(req) {
  if (!req.path) return false;

  // Only track GET requests — POST/PUT/DELETE are API mutations, not page views
  if (req.method !== 'GET') return false;

  // Exclude bot user agents
  const ua = req.headers['user-agent'] || '';
  if (BOT_PATTERNS.some(p => p.test(ua))) return false;

  // Exclude specific path patterns
  if (EXCLUDED_PATTERNS.some(p => p.test(req.path))) return false;

  // Exclude known static asset paths
  const noQuery = req.path.split('?')[0];
  const isStatic = [
    noQuery.endsWith('.ico'), noQuery.endsWith('.png'), noQuery.endsWith('.jpg'),
    noQuery.endsWith('.jpeg'), noQuery.endsWith('.gif'), noQuery.endsWith('.svg'),
    noQuery.endsWith('.css'), noQuery.endsWith('.js'), noQuery.endsWith('.woff'),
    noQuery.endsWith('.woff2'), noQuery.endsWith('.ttf'), noQuery.endsWith('.eot'),
    noQuery.endsWith('.map'), noQuery.endsWith('.webp'),
    noQuery.endsWith('.txt'), noQuery.endsWith('.xml'), noQuery.endsWith('.json'),
  ].some(Boolean);
  if (isStatic) return false;

  return true;
}

// Note: this middleware is mounted in server.js on all routes BEFORE route handlers.
// It attaches to res.on('finish') for zero-overhead tracking.

// ─── ANALYTICS API ──────────────────────────────────────
// All analytics endpoints require admin or owner role.

router.get('/views', authenticateToken, requireRole('owner', 'admin'), async (req, res) => {
  try {
    const days = Math.min(parseInt(req.query.days) || 7, 90);
    const [total7, total30, byPath] = await Promise.all([
      getTotalViews(7),
      getTotalViews(30),
      getViewsByPath(days, 50),
    ]);
    res.json({ total_7d: total7, total_30d: total30, by_path: byPath });
  } catch (err) {
    console.error('Analytics views error:', err);
    res.status(500).json({ error: 'Failed to fetch view data' });
  }
});

router.get('/referrers', authenticateToken, requireRole('owner', 'admin'), async (req, res) => {
  try {
    const days = Math.min(parseInt(req.query.days) || 7, 90);
    const referrers = await getTopReferrers(days, 20);
    res.json({ period_days: days, referrers });
  } catch (err) {
    console.error('Analytics referrers error:', err);
    res.status(500).json({ error: 'Failed to fetch referrer data' });
  }
});

router.get('/popular', authenticateToken, requireRole('owner', 'admin'), async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 10, 50);
    const pages = await getPopularPages(limit);
    res.json({ top_pages: pages });
  } catch (err) {
    console.error('Analytics popular error:', err);
    res.status(500).json({ error: 'Failed to fetch popular pages' });
  }
});

router.get('/daily', authenticateToken, requireRole('owner', 'admin'), async (req, res) => {
  try {
    const days = Math.min(parseInt(req.query.days) || 30, 90);
    const daily = await getDailyViews(days);
    res.json({ period_days: days, daily });
  } catch (err) {
    console.error('Analytics daily error:', err);
    res.status(500).json({ error: 'Failed to fetch daily data' });
  }
});

// Expose tracking middleware for use in server.js
function createPageViewMiddleware() {
  return function trackPageView(req, res, next) {
    if (!shouldTrack(req)) return next();

    const path = req.path.split('?')[0]; // strip query string for grouping
    const referrer = req.headers['referer'] || req.headers['referrer'] || '';
    const userAgent = req.headers['user-agent'] || '';
    // Hash IP for privacy — one-way SHA-256, never stored in plain text
    const ipRaw = req.headers['x-forwarded-for']?.split(',')[0]?.trim()
      || req.connection?.remoteAddress
      || req.ip
      || '';
    const ipHash = ipRaw ? crypto.createHash('sha256').update(ipRaw).digest('hex') : null;

    // Fire and forget — do not block the response
    res.on('finish', () => {
      insertPageView({ path, referrer, userAgent, ipHash, country: null }).catch(() => {});
    });

    next();
  };
}

module.exports = router;
module.exports.createPageViewMiddleware = createPageViewMiddleware;