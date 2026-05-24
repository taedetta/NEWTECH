/**
 * db/file-overrides.js — CRUD for file_overrides table.
 * Owns: persisting editor file changes, querying unsynced overrides.
 * Does NOT own: filesystem writes, GitHub sync, or startup rehydration logic.
 */
'use strict';

const pool = require('./index');

/**
 * Upsert a file override. Called when the editor saves a file.
 */
async function saveFileOverride(filePath, content, editedBy) {
  const result = await pool.query(
    `INSERT INTO file_overrides (file_path, content, edited_by, updated_at, synced_to_github)
     VALUES ($1, $2, $3, NOW(), FALSE)
     ON CONFLICT (file_path) DO UPDATE SET
       content = $2,
       edited_by = $3,
       updated_at = NOW(),
       synced_to_github = FALSE,
       synced_at = NULL
     RETURNING *`,
    [filePath, content, editedBy || null]
  );
  return result.rows[0];
}

/**
 * Get all overrides (for startup rehydration).
 */
async function getAllOverrides() {
  const result = await pool.query(
    'SELECT file_path, content, updated_at FROM file_overrides ORDER BY updated_at ASC'
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
     WHERE synced_to_github = FALSE
     ORDER BY updated_at ASC`
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
     WHERE id = ANY($1)`,
    [ids]
  );
}

/**
 * Remove an override (e.g. when reverting to repo version).
 */
async function removeOverride(filePath) {
  await pool.query('DELETE FROM file_overrides WHERE file_path = $1', [filePath]);
}

/**
 * Remove all overrides (bulk reset).
 */
async function clearAllOverrides() {
  const result = await pool.query('DELETE FROM file_overrides RETURNING file_path');
  return result.rows.map(r => r.file_path);
}

/**
 * Count pending (unsynced) overrides.
 */
async function countUnsynced() {
  const result = await pool.query(
    'SELECT COUNT(*) as cnt FROM file_overrides WHERE synced_to_github = FALSE'
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
