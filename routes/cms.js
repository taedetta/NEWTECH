'use strict';

const express = require('express');
const path = require('path');
const fs = require('fs');
const archiver = require('archiver');
const pool = require('../db/index');
const { saveFileOverride, removeOverride, getUnsyncedOverrides, getAllOverrides, markSynced, clearAllOverrides, countUnsynced } = require('../db/file-overrides');
const { authenticateToken, requirePermission } = require('../middleware/auth');

const router = express.Router();

let _cmsCache = null;
let _cmsCacheAt = 0;
const CMS_CACHE_TTL_MS = 60 * 1000;

async function getCmsData() {
  const now = Date.now();
  if (_cmsCache && (now - _cmsCacheAt) < CMS_CACHE_TTL_MS) return _cmsCache;
  const result = await pool.query('SELECT key, value FROM site_content');
  const data = {};
  result.rows.forEach(row => { data[row.key] = row.value; });
  _cmsCache = data;
  _cmsCacheAt = now;
  return data;
}

function invalidateCmsCache() { _cmsCache = null; _cmsCacheAt = 0; }

let _htmlTemplate = null;
function getHtmlTemplate() {
  if (!_htmlTemplate) {
    const htmlPath = path.join(__dirname, '..', 'public', 'index.html');
    if (fs.existsSync(htmlPath)) _htmlTemplate = fs.readFileSync(htmlPath, 'utf8');
  }
  return _htmlTemplate;
}

router.get('/site-content', async (req, res) => {
  res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  try {
    const result = await pool.query('SELECT key, value FROM site_content');
    const content = {};
    const includeFull = req.query.full === '1';
    result.rows.forEach(row => {
      if (!includeFull && row.value && row.value.startsWith('data:') && row.value.length > 500) {
        content[row.key] = '/api/site-content/image/' + encodeURIComponent(row.key);
      } else {
        content[row.key] = row.value;
      }
    });
    res.json(content);
  } catch (err) {
    console.error('Site content fetch error:', err);
    res.status(500).json({ error: 'Failed to fetch site content' });
  }
});

router.get('/site-content/image/:key', async (req, res) => {
  try {
    const result = await pool.query('SELECT value FROM site_content WHERE key = $1', [req.params.key]);
    if (result.rows.length === 0 || !result.rows[0].value) return res.status(404).json({ error: 'Image not found' });
    const dataUri = result.rows[0].value;
    if (!dataUri.startsWith('data:')) return res.redirect(dataUri);
    const commaIdx = dataUri.indexOf(',');
    if (commaIdx === -1) return res.status(400).json({ error: 'Invalid image data' });
    const mimeType = dataUri.substring(5, commaIdx).replace(';base64', '').split(';')[0] || 'image/jpeg';
    const base64Data = dataUri.substring(commaIdx + 1).replace(/\b/g, '');
    const buffer = Buffer.from(base64Data, 'base64');
    res.set('Content-Type', mimeType);
    res.set('Cache-Control', 'public, max-age=3600');
    res.send(buffer);
  } catch (err) {
    console.error('Site content image error:', err);
    res.status(500).json({ error: 'Failed to fetch image' });
  }
});

router.put('/site-content', authenticateToken, requirePermission('can_edit_website'), async (req, res) => {
  try {
    const updates = req.body;
    if (!updates || typeof updates !== 'object') return res.status(400).json({ error: 'Request body must be a key-value object' });
    const entries = Object.entries(updates);
    if (entries.length === 0) return res.json({ saved: 0 });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const [key, value] of entries) {
        if (typeof key !== 'string' || key.length > 100) continue;
        await client.query(
          `INSERT INTO site_content (key, value, updated_at) VALUES ($1, $2, NOW())
           ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()`,
          [key, value === null ? null : String(value)]
        );
      }
      await client.query('COMMIT');
      invalidateCmsCache();
      _htmlTemplate = null;
      res.json({ saved: entries.length });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('Site content save error:', err);
    res.status(500).json({ error: 'Failed to save site content' });
  }
});

router.post('/site-content/upload-image', authenticateToken, requirePermission('can_edit_website'), async (req, res) => {
  try {
    const { filename, base64, mimeType } = req.body || {};
    if (!base64 || typeof base64 !== 'string') return res.status(400).json({ error: 'Image data is required' });
    const safeMime = typeof mimeType === 'string' && /^image\/(png|jpe?g|gif|webp|svg\+xml)$/i.test(mimeType)
      ? mimeType.toLowerCase()
      : null;
    if (!safeMime) return res.status(400).json({ error: 'Unsupported image type' });
    const data = base64.includes(',') ? base64.split(',').pop() : base64;
    if (!/^[A-Za-z0-9+/=\s]+$/.test(data)) return res.status(400).json({ error: 'Invalid image data' });
    const compact = data.replace(/\s/g, '');
    const buffer = Buffer.from(compact, 'base64');
    if (!buffer.length) return res.status(400).json({ error: 'Invalid image data' });
    if (buffer.length > 3 * 1024 * 1024) return res.status(413).json({ error: 'Image too large (max 3MB)' });
    const safeName = String(filename || 'image')
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'image';
    const key = `editor_upload_${Date.now()}_${safeName}`;
    const dataUri = `data:${safeMime};base64,${compact}`;
    await pool.query(
      `INSERT INTO site_content (key, value, updated_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()`,
      [key, dataUri]
    );
    invalidateCmsCache();
    res.status(201).json({ key, url: `/api/site-content/image/${encodeURIComponent(key)}` });
  } catch (err) {
    console.error('Site content image upload error:', err);
    res.status(500).json({ error: 'Failed to upload image' });
  }
});

router.get('/project-files', authenticateToken, requirePermission('can_edit_website'), async (req, res) => {
  try {
    const projectRoot = path.join(__dirname, '..');
    const searchPath = req.query.path ? path.join(projectRoot, req.query.path) : projectRoot;
    const relPath = req.query.path || '.';
    if (!searchPath.startsWith(projectRoot)) return res.status(403).json({ error: 'Access denied: path outside project root' });
    const blockedPatterns = ['node_modules', '.git', '.env', 'session-env', 'shell-snapshots', 'test-fixtures', 'migrations/node_modules'];
    if (blockedPatterns.some(p => searchPath.includes(p))) return res.status(403).json({ error: 'Access denied: protected directory' });
    const stat = fs.statSync(searchPath);
    if (stat.isFile()) {
      const ext = path.extname(searchPath).toLowerCase();
      const maxSize = 2 * 1024 * 1024;
      if (stat.size > maxSize) return res.status(413).json({ error: 'File too large (max 2MB)', size: stat.size });
      const content = fs.readFileSync(searchPath, 'utf8');
      return res.json({ type: 'file', path: relPath, name: path.basename(searchPath), size: stat.size, content, extension: ext });
    }
    const entries = fs.readdirSync(searchPath, { withFileTypes: true });
    const files = entries
      .filter(e => !e.name.startsWith('.') && !e.name.startsWith('node_modules'))
      .map(e => {
        const fullPath = path.join(searchPath, e.name);
        let s;
        try { s = fs.statSync(fullPath); } catch { return null; }
        return { name: e.name, path: e.name, type: e.isDirectory() ? 'dir' : 'file', size: s.size, extension: e.isDirectory() ? '' : path.extname(e.name).toLowerCase() };
      })
      .filter(Boolean)
      .sort((a, b) => {
        if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
    res.json({ type: 'dir', path: relPath, entries: files });
  } catch (err) {
    console.error('project-files GET error:', err.message);
    res.status(500).json({ error: 'Failed to read file or directory' });
  }
});

router.put('/project-files', authenticateToken, requirePermission('can_edit_website'), async (req, res) => {
  try {
    const { path: filePath, content } = req.body;
    if (!filePath || content === undefined) return res.status(400).json({ error: 'Missing path or content' });
    const projectRoot = path.join(__dirname, '..');
    const fullPath = path.join(projectRoot, filePath);
    if (!fullPath.startsWith(projectRoot)) return res.status(403).json({ error: 'Access denied: path outside project root' });
    const blockedPatterns = ['node_modules', '.git', '.env', 'package-lock.json', 'session-env', 'shell-snapshots', 'migrate.js', 'render.yaml'];
    if (blockedPatterns.some(p => fullPath.includes(p))) return res.status(403).json({ error: 'Access denied: protected file' });

    // Write to filesystem (immediate effect on live app)
    fs.writeFileSync(fullPath, content, 'utf8');

    // Persist to database so the change survives Railway redeploys.
    // Railway's filesystem is ephemeral — without this, editor changes
    // are lost every time the app rebuilds from GitHub.
    try {
      await saveFileOverride(filePath, content, req.user?.id);
    } catch (dbErr) {
      // Non-fatal: filesystem write succeeded, the live app is updated.
      // DB persistence failing means the change won't survive next deploy.
      console.error('[file-overrides] DB persist failed (file was still saved to disk):', dbErr.message);
    }

    res.json({ success: true, path: filePath, persisted: true });
  } catch (err) {
    console.error('project-files PUT error:', err.message);
    res.status(500).json({ error: 'Failed to save file' });
  }
});

router.get('/download-source', authenticateToken, requirePermission('can_edit_website'), async (req, res) => {
  try {
    const projectRoot = path.join(__dirname, '..');
    const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const zipName = `nta-source-${dateStr}.zip`;
    res.set('Content-Type', 'application/zip');
    res.set('Content-Disposition', `attachment; filename="${zipName}"`);
    res.set('Cache-Control', 'no-cache');

    // Load DB overrides — these are the source of truth for editor changes.
    // Filesystem may be stale if rehydration hasn't run yet after a deploy.
    const overrides = await getAllOverrides();
    const overrideMap = {};
    for (const o of overrides) overrideMap[o.file_path] = o.content;

    const archive = archiver('zip', { zlib: { level: 6 } });
    archive.on('error', (err) => { console.error('Archive error:', err); if (!res.headersSent) res.status(500).json({ error: 'Archive failed' }); });
    archive.pipe(res);
    const skipPatterns = [/node_modules/, /\.git/, /\.env/, /session-env/, /shell-snapshots/, /test-fixtures/, /\.DS_Store/];
    const addedPaths = new Set();

    function addDir(dir) {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const e of entries) {
        const full = path.join(dir, e.name);
        if (skipPatterns.some(r => r.test(full))) continue;
        if (e.isDirectory()) { addDir(full); continue; }
        const relPath = path.relative(projectRoot, full);
        addedPaths.add(relPath);
        // Use DB override content when available (guaranteed fresh)
        if (overrideMap[relPath] !== undefined) {
          archive.append(Buffer.from(overrideMap[relPath], 'utf8'), { name: relPath });
        } else {
          archive.file(full, { name: relPath });
        }
      }
    }
    addDir(projectRoot);

    // Add any override files that don't exist on disk (editor-created files)
    for (const [fp, content] of Object.entries(overrideMap)) {
      if (!addedPaths.has(fp)) {
        archive.append(Buffer.from(content, 'utf8'), { name: fp });
      }
    }

    archive.finalize();
  } catch (err) {
    console.error('download-source error:', err.message);
    if (!res.headersSent) res.status(500).json({ error: 'Failed to create download' });
  }
});

// ─── FILE OVERRIDE MANAGEMENT ──────────────────────────────────────
// Endpoints for viewing/syncing editor changes that are persisted to DB
// so they survive Railway's ephemeral filesystem rebuilds.

router.get('/file-overrides', authenticateToken, requirePermission('can_edit_website'), async (req, res) => {
  try {
    const overrides = await getUnsyncedOverrides();
    const total = await countUnsynced();
    res.json({ pending: total, overrides });
  } catch (err) {
    console.error('[file-overrides] GET error:', err.message);
    res.status(500).json({ error: 'Failed to fetch overrides' });
  }
});

router.post('/file-overrides/mark-synced', authenticateToken, requirePermission('can_edit_website'), async (req, res) => {
  try {
    const { ids } = req.body;
    if (!ids || !Array.isArray(ids)) return res.status(400).json({ error: 'ids array required' });
    await markSynced(ids);
    res.json({ ok: true, synced: ids.length });
  } catch (err) {
    console.error('[file-overrides] mark-synced error:', err.message);
    res.status(500).json({ error: 'Failed to mark overrides as synced' });
  }
});

router.delete('/file-overrides', authenticateToken, requirePermission('can_edit_website'), async (req, res) => {
  try {
    const cleared = await clearAllOverrides();
    res.json({ ok: true, cleared: cleared.length, files: cleared });
  } catch (err) {
    console.error('[file-overrides] clear error:', err.message);
    res.status(500).json({ error: 'Failed to clear overrides' });
  }
});

module.exports = router;
module.exports.getCmsData = getCmsData;
module.exports.invalidateCmsCache = invalidateCmsCache;
module.exports.getHtmlTemplate = getHtmlTemplate;