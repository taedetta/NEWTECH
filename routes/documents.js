'use strict';

const express = require('express');
const documentsDb = require('../db/documents');
const { uploadBuffer, isConfigured } = require('../lib/r2-storage');
const { authenticateToken, requireRole } = require('../middleware/auth');

const router = express.Router();

router.get('/types', authenticateToken, requireRole('owner', 'admin', 'instructor'), (req, res) => {
  res.json({ types: documentsDb.DOC_TYPES });
});

router.get('/student/:studentId', authenticateToken, requireRole('owner', 'admin', 'instructor'), async (req, res) => {
  try {
    const studentId = parseInt(req.params.studentId, 10);
    const documents = await documentsDb.listDocuments(studentId);
    res.json({ documents });
  } catch (err) {
    console.error('[documents] list:', err.message);
    res.status(500).json({ error: 'Failed to load documents' });
  }
});

router.post('/student/:studentId', authenticateToken, requireRole('owner', 'admin', 'instructor'), async (req, res) => {
  try {
    const studentId = parseInt(req.params.studentId, 10);
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
      await require('../db/index').query(
        `UPDATE users SET medical_certificate_class = $1, medical_certificate_expiry = $2, updated_at = NOW() WHERE id = $3`,
        [medical_class, expiry_date, studentId]
      );
    }

    res.status(201).json({ document: doc });
  } catch (err) {
    console.error('[documents] create:', err.message);
    res.status(500).json({ error: 'Failed to save document' });
  }
});

router.delete('/:docId', authenticateToken, requireRole('owner', 'admin', 'instructor'), async (req, res) => {
  try {
    const docId = parseInt(req.params.docId, 10);
    const pool = require('../db/index');
    const existing = await pool.query('SELECT * FROM student_documents WHERE id = $1', [docId]);
    if (!existing.rows.length) return res.status(404).json({ error: 'Not found' });
    const doc = await documentsDb.deleteDocument(docId, existing.rows[0].student_id);
    res.json({ ok: true, document: doc });
  } catch (err) {
    console.error('[documents] delete:', err.message);
    res.status(500).json({ error: 'Failed to delete document' });
  }
});

router.get('/expiring', authenticateToken, requireRole('owner', 'admin'), async (req, res) => {
  try {
    const days = parseInt(req.query.days, 10) || 30;
    const documents = await documentsDb.getExpiringDocuments(days);
    res.json({ documents });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load expiring documents' });
  }
});

module.exports = router;
