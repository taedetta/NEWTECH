'use strict';

const pool = require('./index');

const DOC_TYPES = ['medical', 'student_pilot_cert', 'id', 'tsa', 'insurance', 'renter_agreement', 'other'];

async function listDocuments(studentId) {
  const result = await pool.query(
    `SELECT d.*, u.name AS uploaded_by_name
     FROM student_documents d
     LEFT JOIN users u ON u.id = d.uploaded_by
     WHERE d.student_id = $1
     ORDER BY d.expiry_date NULLS LAST, d.created_at DESC`,
    [studentId]
  );
  return result.rows;
}

async function createDocument({ studentId, docType, fileUrl, fileName, expiryDate, notes, uploadedBy }) {
  const result = await pool.query(
    `INSERT INTO student_documents (student_id, doc_type, file_url, file_name, expiry_date, notes, uploaded_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [studentId, docType, fileUrl || null, fileName || null, expiryDate || null, notes || null, uploadedBy]
  );
  const doc = result.rows[0];

  if (docType === 'medical' && expiryDate) {
    await pool.query(
      `UPDATE users SET medical_certificate_expiry = $1, updated_at = NOW() WHERE id = $2`,
      [expiryDate, studentId]
    );
  }
  return doc;
}

async function deleteDocument(docId, studentId) {
  const result = await pool.query(
    'DELETE FROM student_documents WHERE id = $1 AND student_id = $2 RETURNING *',
    [docId, studentId]
  );
  return result.rows[0];
}

async function getExpiringDocuments(withinDays = 30) {
  const result = await pool.query(
    `SELECT d.*, u.name AS student_name, u.email AS student_email
     FROM student_documents d
     JOIN users u ON u.id = d.student_id
     WHERE d.expiry_date IS NOT NULL
       AND d.expiry_date <= CURRENT_DATE + ($1 || ' days')::interval
     ORDER BY d.expiry_date ASC`,
    [withinDays]
  );
  return result.rows;
}

module.exports = {
  DOC_TYPES,
  listDocuments,
  createDocument,
  deleteDocument,
  getExpiringDocuments,
};
