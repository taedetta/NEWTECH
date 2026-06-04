/**
 * New Tech Aviation — Automated Data Backup Service
 *
 * Generates comprehensive PDF reports for ALL operational data (no date filtering),
 * uploads them to R2 CDN, and emails download links to designated recipients.
 *
 * Frequencies: Daily, Weekly, Monthly, Yearly
 * Recipients: operations@3vaflight.com, blankthe97@gmail.com
 *
 * PDFs generated: Billing, Instructor Hours, Flight Logs,
 *                 Endorsements, Student Directory, Maintenance Logs (6 total)
 */

'use strict';

const PDFDocument = require('pdfkit');
const { PassThrough } = require('stream');
const { uploadBuffer } = require('./lib/r2-storage');
const { buildZipBuffer } = require('./lib/backup-zip');
const { sanitizeUploadUrl } = require('./lib/upload-url');
const { prod, assertProductionExport } = require('./lib/production-query');
const { startExportScheduler } = require('./export-service');
const { sendEmail } = require('./email-templates');

const APP_URL = process.env.APP_URL || 'https://www.newtechaviation.com';

const RECIPIENTS = ['aviationnewtech@gmail.com', 'operations@3vaflight.com', 'blankthe97@gmail.com'];

// ── Timezone helpers (Central Time) ────────────────────────────────────────

function toCentral(date) {
  return new Date(date.toLocaleString('en-US', { timeZone: 'America/Chicago' }));
}

function formatDateCT(dateVal) {
  // Returns MM/DD/YYYY from a date string or Date object
  if (!dateVal) return '—';
  const d = new Date(dateVal);
  if (isNaN(d.getTime())) return '—';
  const month = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  const year = d.getUTCFullYear();
  return `${month}/${day}/${year}`;
}

function formatDateTimeCT(date) {
  return new Date(date).toLocaleString('en-US', {
    timeZone: 'America/Chicago',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: true,
  });
}

function isoDate(date) {
  const d = toCentral(date);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// ── Date range computation ──────────────────────────────────────────────────

function getDateRange(frequency) {
  const now = new Date();
  const ct = toCentral(now);

  let label;

  if (frequency === 'daily') {
    label = isoDate(now);
  } else if (frequency === 'weekly') {
    const end = new Date(ct.getFullYear(), ct.getMonth(), ct.getDate(), 23, 59, 59, 999);
    const start = new Date(end);
    start.setDate(start.getDate() - 6);
    start.setHours(0, 0, 0, 0);
    label = `${isoDate(start)}_to_${isoDate(end)}`;
  } else if (frequency === 'monthly') {
    const firstOfThisMonth = new Date(ct.getFullYear(), ct.getMonth(), 1);
    const lastOfPriorMonth = new Date(firstOfThisMonth - 1);
    const monthName = lastOfPriorMonth.toLocaleString('en-US', { month: 'long', year: 'numeric', timeZone: 'America/Chicago' });
    label = monthName.replace(' ', '_');
  } else if (frequency === 'yearly') {
    label = String(ct.getFullYear() - 1);
  } else {
    label = isoDate(now);
  }

  return { label };
}

// ── Formatting helpers ──────────────────────────────────────────────────────

function formatCurrency(val) {
  if (val == null || val === '') return '$0.00';
  const n = parseFloat(val);
  if (isNaN(n)) return '$0.00';
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatDecimal(val, places = 1) {
  if (val == null || val === '') return '0.' + '0'.repeat(places);
  const n = parseFloat(val);
  if (isNaN(n)) return '0.' + '0'.repeat(places);
  return n.toFixed(places);
}

function formatPhone(val) {
  if (!val) return '—';
  const digits = val.replace(/\D/g, '');
  if (digits.length === 10) {
    return `(${digits.slice(0,3)}) ${digits.slice(3,6)}-${digits.slice(6)}`;
  }
  if (digits.length === 11 && digits[0] === '1') {
    return `(${digits.slice(1,4)}) ${digits.slice(4,7)}-${digits.slice(7)}`;
  }
  return val;
}

function endorsementStatus(row) {
  if (!row.expiration_date) {
    return row.student_signed_at ? 'Active' : 'Pending Sig';
  }
  const now = new Date();
  const exp = new Date(row.expiration_date);
  const daysUntil = Math.floor((exp - now) / (1000 * 60 * 60 * 24));
  if (daysUntil < 0) return 'Expired';
  if (daysUntil <= 90) return 'Expiring Soon';
  return 'Active';
}

// ── NTA color palette ───────────────────────────────────────────────────────

const COLORS = {
  navy: '#0F1D2F',
  blue: '#2563EB',
  amber: '#D97706',
  lightGray: '#F3F4F6',
  medGray: '#9CA3AF',
  darkGray: '#374151',
  white: '#FFFFFF',
  rowAlt: '#EFF6FF',
  summaryBg: '#F0F9FF',
  sectionHeader: '#1E3A5F',
};

// ── PDF document factory ────────────────────────────────────────────────────

function createPdfDoc() {
  return new PDFDocument({
    size: 'LETTER',
    margins: { top: 72, bottom: 72, left: 54, right: 54 },
    bufferPages: true,
    info: { Author: 'New Tech Aviation', Creator: 'FlightSlate Backup System' },
  });
}

// ── Page header ─────────────────────────────────────────────────────────────

function drawPageHeader(doc, title, generatedAt, totalRecords) {
  const pageWidth = doc.page.width;
  const lm = 54;

  // Navy header bar
  doc.rect(0, 0, pageWidth, 86).fill(COLORS.navy);

  // Company name
  doc.fillColor(COLORS.white).font('Helvetica-Bold').fontSize(16)
    .text('NEW TECH AVIATION', lm, 18, { width: pageWidth - 108 });

  doc.fillColor(COLORS.amber).font('Helvetica').fontSize(9)
    .text('Serving the Skies from Dublin, Virginia · KPSK', lm, 40);

  // Amber rule
  doc.rect(0, 86, pageWidth, 3).fill(COLORS.amber);

  // Report title block
  doc.fillColor(COLORS.navy).font('Helvetica-Bold').fontSize(18)
    .text(title, lm, 102, { width: pageWidth - 108 - 160 });

  // Generated date + record count — top right
  const metaX = pageWidth - 54 - 155;
  doc.fillColor(COLORS.darkGray).font('Helvetica').fontSize(8)
    .text(`Generated: ${generatedAt} CT`, metaX, 102, { width: 155, align: 'right' });
  doc.fillColor(COLORS.medGray).font('Helvetica').fontSize(8)
    .text(`Total records: ${totalRecords}`, metaX, 114, { width: 155, align: 'right' });

  // Separator
  doc.moveTo(lm, 132).lineTo(pageWidth - 54, 132)
    .strokeColor(COLORS.lightGray).lineWidth(1).stroke();

  doc.y = 142;
}

// ── Page footer ─────────────────────────────────────────────────────────────

function drawPageFooter(doc, pageNum, totalPages) {
  const pageWidth = doc.page.width;
  const pageHeight = doc.page.height;
  const lm = 54;

  doc.rect(0, pageHeight - 46, pageWidth, 46).fill(COLORS.navy);

  doc.fillColor(COLORS.white).font('Helvetica').fontSize(8)
    .text('New Tech Aviation · 179 Airport Circle, Dublin, VA 24084 · KPSK', lm, pageHeight - 32);

  doc.fillColor(COLORS.white).font('Helvetica').fontSize(8)
    .text(`Generated by New Tech Aviation — Confidential`, lm, pageHeight - 21);

  doc.fillColor(COLORS.amber).font('Helvetica-Bold').fontSize(8)
    .text(`Page ${pageNum} of ${totalPages}`, pageWidth - 100, pageHeight - 32, { width: 60, align: 'right' });
}

// ── Section header ───────────────────────────────────────────────────────────

function drawSectionHeader(doc, text, lm, rightEdge) {
  const y = doc.y;
  doc.rect(lm, y, rightEdge - lm, 22).fill(COLORS.sectionHeader);
  doc.fillColor(COLORS.white).font('Helvetica-Bold').fontSize(10)
    .text(text.toUpperCase(), lm + 8, y + 6, { width: rightEdge - lm - 16 });
  doc.y = y + 28;
}

// ── Summary box ──────────────────────────────────────────────────────────────

function drawSummaryBox(doc, lines, lm, rightEdge) {
  const boxH = 14 + lines.length * 16 + 8;
  const y = doc.y;
  doc.rect(lm, y, rightEdge - lm, boxH).fill(COLORS.summaryBg);
  doc.rect(lm, y, 4, boxH).fill(COLORS.blue);

  let ty = y + 8;
  for (let i = 0; i < lines.length; i++) {
    const [label, value] = lines[i];
    doc.fillColor(COLORS.darkGray).font('Helvetica').fontSize(8.5)
      .text(label, lm + 12, ty, { continued: true })
      .font('Helvetica-Bold').fillColor(COLORS.navy)
      .text(value);
    ty += 16;
  }
  doc.y = y + boxH + 8;
}

// ── Table drawing ────────────────────────────────────────────────────────────

const ROW_H = 17;
const HDR_H = 20;

function drawTableRow(doc, cols, colWidths, y, isHeader, isAlt, lm, alignments) {
  const rowH = isHeader ? HDR_H : ROW_H;
  const bgColor = isHeader ? COLORS.navy : (isAlt ? COLORS.rowAlt : COLORS.white);
  const textColor = isHeader ? COLORS.white : COLORS.darkGray;

  let x = lm;
  for (let i = 0; i < cols.length; i++) {
    doc.rect(x, y, colWidths[i], rowH).fill(bgColor);
    const align = alignments && alignments[i] ? alignments[i] : 'left';
    doc.fillColor(textColor)
      .font(isHeader ? 'Helvetica-Bold' : 'Helvetica')
      .fontSize(isHeader ? 7.5 : 7)
      .text(String(cols[i] ?? '—'), x + 3, y + (isHeader ? 6 : 5), {
        width: colWidths[i] - 6,
        ellipsis: true,
        lineBreak: false,
        align,
      });
    x += colWidths[i];
  }
  return y + rowH;
}

/**
 * Draw a full table, paginating as needed.
 * pageInfo: { title, generatedAt, totalRecords, pageCounter, lm, rightEdge }
 */
function drawTable(doc, headers, colWidths, rows, alignments, pageInfo, summaryRows) {
  const { title, generatedAt, totalRecords, pageCounter, lm, rightEdge } = pageInfo;
  const pageBottomLimit = doc.page.height - 60;

  let y = doc.y;

  // Draw headers
  if (y + HDR_H > pageBottomLimit) {
    pageCounter.count++;
    doc.addPage();
    drawPageHeader(doc, title, generatedAt, totalRecords);
    y = doc.y;
  }
  y = drawTableRow(doc, headers, colWidths, y, true, false, lm, alignments);

  // Draw data rows
  for (let i = 0; i < rows.length; i++) {
    if (y + ROW_H > pageBottomLimit) {
      pageCounter.count++;
      doc.addPage();
      drawPageHeader(doc, title, generatedAt, totalRecords);
      y = doc.y;
      y = drawTableRow(doc, headers, colWidths, y, true, false, lm, alignments);
    }
    y = drawTableRow(doc, rows[i], colWidths, y, false, i % 2 === 1, lm, alignments);
  }

  // Empty state
  if (rows.length === 0) {
    const emptyRow = headers.map((_, i) => i === 0 ? 'No records found' : '');
    y = drawTableRow(doc, emptyRow, colWidths, y, false, false, lm, null);
  }

  // Summary footer row
  if (summaryRows && summaryRows.length > 0) {
    for (const sr of summaryRows) {
      if (y + HDR_H > pageBottomLimit) {
        pageCounter.count++;
        doc.addPage();
        drawPageHeader(doc, title, generatedAt, totalRecords);
        y = doc.y;
      }
      // Bold summary row with light navy bg
      const rowH = HDR_H;
      let x = lm;
      for (let i = 0; i < sr.length; i++) {
        doc.rect(x, y, colWidths[i], rowH).fill(COLORS.lightGray);
        doc.fillColor(COLORS.navy).font('Helvetica-Bold').fontSize(7.5)
          .text(String(sr[i] ?? ''), x + 3, y + 6, {
            width: colWidths[i] - 6,
            ellipsis: true,
            lineBreak: false,
            align: alignments && alignments[i] ? alignments[i] : 'left',
          });
        x += colWidths[i];
      }
      y += rowH;
    }
  }

  doc.y = y + 10;
}

// ── Buffer helper ────────────────────────────────────────────────────────────

function docToBuffer(doc) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    doc.on('data', c => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });
}

function finalizeDoc(doc, pageCounter) {
  doc.end();
  // After doc.end(), bufferedPageRange is available
  return docToBuffer(doc).then(buf => {
    // Footers are added BEFORE end() in each builder using doc.switchToPage
    return buf;
  });
}

function addFootersAndFinalize(doc, title, generatedAt, totalRecords, pageCounter) {
  // Add footers to all pages
  const range = doc.bufferedPageRange();
  const totalPages = range.count;
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(range.start + i);
    drawPageFooter(doc, i + 1, totalPages);
  }
  doc.end();
  return docToBuffer(doc);
}

// ── PDF builders ─────────────────────────────────────────────────────────────

async function buildBillingPdf(pool, generatedAt) {
  const doc = createPdfDoc();
  const lm = 54;
  const rightEdge = doc.page.width - 54;
  const pageCounter = { count: 1 };

  // Fetch ALL billing records — no date filter
  const q = await pool.query(`
    SELECT
      fl.flight_date,
      u.name AS student_name,
      i.name AS instructor_name,
      a.tail_number,
      a.make_model,
      fl.hobbs_start,
      fl.hobbs_end,
      fl.hobbs_delta,
      fl.tach_start,
      fl.tach_end,
      fl.tach_delta,
      fl.dual_instruction_hours AS instruction_hours,
      fl.dual_instruction_hours AS dual_hours,
      a.hourly_rate AS aircraft_rate,
      fl.aircraft_charge_amount,
      i.instructor_rate,
      fl.instruction_charge_amount AS instruction_charge,
      (COALESCE(fl.aircraft_charge_amount, 0) + COALESCE(fl.instruction_charge_amount, 0)) AS total_billed,
      COALESCE(b.lesson_type, fl.booking_type) AS lesson_type
    FROM flight_logs fl
    LEFT JOIN bookings b ON b.id = fl.booking_id
    LEFT JOIN users u ON fl.student_id = u.id
    LEFT JOIN users i ON fl.instructor_id = i.id
    LEFT JOIN aircraft a ON fl.aircraft_id = a.id
    WHERE ${prod('fl')}
    ORDER BY fl.flight_date DESC, u.name
  `);

  const groundQ = await pool.query(`
    SELECT
      gs.session_date,
      u.name AS student_name,
      i.name AS instructor_name,
      gs.ground_hours,
      gs.instructor_rate,
      gs.instruction_charge_amount
    FROM ground_sessions gs
    LEFT JOIN users u ON gs.student_id = u.id
    LEFT JOIN users i ON gs.instructor_id = i.id
    WHERE ${prod('gs')}
    ORDER BY gs.session_date DESC, u.name
  `);

  const totalHobbs = q.rows.reduce((s, r) => s + parseFloat(r.hobbs_delta || 0), 0);
  const totalTach = q.rows.reduce((s, r) => s + parseFloat(r.tach_delta || 0), 0);
  const totalInstrHrs = q.rows.reduce((s, r) => s + parseFloat(r.instruction_hours || 0), 0);
  const totalAircraftCharge = q.rows.reduce((s, r) => s + parseFloat(r.aircraft_charge_amount || 0), 0);
  const totalInstrCharge = q.rows.reduce((s, r) => s + parseFloat(r.instruction_charge || 0), 0);
  const totalGroundCharge = groundQ.rows.reduce((s, r) => s + parseFloat(r.instruction_charge_amount || 0), 0);
  const grandTotal = totalAircraftCharge + totalInstrCharge + totalGroundCharge;
  const totalRecords = q.rows.length + groundQ.rows.length;

  drawPageHeader(doc, 'Billing Report', generatedAt, totalRecords);

  // Summary
  drawSummaryBox(doc, [
    ['Total Hobbs Hours:', formatDecimal(totalHobbs, 2) + ' hrs'],
    ['Total Tach Hours:', formatDecimal(totalTach, 2) + ' hrs'],
    ['Total Instruction Hours:', formatDecimal(totalInstrHrs, 2) + ' hrs'],
    ['Aircraft Charges:', formatCurrency(totalAircraftCharge)],
    ['Instruction Charges:', formatCurrency(totalInstrCharge)],
    ['Ground Session Charges:', formatCurrency(totalGroundCharge)],
    ['TOTAL REVENUE:', formatCurrency(grandTotal)],
  ], lm, rightEdge);

  const pageInfo = { title: 'Billing Report', generatedAt, totalRecords, pageCounter, lm, rightEdge };

  // Section: Flight Billing Entries
  drawSectionHeader(doc, 'Flight Billing Entries (' + q.rows.length + ' records)', lm, rightEdge);

  {
    const headers = ['Date', 'Student', 'Instructor', 'Aircraft', 'Hobbs In', 'Hobbs Out', 'Hobbs Δ', 'Tach In', 'Tach Out', 'Tach Δ', 'Instr Hrs', 'Dual Hrs', 'Aircraft $', 'Instr $', 'Total'];
    const colWidths = [52, 80, 75, 52, 44, 44, 38, 40, 40, 38, 42, 38, 50, 50, 50];
    const alignments = ['left','left','left','left','right','right','right','right','right','right','right','right','right','right','right'];
    const rows = q.rows.map(r => [
      formatDateCT(r.flight_date),
      r.student_name || '—',
      r.instructor_name || 'Solo',
      r.tail_number || '—',
      formatDecimal(r.hobbs_start, 1),
      formatDecimal(r.hobbs_end, 1),
      formatDecimal(r.hobbs_delta, 2),
      formatDecimal(r.tach_start, 1),
      formatDecimal(r.tach_end, 1),
      formatDecimal(r.tach_delta, 2),
      formatDecimal(r.instruction_hours, 2),
      formatDecimal(r.dual_hours, 2),
      formatCurrency(r.aircraft_charge_amount),
      formatCurrency(r.instruction_charge),
      formatCurrency(r.total_billed),
    ]);
    const summaryRow = [
      'TOTALS', '', '', '',
      '', '', formatDecimal(totalHobbs, 2),
      '', '', formatDecimal(totalTach, 2),
      formatDecimal(totalInstrHrs, 2), '',
      formatCurrency(totalAircraftCharge),
      formatCurrency(totalInstrCharge),
      formatCurrency(totalAircraftCharge + totalInstrCharge),
    ];
    drawTable(doc, headers, colWidths, rows, alignments, pageInfo, [summaryRow]);
  }

  // Section: Ground Session Charges
  drawSectionHeader(doc, 'Ground Session Charges (' + groundQ.rows.length + ' records)', lm, rightEdge);

  {
    const headers = ['Date', 'Student', 'Instructor', 'Ground Hours', 'Rate/Hr', 'Total Charge'];
    const colWidths = [70, 140, 130, 80, 80, 87];
    const alignments = ['left','left','left','right','right','right'];
    const rows = groundQ.rows.map(r => [
      formatDateCT(r.session_date),
      r.student_name || '—',
      r.instructor_name || '—',
      formatDecimal(r.ground_hours, 2),
      formatCurrency(r.instructor_rate),
      formatCurrency(r.instruction_charge_amount),
    ]);
    const summaryRow = ['TOTALS', '', '', '', '', formatCurrency(totalGroundCharge)];
    drawTable(doc, headers, colWidths, rows, alignments, pageInfo, [summaryRow]);
  }

  return addFootersAndFinalize(doc, 'Billing Report', generatedAt, totalRecords, pageCounter);
}

async function buildInstructorHoursPdf(pool, generatedAt) {
  const doc = createPdfDoc();
  const lm = 54;
  const rightEdge = doc.page.width - 54;
  const pageCounter = { count: 1 };

  // Flight instruction — ALL records
  const flQ = await pool.query(`
    SELECT
      fl.flight_date AS date,
      i.name AS instructor_name,
      u.name AS student_name,
      fl.hobbs_delta AS hobbs_hours,
      fl.dual_instruction_hours AS instruction_hours,
      i.instructor_rate AS rate,
      fl.instruction_charge_amount AS instruction_charge,
      a.tail_number,
      'Flight' AS session_type
    FROM flight_logs fl
    LEFT JOIN users i ON fl.instructor_id = i.id
    LEFT JOIN users u ON fl.student_id = u.id
    LEFT JOIN aircraft a ON fl.aircraft_id = a.id
    WHERE fl.instructor_id IS NOT NULL AND ${prod('fl')}
    ORDER BY fl.flight_date DESC, i.name
  `);

  // Ground sessions — ALL records
  const gsQ = await pool.query(`
    SELECT
      gs.session_date AS date,
      i.name AS instructor_name,
      u.name AS student_name,
      0 AS hobbs_hours,
      gs.ground_hours AS instruction_hours,
      gs.instructor_rate AS rate,
      gs.instruction_charge_amount AS instruction_charge,
      NULL AS tail_number,
      'Ground' AS session_type
    FROM ground_sessions gs
    LEFT JOIN users i ON gs.instructor_id = i.id
    LEFT JOIN users u ON gs.student_id = u.id
    WHERE ${prod('gs')}
    ORDER BY gs.session_date DESC, i.name
  `);

  const allRows = [...flQ.rows, ...gsQ.rows];
  allRows.sort((a, b) => new Date(b.date) - new Date(a.date));

  const totalHobbs = allRows.reduce((s, r) => s + parseFloat(r.hobbs_hours || 0), 0);
  const totalInstrHrs = allRows.reduce((s, r) => s + parseFloat(r.instruction_hours || 0), 0);
  const totalInstrCharges = allRows.reduce((s, r) => s + parseFloat(r.instruction_charge || 0), 0);
  const groundSessionHrs = gsQ.rows.reduce((s, r) => s + parseFloat(r.instruction_hours || 0), 0);
  const groundSessionCharges = gsQ.rows.reduce((s, r) => s + parseFloat(r.instruction_charge || 0), 0);
  const totalRecords = allRows.length;

  drawPageHeader(doc, 'Instructor Hours Report', generatedAt, totalRecords);

  drawSummaryBox(doc, [
    ['Total Hobbs Hours:', formatDecimal(totalHobbs, 2) + ' hrs'],
    ['Total Instruction Hours:', formatDecimal(totalInstrHrs, 2) + ' hrs'],
    ['Ground Session Hours:', formatDecimal(groundSessionHrs, 2) + ' hrs'],
    ['Ground Session Charges:', formatCurrency(groundSessionCharges)],
    ['Total Instructor Charges:', formatCurrency(totalInstrCharges)],
    ['Total Billed:', formatCurrency(totalInstrCharges)],
  ], lm, rightEdge);

  const pageInfo = { title: 'Instructor Hours Report', generatedAt, totalRecords, pageCounter, lm, rightEdge };

  drawSectionHeader(doc, 'All Instructor Sessions (' + totalRecords + ' records)', lm, rightEdge);

  {
    const headers = ['Date', 'Instructor', 'Student', 'Type', 'Aircraft', 'Hobbs Hrs', 'Instr Hrs', 'Rate/Hr', 'Instr Charge', 'Total Billed'];
    const colWidths = [54, 90, 85, 45, 52, 50, 50, 48, 60, 53];
    const alignments = ['left','left','left','left','left','right','right','right','right','right'];
    const rows = allRows.map(r => [
      formatDateCT(r.date),
      r.instructor_name || '—',
      r.student_name || '—',
      r.session_type,
      r.tail_number || '—',
      formatDecimal(r.hobbs_hours, 2),
      formatDecimal(r.instruction_hours, 2),
      formatCurrency(r.rate),
      formatCurrency(r.instruction_charge),
      formatCurrency(r.instruction_charge),
    ]);
    const summaryRow = ['TOTALS', '', '', '', '',
      formatDecimal(totalHobbs, 2),
      formatDecimal(totalInstrHrs, 2),
      '',
      formatCurrency(totalInstrCharges),
      formatCurrency(totalInstrCharges),
    ];
    drawTable(doc, headers, colWidths, rows, alignments, pageInfo, [summaryRow]);
  }

  return addFootersAndFinalize(doc, 'Instructor Hours Report', generatedAt, totalRecords, pageCounter);
}

async function buildFlightLogsPdf(pool, generatedAt) {
  const doc = createPdfDoc();
  const lm = 54;
  const rightEdge = doc.page.width - 54;
  const pageCounter = { count: 1 };

  // ALL flight logs — no date filter
  const q = await pool.query(`
    SELECT
      fl.flight_date,
      u.name AS student_name,
      i.name AS instructor_name,
      a.tail_number,
      a.make_model,
      fl.hobbs_start,
      fl.hobbs_end,
      fl.hobbs_delta,
      fl.tach_start,
      fl.tach_end,
      fl.tach_delta,
      fl.dual_instruction_hours,
      fl.booking_type,
      COALESCE(b.lesson_type, fl.booking_type) AS lesson_type,
      fl.notes
    FROM flight_logs fl
    LEFT JOIN bookings b ON b.id = fl.booking_id
    LEFT JOIN users u ON fl.student_id = u.id
    LEFT JOIN users i ON fl.instructor_id = i.id
    LEFT JOIN aircraft a ON fl.aircraft_id = a.id
    WHERE ${prod('fl')}
    ORDER BY fl.flight_date DESC, u.name
  `);

  // Current cumulative aircraft hours
  const aircraftQ = await pool.query(`
    SELECT
      tail_number,
      make_model,
      COALESCE(current_hobbs, 0) AS current_hobbs,
      COALESCE(current_tach, 0) AS current_tach,
      status
    FROM aircraft a
    WHERE ${prod('a')}
    ORDER BY tail_number
  `);

  const totalHobbs = q.rows.reduce((s, r) => s + parseFloat(r.hobbs_delta || 0), 0);
  const totalTach = q.rows.reduce((s, r) => s + parseFloat(r.tach_delta || 0), 0);
  const totalDualHrs = q.rows.reduce((s, r) => s + parseFloat(r.dual_instruction_hours || 0), 0);
  const totalRecords = q.rows.length;

  drawPageHeader(doc, 'Flight Logs Report', generatedAt, totalRecords);

  drawSummaryBox(doc, [
    ['Total Flights:', String(q.rows.length)],
    ['Total Hobbs Hours:', formatDecimal(totalHobbs, 2) + ' hrs'],
    ['Total Tach Hours:', formatDecimal(totalTach, 2) + ' hrs'],
    ['Total Dual Instruction Hours:', formatDecimal(totalDualHrs, 2) + ' hrs'],
  ], lm, rightEdge);

  const pageInfo = { title: 'Flight Logs Report', generatedAt, totalRecords, pageCounter, lm, rightEdge };

  // Section: Flight Log Entries
  drawSectionHeader(doc, 'Flight Log Entries (' + q.rows.length + ' records)', lm, rightEdge);

  {
    const headers = ['Date', 'Student', 'Instructor', 'Aircraft', 'Hobbs In', 'Hobbs Out', 'Hobbs Δ', 'Tach In', 'Tach Out', 'Tach Δ', 'Instr Hrs', 'Flight Type'];
    const colWidths = [54, 82, 78, 50, 42, 44, 38, 40, 42, 38, 42, 57];
    const alignments = ['left','left','left','left','right','right','right','right','right','right','right','left'];
    const rows = q.rows.map(r => [
      formatDateCT(r.flight_date),
      r.student_name || '—',
      r.instructor_name || 'Solo',
      r.tail_number || '—',
      formatDecimal(r.hobbs_start, 1),
      formatDecimal(r.hobbs_end, 1),
      formatDecimal(r.hobbs_delta, 2),
      formatDecimal(r.tach_start, 1),
      formatDecimal(r.tach_end, 1),
      formatDecimal(r.tach_delta, 2),
      formatDecimal(r.dual_instruction_hours, 2),
      r.lesson_type || r.booking_type || '—',
    ]);
    const summaryRow = ['TOTALS', '', '', '', '', '',
      formatDecimal(totalHobbs, 2), '', '',
      formatDecimal(totalTach, 2),
      formatDecimal(totalDualHrs, 2), '',
    ];
    drawTable(doc, headers, colWidths, rows, alignments, pageInfo, [summaryRow]);
  }

  // Section: Aircraft Current Hours
  drawSectionHeader(doc, 'Aircraft Current Hours (' + aircraftQ.rows.length + ' aircraft)', lm, rightEdge);

  {
    const headers = ['Aircraft', 'Make / Model', 'Current Hobbs', 'Current Tach', 'Status'];
    const colWidths = [80, 200, 110, 110, 87];
    const alignments = ['left', 'left', 'right', 'right', 'left'];
    const rows = aircraftQ.rows.map(r => [
      r.tail_number || '—',
      r.make_model || '—',
      formatDecimal(r.current_hobbs, 1) + ' hrs',
      formatDecimal(r.current_tach, 1) + ' hrs',
      r.status === 'maintenance' ? 'Maintenance' : 'Available',
    ]);
    drawTable(doc, headers, colWidths, rows, alignments, pageInfo, null);
  }

  // Section: Flight Notes (inline)
  const withNotes = q.rows.filter(r => r.notes && r.notes.trim());
  if (withNotes.length > 0) {
    drawSectionHeader(doc, 'Flight Notes (' + withNotes.length + ' entries)', lm, rightEdge);
    for (const r of withNotes) {
      if (doc.y > doc.page.height - 100) {
        pageCounter.count++;
        doc.addPage();
        drawPageHeader(doc, 'Flight Logs Report', generatedAt, totalRecords);
      }
      doc.fillColor(COLORS.darkGray).font('Helvetica-Bold').fontSize(7.5)
        .text(`${formatDateCT(r.flight_date)} — ${r.student_name || '—'} / ${r.tail_number || '—'}:`, lm, doc.y);
      doc.fillColor(COLORS.darkGray).font('Helvetica').fontSize(7.5)
        .text(r.notes, lm + 10, doc.y, { width: rightEdge - lm - 10 });
      doc.moveDown(0.4);
    }
  }

  return addFootersAndFinalize(doc, 'Flight Logs Report', generatedAt, totalRecords, pageCounter);
}

async function buildEndorsementsPdf(pool, generatedAt) {
  const doc = createPdfDoc();
  const lm = 54;
  const rightEdge = doc.page.width - 54;
  const pageCounter = { count: 1 };

  // ALL endorsements — no date filter
  const q = await pool.query(`
    SELECT
      e.endorsement_date,
      e.student_name,
      e.instructor_name,
      e.instructor_cert_number,
      e.endorsement_type,
      e.template_key,
      e.aircraft_make_model,
      a.tail_number AS aircraft_tail,
      e.expiration_date,
      e.signed_at,
      e.student_signed_at,
      e.instructor_signature IS NOT NULL AS cfi_signed,
      e.student_signature IS NOT NULL AS student_signed_flag
    FROM endorsements e
    LEFT JOIN aircraft a ON e.aircraft_id = a.id
    WHERE ${prod('e')}
    ORDER BY e.endorsement_date DESC, e.student_name
  `);

  const now = new Date();
  const activeCount = q.rows.filter(r => {
    if (!r.expiration_date) return true;
    return new Date(r.expiration_date) >= now;
  }).length;
  const expiredCount = q.rows.filter(r => r.expiration_date && new Date(r.expiration_date) < now).length;
  const expiringSoonCount = q.rows.filter(r => {
    if (!r.expiration_date) return false;
    const days = Math.floor((new Date(r.expiration_date) - now) / (1000 * 60 * 60 * 24));
    return days >= 0 && days <= 90;
  }).length;
  const totalRecords = q.rows.length;

  drawPageHeader(doc, 'Endorsements Report', generatedAt, totalRecords);

  drawSummaryBox(doc, [
    ['Total Endorsements:', String(totalRecords)],
    ['Active:', String(activeCount)],
    ['Expiring Within 90 Days:', String(expiringSoonCount)],
    ['Expired:', String(expiredCount)],
    ['CFI Signed:', String(q.rows.filter(r => r.cfi_signed).length)],
    ['Student Acknowledged:', String(q.rows.filter(r => r.student_signed_flag).length)],
  ], lm, rightEdge);

  const pageInfo = { title: 'Endorsements Report', generatedAt, totalRecords, pageCounter, lm, rightEdge };

  drawSectionHeader(doc, 'All Endorsements (' + totalRecords + ' records)', lm, rightEdge);

  {
    const headers = ['Date Signed', 'Student', 'CFI Name', 'CFI Cert #', 'Endorsement Type', 'Aircraft', 'Expires', 'Status', 'CFI Sig', 'Student Sig'];
    const colWidths = [54, 85, 82, 60, 110, 70, 54, 58, 40, 54];
    const alignments = ['left','left','left','left','left','left','left','left','center','center'];
    const rows = q.rows.map(r => {
      const aircraft = r.aircraft_tail
        ? `${r.aircraft_tail}${r.aircraft_make_model ? ' ' + r.aircraft_make_model : ''}`
        : (r.aircraft_make_model || '—');
      return [
        formatDateCT(r.endorsement_date),
        r.student_name || '—',
        r.instructor_name || '—',
        r.instructor_cert_number || '—',
        r.endorsement_type || r.template_key || '—',
        aircraft,
        r.expiration_date ? formatDateCT(r.expiration_date) : 'No Expiry',
        endorsementStatus(r),
        r.cfi_signed ? 'Yes' : 'No',
        r.student_signed_flag ? 'Yes' : 'No',
      ];
    });
    drawTable(doc, headers, colWidths, rows, alignments, pageInfo, null);
  }

  return addFootersAndFinalize(doc, 'Endorsements Report', generatedAt, totalRecords, pageCounter);
}

async function buildStudentDirectoryPdf(pool, generatedAt) {
  const doc = createPdfDoc();
  const lm = 54;
  const rightEdge = doc.page.width - 54;
  const pageCounter = { count: 1 };

  // ALL users — no filter on enrollment date, all roles
  const q = await pool.query(`
    SELECT
      u.id,
      u.name,
      u.email,
      u.phone_number,
      u.role,
      u.created_at,
      u.deleted_at,
      inst.name AS assigned_instructor
    FROM users u
    LEFT JOIN student_training st ON st.student_id = u.id AND st.status = 'active' AND ${prod('st')}
    LEFT JOIN users inst ON inst.id = st.instructor_id
    WHERE ${prod('u')}
    ORDER BY
      CASE u.role
        WHEN 'owner' THEN 1
        WHEN 'admin' THEN 2
        WHEN 'instructor' THEN 3
        WHEN 'student' THEN 4
        ELSE 5
      END,
      u.deleted_at IS NULL DESC,
      u.name ASC
  `);

  const activeCount = q.rows.filter(r => !r.deleted_at).length;
  const inactiveCount = q.rows.filter(r => r.deleted_at).length;
  const studentCount = q.rows.filter(r => r.role === 'student').length;
  const instructorCount = q.rows.filter(r => r.role === 'instructor').length;
  const totalRecords = q.rows.length;

  drawPageHeader(doc, 'User Directory', generatedAt, totalRecords);

  drawSummaryBox(doc, [
    ['Total Users:', String(totalRecords)],
    ['Active:', String(activeCount)],
    ['Inactive / Departed:', String(inactiveCount)],
    ['Students:', String(studentCount)],
    ['Instructors:', String(instructorCount)],
  ], lm, rightEdge);

  const pageInfo = { title: 'User Directory', generatedAt, totalRecords, pageCounter, lm, rightEdge };

  drawSectionHeader(doc, 'All Users (' + totalRecords + ' records)', lm, rightEdge);

  {
    const headers = ['Full Name', 'Email Address', 'Phone Number', 'Role', 'Registered', 'Status', 'Assigned Instructor'];
    const colWidths = [105, 145, 88, 58, 62, 55, 74];
    const alignments = ['left','left','left','left','left','left','left'];
    const rows = q.rows.map(r => [
      r.name || '—',
      r.email || '—',
      formatPhone(r.phone_number),
      r.role ? (r.role.charAt(0).toUpperCase() + r.role.slice(1)) : '—',
      r.created_at ? formatDateCT(r.created_at) : '—',
      r.deleted_at ? 'Inactive' : 'Active',
      r.assigned_instructor || (r.role === 'student' ? 'Unassigned' : '—'),
    ]);
    drawTable(doc, headers, colWidths, rows, alignments, pageInfo, null);
  }

  return addFootersAndFinalize(doc, 'User Directory', generatedAt, totalRecords, pageCounter);
}

async function buildMaintenanceLogsPdf(pool, generatedAt) {
  const doc = createPdfDoc();
  const lm = 54;
  const rightEdge = doc.page.width - 54;
  const pageCounter = { count: 1 };

  // ALL squawks/maintenance logs — no date filter
  const q = await pool.query(`
    SELECT
      sq.id,
      a.tail_number,
      a.make_model,
      sq.reported_at,
      rep.name AS reported_by_name,
      sq.description,
      sq.severity,
      sq.status,
      sq.resolution_notes,
      sq.expected_downtime,
      sq.updated_at,
      rev.name AS reviewed_by_name,
      sq.reviewed_at
    FROM squawks sq
    LEFT JOIN aircraft a ON sq.aircraft_id = a.id
    LEFT JOIN users rep ON sq.reported_by = rep.id
    LEFT JOIN users rev ON sq.reviewed_by = rev.id
    WHERE ${prod('sq')}
    ORDER BY sq.reported_at DESC
  `);

  const openCount = q.rows.filter(r => r.status === 'open').length;
  const resolvedCount = q.rows.filter(r => r.status === 'resolved').length;
  const groundingCount = q.rows.filter(r => r.severity === 'grounding').length;
  const totalRecords = q.rows.length;

  drawPageHeader(doc, 'Maintenance Logs Report', generatedAt, totalRecords);

  drawSummaryBox(doc, [
    ['Total Squawks / Discrepancies:', String(totalRecords)],
    ['Open:', String(openCount)],
    ['Deferred:', String(q.rows.filter(r => r.status === 'deferred').length)],
    ['Resolved:', String(resolvedCount)],
    ['Grounding Severity:', String(groundingCount)],
  ], lm, rightEdge);

  const pageInfo = { title: 'Maintenance Logs Report', generatedAt, totalRecords, pageCounter, lm, rightEdge };

  drawSectionHeader(doc, 'All Maintenance Records (' + totalRecords + ' records)', lm, rightEdge);

  {
    const headers = ['Aircraft', 'Date Reported', 'Reported By', 'Description', 'Severity', 'Status', 'Resolution Notes', 'Exp. Downtime', 'Last Updated'];
    const colWidths = [55, 62, 72, 120, 52, 50, 110, 62, 64];
    const alignments = ['left','left','left','left','left','left','left','left','left'];

    const capFirst = s => s ? (s.charAt(0).toUpperCase() + s.slice(1)) : '—';

    const rows = q.rows.map(r => [
      r.tail_number ? `${r.tail_number}` : '—',
      r.reported_at ? formatDateCT(r.reported_at) : '—',
      r.reported_by_name || '—',
      r.description || '—',
      capFirst(r.severity),
      capFirst(r.status),
      r.resolution_notes || '—',
      r.expected_downtime || '—',
      r.updated_at ? formatDateCT(r.updated_at) : '—',
    ]);
    drawTable(doc, headers, colWidths, rows, alignments, pageInfo, null);
  }

  return addFootersAndFinalize(doc, 'Maintenance Logs Report', generatedAt, totalRecords, pageCounter);
}

// ── R2 upload helper ──────────────────────────────────────────────────────────

async function uploadPdfToR2(pdfBuffer, filename) {
  const url = await uploadBuffer(pdfBuffer, filename, { folder: 'backups', contentType: 'application/pdf' });
  if (!url) console.error('[backup] PDF upload failed for', filename);
  return url;
}

// ── Email ─────────────────────────────────────────────────────────────────────

async function sendBackupEmail(frequency, label, downloadLinks, recordCounts, zipAttachment) {
  const freqLabel = frequency.charAt(0).toUpperCase() + frequency.slice(1);
  const subject = `New Tech Aviation — ${freqLabel} Data Backup — ${label}`;
  const generatedAt = new Date().toLocaleString('en-US', { timeZone: 'America/Chicago' });

  const bodyHtml = buildBackupEmailHtml(freqLabel, label, generatedAt, recordCounts, downloadLinks, zipAttachment);
  const bodyText = buildBackupEmailText(freqLabel, label, generatedAt, recordCounts, downloadLinks, zipAttachment);
  const attachments = zipAttachment
    ? [{ name: zipAttachment.name, content: zipAttachment.buffer }]
    : undefined;

  const errors = [];
  for (const recipient of RECIPIENTS) {
    try {
      await sendEmail(recipient, subject, bodyHtml, bodyText, attachments);
    } catch (err) {
      console.error(`[backup] Error sending to ${recipient}:`, err.message);
      errors.push({ recipient, error: err.message });
    }
  }
  return errors;
}

function buildBackupEmailHtml(freqLabel, label, generatedAt, recordCounts, downloadLinks, zipAttachment) {
  const LOGO = 'https://pub-629428d185ca4960a0a73c850d32294b.r2.dev/company_96457/images/6131da51-11d1-4327-8e6f-470c3e242f0b.png';

  const dlRows = downloadLinks.map((dl, i) => `
    <tr style="background:${i % 2 === 0 ? '#ffffff' : '#F9FAFB'};">
      <td style="padding:10px 16px;color:#374151;font-size:13px;">${dl.name}</td>
      <td style="padding:10px 16px;text-align:right;">
        ${dl.url
          ? `<a href="${dl.url}" style="color:#2563EB;font-weight:bold;font-size:13px;text-decoration:none;">Download PDF &rarr;</a>`
          : zipAttachment
            ? '<span style="color:#059669;font-size:13px;">Included in attached ZIP</span>'
            : '<span style="color:#9CA3AF;font-size:13px;">See attached ZIP</span>'}
      </td>
    </tr>`).join('');

  const rcRows = recordCounts.map((rc, i) => `
    <tr style="background:${i % 2 === 0 ? '#ffffff' : '#F9FAFB'};">
      <td style="padding:10px 16px;color:#374151;font-size:13px;">${rc.name}</td>
      <td style="padding:10px 16px;color:#2563EB;font-weight:bold;font-size:13px;text-align:right;">${rc.count}</td>
    </tr>`).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>New Tech Aviation Data Backup</title>
</head>
<body style="margin:0;padding:0;background:#f4f6f9;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6f9;padding:32px 0;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:10px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.08);">
        <tr>
          <td style="background:#0F1D2F;padding:24px 32px;">
            <img src="${LOGO}" alt="New Tech Aviation" style="height:44px;width:auto;display:block;" />
          </td>
        </tr>
        <tr>
          <td style="padding:32px;">
            <h2 style="margin:0 0 8px;color:#0F1D2F;font-size:22px;">${freqLabel} Data Backup</h2>
            <p style="margin:0 0 6px;color:#6B7280;font-size:13px;">Backup ID: <strong>${label}</strong></p>
            <p style="margin:0 0 24px;color:#6B7280;font-size:13px;">Generated: <strong>${generatedAt} CT</strong></p>
            <p style="color:#374151;font-size:15px;margin:0 0 20px;">
              Your ${freqLabel.toLowerCase()} backup reports are ready. Each PDF contains <strong>complete historical data</strong> — not just recent activity.
            </p>
            ${zipAttachment ? `<div style="background:#ECFDF5;border-left:4px solid #059669;padding:12px 16px;border-radius:4px;margin-bottom:20px;">
              <p style="margin:0;color:#065F46;font-size:13px;"><strong>Attached:</strong> All 6 PDF reports are included in <strong>${zipAttachment.name}</strong> on this email.</p>
            </div>` : ''}
            <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #E5E7EB;border-radius:8px;overflow:hidden;margin-bottom:24px;">
              <tr style="background:#0F1D2F;">
                <td style="padding:12px 16px;font-weight:bold;color:#ffffff;font-size:13px;">Report (6 PDFs)</td>
                <td style="padding:12px 16px;font-weight:bold;color:#ffffff;font-size:13px;text-align:right;">Download</td>
              </tr>
              ${dlRows}
            </table>
            <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #E5E7EB;border-radius:8px;overflow:hidden;margin-bottom:24px;">
              <tr style="background:#F9FAFB;">
                <td style="padding:12px 16px;font-weight:bold;color:#374151;font-size:13px;">Report</td>
                <td style="padding:12px 16px;font-weight:bold;color:#374151;font-size:13px;text-align:right;">Total Records</td>
              </tr>
              ${rcRows}
            </table>
            <div style="background:#EFF6FF;border-left:4px solid #2563EB;padding:12px 16px;border-radius:4px;">
              <p style="margin:0;color:#1E40AF;font-size:13px;">
                <strong>Full history backup:</strong> Each PDF contains ALL records from the database, not just recent activity. These are permanent snapshots suitable for compliance and audit.
              </p>
            </div>
          </td>
        </tr>
        <tr>
          <td style="background:#0F1D2F;padding:20px 32px;">
            <p style="margin:0;color:#9CA3AF;font-size:12px;">
              New Tech Aviation · 179 Airport Circle, Dublin, VA 24084 · KPSK<br>
              Automated backup generated ${generatedAt} CT
            </p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function buildBackupEmailText(freqLabel, label, generatedAt, recordCounts, downloadLinks, zipAttachment) {
  const dlLines = downloadLinks.map((dl) => {
    if (dl.url) return `  - ${dl.name}: ${dl.url}`;
    if (zipAttachment) return `  - ${dl.name}: included in attached ${zipAttachment.name}`;
    return `  - ${dl.name}: see attached ZIP`;
  }).join('\n');
  const rcLines = recordCounts.map(rc => `  - ${rc.name}: ${rc.count} records`).join('\n');
  return `New Tech Aviation — ${freqLabel} Data Backup (${label})
Generated: ${generatedAt} CT
${zipAttachment ? `\nAttachment: ${zipAttachment.name} (all 6 PDF reports)\n` : ''}
Full history backup — ALL records from the database.

Reports:
${dlLines}

Record counts:
${rcLines}

New Tech Aviation · 179 Airport Circle, Dublin, VA 24084 · KPSK`;
}

// ── Main backup runner ────────────────────────────────────────────────────────

async function runBackup(pool, frequency) {
  assertProductionExport();
  const startTime = Date.now();
  console.log(`[backup] Starting ${frequency} backup (production data only)...`);

  try {
    const { label } = getDateRange(frequency);
    const generatedAt = new Date().toLocaleString('en-US', {
      timeZone: 'America/Chicago',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hour12: true,
    });

    console.log(`[backup] Generating 6 PDFs with full data...`);

    // Generate all 6 PDFs in parallel
    const [billingBuf, instructorBuf, flightBuf, endorsementBuf, studentBuf, maintenanceBuf] = await Promise.all([
      buildBillingPdf(pool, generatedAt),
      buildInstructorHoursPdf(pool, generatedAt),
      buildFlightLogsPdf(pool, generatedAt),
      buildEndorsementsPdf(pool, generatedAt),
      buildStudentDirectoryPdf(pool, generatedAt),
      buildMaintenanceLogsPdf(pool, generatedAt),
    ]);

    console.log(`[backup] PDFs generated in ${Date.now() - startTime}ms`);

    // Record counts for email summary
    const [flCount, gsCount, endCount, userCount, sqCount, instrTotal] = await Promise.all([
      pool.query(`SELECT COUNT(*) FROM flight_logs WHERE ${prod('flight_logs')}`),
      pool.query(`SELECT COUNT(*) FROM ground_sessions WHERE ${prod('ground_sessions')}`),
      pool.query(`SELECT COUNT(*) FROM endorsements WHERE ${prod('endorsements')}`),
      pool.query(`SELECT COUNT(*) FROM users WHERE ${prod('users')}`),
      pool.query(`SELECT COUNT(*) FROM squawks WHERE ${prod('squawks')}`),
      pool.query(`
        SELECT (SELECT COUNT(*) FROM flight_logs WHERE instructor_id IS NOT NULL AND ${prod('flight_logs')}) +
               (SELECT COUNT(*) FROM ground_sessions WHERE ${prod('ground_sessions')}) AS count
      `),
    ]);

    const recordCounts = [
      { name: 'Billing — Flight Entries', count: parseInt(flCount.rows[0].count) },
      { name: 'Billing — Ground Sessions', count: parseInt(gsCount.rows[0].count) },
      { name: 'Instructor Hour Entries', count: parseInt(instrTotal.rows[0].count) },
      { name: 'Flight Logs', count: parseInt(flCount.rows[0].count) },
      { name: 'Endorsements', count: parseInt(endCount.rows[0].count) },
      { name: 'Users in Directory', count: parseInt(userCount.rows[0].count) },
      { name: 'Maintenance / Squawk Records', count: parseInt(sqCount.rows[0].count) },
    ];

    // Upload all 6 PDFs to R2
    const pdfFiles = [
      { name: 'Billing Report', zipFolder: '01_Billing', filename: `Billing_${label}.pdf`, buffer: billingBuf },
      { name: 'Instructor Hours Report', zipFolder: '02_Instructor_Hours', filename: `Instructor_Hours_${label}.pdf`, buffer: instructorBuf },
      { name: 'Flight Logs Report', zipFolder: '03_Flight_Logs', filename: `Flight_Logs_${label}.pdf`, buffer: flightBuf },
      { name: 'Endorsements Report', zipFolder: '04_Endorsements', filename: `Endorsements_${label}.pdf`, buffer: endorsementBuf },
      { name: 'User Directory', zipFolder: '05_User_Directory', filename: `User_Directory_${label}.pdf`, buffer: studentBuf },
      { name: 'Maintenance Logs Report', zipFolder: '06_Maintenance_Logs', filename: `Maintenance_Logs_${label}.pdf`, buffer: maintenanceBuf },
    ];

    console.log(`[backup] Uploading ${pdfFiles.length} PDFs to storage...`);
    const downloadLinks = [];
    for (const pf of pdfFiles) {
      const url = sanitizeUploadUrl(await uploadPdfToR2(pf.buffer, pf.filename));
      downloadLinks.push({ name: pf.name, filename: pf.filename, url });
    }

    const uploadedCount = downloadLinks.filter(dl => dl.url).length;
    console.log(`[backup] ${uploadedCount}/${pdfFiles.length} PDFs uploaded to storage`);

    const zipName = `NTA_PDF_Backup_${label.replace(/[^\w-]+/g, '_')}.zip`;
    const readme = [
      'New Tech Aviation — PDF Data Backup',
      `Frequency: ${frequency}`,
      `Label: ${label}`,
      `Generated: ${generatedAt} CT`,
      '',
      'Each folder contains one PDF report with complete historical data.',
      '',
      'Folder structure:',
      ...pdfFiles.map((pf) => `  ${pf.zipFolder}/${pf.filename}  —  ${pf.name}`),
    ].join('\r\n');
    const zipBuffer = await buildZipBuffer(
      pdfFiles.map((pf) => ({ name: `${pf.zipFolder}/${pf.filename}`, content: pf.buffer })),
      readme,
    );
    console.log(`[backup] ZIP attachment ready: ${zipName} (${(zipBuffer.length / 1024).toFixed(0)} KB)`);

    await sendBackupEmail(frequency, label, downloadLinks, recordCounts, { name: zipName, buffer: zipBuffer });

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`[backup] ${frequency} backup complete in ${elapsed}s`);
    return { success: true, label, recordCounts, uploadedCount, downloadLinks, zipName, zipSizeKb: Math.round(zipBuffer.length / 1024) };
  } catch (err) {
    console.error(`[backup] ${frequency} backup failed:`, err);
    return { success: false, error: err.message };
  }
}

// ── Scheduler ─────────────────────────────────────────────────────────────────

function startBackupScheduler(pool) {
  const { isStaging } = require('./lib/app-env');
  if (isStaging()) {
    console.log('[backup] Staging — backup scheduler disabled');
    return;
  }

  console.log('[backup] Scheduler started. Daily 2:00 CT · Weekly Sun 3:00 CT · Monthly 1st 3:30 CT · Yearly Jan 1 4:00 CT');

  const lastRun = { daily: null, weekly: null, monthly: null, yearly: null };

  setInterval(async () => {
    const now = new Date();
    const ct = toCentral(now);
    const h = ct.getHours();
    const m = ct.getMinutes();
    const dow = ct.getDay();
    const dom = ct.getDate();
    const moy = ct.getMonth() + 1;
    const todayKey = isoDate(now);

    if (h === 2 && m === 0 && lastRun.daily !== todayKey) {
      lastRun.daily = todayKey;
      runBackup(pool, 'daily').catch(err => console.error('[backup] Daily error:', err.message));
    }
    if (h === 3 && m === 0 && dow === 0 && lastRun.weekly !== todayKey) {
      lastRun.weekly = todayKey;
      runBackup(pool, 'weekly').catch(err => console.error('[backup] Weekly error:', err.message));
    }
    if (h === 3 && m === 30 && dom === 1 && lastRun.monthly !== todayKey) {
      lastRun.monthly = todayKey;
      runBackup(pool, 'monthly').catch(err => console.error('[backup] Monthly error:', err.message));
    }
    if (h === 4 && m === 0 && dom === 1 && moy === 1 && lastRun.yearly !== todayKey) {
      lastRun.yearly = todayKey;
      runBackup(pool, 'yearly').catch(err => console.error('[backup] Yearly error:', err.message));
    }
  }, 60 * 1000);

  // Start nightly CSV export at 11 PM CT (separate from PDF backup)
  startExportScheduler(pool);
}

module.exports = { runBackup, startBackupScheduler };
