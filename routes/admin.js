'use strict';

const express = require('express');
const archiver = require('archiver');
const path = require('path');
const fs = require('fs');
const pool = require('../db/index');
const { authenticateToken, requireRole } = require('../middleware/auth');
const { getAllOverrides } = require('../db/file-overrides');

const router = express.Router();

// ─── ADMIN: RESET ALL DATA ───────────────────────────────

router.post('/reset-all-data', authenticateToken, requireRole('owner', 'admin'), async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query('DELETE FROM student_maneuver_progress');
    await client.query('DELETE FROM debrief_grades');
    await client.query('DELETE FROM milestone_completions');
    await client.query('DELETE FROM flight_debriefs');
    await client.query('DELETE FROM flight_logs');
    await client.query('DELETE FROM hour_edit_logs');
    await client.query('DELETE FROM aircraft_hours_history');
    await client.query('DELETE FROM at_risk_assessments');
    await client.query('DELETE FROM student_interventions');
    await client.query('DELETE FROM ground_sessions');
    await client.query('DELETE FROM instructor_hours');
    await client.query('DELETE FROM student_training');
    await client.query('DELETE FROM squawks');
    await client.query('DELETE FROM bookings');

    await client.query('UPDATE users SET total_hobbs_hours = 0, total_tach_hours = 0');
    await client.query('UPDATE aircraft SET total_hobbs_hours = 0, total_tach_hours = 0, current_hobbs = 0, current_tach = 0');

    await client.query(
      'INSERT INTO admin_audit_log (action, performed_by, details, performed_at) VALUES ($1, $2, $3, NOW())',
      ['reset_all_data', req.user.id, JSON.stringify({ triggered_by: req.user.name, role: req.user.role })]
    );

    await client.query('COMMIT');
    res.json({ ok: true, message: 'All flight data, hours, billing, and training history have been reset.' });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[reset-all-data] Error:', err);
    res.status(500).json({ error: 'Failed to reset data. Please try again.' });
  } finally {
    client.release();
  }
});

// ─── BACKUP TRIGGER ─────────────────────────────────────

router.post('/backup/trigger', authenticateToken, requireRole('owner', 'admin'), async (req, res) => {
  const frequency = req.body?.frequency || 'daily';
  const validFrequencies = ['daily', 'weekly', 'monthly', 'yearly'];
  if (!validFrequencies.includes(frequency)) {
    return res.status(400).json({ error: `Invalid frequency. Must be one of: ${validFrequencies.join(', ')}` });
  }

  res.json({ success: true, message: `Backup triggered: ${frequency}. Emails will arrive within a minute.` });

  // runBackup is imported/defined in server.js startup — call via global
  if (typeof global.runBackup === 'function') {
    global.runBackup(pool, frequency).then(result => {
      console.log(`[backup] Manual ${frequency} backup result:`, result);
    }).catch(err => {
      console.error(`[backup] Manual ${frequency} backup error:`, err.message);
    });
  }
});

// ─── SOURCE DOWNLOAD ────────────────────────────────────

router.get('/download-source', authenticateToken, requireRole('owner', 'admin'), async (req, res) => {
  try {
    const projectRoot = path.join(__dirname, '..');
    const dateStr = new Date().toISOString().slice(0, 10);
    const zipName = `FlightSlate_Source_${dateStr.replace(/-/g, '')}.zip`;

    res.set('Content-Type', 'application/zip');
    res.set('Content-Disposition', `attachment; filename="${zipName}"`);
    res.set('Cache-Control', 'no-cache');

    // Load DB overrides — source of truth for editor changes.
    // Filesystem may not reflect these if rehydration hasn't run yet.
    const overrides = await getAllOverrides();
    const overrideMap = {};
    for (const o of overrides) overrideMap[o.file_path] = o.content;

    const archive = archiver('zip', { zlib: { level: 6 } });
    archive.on('error', (err) => {
      console.error('[download-source] Archive error:', err);
      if (!res.headersSent) res.status(500).json({ error: 'Failed to create archive' });
    });
    archive.pipe(res);

    const excludeDirs = new Set(['node_modules', '.git', '.claude', '.tmp', 'debug', 'shell-snapshots', 'session-env', 'todos', 'projects', 'scripts']);
    const excludeFiles = new Set(['.env', '.claude.json', '.npmrc']);
    const excludePatterns = ['.claude.json.backup', '.env.backup', 'availability-check2.png', 'availability-debug.png', 'availability-final.png', 'availability-screenshot.png', 'dashboard-check.png'];
    const addedPaths = new Set();

    function addDirectory(dirPath, archivePath) {
      let entries;
      try { entries = fs.readdirSync(dirPath, { withFileTypes: true }); } catch { return; }
      for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);
        const zipPath = archivePath ? `src/${archivePath}/${entry.name}` : `src/${entry.name}`;
        if (entry.isDirectory()) {
          if (excludeDirs.has(entry.name)) continue;
          addDirectory(fullPath, archivePath ? `${archivePath}/${entry.name}` : entry.name);
        } else {
          if (excludeFiles.has(entry.name)) continue;
          if (excludePatterns.some(p => entry.name.includes(p))) continue;
          if (entry.name.startsWith('.') && ![ '.gitignore', '.nvmrc' ].includes(entry.name)) continue;
          try { if (fs.statSync(fullPath).size > 8 * 1024 * 1024) continue; } catch { continue; }
          // Track the relative path (without src/ prefix) for override matching
          const relPath = path.relative(projectRoot, fullPath);
          addedPaths.add(relPath);
          // Use DB override content when available (guaranteed fresh)
          if (overrideMap[relPath] !== undefined) {
            archive.append(Buffer.from(overrideMap[relPath], 'utf8'), { name: zipPath });
          } else {
            archive.file(fullPath, { name: zipPath });
          }
        }
      }
    }
    addDirectory(projectRoot, '');

    // Add any override files that don't exist on disk (editor-created files)
    for (const [fp, content] of Object.entries(overrideMap)) {
      if (!addedPaths.has(fp)) {
        archive.append(Buffer.from(content, 'utf8'), { name: `src/${fp}` });
      }
    }

    // .env.example
    const envExample = `# FlightSlate Environment Variables
# Copy this file to .env and fill in your values

# Database (Neon PostgreSQL)
DATABASE_URL=REDACTED/dbname?sslmode=require

# JWT Authentication
JWT_SECRET=your-long-random-secret-string-here

# Application
PORT=3000
APP_URL=https://your-domain.com
NODE_ENV=production

# Email (Postmark)
POSTMARK_API_KEY=your-postmark-api-key
FROM_EMAIL=noreply@yourdomain.com

# File Storage (Cloudflare R2)
R2_ACCOUNT_ID=your-cloudflare-account-id
R2_ACCESS_KEY_ID=your-r2-access-key
R2_SECRET_ACCESS_KEY=your-r2-secret-key
R2_BUCKET=your-bucket-name
R2_PUBLIC_URL=https://pub-xxx.r2.dev

# AI Features (OpenAI-compatible)
OPENAI_API_KEY=your-openai-api-key
OPENAI_BASE_URL=https://api.openai.com/v1

# Backup (optional)
AUTO_BACKUP_ON_START=
BACKUP_EMAIL=owner@yourdomain.com
`;
    archive.append(envExample, { name: 'src/.env.example' });

    // Database schema
    let schemaSQL = `-- FlightSlate Database Schema\n-- Generated: ${new Date().toISOString()}\n-- Database: PostgreSQL (Neon)\n\n`;
    let structureMd = `# FlightSlate Database Structure\n\nGenerated: ${new Date().toISOString()}\n\n`;

    try {
      const tableRes = await pool.query(`
        SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
        ORDER BY table_name
      `);

      for (const row of tableRes.rows) {
        const tbl = row.table_name;
        const colRes = await pool.query(`
          SELECT column_name, data_type, character_maximum_length, is_nullable, column_default
          FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = $1
          ORDER BY ordinal_position
        `, [tbl]);

        const conRes = await pool.query(`
          SELECT conname, contype, pg_get_constraintdef(oid) AS def
          FROM pg_constraint WHERE conrelid = $1::regclass ORDER BY contype
        `, [tbl]);

        const idxRes = await pool.query(`
          SELECT indexname, indexdef FROM pg_indexes
          WHERE schemaname = 'public' AND tablename = $1 AND indexname NOT LIKE '%_pkey'
          ORDER BY indexname
        `, [tbl]);

        const cols = colRes.rows.map(c => {
          let def = `  ${c.column_name} ${c.data_type.toUpperCase()}`;
          if (c.character_maximum_length) def += `(${c.character_maximum_length})`;
          if (c.column_default) def += ` DEFAULT ${c.column_default}`;
          if (c.is_nullable === 'NO') def += ' NOT NULL';
          return def;
        });
        const constraints = conRes.rows.map(c => `  CONSTRAINT ${c.conname} ${c.def}`);
        schemaSQL += `CREATE TABLE IF NOT EXISTS ${tbl} (\n${[...cols, ...constraints].join(',\n')}\n);\n\n`;
        for (const idx of idxRes.rows) schemaSQL += `${idx.indexdef};\n`;
        schemaSQL += '\n';

        structureMd += '## `' + tbl + '`\n\n';
        structureMd += `| Column | Type | Nullable | Default |\n|--------|------|----------|--------|\n`;
        for (const c of colRes.rows) {
          const type = c.character_maximum_length ? `${c.data_type}(${c.character_maximum_length})` : c.data_type;
          structureMd += '| `' + c.column_name + '` | ' + type + ' | ' + c.is_nullable + ' | ' + (c.column_default || '') + ' |\n';
        }
        if (conRes.rows.length) {
          structureMd += `\n**Constraints:**\n`;
          for (const con of conRes.rows) structureMd += '- `' + con.conname + '`: ' + con.def + '\n';
        }
        if (idxRes.rows.length) {
          structureMd += `\n**Indexes:**\n`;
          for (const idx of idxRes.rows) structureMd += `- ${idx.indexdef}\n`;
        }
        structureMd += '\n';
      }
    } catch (_) { /* schema query failed */ }

    archive.append(schemaSQL, { name: 'docs/database-schema.sql' });
    archive.append(structureMd, { name: 'docs/database-structure.md' });
    archive.append(`# FlightSlate API Documentation\n\nGenerated: ${new Date().toISOString()}\n\nSee routes/ for API endpoints.\n`, { name: 'docs/README.md' });

    archive.finalize();
  } catch (err) {
    console.error('[download-source] error:', err.message);
    if (!res.headersSent) res.status(500).json({ error: 'Failed to create download' });
  }
});

// ─── INSTRUCTOR AVAILABILITY ─────────────────────────────

router.get('/instructor-availability', authenticateToken, async (req, res) => {
  const client = await pool.connect();
  try {
    const instructorId = req.query.instructor_id ? parseInt(req.query.instructor_id) : req.user.id;
    const isOwnProfile = instructorId === req.user.id;
    const isAdmin = ['owner', 'admin'].includes(req.user.role);
    if (!isOwnProfile && !isAdmin) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const weekly = await client.query(
      `SELECT id, day_of_week, start_time, end_time FROM instructor_availability
       WHERE instructor_id = $1 ORDER BY day_of_week, start_time`,
      [instructorId]
    );

    const overrides = await client.query(
      `SELECT id, start_date, end_date, is_available, start_time, end_time, reason, override_type
       FROM instructor_availability_overrides
       WHERE instructor_id = $1 ORDER BY start_date DESC`,
      [instructorId]
    );

    res.json({ instructor_id: instructorId, weekly: weekly.rows, overrides: overrides.rows });
  } catch (err) {
    console.error('GET instructor-availability error:', err);
    res.status(500).json({ error: 'Server error' });
  } finally {
    client.release();
  }
});

router.post('/instructor-availability', authenticateToken, requireRole('instructor', 'admin', 'owner'), async (req, res) => {
  const client = await pool.connect();
  try {
    const { instructor_id, day_of_week, start_time, end_time } = req.body;
    const iid = instructor_id ? parseInt(instructor_id) : req.user.id;
    const isOwnProfile = iid === req.user.id;
    const isAdmin = ['owner', 'admin'].includes(req.user.role);
    if (!isOwnProfile && !isAdmin) return res.status(403).json({ error: 'Can only set your own availability' });
    if (day_of_week === undefined || day_of_week === null || !start_time || !end_time) {
      return res.status(400).json({ error: 'day_of_week, start_time, end_time are required' });
    }
    if (start_time >= end_time) return res.status(400).json({ error: 'end_time must be after start_time' });

    const result = await client.query(
      `INSERT INTO instructor_availability (instructor_id, day_of_week, start_time, end_time)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [iid, parseInt(day_of_week), start_time, end_time]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('POST instructor-availability error:', err);
    res.status(500).json({ error: 'Server error' });
  } finally {
    client.release();
  }
});

router.delete('/instructor-availability/:id', authenticateToken, requireRole('instructor', 'admin', 'owner'), async (req, res) => {
  const client = await pool.connect();
  try {
    const { id } = req.params;
    const row = await client.query('SELECT instructor_id FROM instructor_availability WHERE id=$1', [id]);
    if (row.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    const iid = row.rows[0].instructor_id;
    const isOwnProfile = iid === req.user.id;
    const isAdmin = ['owner', 'admin'].includes(req.user.role);
    if (!isOwnProfile && !isAdmin) return res.status(403).json({ error: 'Forbidden' });
    await client.query('DELETE FROM instructor_availability WHERE id=$1', [id]);
    res.json({ ok: true });
  } catch (err) {
    console.error('DELETE instructor-availability error:', err);
    res.status(500).json({ error: 'Server error' });
  } finally {
    client.release();
  }
});

router.delete('/instructor-availability', authenticateToken, requireRole('instructor', 'admin', 'owner'), async (req, res) => {
  const client = await pool.connect();
  try {
    const instructorId = req.query.instructor_id ? parseInt(req.query.instructor_id) : req.user.id;
    const isOwnProfile = instructorId === req.user.id;
    const isAdmin = ['owner', 'admin'].includes(req.user.role);
    if (!isOwnProfile && !isAdmin) return res.status(403).json({ error: 'Forbidden' });
    await client.query('DELETE FROM instructor_availability WHERE instructor_id=$1', [instructorId]);
    res.json({ ok: true });
  } catch (err) {
    console.error('DELETE all instructor-availability error:', err);
    res.status(500).json({ error: 'Server error' });
  } finally {
    client.release();
  }
});

// POST /api/instructor-availability/overrides
router.post('/instructor-availability/overrides', authenticateToken, requireRole('instructor', 'admin', 'owner'), async (req, res) => {
  const client = await pool.connect();
  try {
    const { instructor_id, start_date, end_date, is_available, start_time, end_time, reason, override_type } = req.body;
    const iid = instructor_id ? parseInt(instructor_id) : req.user.id;
    const isOwnProfile = iid === req.user.id;
    const isAdmin = ['owner', 'admin'].includes(req.user.role);
    if (!isOwnProfile && !isAdmin) return res.status(403).json({ error: 'Can only set your own availability' });
    if (!start_date || !end_date) return res.status(400).json({ error: 'start_date and end_date are required' });
    if (start_date > end_date) return res.status(400).json({ error: 'end_date must be >= start_date' });
    if (start_time && end_time && start_time >= end_time) return res.status(400).json({ error: 'end_time must be after start_time when specifying a range' });

    const result = await client.query(
      `INSERT INTO instructor_availability_overrides
         (instructor_id, start_date, end_date, is_available, start_time, end_time, reason, override_type)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [iid, start_date, end_date, is_available !== false, start_time || null, end_time || null, reason || null, override_type || 'personal']
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('POST instructor-availability/overrides error:', err);
    res.status(500).json({ error: 'Server error' });
  } finally {
    client.release();
  }
});

// DELETE /api/instructor-availability/overrides/:id
router.delete('/instructor-availability/overrides/:id', authenticateToken, requireRole('instructor', 'admin', 'owner'), async (req, res) => {
  const client = await pool.connect();
  try {
    const { id } = req.params;
    const row = await client.query('SELECT instructor_id FROM instructor_availability_overrides WHERE id=$1', [id]);
    if (row.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    const iid = row.rows[0].instructor_id;
    const isOwnProfile = iid === req.user.id;
    const isAdmin = ['owner', 'admin'].includes(req.user.role);
    if (!isOwnProfile && !isAdmin) return res.status(403).json({ error: 'Forbidden' });
    await client.query('DELETE FROM instructor_availability_overrides WHERE id=$1', [id]);
    res.json({ ok: true });
  } catch (err) {
    console.error('DELETE instructor-availability/override error:', err);
    res.status(500).json({ error: 'Server error' });
  } finally {
    client.release();
  }
});

// GET /api/instructor-availability/all — admin view: all instructors' availability for a date
router.get('/instructor-availability/all', authenticateToken, requireRole('admin', 'owner'), async (req, res) => {
  const client = await pool.connect();
  try {
    const { date } = req.query;
    if (!date) return res.status(400).json({ error: 'date required (YYYY-MM-DD)' });

    const dateObj = new Date(date + 'T00:00:00Z');
    const dayOfWeek = dateObj.getUTCDay();

    const instructors = await client.query(
      `SELECT id, name FROM users WHERE is_instructor = true AND deleted_at IS NULL ORDER BY name`
    );

    const result = [];
    for (const inst of instructors.rows) {
      const weekly = await client.query(
        `SELECT start_time, end_time FROM instructor_availability
         WHERE instructor_id = $1 AND day_of_week = $2 ORDER BY start_time`,
        [inst.id, dayOfWeek]
      );

      const overrides = await client.query(
        `SELECT is_available, start_time, end_time, reason FROM instructor_availability_overrides
         WHERE instructor_id = $1 AND start_date <= $2::date AND end_date >= $2::date`,
        [inst.id, date]
      );

      const fullyBlocked = overrides.rows.some(o => !o.is_available && !o.start_time);
      const hasConfig = (await client.query(
        'SELECT 1 FROM instructor_availability WHERE instructor_id=$1 LIMIT 1', [inst.id]
      )).rows.length > 0;

      const windows = weekly.rows.map(w => ({ start: w.start_time.slice(0, 5), end: w.end_time.slice(0, 5) }));
      const extraWindows = overrides.rows.filter(o => o.is_available && o.start_time).map(o => ({ start: o.start_time.slice(0, 5), end: o.end_time.slice(0, 5) }));
      const blocked = overrides.rows.filter(o => !o.is_available && o.start_time).map(o => ({ start: o.start_time.slice(0, 5), end: o.end_time.slice(0, 5), reason: o.reason }));

      const bookings = await client.query(
        `SELECT b.start_time, b.end_time, u.name as student_name
         FROM bookings b LEFT JOIN users u ON b.student_id = u.id
         WHERE b.instructor_id = $1 AND b.status != 'cancelled'
           AND DATE(b.start_time AT TIME ZONE 'UTC') = $2::date`,
        [inst.id, date]
      );

      result.push({
        id: inst.id,
        name: inst.name,
        has_config: hasConfig,
        fully_blocked: fullyBlocked,
        windows: [...windows, ...extraWindows],
        blocked,
        bookings: bookings.rows.map(bk => ({
          start: bk.start_time.toISOString ? bk.start_time.toISOString().slice(11, 16) : String(bk.start_time).slice(11, 16),
          end: bk.end_time.toISOString ? bk.end_time.toISOString().slice(11, 16) : String(bk.end_time).slice(11, 16),
          student: bk.student_name
        }))
      });
    }

    res.json({ date, day: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][dayOfWeek], instructors: result });
  } catch (err) {
    console.error('GET instructor-availability/all error:', err);
    res.status(500).json({ error: 'Server error' });
  } finally {
    client.release();
  }
});

// ─── MANUAL EXPORT TRIGGER (owner/admin only) ─────────────────────────────────

router.post('/run-export', authenticateToken, requireRole('owner', 'admin'), async (req, res) => {
  try {
    const { runExport } = require('../export-service');
    // Fire async — don't block the response
    runExport(pool)
      .then(r => console.log('[export] Manual trigger complete:', r.uploaded + '/9 files'))
      .catch(err => console.error('[export] Manual trigger error:', err.message));
    res.json({ ok: true, message: 'Export started — emails will arrive within a few minutes' });
  } catch (err) {
    console.error('[export] Manual trigger setup error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── PRE-FLIGHT REMINDER TRIGGER (owner/admin only) ──────────────────────────
// Fires the reminder-email job immediately for testing.
// Also resets reminder_sent for bookings matching criteria.

router.post('/run-reminder-check', authenticateToken, requireRole('owner', 'admin'), async (req, res) => {
  const { child } = require('child_process');
  // Spawn the job script — fires immediately and runs in background
  const job = child.spawn('node', ['jobs/reminder-email.js'], {
    detached: true,
    stdio: 'ignore',
  });
  job.unref();
  res.json({ ok: true, message: 'Reminder check triggered — check server logs for results' });
});

// ─── RESET REMINDER_SENT (for testing) ──────────────────────────────────────
// Resets reminder_sent on specific bookings so the cron can fire again.
// Use for testing: create a booking for tomorrow, call this to reset its flag.

router.post('/reset-reminders', authenticateToken, requireRole('owner', 'admin'), async (req, res) => {
  const { booking_ids } = req.body;
  if (!booking_ids || !Array.isArray(booking_ids)) {
    return res.status(400).json({ error: 'booking_ids array required' });
  }
  try {
    const result = await pool.query(
      'UPDATE bookings SET reminder_sent = false, updated_at = NOW() WHERE id = ANY($1) RETURNING id',
      [booking_ids]
    );
    res.json({ ok: true, reset: result.rows.length });
  } catch (err) {
    console.error('[reset-reminders] error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;