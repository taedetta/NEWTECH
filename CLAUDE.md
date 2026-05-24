# FlightSlate — New Tech Aviation

Flight school management platform: scheduling, booking, instructor availability, student tracking, aircraft management, and billing.

## Stack

Express.js + PostgreSQL (Neon) + vanilla JS frontend, deployed on Render.

## Directory Map

- `server.js` — Express app wiring (route mounts, middleware, startup tasks). All business logic extracted to `routes/` and `db/`.
- `routes/` — extracted route modules (auth, users, aircraft, bookings, billing, training, endorsements, analytics, admin, approvals, downtime, track-flights, etc.)
- `db/` — database access layer (`index.js` = shared pool; `analytics.js` = page view queries; `weather.js`; `leads.js`; `at-risk.js` = at-risk student assessment queries; `training.js` = student progress, maneuver tracking, instructor reassignment)
- `middleware/` — auth middleware (`auth.js`), rate limiter (`rate-limiter.js`)
- `public/` — static frontend (`app.html` = main SPA, `index.html` = landing page, `admin/analytics.html` = admin analytics dashboard)
- `migrations/` — `node-pg-migrate` style DDL scripts (one file per schema change)
- `email-templates.js` — transactional email HTML builders (bookingConfirmationEmail, preflightReminderEmailStudent, preflightReminderEmailInstructor, etc.)
- `jobs/reminder-email.js` — standalone cron script for 24hr pre-flight email reminders (run via polsia.toml [[crons]])
- `services/startup.js` — startup task orchestrator (image migration, training program seeding, backup scheduler, route verification)
- `backup-service.js` — nightly PDF backup (2am CT) + starts nightly CSV export at 11pm CT
- `export-service.js` — nightly 11pm CT CSV export: 9 topic folders uploaded to R2, emailed as download links

## Database

- `users` — students, instructors, admins, owners, maintenance techs, renters (soft-delete via `deleted_at`; `approval_status` = pending/approved/rejected for new signups; roles: student/instructor/admin/owner/maintenance/renter)
- `bookings` — flight bookings with status lifecycle (confirmed/completed/cancelled); `reminder_sent` boolean prevents duplicate 24hr reminder emails
- `aircraft` — fleet with Hobbs/Tach tracking, status (available/maintenance)
- `instructor_availability` — weekly recurring time windows per instructor (day_of_week + TIME)
- `instructor_availability_overrides` — date-specific exceptions (vacation, extra hours, blocks)
- `flight_logs` — per-flight Hobbs/Tach/hours records
- `aircraft_hours_history` — audit trail for aircraft hour changes
- `ground_sessions` — non-flight training sessions
- `endorsements` — instructor endorsements with aircraft refs
- `billing_entries` — aircraft and instruction charges
- `squawks` — aircraft discrepancy/squawk log (severity: minor/major/grounding; status: open/reviewed/deferred/resolved)
- `site_content` — CMS key/value store for landing page
- `feedback` — student feedback entries
- `admin_audit_log` — permanent audit trail
- `weather_cache` — persistent METAR/TAF cache (single row per station, survives restarts)
- `discovery_flight_leads` — lead capture form submissions (name/email/phone/experience/status, ENUM new→contacted→booked→no_show→converted)
- `at_risk_assessments` — per-student risk assessment (risk_level, risk_score, days_since_last_flight, manual overrides)
- `student_interventions` — immutable log of instructor actions taken for at-risk students
- `school_settings` — key/value config store (at-risk thresholds, etc.)
- `training_programs` — PPL, IFR, etc. (code, name, stages)
- `program_stages` — ordered stages per program with maneuvers
- `student_training` — enrollments (student_id, program_id, instructor_id, current_stage_id, status)
- `maneuver_progress` — per-enrollment per-maneuver grading (proficient/practiced/introduced, instructor, graded_at)
- `debriefs` — CFI post-flight notes per enrollment + stage
- `endorsements` — FAA endorsements with instructor cert numbers and aircraft refs
- `page_views` — lightweight analytics tracking (path, referrer, user_agent, ip_hash, country, created_at). IP stored as SHA-256 hash only. Bot UAs excluded.
- `aircraft_downtime` — scheduled maintenance windows per aircraft (start_date, end_date, reason, created_by). Blocks aircraft from booking calendar during window.
- `flight_hobbs_readings` — per-booking Hobbs readings per role (student/instructor); one row per booking per role; auto-triggers discrepancy check.
- `flight_discrepancies` — flagged Hobbs mismatches (delta > 0.1 hrs) between student and instructor; status pending/resolved; resolution stores which reading to use.
- `file_overrides` — persists editor file changes across Render deploys; rehydrated to filesystem on startup so downloads always include editor modifications.

## External Integrations

- Polsia email proxy — transactional emails (booking confirmations, pre-flight reminders, approval notifications) sent via Polsia platform
- Polsia R2 — file storage for backups, PDFs, CSV exports, and CMS image uploads
- polsia.toml — declares [[crons]] for pre-flight email reminder job (runs hourly via Polsia infrastructure)

## Key Conventions

- Availability times are stored as timezone-agnostic TIME values (wall-clock local time)
- Bookings stored as TIMESTAMPTZ (UTC) — availability checks must compare local times, not UTC-extracted
- Frontend sends `local_date`, `local_start`, `local_end` with booking requests for correct availability validation
- Page view tracking is automatic — `routes/analytics.js` middleware (`createPageViewMiddleware`) records all non-API page views server-side. Analytics endpoints (`GET /api/analytics/views`, `/referrers`, `/popular`, `/daily`) require `owner` or `admin` role. Admin dashboard at `/admin/analytics`.
- Health checks: `/health` returns `{ ok: true }` instantly (no DB, for Render deploy). `GET /health/deep` runs full stack checks — DB (SELECT 1) + HTTP probe of /api/auth, /api/bookings, /api/aircraft, /api/schedule. Returns 503 if DB is down so Render auto-restarts.

## Staging & Production Data Isolation

FlightSlate now supports **source-tag isolation** for complete staging/production data separation. Both environments share a database but are isolated via `source` column (production|staging) and `APP_ENV` variable. See `STAGING_SETUP.md` for setup instructions.

## Recent Changes

- 2026-05-24: Progress tab instructor features — viewStudentReadiness (checkride readiness modal, GET /api/training/checkride-readiness/:studentId) and Reassign Instructor modal (openAssignModal, PATCH /api/training/enroll/:id via trainingDb.reassignInstructor)
- 2026-05-22: Download Source DB Override Fix — Both download-source endpoints (`routes/cms.js`, `routes/admin.js`) now query `file_overrides` table and overlay DB content on top of filesystem files in the ZIP. Fixes bug where downloads after deploy could serve stale pre-editor content. Rehydration in `services/startup.js` now awaited (was fire-and-forget), preventing race conditions.
- 2026-05-22: Editor-to-GitHub Sync Fix — Editor changes (`PUT /api/project-files`) now persist to `file_overrides` DB table alongside filesystem writes. On every deploy/restart, `services/startup.js` rehydrates overrides from DB to filesystem so editor changes survive Render's ephemeral rebuilds. New endpoints: `GET /api/file-overrides` (list pending), `POST /api/file-overrides/mark-synced`, `DELETE /api/file-overrides` (clear all). Source code downloads now always include editor modifications.
- 2026-05-22: Download Source Code Fix — `routes/admin.js` and `routes/cms.js` download-source endpoints used `__dirname` (routes/ dir) instead of `path.join(__dirname, '..')` (project root). ZIP downloads only contained route files, missing server.js, public/, db/, migrations/, package.json. Fixed both endpoints to archive from the correct project root.
- 2026-05-21: Source-Tag Data Isolation Complete — `source` column added to all 28 data tables via migration `1779395261_add_source_isolation.sql`; `db/source-wrapper.js` provides query filtering; `APP_ENV` env var controls visibility (production|staging). Staging branch created in GitHub. Production running with APP_ENV=production. Staging preview ready to deploy. Verification: `node verify-source-isolation.js`. Docs: `STAGING_SETUP.md` and `STAGING_IMPLEMENTATION_COMPLETE.md`.
- 2026-05-21: Backend Security Hardening — Removed Dev Tools panel (routes/developer.js deleted, frontend UI stripped). Hobbs validation: server re-reads aircraft current_hobbs at submission, rejects if delta > 0.5 hrs. Booking creation validates start_time in future, 12-hour max duration, aircraft downtime check. Role re-verified from DB on critical ops. Hobbs rate limiter: >5 failed submissions in 10min → 15min block. All numeric inputs sanitized (reject NaN, negative, >99999).
