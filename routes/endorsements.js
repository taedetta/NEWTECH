'use strict';

const express = require('express');
const PDFDocument = require('pdfkit');
const pool = require('../db/index');
const { authenticateToken, requireRole } = require('../middleware/auth');
const { sendEmail } = require('../email-templates');

const router = express.Router();

// ─── ENDORSEMENT TEMPLATES ──────────────────────────────

const ENDORSEMENT_TEMPLATES = {
  pre_solo_knowledge: {
    label: 'Pre-Solo Knowledge Test (61.87(b))',
    category: 'Solo',
    hasExpiry: false,
    expiryDays: null,
    requiresAircraft: false,
    text: (f) => `I certify that ${f.studentName} has satisfactorily completed the pre-solo knowledge test of § 61.87(b) for the ${f.aircraftMakeModel || '[aircraft make and model]'}.`,
    acRef: 'AC 61-65, Endorsement No. 6',
  },
  pre_solo_flight: {
    label: 'Pre-Solo Flight Training (61.87(c)(1))',
    category: 'Solo',
    hasExpiry: false,
    expiryDays: null,
    requiresAircraft: true,
    text: (f) => `I certify that ${f.studentName} has received the training required by § 61.87(c)(1) and is proficient in the maneuvers and procedures listed in that section and is prepared for solo flight in a ${f.aircraftMakeModel}.`,
    acRef: 'AC 61-65, Endorsement No. 7',
  },
  solo_flight_90day: {
    label: 'Solo Flight (Each 90-day period, 61.87(n))',
    category: 'Solo',
    hasExpiry: true,
    expiryDays: 90,
    requiresAircraft: true,
    text: (f) => `I certify that ${f.studentName} has received the required training and has been found proficient to make solo flights in a ${f.aircraftMakeModel}. [Limitations: ${f.metadata?.limitations || 'None'}]`,
    acRef: 'AC 61-65, Endorsement No. 8',
  },
  pre_solo_night: {
    label: 'Pre-Solo Night Flight (61.87(o))',
    category: 'Solo',
    hasExpiry: false,
    expiryDays: null,
    requiresAircraft: true,
    text: (f) => `I certify that ${f.studentName} has received the training required by § 61.87(o) for night solo flights in a ${f.aircraftMakeModel}.`,
    acRef: 'AC 61-65, Endorsement No. 10',
  },
  solo_xc_planning: {
    label: 'Solo Cross-Country Flight (61.93(c)(1))',
    category: 'Solo',
    hasExpiry: false,
    expiryDays: null,
    requiresAircraft: true,
    text: (f) => `I certify that ${f.studentName} has received the solo cross-country flight training required by § 61.93(c)(1) and has been found proficient in cross-country flying and has demonstrated the ability to plan and conduct the flight safely under the known conditions and within the approved regulations.`,
    acRef: 'AC 61-65, Endorsement No. 15',
  },
  checkride_private: {
    label: 'Private Pilot Checkride (61.103(d))',
    category: 'Checkride',
    hasExpiry: true,
    expiryDays: 60,
    requiresAircraft: true,
    text: (f) => `I certify that ${f.studentName} has received the training required by § 61.107(b) for a private pilot certificate and has been found proficient in the required areas of operation listed in § 61.107(b) for a ${f.aircraftMakeModel}. ${f.studentName} has demonstrated satisfactory knowledge of the subject areas in which a deficiency was found on the airmen knowledge test. I have reviewed the deficient knowledge areas and found ${f.studentName} to be proficient. I certify that ${f.studentName} is prepared for the private pilot practical test.`,
    acRef: 'AC 61-65, Endorsement No. 45',
  },
  checkride_instrument: {
    label: 'Instrument Rating Checkride (61.65(a)(5))',
    category: 'Checkride',
    hasExpiry: true,
    expiryDays: 60,
    requiresAircraft: true,
    text: (f) => `I certify that ${f.studentName} has received the training required by § 61.65(a)(5) and (b) for the instrument rating and has been found proficient in the required areas of operation listed in § 61.65(c) and (d). I certify that ${f.studentName} is prepared for the instrument rating practical test.`,
    acRef: 'AC 61-65, Endorsement No. 49',
  },
  checkride_commercial: {
    label: 'Commercial Pilot Checkride (61.123(d))',
    category: 'Checkride',
    hasExpiry: true,
    expiryDays: 60,
    requiresAircraft: true,
    text: (f) => `I certify that ${f.studentName} has received the training required by § 61.127(b) for a commercial pilot certificate and has been found proficient in the required areas of operation listed in § 61.127(b) for a ${f.aircraftMakeModel}. I certify that ${f.studentName} is prepared for the commercial pilot practical test.`,
    acRef: 'AC 61-65, Endorsement No. 52',
  },
  checkride_cfi: {
    label: 'CFI Certificate Checkride (61.183(i))',
    category: 'Checkride',
    hasExpiry: true,
    expiryDays: 60,
    requiresAircraft: false,
    text: (f) => `I certify that ${f.studentName} has received the training required by §§ 61.185 and 61.187 for a flight instructor certificate and has been found proficient in the required areas of operation listed in § 61.187 for a ${f.aircraftMakeModel || '[aircraft category and class]'}. I certify that ${f.studentName} is prepared for the flight instructor practical test.`,
    acRef: 'AC 61-65, Endorsement No. 62',
  },
  flight_review: {
    label: 'Flight Review (61.56(c))',
    category: 'Currency',
    hasExpiry: false,
    expiryDays: null,
    requiresAircraft: false,
    text: (f) => `I certify that ${f.studentName} has satisfactorily completed a flight review of § 61.56(a) on ${f.endorsementDate}.`,
    acRef: 'AC 61-65, Endorsement No. 1',
  },
  ipc: {
    label: 'Instrument Proficiency Check (61.57(d))',
    category: 'Currency',
    hasExpiry: false,
    expiryDays: null,
    requiresAircraft: false,
    text: (f) => `I certify that ${f.studentName} has satisfactorily completed the instrument proficiency check required by § 61.57(d) in a ${f.aircraftMakeModel || '[aircraft category and class]'}.`,
    acRef: 'AC 61-65, Endorsement No. 3',
  },
  high_performance: {
    label: 'High-Performance Aircraft (61.31(f)(1))',
    category: 'Special',
    hasExpiry: false,
    expiryDays: null,
    requiresAircraft: true,
    text: (f) => `I certify that ${f.studentName} has received the ground and flight training required by § 61.31(f)(1) and is proficient in the operation of a high-performance airplane, specifically a ${f.aircraftMakeModel}.`,
    acRef: 'AC 61-65, Endorsement No. 40',
  },
  complex: {
    label: 'Complex Aircraft (61.31(e)(1))',
    category: 'Special',
    hasExpiry: false,
    expiryDays: null,
    requiresAircraft: true,
    text: (f) => `I certify that ${f.studentName} has received the required training of § 61.31(e)(1) in a complex airplane and has been found proficient in the operation and systems of a complex airplane, specifically a ${f.aircraftMakeModel}.`,
    acRef: 'AC 61-65, Endorsement No. 38',
  },
  tailwheel: {
    label: 'Tailwheel Aircraft (61.31(i)(1))',
    category: 'Special',
    hasExpiry: false,
    expiryDays: null,
    requiresAircraft: true,
    text: (f) => `I certify that ${f.studentName} has received the training required by § 61.31(i)(1) and is proficient in the operation of a tailwheel airplane, specifically a ${f.aircraftMakeModel}.`,
    acRef: 'AC 61-65, Endorsement No. 42',
  },
  custom: {
    label: 'Custom Endorsement',
    category: 'Custom',
    hasExpiry: false,
    expiryDays: null,
    requiresAircraft: false,
    text: (f) => f.customText || '',
    acRef: null,
  },
};

// ─── CFI Profile ───────────────────────────────────────

router.get('/cfi-profile', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT cfi_cert_number, cfi_expiry FROM users WHERE id = $1',
      [req.user.id]
    );
    const user = result.rows[0] || {};
    res.json({ cfi_cert_number: user.cfi_cert_number || '', cfi_expiry: user.cfi_expiry || null });
  } catch (err) {
    console.error('CFI profile GET error:', err);
    res.status(500).json({ error: 'Failed to load CFI profile' });
  }
});

router.put('/cfi-profile', authenticateToken, requireRole('instructor', 'owner', 'admin'), async (req, res) => {
  try {
    const { cfi_cert_number, cfi_expiry } = req.body;
    await pool.query(
      'UPDATE users SET cfi_cert_number = $1, cfi_expiry = $2 WHERE id = $3',
      [cfi_cert_number || null, cfi_expiry || null, req.user.id]
    );
    res.json({ success: true });
  } catch (err) {
    console.error('CFI profile PUT error:', err);
    res.status(500).json({ error: 'Failed to save CFI profile' });
  }
});

// ─── Templates ─────────────────────────────────────────

router.get('/templates', authenticateToken, (req, res) => {
  const templates = Object.entries(ENDORSEMENT_TEMPLATES).map(([key, t]) => ({
    key,
    label: t.label,
    category: t.category,
    hasExpiry: t.hasExpiry,
    expiryDays: t.expiryDays,
    requiresAircraft: t.requiresAircraft,
    acRef: t.acRef,
    textPattern: key !== 'custom' ? t.text({ studentName: '{{STUDENT}}', endorsementDate: '{{DATE}}', aircraftMakeModel: '{{AIRCRAFT}}', customText: '', metadata: {} }) : null,
  }));
  res.json({ templates });
});

// ─── Endorsements CRUD ─────────────────────────────────

router.get('/', authenticateToken, async (req, res) => {
  try {
    const { student_id, status } = req.query;
    let query = `
      SELECT e.*,
             COALESCE(s.name, e.student_name, 'Former student') AS student_name_user,
             i.name AS instructor_name_user
      FROM endorsements e
      LEFT JOIN users s ON s.id = e.student_id
      JOIN users i ON i.id = e.instructor_id
      WHERE 1=1
    `;
    const params = [];

    if (req.user.role === 'student') {
      params.push(req.user.id);
      query += ` AND e.student_id = $${params.length}`;
    } else if (req.user.role === 'instructor') {
      if (student_id) {
        params.push(parseInt(student_id));
        query += ` AND e.student_id = $${params.length}`;
        params.push(req.user.id);
        query += ` AND e.instructor_id = $${params.length}`;
      } else {
        params.push(req.user.id);
        query += ` AND e.instructor_id = $${params.length}`;
      }
    } else {
      if (student_id) {
        params.push(parseInt(student_id));
        query += ` AND e.student_id = $${params.length}`;
      }
    }

    if (status === 'active') {
      query += ` AND (e.expiration_date IS NULL OR e.expiration_date >= CURRENT_DATE)`;
    } else if (status === 'expired') {
      query += ` AND e.expiration_date IS NOT NULL AND e.expiration_date < CURRENT_DATE`;
    }

    query += ` ORDER BY e.created_at DESC`;

    const result = await pool.query(query, params);
    res.json({ endorsements: result.rows });
  } catch (err) {
    console.error('Endorsements list error:', err);
    res.status(500).json({ error: 'Failed to load endorsements' });
  }
});

router.post('/', authenticateToken, requireRole('instructor', 'owner', 'admin'), async (req, res) => {
  try {
    const {
      student_id, template_key, endorsement_date,
      aircraft_make_model, aircraft_id, custom_text, metadata,
      instructor_signature,
    } = req.body;

    if (!student_id || !template_key || !endorsement_date) {
      return res.status(400).json({ error: 'student_id, template_key, and endorsement_date are required' });
    }

    const template = ENDORSEMENT_TEMPLATES[template_key];
    if (!template) return res.status(400).json({ error: 'Unknown template key' });

    const studentRes = await pool.query('SELECT id, name FROM users WHERE id = $1', [student_id]);
    if (studentRes.rows.length === 0) return res.status(404).json({ error: 'Student not found' });
    const student = studentRes.rows[0];

    const instructorRes = await pool.query(
      'SELECT id, name, cfi_cert_number FROM users WHERE id = $1',
      [req.user.id]
    );
    const instructor = instructorRes.rows[0];
    if (!instructor.cfi_cert_number) {
      return res.status(400).json({ error: 'Please set your CFI certificate number in your profile before creating endorsements' });
    }

    let expirationDate = null;
    if (template.hasExpiry && template.expiryDays) {
      const d = new Date(endorsement_date);
      d.setDate(d.getDate() + template.expiryDays);
      expirationDate = d.toISOString().split('T')[0];
    }

    const textFields = {
      studentName: student.name,
      instructorName: instructor.name,
      endorsementDate: endorsement_date,
      aircraftMakeModel: aircraft_make_model || '',
      customText: custom_text || '',
      metadata: metadata || {},
    };
    const endorsementText = template_key === 'custom'
      ? (custom_text || '')
      : template.text(textFields);

    const ip = req.ip || req.connection?.remoteAddress || '';
    const ua = req.headers['user-agent'] || '';

    const result = await pool.query(`
      INSERT INTO endorsements
        (student_id, instructor_id, template_key, endorsement_type,
         student_name, instructor_name, instructor_cert_number,
         endorsement_date, expiration_date, endorsement_text,
         aircraft_make_model, aircraft_id, instructor_signature, signed_at,
         ip_address, user_agent, metadata)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
      RETURNING *
    `, [
      student.id, instructor.id, template_key, template.label,
      student.name, instructor.name, instructor.cfi_cert_number,
      endorsement_date, expirationDate, endorsementText,
      aircraft_make_model || null,
      aircraft_id ? parseInt(aircraft_id) : null,
      instructor_signature || null,
      instructor_signature ? new Date() : null,
      ip, ua, JSON.stringify(metadata || {}),
    ]);

    res.json({ endorsement: result.rows[0] });
  } catch (err) {
    console.error('Create endorsement error:', err);
    res.status(500).json({ error: 'Failed to create endorsement' });
  }
});

router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT e.*,
             s.name AS student_name_user, s.email AS student_email,
             i.name AS instructor_name_user, i.email AS instructor_email
      FROM endorsements e
      JOIN users s ON s.id = e.student_id
      JOIN users i ON i.id = e.instructor_id
      WHERE e.id = $1
    `, [req.params.id]);

    if (result.rows.length === 0) return res.status(404).json({ error: 'Endorsement not found' });
    const e = result.rows[0];

    const isStudent = req.user.role === 'student' && e.student_id === req.user.id;
    const isInstructor = req.user.role === 'instructor' && e.instructor_id === req.user.id;
    const isAdmin = ['owner', 'admin'].includes(req.user.role);
    if (!isStudent && !isInstructor && !isAdmin) {
      return res.status(403).json({ error: 'Access denied' });
    }

    res.json({ endorsement: e });
  } catch (err) {
    console.error('Get endorsement error:', err);
    res.status(500).json({ error: 'Failed to load endorsement' });
  }
});

router.post('/:id/student-sign', authenticateToken, async (req, res) => {
  try {
    const { student_signature } = req.body;

    const result = await pool.query(
      'SELECT * FROM endorsements WHERE id = $1',
      [req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Endorsement not found' });
    const endorsement = result.rows[0];

    if (endorsement.student_id !== req.user.id && !['owner', 'admin'].includes(req.user.role)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    await pool.query(
      'UPDATE endorsements SET student_signature = $1, student_signed_at = $2 WHERE id = $3',
      [student_signature, new Date(), req.params.id]
    );

    res.json({ success: true });
  } catch (err) {
    console.error('Student sign error:', err);
    res.status(500).json({ error: 'Failed to save student signature' });
  }
});

router.delete('/:id', authenticateToken, requireRole('instructor', 'owner', 'admin'), async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM endorsements WHERE id = $1', [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    const e = result.rows[0];

    if (req.user.role === 'instructor' && e.instructor_id !== req.user.id) {
      return res.status(403).json({ error: 'Can only delete your own endorsements' });
    }

    await pool.query('DELETE FROM endorsements WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    console.error('Delete endorsement error:', err);
    res.status(500).json({ error: 'Failed to delete endorsement' });
  }
});

// ─── PDF Generation ─────────────────────────────────────

router.get('/:id/pdf', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT e.*, s.email AS student_email, i.email AS instructor_email
      FROM endorsements e
      JOIN users s ON s.id = e.student_id
      JOIN users i ON i.id = e.instructor_id
      WHERE e.id = $1
    `, [req.params.id]);

    if (result.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    const e = result.rows[0];

    const isStudent = req.user.role === 'student' && e.student_id === req.user.id;
    const isInstructor = req.user.role === 'instructor' && e.instructor_id === req.user.id;
    const isAdmin = ['owner', 'admin'].includes(req.user.role);
    if (!isStudent && !isInstructor && !isAdmin) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const doc = new PDFDocument({ size: 'LETTER', margin: 72 });
    const filename = `endorsement-${e.id}-${e.student_name.replace(/\\s+/g, '-')}.pdf`;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    doc.pipe(res);

    doc.fontSize(18).font('Helvetica-Bold').text('NEW TECH AVIATION', { align: 'center' });
    doc.fontSize(11).font('Helvetica').text('Flight Training Endorsement Record', { align: 'center' });
    doc.text('New River Valley Airport (KPSK) · Pulaski, Virginia', { align: 'center' });

    doc.moveDown(0.5);
    doc.moveTo(72, doc.y).lineTo(doc.page.width - 72, doc.y).stroke('#CCCCCC');
    doc.moveDown(0.5);

    doc.fontSize(14).font('Helvetica-Bold').text(e.endorsement_type, { align: 'center' });
    doc.moveDown(0.3);

    if (e.metadata?.acRef) {
      doc.fontSize(9).font('Helvetica').fillColor('#666666').text(`${e.metadata.acRef}`, { align: 'center' });
      doc.fillColor('#000000');
    }

    doc.moveDown(0.8);

    const labelWidth = 140;
    const col2 = 72 + labelWidth + 10;
    const lineH = 18;

    function row(label, value) {
      const y = doc.y;
      doc.fontSize(9).font('Helvetica-Bold').fillColor('#444444').text(label, 72, y, { width: labelWidth });
      doc.fontSize(10).font('Helvetica').fillColor('#000000').text(value || '—', col2, y);
      doc.y = y + lineH;
    }

    row('Student:', e.student_name);
    row('Instructor:', e.instructor_name);
    row('CFI Certificate #:', e.instructor_cert_number);
    const endorseDateStr = (e.endorsement_date instanceof Date ? e.endorsement_date : new Date(e.endorsement_date.toString().slice(0, 10) + 'T12:00:00')).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    row('Date:', endorseDateStr);
    if (e.expiration_date) {
      const expired = new Date(e.expiration_date) < new Date();
      const expDateStr = (e.expiration_date instanceof Date ? e.expiration_date : new Date(e.expiration_date.toString().slice(0, 10) + 'T12:00:00')).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
      row('Expiration Date:', expDateStr + (expired ? ' (EXPIRED)' : ''));
    }
    if (e.aircraft_make_model) row('Aircraft:', e.aircraft_make_model);

    doc.moveDown(0.8);
    doc.moveTo(72, doc.y).lineTo(doc.page.width - 72, doc.y).stroke('#CCCCCC');
    doc.moveDown(0.8);

    doc.fontSize(11).font('Helvetica-Bold').text('ENDORSEMENT TEXT');
    doc.moveDown(0.3);
    doc.fontSize(11).font('Helvetica').text(e.endorsement_text, {
      align: 'justify',
      lineGap: 4,
    });

    doc.moveDown(1.2);
    doc.moveTo(72, doc.y).lineTo(doc.page.width - 72, doc.y).stroke('#CCCCCC');
    doc.moveDown(0.8);

    doc.fontSize(11).font('Helvetica-Bold').text('SIGNATURES');
    doc.moveDown(0.5);

    const sigY = doc.y;
    const sigWidth = (doc.page.width - 144) / 2 - 10;

    doc.fontSize(9).font('Helvetica-Bold').fillColor('#444444').text('CFI Signature:', 72, sigY);
    doc.fillColor('#000000');

    if (e.instructor_signature && e.instructor_signature.startsWith('data:image/')) {
      try {
        const base64Data = e.instructor_signature.split(',')[1];
        const imgBuffer = Buffer.from(base64Data, 'base64');
        doc.image(imgBuffer, 72, sigY + 14, { width: sigWidth, height: 50, fit: [sigWidth, 50] });
      } catch {
        doc.fontSize(9).font('Helvetica-Oblique').text('[Signature on file]', 72, sigY + 14);
      }
    }

    if (e.signed_at) {
      doc.fontSize(8).font('Helvetica').fillColor('#555555').text('Signed: ' + new Date(e.signed_at).toLocaleString(), 72, sigY + 70);
    }

    const rightX = 72 + sigWidth + 20;
    doc.fontSize(9).font('Helvetica-Bold').fillColor('#444444').text('Student Acknowledgment (Optional):', rightX, sigY);
    doc.fillColor('#000000');

    if (e.student_signature && e.student_signature.startsWith('data:image/')) {
      try {
        const base64Data = e.student_signature.split(',')[1];
        const imgBuffer = Buffer.from(base64Data, 'base64');
        doc.image(imgBuffer, rightX, sigY + 14, { width: sigWidth, height: 50, fit: [sigWidth, 50] });
      } catch {
        doc.fontSize(9).font('Helvetica-Oblique').text('[No student signature]', rightX, sigY + 14);
      }
    } else {
      doc.fontSize(9).font('Helvetica-Oblique').fillColor('#888888').text('[No student signature]', rightX, sigY + 24);
    }
    doc.fillColor('#000000');

    if (e.student_signed_at) {
      doc.fontSize(8).font('Helvetica').fillColor('#555555').text('Signed: ' + new Date(e.student_signed_at).toLocaleString(), rightX, sigY + 70);
    }

    doc.y = sigY + 90;
    doc.moveDown(1);
    doc.moveTo(72, doc.y).lineTo(doc.page.width - 72, doc.y).stroke('#CCCCCC');
    doc.moveDown(0.5);

    doc.fontSize(8).font('Helvetica').fillColor('#888888');
    doc.text(`Endorsement ID: ${e.id} · Created: ${new Date(e.created_at).toLocaleString()}`);
    if (e.ip_address) doc.text(`IP Address: ${e.ip_address}`);
    doc.text('This endorsement was created digitally and is valid under 15 U.S.C. § 7001 (E-SIGN Act) and applicable state UETA statutes.');
    doc.text('FAA Advisory Circular AC 61-65 endorsement language. Retain this record for a minimum of 3 years per 14 CFR § 61.189.');

    doc.end();
  } catch (err) {
    console.error('PDF generation error:', err);
    if (!res.headersSent) res.status(500).json({ error: 'Failed to generate PDF' });
  }
});

// ─── Expiry Alert Cron (daily) ─────────────────────────

async function sendEndorsementExpiryAlerts() {
  try {
    const thresholds = [14, 7, 1];
    for (const days of thresholds) {
      const targetDate = new Date();
      targetDate.setDate(targetDate.getDate() + days);
      const dateStr = targetDate.toISOString().split('T')[0];

      const result = await pool.query(`
        SELECT e.*, s.email AS student_email, s.name AS student_name_u,
               i.email AS instructor_email
        FROM endorsements e
        JOIN users s ON s.id = e.student_id
        JOIN users i ON i.id = e.instructor_id
        WHERE e.expiration_date = $1
          AND e.instructor_signature IS NOT NULL
      `, [dateStr]);

      for (const e of result.rows) {
        const subject = `Endorsement Expiring in ${days} Day${days > 1 ? 's' : ''}: ${e.endorsement_type}`;
        const body = `
Endorsement Expiry Notice — New Tech Aviation

Student: ${e.student_name}
Endorsement: ${e.endorsement_type}
Expiration Date: ${new Date(e.expiration_date + 'T12:00:00').toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}

This endorsement expires in ${days} day${days > 1 ? 's' : ''}.

Log in to New Tech Aviation to renew or view the endorsement details.
        `.trim();

        sendEmail(e.student_email, subject, null, body).catch(() => {});
        sendEmail(
          e.instructor_email,
          `[Instructor Alert] ${subject}`,
          null,
          `Instructor alert — your student's endorsement is expiring.\n\n${body}`
        ).catch(() => {});
      }
    }
  } catch (err) {
    console.error('[endorsement-expiry] Alert check failed:', err.message);
  }
}

// Schedule daily at app startup (runs every 24h) unless disabled
if (process.env.DISABLE_IN_PROCESS_CRONS !== 'true') {
  setTimeout(() => {
    sendEndorsementExpiryAlerts();
    setInterval(sendEndorsementExpiryAlerts, 24 * 60 * 60 * 1000);
  }, 30 * 1000); // 30s delay after start
}

// Export for server startup wiring
module.exports = router;
module.exports.ENDORSEMENT_TEMPLATES = ENDORSEMENT_TEMPLATES;