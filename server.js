'use strict';

// Load .env for local development (no dotenv dependency)
try {
  const fs = require('fs');
  const envPath = require('path').join(__dirname, '.env');
  if (fs.existsSync(envPath)) {
    fs.readFileSync(envPath, 'utf8').split(/\r?\n/).forEach((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) return;
      const eq = trimmed.indexOf('=');
      if (eq === -1) return;
      const key = trimmed.slice(0, eq).trim();
      const val = trimmed.slice(eq + 1).trim();
      if (key && process.env[key] === undefined) process.env[key] = val;
    });
  }
} catch { /* ignore */ }

// ── Dependencies ──────────────────────────────────────────────────────────────
const express = require('express');
const compression = require('compression');
const expressJson = require('express').json;
const cookieParser = require('cookie-parser');
const path = require('path');
const crypto = require('crypto');
const https = require('https');
const OpenAI = (() => { try { return require('openai'); } catch { return null; } })();

const pool = require('./db/index');
const { authenticateToken, requireRole } = require('./middleware/auth');
const { checkPasswordResetRateLimit } = require('./middleware/rate-limiter');

// ── Routes ────────────────────────────────────────────────────────────────────
const authRoutes        = require('./routes/auth');
const usersRoutes       = require('./routes/users');
const permissionsRoutes = require('./routes/permissions');
const aircraftRoutes    = require('./routes/aircraft');
const bookingsRoutes    = require('./routes/bookings-routes');
const bookingCompletion = require('./routes/bookings-completion');
const maintenanceRoutes = require('./routes/maintenance');
const billingRoutes     = require('./routes/billing');
const flightLogsRoutes  = require('./routes/flight-logs');
const bookingHistory    = require('./routes/booking-history');
const instructorHours   = require('./routes/instructor-hours');
const groundRoutes      = require('./routes/ground');
const cmsRoutes         = require('./routes/cms');
const seoRoutes         = require('./routes/seo');
const flightawareRoutes = require('./routes/flightaware');
const trainingRoutes    = require('./routes/training');
const endorsementsRoutes= require('./routes/endorsements');
const analyticsRoutes   = require('./routes/analytics');
const adminPagesRoutes  = require('./routes/admin-pages');
const adminRoutes       = require('./routes/admin');
const weatherRoutes     = require('./routes/weather');
const blogRoutes        = require('./routes/blog');
const leadsRoutes       = require('./routes/leads');
const messagesRoutes    = require('./routes/messages');
const documentsRoutes   = require('./routes/documents');
const locationsRoutes   = require('./routes/locations');
const pushRoutes        = require('./routes/push');
const configRoutes      = require('./routes/config');
const utilizationRoutes = require('./routes/instructor-utilization');
const atRiskRoutes      = require('./routes/at-risk');
const approvalsRoutes   = require('./routes/approvals');
const downtimeRoutes    = require('./routes/downtime');
const trackFlightsRoutes = require('./routes/track-flights');
const discrepanciesRoutes = require('./routes/discrepancies');
const { router: healthRoutes } = require('./routes/health');
const systemHealthRoutes = require('./routes/system-health');
const logoRoutes = require('./routes/logo');
// backup-service + export scheduler + preflight reminders
const { runBackup, startBackupScheduler } = require('./backup-service');
const { startExportScheduler } = require('./export-service');
const { startPreflightReminderScheduler } = require('./lib/preflight-reminders');
const { startInstructorBriefingScheduler } = require('./lib/instructor-briefing');
const { ensureVapidKeys } = require('./lib/vapid-setup');
global.runBackup = runBackup;
const { runStartup } = require('./services/startup');
// startup-verification.js missing — unused in server.js
const {
  sendEmail, welcomeEmail, passwordResetEmail, inviteEmail,
  bookingConfirmationEmail, groundingSquawkEmail
} = require('./email-templates');

// ── App Setup ─────────────────────────────────────────────────────────────────
const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'REDACTED';

app.use(compression({ threshold: 1024, filter: (req, res) => {
  const ct = res.getHeader('Content-Type');
  return (typeof ct === 'string' && ct.startsWith('image/')) ? false : compression.filter(req, res);
}}));
app.use(expressJson({ limit: '25mb' }));
app.use(cookieParser());

// Health: /health (no DB) for Railway probes; /health/deep for full stack check
app.locals.pool = pool;
app.locals.PORT = PORT;
app.use('/health', healthRoutes);

// ── CORS / Response Headers ───────────────────────────────────────────────────
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && (origin.endsWith('.newtechaviation.com') || origin.includes('localhost') || origin.includes('railway.app'))) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  next();
});

// Page views: registered early so res.on('finish') fires for all responses
const { createPageViewMiddleware } = analyticsRoutes;
app.use(createPageViewMiddleware());

// ── Route Mounts ──────────────────────────────────────────────────────────────
app.use('/api/auth', authRoutes);
app.use('/api/users', usersRoutes);
app.use('/api/users/me', endorsementsRoutes);  // /api/users/me/cfi-profile
app.use('/api/permissions', permissionsRoutes);
app.use('/api/aircraft', aircraftRoutes);
app.use('/api/bookings', bookingsRoutes);
app.use('/api/bookings', bookingCompletion);   // /api/bookings/:id/end-early, complete
app.use('/api', maintenanceRoutes);            // /api/squawks, /api/hours-audit
app.use('/api/billing', billingRoutes);
app.use('/api/flight-logs', flightLogsRoutes);
app.use('/api/booking-history', bookingHistory);
app.use('/api/instructor-hours', instructorHours);
app.use('/api/ground-sessions', groundRoutes);
app.use('/api', cmsRoutes);                    // /api/site-content, /api/project-files, /api/download-source
app.use(seoRoutes);                            // /, /mosaic, /become-a-pilot, /sitemap.xml, /robots.txt, /app/*
app.use('/api/flights', flightawareRoutes);    // /api/flights/tracking
app.use('/api/training', trainingRoutes);
app.use('/api/admin/training', trainingRoutes); // /api/admin/training/programs|stages|maneuvers
app.use('/api/endorsements', endorsementsRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/admin', adminRoutes);            // /api/admin/reset-all-data, /api/admin/download-source
app.use('/api/admin', logoRoutes);             // /api/admin/generate-logo
app.use('/api', adminRoutes);                  // /api/instructor-availability/*
app.use('/api/weather', weatherRoutes);
app.use('/blog', blogRoutes);
app.use('/api/leads', leadsRoutes);
app.use('/api/messages', messagesRoutes);
app.use('/api/documents', documentsRoutes);
app.use('/api/locations', locationsRoutes);
app.use('/api/push', pushRoutes);
app.use('/api/config', configRoutes);
app.use('/api/instructor-utilization', utilizationRoutes);
app.use('/api/at-risk', atRiskRoutes);
app.use('/api/approvals', approvalsRoutes);
app.use('/api/downtime', downtimeRoutes);
app.use('/api/track-flights', trackFlightsRoutes);
app.use('/api/discrepancies', discrepanciesRoutes);
app.use('/api/admin/system-health', systemHealthRoutes);
app.use('/admin', adminPagesRoutes);

// ── Static Files ───────────────────────────────────────────────────────────────
const { getUploadRoot } = require('./lib/r2-storage');
app.use('/uploads', express.static(getUploadRoot(), { maxAge: '1d', etag: true }));
app.use(express.static(path.join(__dirname, 'public'), {
  index: false,
  maxAge: '7d',
  etag: true,
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    }
    if (filePath.endsWith('sw.js') || (filePath.includes(`${path.sep}js${path.sep}`) && filePath.endsWith('.js'))) {
      res.setHeader('Cache-Control', 'no-cache, must-revalidate');
    }
    if (filePath.endsWith('.webmanifest')) {
      res.setHeader('Content-Type', 'application/manifest+json');
    }
  }
}));

// ── Server Listen ───────────────────────────────────────────────────────────────
app.listen(PORT, async () => {
  const appEnv = process.env.APP_ENV || 'production';
  const nodeEnv = process.env.NODE_ENV || 'development';
  console.log(`FlightSlate running on port ${PORT} (${nodeEnv}, APP_ENV=${appEnv})`);
  if (appEnv === 'staging') {
    console.log('[staging] Isolated DB · emails redirected · crons off · R2 uploads prefixed staging/');
  }

  // Startup tasks — await so file-override rehydration completes before serving
  await runStartup({ pool });
  await ensureVapidKeys();

  startBackupScheduler(pool);
  startExportScheduler(pool);
  startPreflightReminderScheduler(pool);
  startInstructorBriefingScheduler(pool);

  // Auto backup on startup (fires after 10s delay)
  if (process.env.AUTO_BACKUP_ON_START) {
    const freq = process.env.AUTO_BACKUP_ON_START;
    console.log(`[backup] AUTO_BACKUP_ON_START=${freq} — triggering startup backup in 10s...`);
    setTimeout(() => runBackup(pool, freq)
      .then(r => console.log('[backup] Startup backup result:', JSON.stringify(r)))
      .catch(e => console.error('[backup] Startup backup error:', e.message)), 10000);
  }
});

module.exports = app;