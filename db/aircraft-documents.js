'use strict';

const pool = require('./index');

const DOC_TYPES = [
  'poh',
  'weight_balance',
  'airworthiness',
  'registration',
  'insurance',
  'maintenance',
  'checklist',
  'ad_summary',
  'other',
];

const DOC_LABELS = {
  poh: 'POH / AFM',
  weight_balance: 'Weight & Balance',
  airworthiness: 'Airworthiness Certificate',
  registration: 'Registration',
  insurance: 'Insurance',
  maintenance: 'Maintenance Records',
  checklist: 'Checklists',
  ad_summary: 'AD Summary',
  other: 'Other',
};

let _schemaReady = false;

async function ensureTable() {
  if (_schemaReady) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS aircraft_documents (
      id SERIAL PRIMARY KEY,
      aircraft_id INTEGER NOT NULL REFERENCES aircraft(id) ON DELETE CASCADE,
      doc_type VARCHAR(50) NOT NULL,
      title VARCHAR(255),
      file_url TEXT NOT NULL,
      file_name VARCHAR(255) NOT NULL,
      expiry_date DATE,
      notes TEXT,
      uploaded_by INTEGER REFERENCES users(id),
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS aircraft_documents_aircraft_id_idx ON aircraft_documents(aircraft_id);
  `);
  _schemaReady = true;
}

async function listByAircraft(aircraftId) {
  await ensureTable();
  const result = await pool.query(
    `SELECT d.*, u.name AS uploaded_by_name
     FROM aircraft_documents d
     LEFT JOIN users u ON u.id = d.uploaded_by
     WHERE d.aircraft_id = $1
     ORDER BY d.doc_type, d.created_at DESC`,
    [aircraftId]
  );
  return result.rows;
}

async function createDocument({ aircraftId, docType, title, fileUrl, fileName, expiryDate, notes, uploadedBy }) {
  await ensureTable();
  const result = await pool.query(
    `INSERT INTO aircraft_documents
       (aircraft_id, doc_type, title, file_url, file_name, expiry_date, notes, uploaded_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [aircraftId, docType, title || null, fileUrl, fileName, expiryDate || null, notes || null, uploadedBy]
  );
  return result.rows[0];
}

async function deleteDocument(docId, aircraftId) {
  const result = await pool.query(
    'DELETE FROM aircraft_documents WHERE id = $1 AND aircraft_id = $2 RETURNING *',
    [docId, aircraftId]
  );
  return result.rows[0];
}

module.exports = {
  DOC_TYPES,
  DOC_LABELS,
  ensureTable,
  listByAircraft,
  createDocument,
  deleteDocument,
};
