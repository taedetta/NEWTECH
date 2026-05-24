/**
 * db/leads.js — Discovery flight lead persistence.
 * Owns: discovery_flight_leads table reads and writes (with source isolation).
 * Does NOT own: email notification, rate limiting, request validation.
 */

const pool = require('./index');
const { buildSourceParam, addSourceFilter, queryWithSourceFilter } = require('./source-wrapper');

/**
 * Insert a new discovery flight lead (auto-tagged with APP_ENV source).
 * @param {{ name, email, phone, preferred_date, experience_level, message }} lead
 * @returns {Promise<Object>} inserted row
 */
async function createLead({ name, email, phone, preferred_date, experience_level, message }) {
  const { source } = buildSourceParam();
  const result = await pool.query(
    `INSERT INTO discovery_flight_leads
       (name, email, phone, preferred_date, experience_level, message, status, created_at, updated_at, source)
     VALUES ($1, $2, $3, $4, $5, $6, 'new', NOW(), NOW(), $7)
     RETURNING *`,
    [name, email, phone, preferred_date || null, experience_level || null, message || null, source]
  );
  return result.rows[0];
}

/**
 * List all leads ordered by newest first (filtered by APP_ENV source).
 * @returns {Promise<Object[]>}
 */
async function listLeads() {
  const result = await queryWithSourceFilter(
    `SELECT * FROM discovery_flight_leads ORDER BY created_at DESC`
  );
  return result.rows;
}

/**
 * Update a lead's status (filtered by APP_ENV source).
 * @param {number} id
 * @param {string} status
 * @returns {Promise<Object>}
 */
async function updateLeadStatus(id, status) {
  const result = await queryWithSourceFilter(
    `UPDATE discovery_flight_leads SET status = $1, updated_at = NOW() WHERE id = $2 RETURNING *`,
    [status, id]
  );
  return result.rows[0];
}

module.exports = { createLead, listLeads, updateLeadStatus };
