/**
 * db/file-overrides.js — CRUD for file_overrides table.
 * Owns: persisting editor file changes, querying unsynced overrides.
 * Does NOT own: filesystem writes, GitHub sync, or startup rehydration logic.
 */
'use strict';

const pool = require('./index');
const { getAppEnv } = require('../lib/app-env');

/**
 * Upsert a file override. Called when the editor saves a file.
 */
async function saveFileOverride(filePath, content, editedBy) {
  const source = getAppEnv();
  const result = await pool.query(
    `INSERT INTO file_overrides (file_path, content, edited_by, updated_at, synced_to_github, source)
     VALUES ($1, $2, $3, NOW(), FALSE, $4)
     ON CONFLICT (file_path, source) DO UPDATE SET
       content = EXCLUDED.content,
       edited_by = EXCLUDED.edited_by,
       updated_at = NOW(),
       synced_to_github = FALSE,
       synced_at = NULL
     RETURNING *`,
    [filePath, content, editedBy || null, source]
  );
  return result.rows[0];
}

/**
 * Get all overrides (for startup rehydration).
 */
async function getAllOverrides() {
  const result = await pool.query(
    'SELECT file_path, content, updated_at FROM file_overrides WHERE source = $1 ORDER BY updated_at ASC',
    [getAppEnv()]
  );
  return result.rows;
}

/**
 * Get all unsynced overrides (for GitHub sync).
 */
async function getUnsyncedOverrides() {
  const result = await pool.query(
    `SELECT id, file_path, content, edited_by, updated_at
     FROM file_overrides
     WHERE synced_to_github = FALSE AND source = $1
     ORDER BY updated_at ASC`,
    [getAppEnv()]
  );
  return result.rows;
}

/**
 * Mark overrides as synced to GitHub.
 */
async function markSynced(ids) {
  if (!ids || ids.length === 0) return;
  await pool.query(
    `UPDATE file_overrides SET synced_to_github = TRUE, synced_at = NOW()
     WHERE id = ANY($1) AND source = $2`,
    [ids, getAppEnv()]
  );
}

/**
 * Remove an override (e.g. when reverting to repo version).
 */
async function removeOverride(filePath) {
  await pool.query('DELETE FROM file_overrides WHERE file_path = $1 AND source = $2', [filePath, getAppEnv()]);
}

/**
 * Remove all overrides (bulk reset).
 */
async function clearAllOverrides() {
  const result = await pool.query('DELETE FROM file_overrides WHERE source = $1 RETURNING file_path', [getAppEnv()]);
  return result.rows.map(r => r.file_path);
}

/**
 * Count pending (unsynced) overrides.
 */
async function countUnsynced() {
  const result = await pool.query(
    'SELECT COUNT(*) as cnt FROM file_overrides WHERE synced_to_github = FALSE AND source = $1',
    [getAppEnv()]
  );
  return parseInt(result.rows[0].cnt);
}

module.exports = {
  saveFileOverride,
  getAllOverrides,
  getUnsyncedOverrides,
  markSynced,
  removeOverride,
  clearAllOverrides,
  countUnsynced,
};
