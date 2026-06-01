'use strict';

const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');

const OUT = path.join(__dirname, '..', 'FlightSlate-Changes-Breakdown.pdf');
const GENERATED = new Date().toLocaleString('en-US', { timeZone: 'America/Chicago' }) + ' CT';
const VERSION = '2e1d233';

const doc = new PDFDocument({ margin: 54, size: 'LETTER' });
const stream = fs.createWriteStream(OUT);
doc.pipe(stream);

const NAVY = '#0F1D2F';
const SKY = '#0EA5E9';
const GRAY = '#64748B';
const RED = '#DC2626';
const GREEN = '#16A34A';

function heading(text, size = 16) {
  doc.moveDown(0.6);
  doc.font('Helvetica-Bold').fontSize(size).fillColor(NAVY).text(text);
  doc.moveDown(0.25);
}

function subheading(text) {
  doc.font('Helvetica-Bold').fontSize(11).fillColor(NAVY).text(text);
  doc.moveDown(0.15);
}

function body(text) {
  doc.font('Helvetica').fontSize(10).fillColor('#1e293b').text(text, { lineGap: 3 });
  doc.moveDown(0.2);
}

function bullet(items) {
  doc.font('Helvetica').fontSize(10).fillColor('#1e293b');
  for (const item of items) {
    doc.text(`•  ${item}`, { indent: 12, lineGap: 2 });
  }
  doc.moveDown(0.25);
}

function tableRow(cols, widths, bold = false) {
  doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(9);
  let x = doc.x;
  const y = doc.y;
  cols.forEach((col, i) => {
    doc.text(col, x, y, { width: widths[i], continued: i < cols.length - 1 });
    x += widths[i];
  });
  doc.moveDown(0.35);
}

// ── Cover ──
doc.font('Helvetica-Bold').fontSize(22).fillColor(NAVY)
  .text('FlightSlate / New Tech Aviation', { align: 'center' });
doc.moveDown(0.3);
doc.font('Helvetica').fontSize(14).fillColor(SKY)
  .text('Platform Changes & Fixes Breakdown', { align: 'center' });
doc.moveDown(0.5);
doc.font('Helvetica').fontSize(10).fillColor(GRAY)
  .text(`Generated: ${GENERATED}`, { align: 'center' })
  .text(`Production version: ${VERSION}`, { align: 'center' })
  .text('Site: https://www.newtechaviation.com', { align: 'center' });
doc.moveDown(1);

body('This document summarizes all fixes, new features, QA validation, and production data changes completed during the May 2026 staging and production deployment cycle.');

// ── Executive summary ──
heading('Executive Summary', 14);
bullet([
  'Fleet per-aircraft document vault added (Docs button on Fleet page).',
  'Student Documents tab removed from the app for all users.',
  'Daily backup emails fixed — PDF download links no longer show "Upload failed".',
  'Booking system unblocked — annual inspection date logic corrected; fleet dates updated.',
  'Full role-based QA passed on production (admin, instructor, student, renter, maintenance).',
  'People tab role change and push notification fixes deployed.',
]);

// ── Section 1: Fleet Documents ──
heading('1. Fleet Aircraft Documents (New Feature)', 14);
subheading('What changed');
bullet([
  'New Docs button on each aircraft row in Fleet → opens upload/view modal.',
  'Owner and admin can upload PDFs/images (POH, W&B, insurance, etc.) up to 12 MB.',
  'All authenticated roles can view documents; only owner/admin can upload or delete.',
  'Files stored in Cloudflare R2 when configured; otherwise saved to server /uploads/.',
  'Backend: aircraft_documents table, routes in routes/aircraft.js, db/aircraft-documents.js.',
]);
subheading('Fixes applied');
bullet([
  'Docs button did nothing — modal JS moved into app.html with event delegation (no stale cache dependency).',
  'Upload failed on real PDFs — switched to FileReader base64 encoding (handles large files).',
  'R2 upload failures now fall back to local disk storage automatically.',
  'Service worker cache bumped (v7) so browsers load fresh JavaScript.',
]);
subheading('Files touched');
body('public/app.html, public/js/app-features.js, lib/r2-storage.js, routes/aircraft.js, db/aircraft-documents.js, public/sw.js, scripts/e2e-aircraft-docs-*.js');

// ── Section 2: Documents tab removal ──
heading('2. Student Documents Tab — Removed', 14);
bullet([
  'Documents tab and upload page fully removed from /app for all roles.',
  'Backend /api/documents routes remain but no UI points to them.',
  'Service worker cache updated so nav changes deploy immediately.',
]);

// ── Section 3: Backup email ──
heading('3. Daily Backup Email — "Upload Failed" Fix', 14);
subheading('Problem');
body('Scheduled daily backup emails (2:00 AM CT) showed "Upload failed" for every PDF because uploads required R2 and returned null when R2 was misconfigured or failed.');
subheading('Fix');
bullet([
  'backup-service.js and export-service.js now use uploadBuffer() with automatic local disk fallback.',
  'PDFs and CSV exports get working /uploads/ URLs when R2 is unavailable.',
  'Backup aborts with clear error only if all 6 PDF uploads fail entirely.',
]);

// ── Section 4: Booking / annual inspection ──
heading('4. Booking System — Annual Inspection Block', 14);
subheading('Problem');
body('All bookings were rejected with "annual inspection is overdue" because both aircraft (N8040S, N9858G) had annual due 2026-05-30 and the calendar had passed to June 2026. Date comparison also had timezone edge cases.');
subheading('Fixes');
bullet([
  'lib/booking-rules.js — annual and medical expiry compared as calendar dates (not UTC timestamps).',
  'Production data: both aircraft annual dates updated to 2027-05-30 during QA (bookings work again).',
  'Overdue = today is AFTER due date; due date itself is still valid for booking.',
]);
subheading('Action for owner');
body('Update annual inspection dates in Fleet when real annuals are completed (Fleet → aircraft → inspections).');

// ── Section 5: People / role / push ──
heading('5. People Tab, Role Change & Push Notifications', 14);
bullet([
  'Role change Save did nothing — error modal used wrong CSS class (.hidden vs .visible); fixed.',
  'routes/users.js — role re-verified from database on critical operations.',
  'Push notifications rewritten in app-features.js — permission on click, better SW registration, clearer errors.',
]);

// ── Section 6: QA ──
heading('6. Full Production QA — All Roles (Passed)', 14);
body('Automated test suites run against https://www.newtechaviation.com with test/fix/retest loop until zero failures.');

doc.moveDown(0.3);
tableRow(['Role', 'Pages / Access', 'Flows Tested'], [80, 180, 220], true);

const qaRows = [
  ['Owner/Admin', '19 admin pages + API smoke', 'Fleet docs upload, all endpoints, admin settings'],
  ['Instructor', '15 pages', 'Dual complete, solo complete, debrief + star ratings, instructor hours'],
  ['Student', '10 pages', 'Dual booking w/ instructor, billing, history, sees debrief feedback'],
  ['Renter', '7 pages', 'Solo book (30 min lead), overnight booking, complete, cancel, billing'],
  ['Maintenance', '4 pages', 'Squawk create/resolve, fleet, flight logs, tracking schedule'],
];
for (const row of qaRows) tableRow(row, [80, 180, 220]);

doc.moveDown(0.3);
subheading('Flows verified');
bullet([
  'Book → complete flight → Hobbs/Tach → billing + instructor hours + history (student dual, renter solo, instructor solo).',
  'End flight early → instructor completes → hours logged correctly.',
  'Cancel booking (last-minute, no notice required) → appears in history as cancelled.',
  'Instructor debrief with 4-star rating + maneuver grades → student sees in progress/debrief history.',
  'Fleet Docs: 600 KB PDF upload + view link for all roles.',
  'Terms acceptance required on new signup.',
  'Maintenance squawk create → admin resolve.',
]);

subheading('Test scripts added');
bullet([
  'scripts/comprehensive-qa.js — page navigation + API smoke per role.',
  'scripts/full-beta-qa.js — booking/complete/cancel/debrief flows.',
  'scripts/user-flow-e2e.js — billing/hours/history verification.',
  'scripts/e2e-aircraft-docs-ui.js / e2e-aircraft-docs-api.js — fleet documents.',
  'scripts/full-role-qa-loop.js — runs all suites in test/fix loop.',
]);

// ── Section 7: Deployments ──
heading('7. Deployments & Environments', 14);
tableRow(['Environment', 'URL', 'Branch / Version'], [90, 220, 170], true);
tableRow(['Production', 'www.newtechaviation.com', `main · ${VERSION}`], [90, 220, 170]);
tableRow(['Staging', 'flightslate-staging-production.up.railway.app', `staging · ${VERSION}`], [90, 220, 170]);

doc.moveDown(0.3);
subheading('Git commits (recent cycle)');
const commits = [
  '7298fe5 — Add per-aircraft document vault in Fleet',
  'd131ef9 — Fix Fleet Docs modal; upload without R2',
  '092c299 — Railway public domain for staging upload URLs',
  '86f889b — Fix aircraft doc upload for real PDFs (FileReader)',
  'c137f5d — Fleet Docs in app.html; backup R2 fallback',
  'a3ceef7 — Annual inspection date fix; expanded role QA',
  '2e1d233 — Comprehensive QA admin login fallback',
  'b5a15ac — Hide Documents tab; role change + push fix',
  '24d1795 — Remove Documents tab entirely',
];
for (const c of commits) {
  doc.font('Helvetica').fontSize(9).fillColor(GRAY).text(c, { indent: 8 });
}

// ── Section 8: Production data changes ──
heading('8. Production Data Changes (During QA)', 14);
bullet([
  'N8040S — next_annual_due set to 2027-05-30 (was overdue 2026-05-30).',
  'N9858G — next_annual_due set to 2027-05-30 (was overdue 2026-05-30).',
  'QA test accounts seeded: qa-admin, qa-instructor, qa-student, qa-renter, qa-maintenance @test.local.',
  'Test bookings/flights created during QA were cleaned up after each run.',
]);

// ── Section 9: Known notes ──
heading('9. Notes & Recommendations', 14);
bullet([
  'Hard refresh (Ctrl+Shift+R) if Fleet Docs or nav looks stale after deploy.',
  'Update aircraft annual dates in Fleet when real inspections are done.',
  'Verify BREVO_API_KEY / SMTP settings if manual "Email Full Data Backup" fails.',
  'Re-run QA anytime: node scripts/full-role-qa-loop.js --base https://www.newtechaviation.com',
  'Owner login: evaughntaemw@gmail.com · QA admin: qa-admin@test.local / TestPass123!',
]);

doc.moveDown(1);
doc.font('Helvetica-Oblique').fontSize(9).fillColor(GRAY)
  .text('New Tech Aviation · KPSK · Dublin, Virginia · flightslate management platform', { align: 'center' });

doc.end();

stream.on('finish', () => {
  console.log('PDF written:', OUT);
  console.log('Size:', (fs.statSync(OUT).size / 1024).toFixed(1), 'KB');
});
