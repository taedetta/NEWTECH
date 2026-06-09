/**
 * Startup tasks — runs once on server boot.
 * Extracted from server.js to keep entry file under 300 lines.
 * Owns: image migration, training program seeding, backup scheduler, file override rehydration.
 */
'use strict';

const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const fetch = require('node-fetch');
const { getPlatformAdminEmail } = require('../lib/platform-admin');
const { syncAllAircraftMeterFields } = require('../lib/aircraft-meter');

// backup-service.js removed from services/ — backup scheduling skipped
// migrateDataUriImagesToR2 is provided inline below

function toCentral(date) {
  return new Date(date.toLocaleString('en-US', { timeZone: 'America/New_York' }));
}

function isoDate(date) {
  const d = toCentral(date);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

async function ensureDatabaseSchema(pool) {
  try {
    const check = await pool.query(`SELECT to_regclass('public.users') AS users_table`);
    if (check.rows[0]?.users_table) return;

    console.log('[bootstrap] Fresh database detected — applying schema...');
    const schemaPath = path.join(__dirname, '..', 'scripts', 'bootstrap-schema.sql');
    if (!fs.existsSync(schemaPath)) {
      console.error('[bootstrap] bootstrap-schema.sql not found — skipping');
      return;
    }
    await pool.query(fs.readFileSync(schemaPath, 'utf8'));
    console.log('[bootstrap] Schema applied');

    // Seed CMS from live production site
    try {
      const liveUrl = process.env.CMS_SEED_URL || 'https://www.newtechaviation.com/api/site-content?full=1';
      const res = await fetch(liveUrl);
      if (res.ok) {
        const cms = await res.json();
        let count = 0;
        for (const [key, value] of Object.entries(cms)) {
          if (value == null) continue;
          await pool.query(
            `INSERT INTO site_content (key, value, updated_at) VALUES ($1, $2, NOW())
             ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()`,
            [key, String(value)]
          );
          count++;
        }
        console.log(`[bootstrap] Seeded ${count} CMS keys from live site`);
      }
    } catch (seedErr) {
      console.error('[bootstrap] CMS seed failed:', seedErr.message);
    }

    // Create default admin account if no users exist
    const users = await pool.query('SELECT COUNT(*) AS cnt FROM users');
    if (parseInt(users.rows[0].cnt, 10) === 0) {
      const email = process.env.ADMIN_EMAIL || process.env.OWNER_EMAIL || 'evaughntaemw@gmail.com';
      const pass = process.env.ADMIN_PASSWORD || process.env.OWNER_PASSWORD || 'NewTech2026!';
      const hash = await bcrypt.hash(pass, 12);
      const inserted = await pool.query(
        `INSERT INTO users (email, name, password_hash, role, approval_status, is_instructor)
         VALUES ($1, $2, $3, 'admin', 'approved', TRUE)
         RETURNING id`,
        [email.toLowerCase(), 'Evaughntae White', hash]
      );
      await pool.query(
        `INSERT INTO user_permissions (user_id, can_manage_aircraft, can_manage_instructors, can_manage_permissions, can_manage_students, can_edit_website)
         VALUES ($1, TRUE, TRUE, TRUE, TRUE, TRUE)
         ON CONFLICT (user_id) DO NOTHING`,
        [inserted.rows[0].id]
      );
      console.log(`[bootstrap] Created admin/instructor account: ${email}`);
    }
  } catch (err) {
    console.error('[bootstrap] Schema bootstrap error:', err.message);
  }
}

async function ensureSchemaPatches(pool) {
  try {
    await pool.query(`
      ALTER TABLE aircraft_downtime ADD COLUMN IF NOT EXISTS start_time TIME;
      ALTER TABLE aircraft_downtime ADD COLUMN IF NOT EXISTS end_time TIME;
      ALTER TABLE aircraft_downtime ADD COLUMN IF NOT EXISTS all_day BOOLEAN DEFAULT TRUE;
      UPDATE aircraft_downtime SET all_day = TRUE WHERE all_day IS NULL;
      UPDATE aircraft_downtime SET all_day = FALSE
        WHERE start_time IS NOT NULL AND end_time IS NOT NULL AND all_day = TRUE;
      ALTER TABLE aircraft ADD COLUMN IF NOT EXISTS maintenance_reason TEXT;
    `);
  } catch (err) {
    console.error('[bootstrap] Downtime column patch error:', err.message);
  }
  try {
    const patchPath = path.join(__dirname, '..', 'scripts', 'schema-patches.sql');
    if (!fs.existsSync(patchPath)) return;
    await pool.query(fs.readFileSync(patchPath, 'utf8'));
    console.log('[bootstrap] Schema patches applied');
  } catch (err) {
    console.error('[bootstrap] Schema patches error:', err.message);
  }
}

async function ensureUserIdSequence(pool) {
  try {
    const seqName = await pool.query(`SELECT pg_get_serial_sequence('users', 'id') AS name`);
    if (seqName.rows[0]?.name) {
      await pool.query(
        `SELECT setval($1::regclass, GREATEST(COALESCE((SELECT MAX(id) FROM users), 1), 1))`,
        [seqName.rows[0].name]
      );
    } else {
      await pool.query(`
        CREATE SEQUENCE IF NOT EXISTS users_id_seq OWNED BY users.id;
        ALTER TABLE users ALTER COLUMN id SET DEFAULT nextval('users_id_seq');
        SELECT setval('users_id_seq', GREATEST(COALESCE((SELECT MAX(id) FROM users), 1), 1));
      `);
    }
  } catch (err) {
    console.error('[bootstrap] users id sequence sync error:', err.message);
  }
}

async function ensureDefaultAdminAccount(pool) {
  const email = getPlatformAdminEmail();
  try {
    const existing = await pool.query(
      'SELECT id, role FROM users WHERE LOWER(email) = LOWER($1) AND deleted_at IS NULL',
      [email]
    );
    if (existing.rows.length === 0) return;

    const userId = existing.rows[0].id;
    if (existing.rows[0].role !== 'admin') {
      await pool.query(
        `UPDATE users SET role = 'admin', is_instructor = TRUE, approval_status = 'approved', updated_at = NOW()
         WHERE id = $1`,
        [userId]
      );
      console.log(`[bootstrap] Platform admin ${email} set to admin/instructor (not owner label)`);
    } else {
      await pool.query(
        `UPDATE users SET is_instructor = TRUE, approval_status = 'approved', updated_at = NOW()
         WHERE id = $1 AND (is_instructor IS NOT TRUE OR approval_status != 'approved')`,
        [userId]
      );
    }

    await upsertFullUserPermissions(pool, userId);
  } catch (err) {
    console.error('[bootstrap] ensureDefaultAdminAccount error:', err.message);
  }
}

async function migrateDataUriImagesToR2Inline(pool) {
  const { uploadBuffer, isConfigured } = require('../lib/r2-storage');
  if (!isConfigured()) { console.log('[image-migration] Skipping — R2 env vars not set'); return; }
  try {
    const result = await pool.query("SELECT key, value FROM site_content WHERE key LIKE '%image%' AND value LIKE 'data:%'");
    if (result.rows.length === 0) { console.log('[image-migration] No data-URI images to migrate'); return; }
    console.log(`[image-migration] Found ${result.rows.length} data-URI image(s) to migrate to R2`);
    for (const row of result.rows) {
      try {
        const dataUri = row.value;
        const commaIdx = dataUri.indexOf(',');
        if (commaIdx === -1) continue;
        const mimeType = dataUri.substring(5, commaIdx).replace(';base64', '').split(';')[0] || 'image/jpeg';
        const base64Data = dataUri.substring(commaIdx + 1).replace(/\b/g, '');
        const buffer = Buffer.from(base64Data, 'base64');
        const ext = mimeType.split('/')[1] || 'jpg';
        const uniqueName = `cms-${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
        const imageUrl = await uploadBuffer(buffer, uniqueName, { folder: 'images', contentType: mimeType });
        if (imageUrl) {
          await pool.query('UPDATE site_content SET value = $1, updated_at = NOW() WHERE key = $2', [imageUrl, row.key]);
          console.log(`[image-migration] migrated ${row.key} to ${imageUrl}`);
        }
      } catch (itemErr) { console.error(`[image-migration] ${row.key} error: ${itemErr.message}`); }
    }
  } catch (err) { console.error('[image-migration] error:', err.message); }
}

async function ensureTrainingPrograms(pool) {
  try {
    const check = await pool.query('SELECT COUNT(*) as cnt FROM training_programs');
    if (parseInt(check.rows[0].cnt) === 0) {
      console.log('Seeding training programs...');
      const programs = [
        { name: 'Private Pilot License', code: 'PPL', description: 'FAA Private Pilot Certificate', stages: ['Pre-Solo Dual','First Solo','Post-Solo Dual','Cross-Country Dual','Cross-Country Solo','Night Training','Instrument & Hood Work','Checkride Prep','Checkride'] },
        { name: 'Instrument Rating', code: 'IFR', description: 'FAA Instrument Rating — fly in IMC under IFR', stages: ['Instrument Fundamentals','Navigation & Holds','Instrument Approaches','IFR Cross-Country','Unusual Attitudes & Emergencies','Checkride Prep','Checkride'] },
        { name: 'Commercial Pilot License', code: 'CPL', description: 'FAA Commercial Pilot Certificate', stages: ['Complex Aircraft Transition','Commercial Maneuvers','Commercial Cross-Country','Night Commercial Training','High Altitude & Oxygen','Checkride Prep','Checkride'] },
      ];
      for (const p of programs) {
        const r = await pool.query(`INSERT INTO training_programs (name, code, description) VALUES ($1, $2, $3) ON CONFLICT (code) DO NOTHING RETURNING id`, [p.name, p.code, p.description]);
        const pid = r.rows.length > 0 ? r.rows[0].id : (await pool.query(`SELECT id FROM training_programs WHERE code = $1`, [p.code])).rows[0].id;
        for (let i = 0; i < p.stages.length; i++) {
          await pool.query(`INSERT INTO program_stages (program_id, name, order_index) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`, [pid, p.stages[i], i + 1]);
        }
      }
      console.log('Training programs seeded.');
    }
    // Replace generic PPL syllabus with ASA PM-S-P9-PD lesson structure
    const { seedPplPmSyllabus } = require('../scripts/seed-ppl-pm-syllabus');
    await seedPplPmSyllabus();
  } catch (err) { console.error('Training programs seed check failed:', err.message); }
}

async function runStartupVerification(port) {
  // startup-verification.js removed — skipping verification
  console.log('[startup] Route verification not configured (startup-verification.js missing)');
  return { passed: [], failed: [], criticalFailures: [] };
}

async function startBackup(pool) {
  // backup-service.js removed — backup scheduling not available
  console.log('[startup] Backup scheduler not configured (backup-service.js missing)');
}

/**
 * Rehydrate editor file changes from database to filesystem.
 * Railway's filesystem is ephemeral — every deploy rebuilds from GitHub,
 * wiping any editor changes. This restores them from the DB on boot.
 */
async function rehydrateFileOverrides(pool) {
  try {
    // Check if file_overrides table exists (may not on first deploy before migration runs)
    const tableCheck = await pool.query(`
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'file_overrides'
    `);
    if (tableCheck.rows.length === 0) {
      console.log('[file-overrides] Table not yet created — skipping rehydration');
      return;
    }

    const result = await pool.query(
      'SELECT file_path, content, updated_at FROM file_overrides ORDER BY updated_at ASC'
    );
    if (result.rows.length === 0) {
      console.log('[file-overrides] No overrides to rehydrate');
      return;
    }

    const projectRoot = path.join(__dirname, '..');
    let applied = 0;
    let skipped = 0;

    for (const row of result.rows) {
      try {
        const fullPath = path.join(projectRoot, row.file_path);
        // Safety: only write within project root
        if (!fullPath.startsWith(projectRoot)) {
          console.warn(`[file-overrides] Skipping path outside project root: ${row.file_path}`);
          skipped++;
          continue;
        }
        // Ensure parent directory exists
        const dir = path.dirname(fullPath);
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(fullPath, row.content, 'utf8');
        applied++;
      } catch (fileErr) {
        console.error(`[file-overrides] Failed to rehydrate ${row.file_path}: ${fileErr.message}`);
        skipped++;
      }
    }
    console.log(`[file-overrides] Rehydrated ${applied} file(s), skipped ${skipped}`);
  } catch (err) {
    console.error('[file-overrides] Rehydration error:', err.message);
  }
}

/**
 * Run all startup tasks. Call once from server.js after app.listen().
 */
async function runStartup({ pool }) {
  // Bootstrap schema on fresh databases (e.g. new Postgres instance)
  try {
    await ensureDatabaseSchema(pool);
    await ensureSchemaPatches(pool);
    await ensureUserIdSequence(pool);
    await ensureDefaultAdminAccount(pool);
    await syncAllAircraftMeterFields(pool);
  } catch (err) {
    console.error('[bootstrap] startup error:', err.message);
  }

  // Rehydrate editor file overrides FIRST and AWAIT it — restores admin edits
  // lost on deploy. Must complete before the app serves any requests so that
  // download-source endpoints and the live filesystem reflect editor changes.
  try {
    await rehydrateFileOverrides(pool);
  } catch (err) {
    console.error('[file-overrides] startup error:', err.message);
  }

  migrateDataUriImagesToR2Inline(pool).catch(err => console.error('[image-migration] startup error:', err.message));
  ensureTrainingPrograms(pool).catch(err => console.error('[training-seed] startup error:', err.message));
  startBackup(pool);
  runStartupVerification(process.env.PORT || 3000).then(({ passed, failed, criticalFailures }) => {
    if (criticalFailures.length > 0) {
      console.error('[CRITICAL] Routes failed verification — see above. Process will continue but site may be broken.');
    }
  });
}

module.exports = { runStartup };