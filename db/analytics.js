'use strict';

const pool = require('./index');

/**
 * Insert a single page view record asynchronously (fire-and-forget).
 * Do not await this in the request path — let it run in the background.
 */
async function insertPageView({ path, referrer, userAgent, ipHash, country }) {
  try {
    await pool.query(
      `INSERT INTO page_views (path, referrer, user_agent, ip_hash, country) VALUES ($1, $2, $3, $4, $5)`,
      [path, referrer || null, userAgent || null, ipHash || null, country || null]
    );
  } catch (err) {
    // Silently swallow — tracking failures must not affect user requests
    console.error('[analytics] page view insert failed:', err.message);
  }
}

/**
 * Get total page views for a given number of trailing days.
 */
async function getTotalViews(days) {
  const result = await pool.query(
    `SELECT COUNT(*)::int as total
     FROM page_views
     WHERE created_at >= NOW() - INTERVAL '1 day' * $1`,
    [days]
  );
  return result.rows[0].total;
}

/**
 * Get page view counts grouped by path, for a given number of trailing days.
 * Returns { path, count } rows sorted by count descending.
 */
async function getViewsByPath(days, limit = 50) {
  const result = await pool.query(
    `SELECT path, COUNT(*)::int as count
     FROM page_views
     WHERE created_at >= NOW() - INTERVAL '1 day' * $1
     GROUP BY path
     ORDER BY count DESC
     LIMIT $2`,
    [days, limit]
  );
  return result.rows;
}

/**
 * Get top referral sources (count of visits grouped by normalized referrer domain).
 * Returns { referrer, count } rows sorted by count descending.
 */
async function getTopReferrers(days, limit = 20) {
  const result = await pool.query(
    `SELECT
       CASE
         WHEN referrer IS NULL OR referrer = '' THEN '(direct)'
         ELSE REGEXP_REPLACE(
           referrer,
           '^(https?://)?([^/]+).*',
           '\\2',
           'i'
         )
       END AS referrer,
       COUNT(*)::int AS count
     FROM page_views
     WHERE created_at >= NOW() - INTERVAL '1 day' * $1
       AND referrer IS DISTINCT FROM ''
     GROUP BY 1
     ORDER BY count DESC
     LIMIT $2`,
    [days, limit]
  );
  return result.rows;
}

/**
 * Get top N most visited pages (alias for getViewsByPath with a sensible limit).
 */
async function getPopularPages(limit = 10) {
  return getViewsByPath(30, limit);
}

/**
 * Get daily view counts for the last N days (for chart rendering).
 * Returns { date, count } rows ordered by date ascending.
 */
async function getDailyViews(days) {
  const result = await pool.query(
    `SELECT
       DATE(created_at AT TIME ZONE 'UTC') AS date,
       COUNT(*)::int AS count
     FROM page_views
     WHERE created_at >= NOW() - INTERVAL '1 day' * $1
     GROUP BY 1
     ORDER BY 1 ASC`,
    [days]
  );
  return result.rows;
}

module.exports = {
  insertPageView,
  getTotalViews,
  getViewsByPath,
  getTopReferrers,
  getPopularPages,
  getDailyViews,
};