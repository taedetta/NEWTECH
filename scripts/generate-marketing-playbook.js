/**
 * Generate Local Marketing Playbook PDF for New Tech Aviation
 * Professional formatting with navy/amber branding, TOC, tables, checklists
 * Content sourced from research report #699450
 */
const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');

const NAVY = '#1B2A4A';
const AMBER = '#F5A623';
const DARK_TEXT = '#2D3748';
const LIGHT_BG = '#F7F8FA';
const WHITE = '#FFFFFF';
const LIGHT_GRAY = '#E2E8F0';
const MEDIUM_GRAY = '#718096';
const FOOTER_TEXT = 'New Tech Aviation — Dublin, VA | newtechaviation.com';

const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;
const MARGIN = 54;
const CONTENT_WIDTH = PAGE_WIDTH - 2 * MARGIN;

let currentPage = 0;
const tocEntries = [];

function createDoc() {
  const doc = new PDFDocument({
    size: 'letter',
    margins: { top: 60, bottom: 72, left: MARGIN, right: MARGIN },
    bufferPages: true,
    info: {
      Title: 'Local Marketing Playbook — New Tech Aviation',
      Author: 'New Tech Aviation',
      Subject: 'Low-Budget Marketing Strategy for Flight Schools',
    },
  });
  return doc;
}

function addFooter(doc) {
  const range = doc.bufferedPageRange();
  const totalPages = range.count;
  const contentPages = totalPages - 1; // exclude cover page

  for (let i = 1; i < totalPages; i++) {
    doc.switchToPage(i);

    // Amber accent line (vector drawing works fine with switchToPage)
    doc.save();
    doc.moveTo(MARGIN, PAGE_HEIGHT - 52)
       .lineTo(PAGE_WIDTH - MARGIN, PAGE_HEIGHT - 52)
       .strokeColor(AMBER).lineWidth(0.5).stroke();
    doc.restore();

    // Temporarily set bottom margin to 0 so doc.text() at y=752
    // doesn't think it overflows the page (default maxY = 792-72 = 720).
    // This prevents pdfkit from creating spurious blank pages.
    const origBottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;

    doc.font('Helvetica').fontSize(8).fillColor(MEDIUM_GRAY);
    doc.text(FOOTER_TEXT, MARGIN, PAGE_HEIGHT - 40, {
      width: CONTENT_WIDTH,
      lineBreak: false,
    });
    doc.text(`Page ${i} of ${contentPages}`, MARGIN, PAGE_HEIGHT - 40, {
      width: CONTENT_WIDTH,
      align: 'right',
      lineBreak: false,
    });

    // Restore original margin
    doc.page.margins.bottom = origBottom;
  }
}

function pageNum(doc) {
  return doc.bufferedPageRange().start + doc.bufferedPageRange().count;
}

function addSection(doc, title) {
  const pg = pageNum(doc);
  tocEntries.push({ title, page: pg });
}

function sectionHeader(doc, title, opts = {}) {
  const y = doc.y;
  if (y > PAGE_HEIGHT - 140) doc.addPage();

  // Navy background bar
  doc.save();
  doc.rect(MARGIN - 8, doc.y - 4, CONTENT_WIDTH + 16, 32).fill(NAVY);
  doc.fontSize(15).fillColor(WHITE).font('Helvetica-Bold');
  doc.text(title, MARGIN + 6, doc.y + 4, { width: CONTENT_WIDTH - 12 });
  doc.restore();
  doc.moveDown(1.8);
}

function subHeader(doc, title) {
  if (doc.y > PAGE_HEIGHT - 100) doc.addPage();
  // Amber left bar
  doc.save();
  doc.rect(MARGIN - 2, doc.y, 3, 16).fill(AMBER);
  doc.fontSize(12).fillColor(NAVY).font('Helvetica-Bold');
  doc.text(title, MARGIN + 10, doc.y + 1);
  doc.restore();
  doc.moveDown(0.6);
}

function bodyText(doc, text) {
  doc.fontSize(9.5).fillColor(DARK_TEXT).font('Helvetica');
  doc.text(text, MARGIN, doc.y, { width: CONTENT_WIDTH, lineGap: 3 });
  doc.moveDown(0.4);
}

function bulletList(doc, items, indent = 12) {
  doc.fontSize(9.5).fillColor(DARK_TEXT).font('Helvetica');
  items.forEach(item => {
    if (doc.y > PAGE_HEIGHT - 80) doc.addPage();
    doc.text(`•  ${item}`, MARGIN + indent, doc.y, { width: CONTENT_WIDTH - indent, lineGap: 2 });
    doc.moveDown(0.2);
  });
  doc.moveDown(0.3);
}

function checklistItem(doc, text, indent = 12) {
  if (doc.y > PAGE_HEIGHT - 80) doc.addPage();
  doc.fontSize(9.5).font('Helvetica');
  doc.fillColor(AMBER).text('☐', MARGIN + indent, doc.y);
  doc.fillColor(DARK_TEXT).text(`  ${text}`, MARGIN + indent + 14, doc.y - doc.currentLineHeight(), { width: CONTENT_WIDTH - indent - 20, lineGap: 2 });
  doc.moveDown(0.25);
}

function checklist(doc, items, indent = 12) {
  items.forEach(item => checklistItem(doc, item, indent));
  doc.moveDown(0.3);
}

function drawTable(doc, headers, rows, colWidths) {
  const startX = MARGIN;
  const rowHeight = 22;
  const cellPadding = 6;

  if (doc.y > PAGE_HEIGHT - 120) doc.addPage();
  let y = doc.y;

  // Header row
  doc.save();
  let x = startX;
  doc.rect(startX, y, CONTENT_WIDTH, rowHeight).fill(NAVY);
  headers.forEach((h, i) => {
    doc.fontSize(8).fillColor(WHITE).font('Helvetica-Bold');
    doc.text(h, x + cellPadding, y + 6, { width: colWidths[i] - cellPadding * 2, lineGap: 0 });
    x += colWidths[i];
  });
  y += rowHeight;
  doc.restore();

  // Data rows
  rows.forEach((row, ri) => {
    if (y > PAGE_HEIGHT - 80) {
      doc.addPage();
      y = doc.y;
      // Repeat header on new page
      let hx = startX;
      doc.save();
      doc.rect(startX, y, CONTENT_WIDTH, rowHeight).fill(NAVY);
      headers.forEach((h, i) => {
        doc.fontSize(8).fillColor(WHITE).font('Helvetica-Bold');
        doc.text(h, hx + cellPadding, y + 6, { width: colWidths[i] - cellPadding * 2 });
        hx += colWidths[i];
      });
      doc.restore();
      y += rowHeight;
    }

    const bgColor = ri % 2 === 0 ? LIGHT_BG : WHITE;
    doc.save();
    doc.rect(startX, y, CONTENT_WIDTH, rowHeight).fill(bgColor);

    let x = startX;
    row.forEach((cell, ci) => {
      doc.fontSize(7.5).fillColor(DARK_TEXT).font('Helvetica');
      doc.text(String(cell), x + cellPadding, y + 6, { width: colWidths[ci] - cellPadding * 2, lineGap: 0 });
      x += colWidths[ci];
    });
    doc.restore();
    y += rowHeight;
  });

  // Border
  doc.save();
  doc.rect(startX, doc.y, CONTENT_WIDTH, y - doc.y).strokeColor(LIGHT_GRAY).lineWidth(0.5).stroke();
  doc.restore();

  doc.y = y + 8;
}

function highlightBox(doc, text, bgColor = '#FFF8E7') {
  if (doc.y > PAGE_HEIGHT - 100) doc.addPage();
  const boxY = doc.y;
  doc.save();
  const textHeight = doc.heightOfString(text, { width: CONTENT_WIDTH - 24 });
  doc.rect(MARGIN, boxY, CONTENT_WIDTH, textHeight + 16).fill(bgColor);
  doc.rect(MARGIN, boxY, 3, textHeight + 16).fill(AMBER);
  doc.fontSize(9.5).fillColor(DARK_TEXT).font('Helvetica');
  doc.text(text, MARGIN + 14, boxY + 8, { width: CONTENT_WIDTH - 28, lineGap: 3 });
  doc.restore();
  doc.y = boxY + textHeight + 28;
}

// ============================================================
// BUILD THE PDF
// ============================================================
async function buildPDF() {
  const outputPath = path.join(__dirname, '..', 'nta-marketing-playbook.pdf');
  const doc = createDoc();
  const stream = fs.createWriteStream(outputPath);
  doc.pipe(stream);

  // ---- COVER PAGE ----
  doc.rect(0, 0, PAGE_WIDTH, PAGE_HEIGHT).fill(NAVY);

  // Amber accent band
  doc.rect(0, PAGE_HEIGHT * 0.42, PAGE_WIDTH, 6).fill(AMBER);

  // Title
  doc.fontSize(36).fillColor(WHITE).font('Helvetica-Bold');
  doc.text('Local Marketing', MARGIN, PAGE_HEIGHT * 0.22, { width: CONTENT_WIDTH, align: 'center' });
  doc.fontSize(36).fillColor(AMBER).font('Helvetica-Bold');
  doc.text('Playbook', MARGIN, doc.y, { width: CONTENT_WIDTH, align: 'center' });

  doc.moveDown(2);
  doc.fontSize(14).fillColor(WHITE).font('Helvetica');
  doc.text('Low-Budget Marketing Channels for', MARGIN, PAGE_HEIGHT * 0.50, { width: CONTENT_WIDTH, align: 'center' });
  doc.text('Flight Schools & Pilot Education', MARGIN, doc.y, { width: CONTENT_WIDTH, align: 'center' });

  doc.moveDown(2);
  doc.fontSize(18).fillColor(AMBER).font('Helvetica-Bold');
  doc.text('New Tech Aviation', MARGIN, PAGE_HEIGHT * 0.62, { width: CONTENT_WIDTH, align: 'center' });
  doc.fontSize(12).fillColor(WHITE).font('Helvetica');
  doc.text('Dublin, VA', MARGIN, doc.y + 4, { width: CONTENT_WIDTH, align: 'center' });

  doc.fontSize(10).fillColor(MEDIUM_GRAY).font('Helvetica');
  doc.text('May 2026', MARGIN, PAGE_HEIGHT * 0.78, { width: CONTENT_WIDTH, align: 'center' });
  doc.text('newtechaviation.com', MARGIN, doc.y + 4, { width: CONTENT_WIDTH, align: 'center' });

  // ---- TABLE OF CONTENTS (placeholder - filled after) ----
  doc.addPage();
  const tocPageIndex = doc.bufferedPageRange().count - 1;

  doc.fontSize(22).fillColor(NAVY).font('Helvetica-Bold');
  doc.text('Table of Contents', MARGIN, 60);
  doc.moveDown(0.5);
  doc.moveTo(MARGIN, doc.y).lineTo(MARGIN + 200, doc.y).strokeColor(AMBER).lineWidth(2).stroke();
  doc.moveDown(1.5);

  // Store TOC Y position - we'll fill it in later
  const tocStartY = doc.y;

  // ---- SECTION 1: EXECUTIVE SUMMARY ----
  doc.addPage();
  addSection(doc, 'Executive Summary');
  sectionHeader(doc, '1. Executive Summary');

  highlightBox(doc, 'Key Finding: Flight schools can dominate local search and reach aspiring pilots through a three-phase, zero-to-low-cost strategy combining free directories, community engagement, and organic social media. Data shows 50–300+ qualified phone calls per month from properly optimized local SEO alone, compared to 30–80 calls from $5K/month paid ads.');

  doc.moveDown(0.3);
  subHeader(doc, 'Three Highest-Impact Channels (Free to Start)');

  bulletList(doc, [
    'Google Business Profile + Local SEO — 50–300+ calls/month at $0 marginal cost. Fastest ROI.',
    'Reddit Communities + Forums — r/flying (457K), r/studentpilot (100K+), AOPA forums. $0 cost, 3–5% organic conversion, high-intent audience.',
    'TikTok + YouTube Short-Form Video — 60% of cadets use TikTok/Instagram as search engines. Repurpose one 10-min YouTube tutorial into 5–7 short-form clips. Viral potential + SEO value.',
  ]);

  doc.moveDown(0.3);
  subHeader(doc, 'Execution Timeline');
  bodyText(doc, '2-week local SEO setup → 4-week community engagement → 8–12 week organic ramp (first results visible). By week 8, expect 8–20 signups/week from free channels alone.');

  // ---- SECTION 2: FREE/LOW-COST DIRECTORIES ----
  doc.addPage();
  addSection(doc, 'Free/Low-Cost Directories');
  sectionHeader(doc, '2. Free/Low-Cost Directories');

  subHeader(doc, 'Primary Directories');

  drawTable(doc,
    ['Directory', 'Cost', 'Reach', 'Setup', 'Key Features'],
    [
      ['AOPA Flight School Finder', 'FREE', '457K+ members', '30 min', 'Searchable by state, ZIP, radius. Must be FAA-certified.'],
      ['AOPA College Directory', 'FREE', '457K+ members', '30 min', 'Lists aviation programs with flight training.'],
      ['Google Business Profile', 'FREE', '38%+ local queries', '1–2 wks', 'Maps, Search, AI Overviews. 50–300 calls/mo.'],
      ['Yelp', 'FREE', '150M+ monthly visitors', '20 min', 'Lists by Flight School, Aviation Training.'],
      ['YellowPages', 'FREE', '50M+ local searches', '20 min', 'Verify/claim listing, ensure NAP accuracy.'],
      ['Aviation Directories', 'FREE', '10–50K per directory', 'Varies', 'Flight Schools USA, AirNav, FAA Part 141 list.'],
      ['VA Aviation Association', 'FREE', '~5K VA pilots', '45 min', 'State association for local authority boost.'],
      ['Google/Apple Maps', 'FREE', '100M+ location searches', 'Auto', 'Syncs with GBP once verified.'],
    ],
    [120, 40, 90, 50, CONTENT_WIDTH - 300]
  );

  doc.moveDown(0.5);
  subHeader(doc, 'Implementation Checklist (Week 1–2)');

  checklist(doc, [
    'Claim/verify Google Business Profile with exact NAP from FAA records',
    'Primary category: "Flight School" + secondary: "Aviation Training"',
    'Upload 15–20 high-quality photos (aircraft fleet, classroom, hangar, students, instructors)',
    'Add 1–2 videos (30–60 sec facility walkthrough, student testimonial)',
    'Create first 3 Google Posts (events, scholarship, enrollment deadline)',
    'Enable online scheduling or appointment booking link',
    'Submit to Yelp, YellowPages, MerchantCircle — consistent NAP across all',
    'Register with Virginia Aviation Association',
  ]);

  // ---- SECTION 3: AVIATION COMMUNITIES & FORUMS ----
  doc.addPage();
  addSection(doc, 'Aviation Communities & Forums');
  sectionHeader(doc, '3. Aviation Communities & Forums');

  subHeader(doc, 'High-Intent Communities');

  drawTable(doc,
    ['Platform', 'Audience', 'Model', 'Effort/wk', 'Expected Outcomes'],
    [
      ['r/flying', '457K members', 'Self-promo Thu + educational', '2–3 hrs', '30–50 upvotes = 500–1.5K clicks; 2–3 leads/mo'],
      ['r/studentpilot', '100K+ members', 'High on "choosing a school"', '2–3 hrs', 'Entry-level audience; 2–3 leads/mo'],
      ['r/FlightTraining', '50K+ members', 'Flight training Q&A', '1–2 hrs', '15–30 upvotes = 200–400 clicks; 1–2 leads/mo'],
      ['AOPA Forums', '20–30K active', 'Free membership; slower', '1–2 hrs', '5–15 responses; highly qualified leads'],
      ['PPRuNe', '100K+ members', 'Professional pilots', '2–3 hrs', 'Lower volume, highest quality'],
      ['Aviation Discord', '5–20K/server', 'Real-time chat', '2–5 hrs', 'Direct recruitment; fast feedback'],
      ['Facebook Groups', '10–100K/group', 'Parents + aspiring pilots', '1–2 hrs', '5–20 leads/mo'],
    ],
    [90, 75, 105, 55, CONTENT_WIDTH - 325]
  );

  doc.moveDown(0.5);
  subHeader(doc, 'Execution Strategy (Weeks 3–4)');

  highlightBox(doc, 'DO NOT PITCH DIRECTLY. Answer 3–5 questions/week without promoting. Build credibility first.', '#FFF0E0');

  bodyText(doc, 'Week 3, Day 1–7: Identify top threads on r/flying, r/studentpilot. Search "flight school," "choosing a school," "pilot training cost." Post helpful, data-backed answers with 2–3 sources. No CTA.');
  bodyText(doc, 'Week 3, Day 8–14: Share a case study (soft pitch). "Here\'s what flight school retention looks like..." Link to blog post. Expected: 20–50 upvotes, 3–8 DMs.');
  bodyText(doc, 'Week 3–4, Day 15–28: Continue answering + post 1 self-promo in Thursday megathread on r/flying. Expected: 30–100 upvotes, 10–20 comments, 2–5 qualified leads.');
  bodyText(doc, 'Ongoing (Weeks 5+): 1 thoughtful comment per day. 1 case-study post per week. Monitor "school recommendation" threads — respond within 2 hours.');

  // ---- SECTION 4: SEO KEYWORD ANALYSIS ----
  doc.addPage();
  addSection(doc, 'SEO Keyword Analysis');
  sectionHeader(doc, '4. SEO Keyword Analysis');

  subHeader(doc, 'High-Intent Search Keywords');

  drawTable(doc,
    ['Search Query', 'Monthly Volume', 'Intent', 'Content Angle', 'Difficulty'],
    [
      ['"how to become a pilot"', '60K+', 'Discovery', 'Multi-stage pathway, cost overview', 'Easy'],
      ['"pilot training cost 2026"', '35K+', 'Comparing', 'Itemized costs, financing options', 'Medium'],
      ['"flight school near me"', '28K+', 'Local', 'Map pack + directory ranking', 'Medium'],
      ['"cheapest way to get license"', '18K+', 'Budget', 'Part 61 vs 141 cost comparison', 'Medium'],
      ['"student pilot requirements"', '12K+', 'Eligibility', 'Medical, age, written test', 'Easy'],
      ['"PPL cost Virginia"', '3–5K', 'Local', 'State-specific costs, local jobs', 'Medium'],
      ['"commercial pilot training"', '8K+', 'Career', 'Career path, timeline, financing', 'Medium'],
      ['"pilot medical certificate"', '15K+', 'Compliance', 'Medical requirements, application', 'Easy'],
      ['"degree needed for pilot?"', '12K+', 'Eligibility', 'Degree vs non-degree paths', 'Easy'],
      ['"flight school financing"', '5K+', 'Solving barrier', 'Loans, cadet programs, payment plans', 'Medium'],
    ],
    [130, 60, 55, 140, CONTENT_WIDTH - 385]
  );

  doc.moveDown(0.5);
  subHeader(doc, 'Recommended Blog Posts');

  bodyText(doc, 'Phase 1 (Weeks 1–4):');
  bulletList(doc, [
    '"How to Become a Pilot: Complete 2026 Roadmap" (2,500 words) — Target: 200–500 organic clicks/month',
    '"Private Pilot License Cost Breakdown: Virginia" (1,500 words) — Target: 100–200 organic clicks/month',
    '"Medical Certificate for Pilots: What You Need to Know" (1,200 words) — Target: 150–300 clicks/month',
  ]);

  bodyText(doc, 'Phase 2 (Weeks 5–12):');
  bulletList(doc, [
    '"Flight School Financing: Loans, Cadet Programs, and Payment Plans" (1,800 words)',
    '"Part 61 vs Part 141: Which Flight School Type Is Right for You?" (1,600 words)',
    '"Can You Become a Pilot Without a Degree?" (1,200 words)',
    '"Commercial Pilot License: Cost, Timeline, and Career Outlook" (1,500 words)',
  ]);

  // ---- SECTION 5: SOCIAL MEDIA & INFLUENCERS ----
  doc.addPage();
  addSection(doc, 'Social Media & Influencers');
  sectionHeader(doc, '5. Social Media & Influencer Strategy');

  subHeader(doc, 'Platform-Specific Content Strategy');

  drawTable(doc,
    ['Platform', 'Best For', 'Content Pillars', 'Frequency', 'Growth Tactics'],
    [
      ['YouTube', 'Search + evergreen', 'Technical, career, milestones', '1–2 videos/wk', 'SEO titles, timestamps, promote on TikTok'],
      ['TikTok', 'Discovery + viral', 'Quick tips, BTS, cockpit POV', '3–5 posts/day', 'Trending sounds, student takeover series'],
      ['Instagram', 'Community + visual', 'Carousels, spotlights, live Q&A', '4–5/wk + stories', 'Save-able carousels, monthly giveaways'],
    ],
    [70, 85, 130, 80, CONTENT_WIDTH - 365]
  );

  doc.moveDown(0.5);
  subHeader(doc, 'Content Themes That Drive Enrollment');

  bulletList(doc, [
    'Cost Transparency — "Real Cost Breakdown: What Flight Training Actually Costs" (35K+ searches/month)',
    'Timeline & Realism — "How Long Does It Really Take to Get a Pilot License?" (people want timelines)',
    'Path Clarity for Beginners — "Private vs Instrument vs Commercial: Which Rating First?"',
    'Student Testimonials — "First Solo!" TikToks, "Day in the Life" vlogs (peer validation for Gen Z)',
    'Medical & Eligibility — "FAA Medical Certificate: What Disqualifies You?" (15K+ searches/month)',
    'Instructor Spotlights — "Meet the Team: CFI Interviews" (humanizes your school, builds connection)',
  ]);

  doc.moveDown(0.3);
  subHeader(doc, 'Influencer Partnerships (Low-Cost)');

  drawTable(doc,
    ['Influencer', 'Following', 'Platform', 'Outreach Model'],
    [
      ['@flywithcaptainjoe', '579K IG + YouTube', 'Instagram, YouTube', 'Co-created lesson or "pilot swap" day'],
      ['@pilot_johnnie', '418K IG', 'Instagram', 'Free flight or co-produced video'],
      ['@flywithmat', '414K IG + 451K TikTok', 'Instagram, TikTok', 'Co-produced YouTube video (10–15 min)'],
      ['@pilotoncall', '209K IG', 'Instagram', 'Co-produced content'],
      ['Damion Bailey', '1.5M total', 'TikTok, IG, YouTube', 'Aviation travel content collaboration'],
    ],
    [110, 110, 100, CONTENT_WIDTH - 320]
  );

  bodyText(doc, 'Expected: 2–5 macro influencer collaborations/year = 50–200K views per collab, 5–20 qualified leads per collaboration.');

  // ---- SECTION 6: LOCAL SEO TACTICS ----
  doc.addPage();
  addSection(doc, 'Local SEO Tactics (Virginia)');
  sectionHeader(doc, '6. Local SEO Tactics (Virginia Focus)');

  subHeader(doc, 'Google Business Profile Optimization');

  bodyText(doc, 'Core Setup (Week 1):');
  checklist(doc, [
    'Verify profile; use exact NAP from official FAA records',
    'Primary category: "Flight School" — Secondary: "Aviation Training," "Pilot Training"',
    'Upload 15–20 high-quality photos (aircraft, classrooms, hangars, instructors, students)',
    'Add 1–2 videos (facility walkthrough 30–60 sec, student testimonial)',
    'Create Service Areas: list all Virginia cities served',
  ]);

  bodyText(doc, 'Ongoing Maintenance (Weekly):');
  checklist(doc, [
    'Publish 1–2 Google Posts per week (enrollment deadlines, pilot tips)',
    'Upload 3 new photos/week (student milestones, aircraft, facility updates)',
    'Respond to ALL reviews within 24 hours',
    'Ask every graduate to leave a Google review (provide QR code link)',
  ]);

  doc.moveDown(0.3);
  subHeader(doc, 'Local SEO Ranking Factors (2026)');

  drawTable(doc,
    ['Factor', 'Weight', 'Action'],
    [
      ['NAP Consistency', '40%', 'Consistent name/address/phone across all citation sites'],
      ['Review Volume & Quality', '25%', 'Target 4.5–5 stars; respond to all reviews'],
      ['GBP Completeness', '20%', 'Photos, videos, posts, services, attributes'],
      ['Local Citation Authority', '15%', 'VA Aviation Association + local news + chamber'],
    ],
    [130, 50, CONTENT_WIDTH - 180]
  );

  doc.moveDown(0.3);
  subHeader(doc, 'Dedicated Local Landing Pages');
  bulletList(doc, [
    'Create separate pages for each city/region served',
    'Examples: /flight-training-richmond-va, /pilot-training-virginia-beach, /flight-school-roanoke',
    'Include local keywords, local instructor testimonials, nearby airports, community events',
    'Link from GBP "Service Areas" section',
  ]);

  doc.moveDown(0.3);
  subHeader(doc, 'Expected Results');
  drawTable(doc,
    ['Timeline', 'Milestone'],
    [
      ['Week 2', 'GBP fully optimized, first Google Posts published'],
      ['Week 4', 'Review count starts climbing'],
      ['Week 8', 'Appearing in "Flight School Near Me" map packs'],
      ['Month 3', 'Generating 30–50 phone calls/month from local search'],
      ['Month 6', 'Generating 50–150+ phone calls/month (fully optimized)'],
    ],
    [100, CONTENT_WIDTH - 100]
  );

  // ---- SECTION 7: COST BREAKDOWN ----
  doc.addPage();
  addSection(doc, 'Cost Breakdown');
  sectionHeader(doc, '7. Cost Breakdown');

  subHeader(doc, 'Channel-by-Channel Costs & Expected Returns');

  drawTable(doc,
    ['Channel', 'Setup Cost', 'Monthly Cost', 'Expected Leads/Mo (Month 6)'],
    [
      ['Google Business Profile', '$0', '$0', '50–150'],
      ['Blog + SEO', '$0 (DIY) or $500–1K', '$0–500/mo', '30–100'],
      ['YouTube', '$0', '$0–500/mo (editor optional)', '10–30'],
      ['TikTok / Instagram', '$0', '$0–200/mo (scheduler)', '20–50'],
      ['Reddit / Forums', '$0', '$0 (5–10 hrs/week)', '10–20'],
      ['AOPA / Directory Citations', '$0', '$0', '5–15'],
      ['TOTAL', '$0–$1,500', '$0–$1,200/month', '125–365 leads/month'],
    ],
    [125, 100, 125, CONTENT_WIDTH - 350]
  );

  doc.moveDown(0.5);
  highlightBox(doc, 'Comparison: Traditional Google Ads (pilot training) costs $50–100 per click. 365 leads from organic = $18,250–$36,500 in equivalent ad spend — at zero ongoing cost.');

  // ---- SECTION 8: 12-WEEK ACTION PLAN ----
  doc.addPage();
  addSection(doc, '12-Week Action Plan');
  sectionHeader(doc, '8. 12-Week Action Plan');

  subHeader(doc, 'Weeks 1–2: Local SEO Foundation');
  checklist(doc, [
    'Claim + fully optimize Google Business Profile',
    'Submit to 5–7 citation sites (Yelp, YellowPages, VA Aviation Association)',
    'Upload 15–20 GBP photos + 2 videos',
    'Create first 3 Google Posts',
  ]);
  bodyText(doc, 'Expected Output: GBP 100% complete; ready for review velocity.');

  doc.moveDown(0.3);
  subHeader(doc, 'Weeks 3–4: Community Engagement + Blog Launch');
  checklist(doc, [
    'Start posting in r/flying, r/studentpilot (no direct pitch yet)',
    'Publish first blog post: "How to Become a Pilot: 2026 Roadmap"',
    'Create YouTube channel + upload first tutorial (10 min)',
    'Start Instagram / TikTok accounts',
  ]);
  bodyText(doc, 'Expected Output: 2–3 community threads answered, 1 blog post indexed, 1 YouTube video live.');

  doc.moveDown(0.3);
  subHeader(doc, 'Weeks 5–8: Content Ramp + Community Authority');
  checklist(doc, [
    'Publish blog post #2: "Private Pilot License Cost (Virginia)"',
    'Publish 2–3 YouTube tutorials (aim: 1–2/week)',
    'Post 3–5 TikToks/day (tips + behind-the-scenes)',
    'Post 4–5 Instagram posts/week',
    'Answer 3–5 Reddit questions/week (no pitch)',
    'Respond to 100% of Google reviews',
  ]);
  bodyText(doc, 'Expected Output: 8–20 organic leads, blog ranking page 2–3, YouTube 50–100 subs, TikTok 500–1K followers.');

  doc.moveDown(0.3);
  subHeader(doc, 'Weeks 9–12: Lead Generation + Optimization');
  checklist(doc, [
    'Publish blog post #3: "Medical Certificate for Pilots"',
    'Launch 1 Reddit self-promo (Thursday megathread)',
    'Optimize blog titles + meta descriptions based on rankings',
    'Continue 1–2 YouTube videos/week',
    'Continue TikTok 3–5/day, Instagram 4–5/week',
    'Update blog #1 with 2026 data + internal links',
  ]);
  bodyText(doc, 'Expected Output: 30–80 organic leads, blog #1 ranking page 1, YouTube 200–500 subs, TikTok 2–5K followers.');

  // ---- SECTION 9: SUCCESS METRICS ----
  doc.addPage();
  addSection(doc, 'Success Metrics & Tracking');
  sectionHeader(doc, '9. Success Metrics & Tracking');

  subHeader(doc, 'Month 1 (Week 4)');
  checklist(doc, [
    'GBP fully optimized, 10+ posts published',
    'Blog post #1 indexed',
    'Reddit: 50+ upvotes on first answer',
    'YouTube: 50+ subs, 200+ views on first video',
    'TikTok: 500+ followers',
  ]);

  subHeader(doc, 'Month 3 (Week 12)');
  checklist(doc, [
    'GBP generating 30–50 calls/month',
    'Blog #1 ranking page 1–2 for target keyword',
    '3 blog posts published',
    'YouTube: 200–500 subs, 500–1.5K views per video',
    'TikTok: 2–5K followers, 20K+ total views',
    '30–80 organic leads from all channels combined',
  ]);

  subHeader(doc, 'Month 6 (Week 24)');
  checklist(doc, [
    'GBP generating 50–150 calls/month',
    '6–8 blog posts published, multiple ranking page 1',
    'YouTube: 500–1.5K subs, consistent 1–3K views per video',
    'TikTok: 5–10K followers, 50K+ total views',
    'Instagram: 1–3K followers',
    'Reddit: regular community contributor (5–15 leads/month)',
    'Total: 125–365 leads/month from organic channels',
  ]);

  doc.moveDown(0.5);
  subHeader(doc, 'Recommended Execution Order');

  drawTable(doc,
    ['Priority', 'Channel', 'When', 'Expected Impact'],
    [
      ['1', 'Google Business Profile', 'Week 1', '50–300 calls/mo at $0'],
      ['2', 'Blog + SEO', 'Week 3', '30–100 leads/mo by month 4'],
      ['3', 'Reddit Communities', 'Week 3', 'High-intent, quick wins'],
      ['4', 'TikTok + YouTube', 'Week 5', '20–50 leads/mo, viral potential'],
      ['5', 'Instagram', 'Week 8', 'Community building post-engagement'],
      ['6', 'Influencer Outreach', 'Week 12', '50–200K views per collab'],
    ],
    [50, 140, 70, CONTENT_WIDTH - 260]
  );

  doc.moveDown(0.5);
  highlightBox(doc, 'The Flywheel Effect: By month 6, these channels feed each other — blog posts build SEO authority, YouTube tutorials become TikTok clips, Reddit answers prove expertise and link to blog, GBP reviews create social proof, and student testimonials fuel Instagram/TikTok content. No paid ads needed.');

  // ---- NOW FILL IN TOC ----
  doc.switchToPage(tocPageIndex);
  doc.y = tocStartY;
  doc.fontSize(11).font('Helvetica');

  tocEntries.forEach((entry, idx) => {
    const lineY = doc.y;
    // Section number + title on one line
    doc.font('Helvetica-Bold').fontSize(11).fillColor(NAVY);
    const label = `${idx + 1}.  ${entry.title}`;
    doc.text(label, MARGIN, lineY, { width: CONTENT_WIDTH - 50, lineBreak: false });
    // Dotted leader + page number on right
    doc.font('Helvetica-Bold').fontSize(11).fillColor(AMBER);
    doc.text(`${entry.page - 1}`, MARGIN, lineY, { width: CONTENT_WIDTH, align: 'right', lineBreak: false });
    doc.y = lineY + 20;
  });

  // ---- ADD FOOTERS ----
  addFooter(doc);

  doc.end();

  return new Promise((resolve, reject) => {
    stream.on('finish', () => {
      const stats = fs.statSync(outputPath);
      console.log(`PDF generated: ${outputPath} (${(stats.size / 1024).toFixed(1)} KB)`);
      resolve(outputPath);
    });
    stream.on('error', reject);
  });
}

buildPDF().catch(err => {
  console.error('PDF generation failed:', err);
  process.exit(1);
});
