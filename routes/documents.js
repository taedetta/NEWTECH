'use strict';

const express = require('express');
const pool = require('../db/index');
const documentsDb = require('../db/documents');
const { uploadBuffer, isConfigured, downloadStoredFile, guessContentType } = require('../lib/r2-storage');
const { authenticateToken, requireRole, getUserPermissions } = require('../middleware/auth');
const { getAppEnv } = require('../lib/app-env');

const router = express.Router();

function parseId(value) {
  if (!/^\d+$/.test(String(value))) return null;
  const id = Number(value);
  return Number.isFinite(id) ? id : null;
}

function protectedDocument(doc) {
  if (!doc) return doc;
  return {
    ...doc,
    file_url: doc.file_url ? `/api/documents/${doc.id}/file` : null,
  };
}

function safeDownloadName(name) {
  return String(name || 'document').replace(/[\r\n"]/g, '_');
}

async function sendStoredDocument(res, doc) {
  if (!doc.file_url) return res.status(404).json({ error: 'Document file not found' });
  const file = await downloadStoredFile(doc.file_url, doc.file_name);
  if (!file) return res.status(404).json({ error: 'Document file not found' });
  res.setHeader('Content-Type', file.contentType || guessContentType(doc.file_name || 'document'));
  res.setHeader('Content-Disposition', `inline; filename="${safeDownloadName(doc.file_name)}"`);
  res.setHeader('Cache-Control', 'private, no-store');
  return res.send(file.buffer);
}

async function canManageStudentDocuments(user, studentId) {
  const student = await pool.query(
    "SELECT id FROM users WHERE id = $1 AND role = 'student' AND deleted_at IS NULL AND source = $2",
    [studentId, getAppEnv()]
  );
  if (!student.rows.length) return false;
  if (['owner', 'admin'].includes(user.role)) return true;
  if (user.role !== 'instructor') return false;
  const perms = await getUserPermissions(user.id, user.role);
  if (perms.can_manage_students) return true;
  const assigned = await pool.query(
    `SELECT 1 FROM student_training
     WHERE student_id = $1 AND instructor_id = $2 AND status = 'active' AND source = $3
     LIMIT 1`,
    [studentId, user.id, getAppEnv()]
  );
  return assigned.rows.length > 0;
}

router.get('/types', authenticateToken, requireRole('owner', 'admin', 'instructor'), (req, res) => {
  res.json({ types: documentsDb.DOC_TYPES });
});

router.get('/student/:studentId', authenticateToken, requireRole('owner', 'admin', 'instructor'), async (req, res) => {
  try {
    const studentId = parseId(req.params.studentId);
    if (!studentId) return res.status(400).json({ error: 'Invalid student id' });
    if (!(await canManageStudentDocuments(req.user, studentId))) {
      return res.status(403).json({ error: 'Only assigned instructors or admins can manage student documents' });
    }
    const documents = (await documentsDb.listDocuments(studentId)).map(protectedDocument);
    res.json({ documents });
  } catch (err) {
    console.error('[documents] list:', err.message);
    res.status(500).json({ error: 'Failed to load documents' });
  }
});

router.post('/student/:studentId', authenticateToken, requireRole('owner', 'admin', 'instructor'), async (req, res) => {
  try {
    const studentId = parseId(req.params.studentId);
    if (!studentId) return res.status(400).json({ error: 'Invalid student id' });
    if (!(await canManageStudentDocuments(req.user, studentId))) {
      return res.status(403).json({ error: 'Only assigned instructors or admins can manage student documents' });
    }
    const { doc_type, file_data, file_name, expiry_date, notes, medical_class } = req.body;
    if (!doc_type || !documentsDb.DOC_TYPES.includes(doc_type)) {
      return res.status(400).json({ error: 'Valid doc_type is required' });
    }

    let fileUrl = null;
    if (file_data && file_name) {
      if (!isConfigured()) {
        return res.status(503).json({ error: 'File storage not configured' });
      }
      const buffer = Buffer.from(file_data, 'base64');
      if (buffer.length > 8 * 1024 * 1024) {
        return res.status(400).json({ error: 'File too large (max 8MB)' });
      }
      fileUrl = await uploadBuffer(buffer, file_name, { folder: `student-docs/${studentId}` });
      if (!fileUrl) return res.status(500).json({ error: 'Upload failed' });
    }

    const doc = await documentsDb.createDocument({
      studentId,
      docType: doc_type,
      fileUrl,
      fileName: file_name || null,
      expiryDate: expiry_date || null,
      notes: notes || null,
      uploadedBy: req.user.id,
    });

    if (doc_type === 'medical' && expiry_date && medical_class) {
      await pool.query(
        `UPDATE users SET medical_certificate_class = $1, medical_certificate_expiry = $2, updated_at = NOW() WHERE id = $3 AND source = $4`,
        [medical_class, expiry_date, studentId, getAppEnv()]
      );
    }

    res.status(201).json({ document: protectedDocument(doc) });
  } catch (err) {
    console.error('[documents] create:', err.message);
    res.status(500).json({ error: 'Failed to save document' });
  }
});

router.get('/:docId/file', authenticateToken, requireRole('owner', 'admin', 'instructor'), async (req, res) => {
  try {
    const docId = parseId(req.params.docId);
    if (!docId) return res.status(400).json({ error: 'Invalid document id' });
    const existing = await pool.query(
      `SELECT d.*
       FROM student_documents d
       JOIN users u ON u.id = d.student_id
       WHERE d.id = $1 AND u.source = $2`,
      [docId, getAppEnv()]
    );
    if (!existing.rows.length) return res.status(404).json({ error: 'Not found' });
    if (!(await canManageStudentDocuments(req.user, existing.rows[0].student_id))) {
      return res.status(403).json({ error: 'Only assigned instructors or admins can view student documents' });
    }
    return sendStoredDocument(res, existing.rows[0]);
  } catch (err) {
    console.error('[documents] download:', err.message);
    return res.status(500).json({ error: 'Failed to download document' });
  }
});

router.delete('/:docId', authenticateToken, requireRole('owner', 'admin', 'instructor'), async (req, res) => {
  try {
    const docId = parseId(req.params.docId);
    if (!docId) return res.status(400).json({ error: 'Invalid document id' });
    const existing = await pool.query(
      `SELECT d.*
       FROM student_documents d
       JOIN users u ON u.id = d.student_id
       WHERE d.id = $1 AND u.source = $2`,
      [docId, getAppEnv()]
    );
    if (!existing.rows.length) return res.status(404).json({ error: 'Not found' });
    if (!(await canManageStudentDocuments(req.user, existing.rows[0].student_id))) {
      return res.status(403).json({ error: 'Only assigned instructors or admins can manage student documents' });
    }
    const doc = await documentsDb.deleteDocument(docId, existing.rows[0].student_id);
    res.json({ ok: true, document: protectedDocument(doc) });
  } catch (err) {
    console.error('[documents] delete:', err.message);
    res.status(500).json({ error: 'Failed to delete document' });
  }
});

router.get('/expiring', authenticateToken, requireRole('owner', 'admin'), async (req, res) => {
  try {
    const days = parseInt(req.query.days, 10) || 30;
    const documents = (await documentsDb.getExpiringDocuments(days)).map(protectedDocument);
    res.json({ documents });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load expiring documents' });
  }
});

module.exports = router;
