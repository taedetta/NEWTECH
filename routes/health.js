/**
 * Health check routes — /health and /health/deep.
 * /health: lightweight, no DB, for Render deploy checks.
 * /health/deep: full stack check (DB + critical tables + routes), returns 503 if degraded.
 */

const express = require('express');
const router = express.Router();

const CHECK_ROUTES = [
  { path: '/api/auth', label: 'auth' },
  { path: '/api/bookings', label: 'bookings' },
  { path: '/api/aircraft', label: 'aircraft' },
  { path: '/api/schedule', label: 'schedule' },
];

const CRITICAL_TABLES = ['bookings', 'discovery_flight_leads', 'users'];

function healthCheckRoute(port, path) {
  const http = require('http');
  return new Promise((resolve) => {
    const req = http.request({ hostname: 'localhost', port, path, method: 'GET', timeout: 2000 }, (res) => {
      resolve({ up: res.statusCode < 500, status: res.statusCode });
    });
    req.on('error', () => resolve({ up: false, status: 0 }));
    req.on('timeout', () => { req.destroy(); resolve({ up: false, status: 0 }); });
    req.end();
  });
}

async function deepHealthCheck(pool, port) {
  const checks = { db: false, tables: {}, routes: {} };
  let overall = 'healthy';
  let last_query = null;

  // DB + critical tables check
  try {
    await pool.query('SELECT 1');
    checks.db = true;
    last_query = new Date().toISOString();

    for (const tbl of CRITICAL_TABLES) {
      try {
        const r = await pool.query(`SELECT 1 FROM ${tbl} LIMIT 1`);
        checks.tables[tbl] = { exists: true };
      } catch (err) {
        checks.tables[tbl] = { exists: false, error: err.message };
      }
    }
  } catch (err) {
    console.error('[health] DB check failed:', err.message);
    overall = 'down';
    last_query = new Date().toISOString();
  }

  // Route checks
  const routeResults = await Promise.all(CHECK_ROUTES.map(async (r) => {
    const result = await healthCheckRoute(port, r.path);
    return { label: r.label, up: result.up };
  }));
  for (const r of routeResults) checks.routes[r.label] = r.up;

  const anyRouteDown = Object.values(checks.routes).some(v => !v);
  if (anyRouteDown && overall !== 'down') overall = 'degraded';

  if (!checks.db) {
    for (const r of routeResults) checks.routes[r.label] = false;
    overall = 'down';
  }

  const criticalTablesOk = CRITICAL_TABLES.every(t => checks.tables[t]?.exists === true);
  if (!criticalTablesOk && overall !== 'down') overall = 'degraded';

  return { overall, checks, last_query, ts: new Date().toISOString() };
}

// GET /health — lightweight, no DB dependency
router.get('/', (req, res) => {
  res.json({ ok: true, ts: new Date().toISOString() });
});

// GET /health/deep — full stack check
router.get('/deep', async (req, res) => {
  const pool = req.app.locals.pool;
  const PORT = req.app.locals.PORT || 3000;
  const result = await deepHealthCheck(pool, PORT);
  const httpStatus = result.overall === 'down' || result.overall === 'degraded' ? 503 : 200;
  res.status(httpStatus).json({
    status: result.overall,
    db: result.checks.db,
    tables: result.checks.tables,
    routes: result.checks.routes,
    uptime_seconds: Math.floor(process.uptime()),
    last_query: result.last_query,
    ts: result.ts,
  });
});

module.exports = { router, deepHealthCheck };