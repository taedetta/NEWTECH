'use strict';

const pool = require('./index');

let schemaPromise = null;

async function ensureMessagesSchema() {
  if (schemaPromise) return schemaPromise;
  schemaPromise = pool.query(`
    CREATE TABLE IF NOT EXISTS message_threads (
      id SERIAL PRIMARY KEY,
      student_id INTEGER NOT NULL REFERENCES users(id),
      instructor_id INTEGER NOT NULL REFERENCES users(id),
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(student_id, instructor_id)
    );
    CREATE TABLE IF NOT EXISTS messages (
      id SERIAL PRIMARY KEY,
      thread_id INTEGER NOT NULL REFERENCES message_threads(id) ON DELETE CASCADE,
      sender_id INTEGER NOT NULL REFERENCES users(id),
      body TEXT NOT NULL,
      read_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS messages_thread_id_idx ON messages(thread_id);
  `).catch((err) => {
    schemaPromise = null;
    throw err;
  });
  return schemaPromise;
}

function isStudentSideRole(role) {
  return role === 'student' || role === 'renter';
}

async function getOrCreateThread(studentId, instructorId) {
  await ensureMessagesSchema();
  const existing = await pool.query(
    `SELECT * FROM message_threads WHERE student_id = $1 AND instructor_id = $2`,
    [studentId, instructorId]
  );
  if (existing.rows.length) return existing.rows[0];
  const created = await pool.query(
    `INSERT INTO message_threads (student_id, instructor_id) VALUES ($1, $2) RETURNING *`,
    [studentId, instructorId]
  );
  return created.rows[0];
}

async function listThreadsForUser(userId, role) {
  await ensureMessagesSchema();
  let query;
  const params = [userId];
  const selectCols = `
      SELECT t.*,
             s.name AS student_name, i.name AS instructor_name,
             (SELECT body FROM messages m WHERE m.thread_id = t.id ORDER BY m.created_at DESC LIMIT 1) AS last_message,
             (SELECT created_at FROM messages m WHERE m.thread_id = t.id ORDER BY m.created_at DESC LIMIT 1) AS last_message_at,
             (SELECT COUNT(*)::int FROM messages m WHERE m.thread_id = t.id AND m.read_at IS NULL AND m.sender_id != $1) AS unread_count
      FROM message_threads t
      JOIN users s ON s.id = t.student_id
      JOIN users i ON i.id = t.instructor_id`;
  if (['owner', 'admin'].includes(role)) {
    query = `${selectCols}
      ORDER BY t.updated_at DESC
    `;
  } else if (role === 'instructor') {
    query = `${selectCols}
      WHERE t.instructor_id = $1
      ORDER BY t.updated_at DESC
    `;
  } else if (isStudentSideRole(role)) {
    query = `${selectCols}
      WHERE t.student_id = $1
      ORDER BY t.updated_at DESC
    `;
  } else {
    return [];
  }
  const result = await pool.query(query, params);
  return result.rows;
}

async function getThreadMessages(threadId, userId, role) {
  await ensureMessagesSchema();
  const thread = await pool.query(
    `SELECT t.*, s.name AS student_name, i.name AS instructor_name
     FROM message_threads t
     JOIN users s ON s.id = t.student_id
     JOIN users i ON i.id = t.instructor_id
     WHERE t.id = $1`,
    [threadId]
  );
  if (!thread.rows.length) return null;
  const t = thread.rows[0];
  const allowed = ['owner', 'admin'].includes(role)
    || t.student_id === userId
    || t.instructor_id === userId;
  if (!allowed) return { forbidden: true };

  const msgs = await pool.query(
    `SELECT m.*, u.name AS sender_name, u.role AS sender_role
     FROM messages m
     JOIN users u ON u.id = m.sender_id
     WHERE m.thread_id = $1
     ORDER BY m.created_at ASC`,
    [threadId]
  );

  await pool.query(
    `UPDATE messages SET read_at = NOW()
     WHERE thread_id = $1 AND sender_id != $2 AND read_at IS NULL`,
    [threadId, userId]
  );

  return { thread: t, messages: msgs.rows };
}

async function postMessage({ threadId, senderId, body }) {
  const result = await pool.query(
    `INSERT INTO messages (thread_id, sender_id, body) VALUES ($1, $2, $3) RETURNING *`,
    [threadId, senderId, body.trim()]
  );
  await pool.query('UPDATE message_threads SET updated_at = NOW() WHERE id = $1', [threadId]);
  return result.rows[0];
}

async function startThreadAndMessage({ studentId, instructorId, senderId, body }) {
  const thread = await getOrCreateThread(studentId, instructorId);
  const msg = await postMessage({ threadId: thread.id, senderId, body });
  return { thread, message: msg };
}

module.exports = {
  ensureMessagesSchema,
  getOrCreateThread,
  listThreadsForUser,
  getThreadMessages,
  postMessage,
  startThreadAndMessage,
};
