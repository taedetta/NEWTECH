/**
 * db/leads.js — Discovery flight lead persistence.
 */

const pool = require('./index');
const { buildSourceParam, queryWithSourceFilter } = require('./source-wrapper');

async function logLeadActivity(client, { leadId, userId, activityType, body, oldStatus, newStatus }) {
  try {
    const db = client || pool;
    await db.query(
      `INSERT INTO lead_activity (lead_id, user_id, activity_type, body, old_status, new_status)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [leadId, userId || null, activityType, body || null, oldStatus || null, newStatus || null]
    );
  } catch (err) {
    console.error('[leads] activity log skipped:', err.message);
  }
}

async function createLead({ name, email, phone, preferred_date, experience_level, message, program_interest, source_label }) {
  const { source } = buildSourceParam();
  const scheduling = preferred_date && String(preferred_date).trim() ? String(preferred_date).trim() : null;
  const params = [
    name, email, phone, scheduling, experience_level || null,
    message || null, program_interest || null, source_label || null, source,
  ];
  let result;
  try {
    result = await pool.query(
      `INSERT INTO discovery_flight_leads
         (name, email, phone, preferred_date, experience_level, message, program_interest, source_label, status, created_at, updated_at, source)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'new', NOW(), NOW(), $9)
       RETURNING *`,
      params
    );
  } catch (err) {
    if (!/preferred_date|program_interest|source_label|experience_level|source/i.test(err.message)) throw err;
    result = await pool.query(
      `INSERT INTO discovery_flight_leads
         (name, email, phone, experience, status, notes, created_at, updated_at, source)
       VALUES ($1, $2, $3, $4, 'new', $5, NOW(), NOW(), $6)
       RETURNING *`,
      [name, email, phone, experience_level || null, [scheduling, message].filter(Boolean).join(' · ') || null, source]
    );
  }
  const lead = result.rows[0];
  await logLeadActivity(null, {
    leadId: lead.id,
    userId: null,
    activityType: 'created',
    body: source_label ? `Submitted via ${source_label}` : 'Lead submitted',
  });
  return lead;
}

async function createManualLead({ name, email, phone, preferred_date, experience_level, message, program_interest, status }, userId) {
  const { source } = buildSourceParam();
  const baseParams = [
    name, email, phone, preferred_date || null, experience_level || null,
    message || null, program_interest || null, status || 'new', source,
  ];
  let result;
  try {
    result = await pool.query(
      `INSERT INTO discovery_flight_leads
         (name, email, phone, preferred_date, experience_level, message, program_interest, source_label, status, created_at, updated_at, source)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'manual', $8, NOW(), NOW(), $9)
       RETURNING *`,
      baseParams
    );
  } catch (err) {
    if (!/program_interest|source_label|source/i.test(err.message)) throw err;
    result = await pool.query(
      `INSERT INTO discovery_flight_leads
         (name, email, phone, preferred_date, experience_level, message, status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
       RETURNING *`,
      [name, email, phone, preferred_date || null, experience_level || null, message || null, status || 'new']
    );
  }
  const lead = result.rows[0];
  await logLeadActivity(null, {
    leadId: lead.id,
    userId,
    activityType: 'manual',
    body: message || 'Lead added manually',
  });
  return lead;
}

async function listLeads() {
  const result = await queryWithSourceFilter(
    `SELECT * FROM discovery_flight_leads ORDER BY created_at DESC`
  );
  return result.rows;
}

async function countNewLeads() {
  const result = await queryWithSourceFilter(
    `SELECT COUNT(*)::int AS cnt FROM discovery_flight_leads WHERE status = 'new'`
  );
  return result.rows[0]?.cnt || 0;
}

async function getLeadById(id) {
  const result = await queryWithSourceFilter(
    `SELECT * FROM discovery_flight_leads WHERE id = $1`,
    [id]
  );
  return result.rows[0];
}

async function getLeadActivity(leadId) {
  const result = await pool.query(
    `SELECT la.*, u.name AS user_name
     FROM lead_activity la
     LEFT JOIN users u ON u.id = la.user_id
     WHERE la.lead_id = $1
     ORDER BY la.created_at ASC`,
    [leadId]
  );
  return result.rows;
}

async function addLeadNote(leadId, userId, note) {
  await logLeadActivity(null, { leadId, userId, activityType: 'note', body: note });
  await pool.query(`UPDATE discovery_flight_leads SET updated_at = NOW() WHERE id = $1`, [leadId]);
}

async function updateLeadStatus(id, status, userId) {
  const existing = await getLeadById(id);
  if (!existing) return null;
  const result = await queryWithSourceFilter(
    `UPDATE discovery_flight_leads SET status = $1, updated_at = NOW() WHERE id = $2 RETURNING *`,
    [status, id]
  );
  const lead = result.rows[0];
  if (lead && existing.status !== status) {
    await logLeadActivity(null, {
      leadId: id,
      userId,
      activityType: 'status_change',
      oldStatus: existing.status,
      newStatus: status,
    });
  }
  return lead;
}

async function recordLeadFollowUp(id, userId) {
  const lead = await getLeadById(id);
  if (!lead) return null;
  const result = await queryWithSourceFilter(
    `UPDATE discovery_flight_leads
     SET follow_up_count = COALESCE(follow_up_count, 0) + 1, last_follow_up_at = NOW(), updated_at = NOW()
     WHERE id = $1 RETURNING *`,
    [id]
  );
  await logLeadActivity(null, {
    leadId: id,
    userId,
    activityType: 'follow_up',
    body: 'Follow-up email sent',
  });
  return result.rows[0];
}

async function markLeadConverted(id, userId, convertedUserId) {
  const existing = await getLeadById(id);
  if (!existing) return null;
  const result = await queryWithSourceFilter(
    `UPDATE discovery_flight_leads
     SET status = 'converted', converted_user_id = $1, updated_at = NOW()
     WHERE id = $2 RETURNING *`,
    [convertedUserId || null, id]
  );
  await logLeadActivity(null, {
    leadId: id,
    userId,
    activityType: 'converted',
    oldStatus: existing.status,
    newStatus: 'converted',
    body: convertedUserId ? `Linked to user #${convertedUserId}` : 'Marked converted',
  });
  return result.rows[0];
}

module.exports = {
  createLead,
  createManualLead,
  listLeads,
  countNewLeads,
  getLeadById,
  getLeadActivity,
  addLeadNote,
  updateLeadStatus,
  logLeadActivity,
  recordLeadFollowUp,
  markLeadConverted,
};
