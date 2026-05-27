'use strict';
// Owns: nightly 11 PM CT CSV export — 9 topic-specific CSVs uploaded to R2, emailed as download links
// Does not own: PDF backup (backup-service.js), auth, booking logic, aircraft management

const { uploadBuffer, isConfigured: isR2Configured } = require('./lib/r2-storage');
const { sendEmail } = require('./email-templates');
const RECIPIENTS = ['aviationnewtech@gmail.com', 'blankthe97@gmail.com', 'bunnfarmva@yopmail.com'];

// ── Timezone helpers ───────────────────────────────────────────────────────────

function toCentral(date) {
  return new Date(date.toLocaleString('en-US', { timeZone: 'America/Chicago' }));
}

function isoDate(d) {
  const ct = toCentral(d);
  return `${ct.getFullYear()}-${String(ct.getMonth() + 1).padStart(2, '0')}-${String(ct.getDate()).padStart(2, '0')}`;
}

// ── CSV helpers ────────────────────────────────────────────────────────────────

function esc(val) {
  if (val === null || val === undefined) return '';
  const s = String(val);
  if (s.includes('"') || s.includes(',') || s.includes('\n') || s.includes('\r')) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

function toCsv(headers, rows) {
  const lines = [headers.map(esc).join(',')];
  for (const row of rows) lines.push(row.map(esc).join(','));
  return lines.join('\n');
}

function fmtDate(v) {
  if (!v) return '';
  const d = new Date(v);
  return isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
}

function fmtDt(v) {
  if (!v) return '';
  const d = new Date(v);
  return isNaN(d.getTime()) ? '' : d.toISOString().replace('T', ' ').slice(0, 19);
}

function fmtDec(v, p = 2) {
  if (v == null) return '';
  const n = parseFloat(v);
  return isNaN(n) ? '' : n.toFixed(p);
}

// ── 9 CSV generators ───────────────────────────────────────────────────────────

async function genStudents(pool) {
  const q = await pool.query(`
    SELECT u.name, u.phone_number, u.email, u.role, u.created_at, u.deleted_at,
           u.approval_status
    FROM users u
    ORDER BY u.created_at
  `);
  const headers = ['first_name','last_name','phone_number','email','role','signup_date','status','approved_by','approved_at'];
  const rows = q.rows.map(r => {
    const parts = (r.name || '').split(' ');
    return [parts[0] || '', parts.slice(1).join(' ') || '', r.phone_number || '', r.email || '',
      r.role || '', fmtDate(r.created_at),
      r.deleted_at ? 'inactive' : (r.approval_status || 'approved'),
      '', ''];  // approved_by/approved_at not stored in this schema
  });
  return { csv: toCsv(headers, rows), count: rows.length };
}

async function genFlightLogs(pool) {
  const q = await pool.query(`
    SELECT fl.booking_id, s.name AS student_name, i.name AS instructor_name,
           a.make_model AS aircraft, a.tail_number, fl.flight_date,
           b.start_time AS scheduled_start, b.end_time AS scheduled_end,
           fl.hobbs_start, fl.hobbs_end, fl.tach_start, fl.tach_end,
           fl.booking_type AS flight_type,
           b.status, fl.notes, fl.created_at
    FROM flight_logs fl
    LEFT JOIN users s ON s.id = fl.student_id
    LEFT JOIN users i ON i.id = fl.instructor_id
    LEFT JOIN aircraft a ON a.id = fl.aircraft_id
    LEFT JOIN bookings b ON b.id = fl.booking_id
    ORDER BY fl.flight_date DESC, fl.created_at DESC
  `);
  const headers = ['booking_id','student_name','instructor_name','aircraft','tail_number','flight_date',
    'scheduled_start','scheduled_end','hobbs_start','hobbs_end','tach_start','tach_end',
    'flight_type','status','notes','created_at'];
  const rows = q.rows.map(r => [
    r.booking_id || '', r.student_name || '', r.instructor_name || '',
    r.aircraft || '', r.tail_number || '', fmtDate(r.flight_date),
    fmtDt(r.scheduled_start), fmtDt(r.scheduled_end),
    fmtDec(r.hobbs_start), fmtDec(r.hobbs_end),
    fmtDec(r.tach_start), fmtDec(r.tach_end),
    r.flight_type || '', r.status || '', r.notes || '', fmtDt(r.created_at),
  ]);
  return { csv: toCsv(headers, rows), count: rows.length };
}

async function genHoursRecords(pool) {
  const q = await pool.query(`
    SELECT fl.booking_id, s.name AS student_name, i.name AS instructor_name,
           a.make_model AS aircraft, a.tail_number, fl.flight_date,
           fl.hobbs_delta AS hobbs_hours, fl.tach_delta AS tach_hours,
           fl.booking_type AS flight_type, fl.created_at
    FROM flight_logs fl
    LEFT JOIN users s ON s.id = fl.student_id
    LEFT JOIN users i ON i.id = fl.instructor_id
    LEFT JOIN aircraft a ON a.id = fl.aircraft_id
    ORDER BY fl.flight_date DESC
  `);
  const headers = ['booking_id','student_name','instructor_name','aircraft','tail_number',
    'flight_date','hobbs_hours','tach_hours','flight_type','created_at'];
  const rows = q.rows.map(r => [
    r.booking_id || '', r.student_name || '', r.instructor_name || '',
    r.aircraft || '', r.tail_number || '', fmtDate(r.flight_date),
    fmtDec(r.hobbs_hours), fmtDec(r.tach_hours),
    r.flight_type || '', fmtDt(r.created_at),
  ]);
  return { csv: toCsv(headers, rows), count: rows.length };
}

async function genMaintenance(pool) {
  const q = await pool.query(`
    SELECT sq.id AS squawk_id, a.make_model AS aircraft, a.tail_number,
           rep.name AS reported_by, sq.reported_at AS reported_date,
           sq.description, sq.status, sq.severity AS priority,
           (sq.severity = 'grounding') AS grounded,
           CASE WHEN sq.status = 'resolved' THEN sq.updated_at ELSE NULL END AS resolved_date,
           rev.name AS resolved_by, sq.resolution_notes AS notes, sq.reported_at AS created_at
    FROM squawks sq
    LEFT JOIN aircraft a ON a.id = sq.aircraft_id
    LEFT JOIN users rep ON rep.id = sq.reported_by
    LEFT JOIN users rev ON rev.id = sq.reviewed_by
    ORDER BY sq.reported_at DESC
  `);
  const headers = ['squawk_id','aircraft','tail_number','reported_by','reported_date',
    'description','status','priority','grounded','resolved_date','resolved_by','notes','created_at'];
  const rows = q.rows.map(r => [
    r.squawk_id, r.aircraft || '', r.tail_number || '', r.reported_by || '',
    fmtDt(r.reported_date), r.description || '', r.status || '', r.priority || '',
    r.grounded ? 'Yes' : 'No', r.resolved_date ? fmtDt(r.resolved_date) : '',
    r.resolved_by || '', r.notes || '', fmtDt(r.created_at),
  ]);
  return { csv: toCsv(headers, rows), count: rows.length };
}

async function genBilling(pool) {
  // Flight charges from flight_logs + ground session charges combined
  const q = await pool.query(`
    SELECT fl.booking_id, s.name AS student_name, i.name AS instructor_name,
           a.make_model AS aircraft, fl.flight_date,
           COALESCE(fl.aircraft_charge_amount, 0) AS hobbs_charge,
           COALESCE(fl.instruction_charge_amount, 0) AS instructor_charge,
           0 AS ground_charge,
           (COALESCE(fl.aircraft_charge_amount, 0) + COALESCE(fl.instruction_charge_amount, 0)) AS total_charge,
           CASE WHEN COALESCE(b.billing_voided, false) THEN 'voided' ELSE 'billed' END AS payment_status,
           fl.created_at
    FROM flight_logs fl
    LEFT JOIN users s ON s.id = fl.student_id
    LEFT JOIN users i ON i.id = fl.instructor_id
    LEFT JOIN aircraft a ON a.id = fl.aircraft_id
    LEFT JOIN bookings b ON b.id = fl.booking_id
    UNION ALL
    SELECT NULL AS booking_id, s.name AS student_name, i.name AS instructor_name,
           'Ground Session' AS aircraft, gs.session_date AS flight_date,
           0 AS hobbs_charge, 0 AS instructor_charge,
           COALESCE(gs.instruction_charge_amount, 0) AS ground_charge,
           COALESCE(gs.instruction_charge_amount, 0) AS total_charge,
           'billed' AS payment_status, gs.created_at
    FROM ground_sessions gs
    LEFT JOIN users s ON s.id = gs.student_id
    LEFT JOIN users i ON i.id = gs.instructor_id
    ORDER BY flight_date DESC NULLS LAST
  `);
  const headers = ['booking_id','student_name','instructor_name','aircraft','flight_date',
    'hobbs_charge','instructor_charge','ground_charge','total_charge','payment_status','created_at'];
  const rows = q.rows.map(r => [
    r.booking_id || '', r.student_name || '', r.instructor_name || '',
    r.aircraft || '', fmtDate(r.flight_date),
    fmtDec(r.hobbs_charge), fmtDec(r.instructor_charge), fmtDec(r.ground_charge),
    fmtDec(r.total_charge), r.payment_status || '', fmtDt(r.created_at),
  ]);
  return { csv: toCsv(headers, rows), count: rows.length };
}

async function genInstructorHours(pool) {
  const q = await pool.query(`
    SELECT fl.booking_id, i.name AS instructor_name, a.make_model AS aircraft,
           fl.flight_date, fl.hobbs_delta AS hobbs_hours, fl.tach_delta AS tach_hours,
           fl.dual_instruction_hours AS instruction_hours, i.instructor_rate,
           fl.instruction_charge_amount AS instructor_charge,
           fl.booking_type AS flight_type, fl.created_at
    FROM flight_logs fl
    LEFT JOIN users i ON i.id = fl.instructor_id
    LEFT JOIN aircraft a ON a.id = fl.aircraft_id
    WHERE fl.instructor_id IS NOT NULL
    UNION ALL
    SELECT NULL AS booking_id, i.name AS instructor_name, 'Ground Session' AS aircraft,
           gs.session_date AS flight_date, 0 AS hobbs_hours, 0 AS tach_hours,
           gs.ground_hours AS instruction_hours, gs.instructor_rate,
           gs.instruction_charge_amount AS instructor_charge, 'ground' AS flight_type,
           gs.created_at
    FROM ground_sessions gs
    LEFT JOIN users i ON i.id = gs.instructor_id
    ORDER BY flight_date DESC NULLS LAST
  `);
  const headers = ['booking_id','instructor_name','aircraft','flight_date','hobbs_hours',
    'tach_hours','instruction_hours','instructor_rate','instructor_charge','flight_type','created_at'];
  const rows = q.rows.map(r => [
    r.booking_id || '', r.instructor_name || '', r.aircraft || '', fmtDate(r.flight_date),
    fmtDec(r.hobbs_hours), fmtDec(r.tach_hours), fmtDec(r.instruction_hours),
    fmtDec(r.instructor_rate), fmtDec(r.instructor_charge), r.flight_type || '', fmtDt(r.created_at),
  ]);
  return { csv: toCsv(headers, rows), count: rows.length };
}

async function genEndorsements(pool) {
  const q = await pool.query(`
    SELECT e.id AS endorsement_id, e.student_name, e.instructor_name,
           COALESCE(e.endorsement_type, e.template_key) AS endorsement_type,
           e.endorsement_date AS flight_date,
           COALESCE(a.make_model, e.aircraft_make_model) AS aircraft,
           e.endorsement_text AS notes, e.created_at
    FROM endorsements e
    LEFT JOIN aircraft a ON a.id = e.aircraft_id
    ORDER BY e.endorsement_date DESC NULLS LAST
  `);
  const headers = ['endorsement_id','student_name','instructor_name','endorsement_type',
    'flight_date','aircraft','notes','created_at'];
  const rows = q.rows.map(r => [
    r.endorsement_id, r.student_name || '', r.instructor_name || '',
    r.endorsement_type || '', fmtDate(r.flight_date),
    r.aircraft || '', r.notes || '', fmtDt(r.created_at),
  ]);
  return { csv: toCsv(headers, rows), count: rows.length };
}

async function genStudentHours(pool) {
  const q = await pool.query(`
    SELECT s.name AS student_name,
           COALESCE(SUM(fl.hobbs_delta), 0) AS total_hobbs,
           COALESCE(SUM(fl.tach_delta), 0) AS total_tach,
           COALESCE(SUM(fl.dual_instruction_hours), 0) AS total_instruction,
           COUNT(fl.id) AS flight_count,
           MAX(fl.flight_date) AS last_flight_date,
           s.created_at
    FROM users s
    LEFT JOIN flight_logs fl ON fl.student_id = s.id
    WHERE s.role = 'student'
    GROUP BY s.id, s.name, s.created_at
    ORDER BY s.name
  `);
  const headers = ['student_name','total_hobbs','total_tach','total_instruction',
    'flight_count','last_flight_date','created_at'];
  const rows = q.rows.map(r => [
    r.student_name, fmtDec(r.total_hobbs), fmtDec(r.total_tach),
    fmtDec(r.total_instruction), r.flight_count,
    fmtDate(r.last_flight_date), fmtDt(r.created_at),
  ]);
  return { csv: toCsv(headers, rows), count: rows.length };
}

async function genStudentProgress(pool) {
  const q = await pool.query(`
    SELECT s.name AS student_name, i.name AS instructor_name,
           tp.name AS program, ps.name AS current_stage,
           ROUND(COALESCE(mc.completed_stages, 0.0) / NULLIF(ts.total_stages, 0) * 100, 1) AS progress_pct,
           ara.risk_level, st.updated_at AS last_activity,
           COALESCE(fc.flight_count, 0) AS total_flights,
           COALESCE(fc.total_hours, 0) AS total_hours, st.created_at
    FROM student_training st
    LEFT JOIN users s ON s.id = st.student_id
    LEFT JOIN users i ON i.id = st.instructor_id
    LEFT JOIN training_programs tp ON tp.id = st.program_id
    LEFT JOIN program_stages ps ON ps.id = st.current_stage_id
    LEFT JOIN at_risk_assessments ara ON ara.student_id = st.student_id
    LEFT JOIN (
      SELECT student_id, COUNT(*) AS completed_stages
      FROM milestone_completions GROUP BY student_id
    ) mc ON mc.student_id = st.student_id
    LEFT JOIN (
      SELECT program_id, COUNT(*) AS total_stages
      FROM program_stages GROUP BY program_id
    ) ts ON ts.program_id = st.program_id
    LEFT JOIN (
      SELECT student_id, COUNT(*) AS flight_count,
             COALESCE(SUM(hobbs_delta), 0) AS total_hours
      FROM flight_logs GROUP BY student_id
    ) fc ON fc.student_id = st.student_id
    ORDER BY s.name
  `);
  const headers = ['student_name','instructor_name','program','current_stage','progress_pct',
    'risk_level','last_activity','total_flights','total_hours','created_at'];
  const rows = q.rows.map(r => [
    r.student_name || '', r.instructor_name || '', r.program || '',
    r.current_stage || '', fmtDec(r.progress_pct, 1),
    r.risk_level || '', fmtDt(r.last_activity),
    r.total_flights, fmtDec(r.total_hours), fmtDt(r.created_at),
  ]);
  return { csv: toCsv(headers, rows), count: rows.length };
}

// ── R2 upload ──────────────────────────────────────────────────────────────────

async function uploadCsvToR2(csvBuffer, filename) {
  if (!isR2Configured()) { console.error('[export] R2 not configured — set R2_* env vars'); return null; }
  return uploadBuffer(csvBuffer, filename, { folder: 'exports', contentType: 'text/csv' });
}

// ── Email ──────────────────────────────────────────────────────────────────────

async function sendExportEmail(dateLabel, files) {
  if (!process.env.BREVO_API_KEY && !process.env.SMTP_HOST) {
    console.error('[export] Email not configured — set BREVO_API_KEY or SMTP');
    return;
  }
  const subject = `New Tech Aviation — Complete Records Export — ${dateLabel}`;
  const generatedAt = new Date().toLocaleString('en-US', { timeZone: 'America/Chicago' });

  const tableRows = files.map((f, i) => `
    <tr style="background:${i % 2 === 0 ? '#fff' : '#F9FAFB'}">
      <td style="padding:10px 16px;color:#374151;font-size:13px;">${f.folder}</td>
      <td style="padding:10px 16px;color:#2563EB;font-size:13px;text-align:right;">${Number(f.count).toLocaleString()} records</td>
      <td style="padding:10px 16px;text-align:right;">
        ${f.url
          ? `<a href="${f.url}" style="color:#2563EB;font-weight:bold;font-size:13px;text-decoration:none;">Download CSV &rarr;</a>`
          : '<span style="color:#9CA3AF;font-size:13px;">Upload failed</span>'}
      </td>
    </tr>`).join('');

  const bodyHtml = `<!DOCTYPE html>
<html><body style="margin:0;padding:0;background:#f4f6f9;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6f9;padding:32px 0;">
  <tr><td align="center">
    <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#fff;border-radius:10px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,.08);">
      <tr><td style="background:#0F1D2F;padding:24px 32px;">
        <p style="margin:0;color:#fff;font-size:20px;font-weight:bold;">✈ New Tech Aviation</p>
        <p style="margin:4px 0 0;color:#D97706;font-size:13px;">Serving the Skies from Dublin, Virginia · KPSK</p>
      </td></tr>
      <tr><td style="padding:32px;">
        <h2 style="margin:0 0 8px;color:#0F1D2F;font-size:22px;">Complete Records Export</h2>
        <p style="margin:0 0 4px;color:#6B7280;font-size:13px;">Export Date: <strong>${dateLabel}</strong></p>
        <p style="margin:0 0 24px;color:#6B7280;font-size:13px;">Generated: <strong>${generatedAt} CT</strong></p>
        <p style="color:#374151;font-size:15px;margin:0 0 20px;">
          Full historical export — <strong>every record from the beginning of time</strong>, no date filtering. 9 CSV files covering all operational data.
        </p>
        <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #E5E7EB;border-radius:8px;overflow:hidden;margin-bottom:24px;">
          <tr style="background:#0F1D2F;">
            <td style="padding:12px 16px;font-weight:bold;color:#fff;font-size:13px;">Data Category</td>
            <td style="padding:12px 16px;font-weight:bold;color:#fff;font-size:13px;text-align:right;">Records</td>
            <td style="padding:12px 16px;font-weight:bold;color:#fff;font-size:13px;text-align:right;">Download</td>
          </tr>
          ${tableRows}
        </table>
        <div style="background:#EFF6FF;border-left:4px solid #2563EB;padding:12px 16px;border-radius:4px;">
          <p style="margin:0;color:#1E40AF;font-size:13px;">
            <strong>Audit-grade export:</strong> All 9 files contain complete records including cancelled, inactive, and historical data. No truncation. Schedule: every night at 11:00 PM CT.
          </p>
        </div>
      </td></tr>
      <tr><td style="background:#0F1D2F;padding:20px 32px;">
        <p style="margin:0;color:#9CA3AF;font-size:12px;">
          New Tech Aviation · 179 Airport Circle, Dublin, VA 24084 · KPSK<br>
          Automated nightly export — ${generatedAt} CT
        </p>
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`;

  const bodyText = `New Tech Aviation — Complete Records Export — ${dateLabel}\nGenerated: ${generatedAt} CT\n\n` +
    `Full history export — ALL records, no date filtering.\n\n` +
    files.map(f => `${f.folder}: ${f.count} records — ${f.url || 'Upload failed'}`).join('\n');

  for (const recipient of RECIPIENTS) {
    sendEmail(recipient, subject, bodyHtml, bodyText)
      .catch((err) => console.error(`[export] Email error to ${recipient}:`, err.message));
  }
}

const EXPORT_TASKS = [
  { folder: 'STUDENTS', fn: genStudents },
  { folder: 'FLIGHT_LOGS', fn: genFlightLogs },
  { folder: 'HOURS_RECORDS', fn: genHoursRecords },
  { folder: 'MAINTENANCE_SQUAWKS', fn: genMaintenance },
  { folder: 'BILLING', fn: genBilling },
  { folder: 'INSTRUCTOR_HOURS', fn: genInstructorHours },
  { folder: 'ENDORSEMENTS', fn: genEndorsements },
  { folder: 'STUDENT_HOURS', fn: genStudentHours },
  { folder: 'STUDENT_PROGRESS', fn: genStudentProgress },
];

/** Generate all CSV exports in memory — used for email backup ZIP attachments. */
async function generateAllCsvExports(pool) {
  const dateLabel = isoDate(new Date());
  const files = [];
  for (const task of EXPORT_TASKS) {
    try {
      const { csv, count } = await task.fn(pool);
      files.push({
        folder: task.folder,
        csv,
        count,
        filename: `${task.folder}_${dateLabel}.csv`,
      });
    } catch (err) {
      console.error(`[export] ${task.folder} generation error:`, err.message);
      files.push({
        folder: task.folder,
        csv: `error,message\n${task.folder},${err.message.replace(/,/g, ' ')}`,
        count: 0,
        filename: `${task.folder}_${dateLabel}.csv`,
        error: err.message,
      });
    }
  }
  return { dateLabel, files };
}

// ── Main export runner ─────────────────────────────────────────────────────────

async function runExport(pool) {
  const startTime = Date.now();
  const dateLabel = isoDate(new Date());
  console.log(`[export] Starting nightly CSV export for ${dateLabel}...`);

  const results = await Promise.allSettled(EXPORT_TASKS.map((t) => t.fn(pool)));
  const files = [];

  for (let i = 0; i < EXPORT_TASKS.length; i++) {
    const task = EXPORT_TASKS[i];
    const result = results[i];
    if (result.status === 'rejected') {
      console.error(`[export] CSV gen failed for ${task.folder}:`, result.reason?.message || result.reason);
      files.push({ folder: task.folder, count: 0, url: null });
      continue;
    }
    const { csv, count } = result.value;
    const filename = `${task.folder}_${dateLabel}.csv`;
    const url = await uploadCsvToR2(Buffer.from(csv, 'utf8'), filename);
    files.push({ folder: task.folder, count, url });
    console.log(`[export] ${task.folder}: ${count} records — ${url ? 'uploaded' : 'upload failed'}`);
  }

  await sendExportEmail(dateLabel, files);

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  const uploaded = files.filter(f => f.url).length;
  console.log(`[export] Complete in ${elapsed}s — ${uploaded}/9 files uploaded`);
  return { success: true, dateLabel, files, uploaded };
}

// ── Scheduler ──────────────────────────────────────────────────────────────────

function startExportScheduler(pool) {
  const { isStaging } = require('./app-env');
  if (isStaging()) {
    console.log('[export] Staging — nightly export scheduler disabled');
    return;
  }

  console.log('[export] Nightly CSV export scheduled at 11:00 PM CT');
  const lastRun = { nightly: null };

  setInterval(() => {
    const ct = toCentral(new Date());
    const todayKey = isoDate(new Date());
    // Fire at 23:00 CT, once per day
    if (ct.getHours() === 23 && ct.getMinutes() === 0 && lastRun.nightly !== todayKey) {
      lastRun.nightly = todayKey;
      runExport(pool).catch(err => console.error('[export] Nightly error:', err.message));
    }
  }, 60 * 1000);

  // Startup trigger for testing: set AUTO_EXPORT_ON_START=1 env var, fires once on boot after 15s
  if (process.env.AUTO_EXPORT_ON_START) {
    console.log('[export] AUTO_EXPORT_ON_START set — triggering export in 15s...');
    setTimeout(() => {
      runExport(pool)
        .then(r => console.log('[export] Startup export complete:', r.uploaded + '/9 files'))
        .catch(err => console.error('[export] Startup export error:', err.message));
    }, 15000);
  }
}

module.exports = { runExport, startExportScheduler, generateAllCsvExports, EXPORT_TASKS };
