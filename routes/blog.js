// blog.js — Public blog routes: /blog listing + /blog/:slug individual articles
// Owns: static SEO article pages for pilot education content
// Does NOT own: CMS content, authenticated app routes, API endpoints

const express = require('express');
const router = express.Router();
const path = require('path');

const BASE_URL = 'https://www.newtechaviation.com';
const PUB_DATE_COST = '2026-05-10';
const PUB_DATE_REQS = '2026-05-10';
const PUB_DATE_TIME = '2026-05-10';
const PUB_DATE_DISCOVERY = '2026-05-19';
const PUB_DATE_VIRGINIA = '2026-05-19';

const ARTICLES = [
  {
    slug: 'how-much-does-it-cost-to-become-a-pilot',
    title: 'How Much Does It Cost to Become a Pilot in 2026?',
    excerpt: 'A complete breakdown of private pilot license costs — aircraft rental, instructor fees, exam fees, medical, and hidden costs most schools don\'t tell you about.',
    readTime: '8 min read',
    published: PUB_DATE_COST,
    category: 'Pilot Training',
    keywords: 'pilot training cost, how much does it cost to become a pilot, PPL cost 2026',
    description: 'Get the full breakdown of what it costs to become a private pilot in 2026 — aircraft rental, instructor fees, medical, written test, checkride, and tips to reduce your total cost.',
  },
  {
    slug: 'student-pilot-requirements',
    title: 'Student Pilot Requirements: Everything You Need Before Your First Lesson',
    excerpt: 'Age, medical certificate, English proficiency, and documents — here\'s exactly what the FAA requires before you can fly solo as a student pilot.',
    readTime: '6 min read',
    published: PUB_DATE_REQS,
    category: 'Getting Started',
    keywords: 'student pilot requirements, FAA student pilot certificate, how to start flight training',
    description: 'Complete guide to FAA student pilot requirements: minimum age, medical certificate classes, English requirements, and what paperwork you need before your first solo flight.',
  },
  {
    slug: 'private-pilot-license-timeline',
    title: 'Private Pilot License Timeline: How Long Does It Really Take?',
    excerpt: 'The FAA minimum is 40 hours. The national average is 60–70. Here\'s what actually determines how long it takes — and how to make it shorter.',
    readTime: '7 min read',
    published: PUB_DATE_TIME,
    category: 'Pilot Training',
    keywords: 'how long to get pilot license, private pilot license timeline, PPL timeline',
    description: 'Realistic private pilot license timeline: FAA minimums vs. national averages, factors that speed or slow progress, part-time vs. full-time training, and what to expect at New Tech Aviation.',
  },
  {
    slug: 'discovery-flight',
    title: 'What to Expect on Your First Discovery Flight',
    excerpt: 'A discovery flight is a 20-minute introductory lesson where you actually take the controls. Here\'s exactly what happens, what it costs, and how to prepare.',
    readTime: '6 min read',
    published: PUB_DATE_DISCOVERY,
    category: 'Getting Started',
    keywords: 'discovery flight, what is a discovery flight, intro flight lesson, first flight lesson',
    description: 'Everything you need to know about your first discovery flight: what to expect, how long it takes, what it costs, what to wear, and how to book one at New Tech Aviation in Virginia.',
  },
  {
    slug: 'learn-to-fly-virginia',
    title: 'Learn to Fly in Virginia: Your Complete Guide to Flight Training',
    excerpt: 'Virginia has great weather, scenic terrain, and several flight schools — but not all are equal. Here\'s how to choose the right one and what flight training actually costs in VA.',
    readTime: '8 min read',
    published: PUB_DATE_VIRGINIA,
    category: 'Flight Schools',
    keywords: 'learn to fly Virginia, flight school Virginia, pilot training Virginia, flight training VA',
    description: 'Complete guide to learning to fly in Virginia: costs, FAA requirements, timeline, how to choose a flight school, and why New Tech Aviation at KPSK is an ideal choice for New River Valley students.',
  },
];

// Shared layout wrapper for all blog pages
function blogLayout({ title, description, keywords, canonical, og, schema, content, breadcrumbs }) {
  const logoUrl = 'https://pub-629428d185ca4960a0a73c850d32294b.r2.dev/company_96457/images/6131da51-11d1-4327-8e6f-470c3e242f0b.png?v=2';
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <meta name="description" content="${description}">
  <meta name="keywords" content="${keywords}">
  <meta name="robots" content="index, follow, max-image-preview:large">
  <link rel="canonical" href="${canonical}">

  <!-- Open Graph -->
  <meta property="og:title" content="${og.title}">
  <meta property="og:description" content="${og.description}">
  <meta property="og:type" content="${og.type || 'article'}">
  <meta property="og:url" content="${og.url}">
  <meta property="og:site_name" content="New Tech Aviation">
  <meta property="og:image" content="${logoUrl}">
  <meta property="og:image:alt" content="New Tech Aviation — Flight School in New River Valley, VA">

  <!-- Twitter Card -->
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${og.title}">
  <meta name="twitter:description" content="${og.description}">
  <meta name="twitter:image" content="${logoUrl}">

  <!-- Schema.org -->
  <script type="application/ld+json">${JSON.stringify(schema)}</script>

  <!-- Favicon -->
  <link rel="icon" type="image/png" sizes="32x32" href="${logoUrl}">
  <link rel="apple-touch-icon" sizes="180x180" href="${logoUrl}">
  <meta name="theme-color" content="#0F1D2F">

  <!-- Fonts -->
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Satoshi:wght@400;500;600;700&display=swap" rel="stylesheet">

  <style>
    *, *::before, *::after { margin: 0; padding: 0; box-sizing: border-box; }

    :root {
      --navy: #0F1D2F;
      --navy-light: #1A2D45;
      --navy-mid: #152338;
      --blue: #2563EB;
      --blue-light: #3B82F6;
      --sky: #0EA5E9;
      --amber: #D97706;
      --amber-light: #F59E0B;
      --white: #FFFFFF;
      --off-white: #F8FAFC;
      --warm-white: #FAFAF8;
      --gray-50: #F1F5F9;
      --gray-100: #E2E8F0;
      --gray-200: #CBD5E1;
      --gray-300: #94A3B8;
      --gray-400: #64748B;
      --gray-500: #475569;
      --gray-600: #334155;
      --gray-700: #1E293B;
      --font: 'Satoshi', -apple-system, BlinkMacSystemFont, sans-serif;
      --font-serif: 'Instrument Serif', Georgia, serif;
    }

    html { scroll-behavior: smooth; }

    body {
      font-family: var(--font);
      background: var(--warm-white);
      color: var(--gray-700);
      line-height: 1.7;
      -webkit-font-smoothing: antialiased;
    }

    /* ── NAV ── */
    .nav {
      background: var(--navy);
      padding: 0 2rem;
      position: sticky;
      top: 0;
      z-index: 100;
      box-shadow: 0 1px 0 rgba(255,255,255,0.06);
    }
    .nav-inner {
      max-width: 1100px;
      margin: 0 auto;
      display: flex;
      align-items: center;
      justify-content: space-between;
      height: 64px;
    }
    .nav-logo {
      display: flex;
      align-items: center;
      gap: 10px;
      text-decoration: none;
    }
    .nav-logo img { height: 34px; width: auto; }
    .nav-logo-text {
      color: var(--white);
      font-weight: 600;
      font-size: 0.95rem;
      letter-spacing: -0.01em;
      line-height: 1.2;
    }
    .nav-logo-sub {
      color: var(--gray-300);
      font-size: 0.72rem;
      font-weight: 400;
      display: block;
    }
    .nav-links {
      display: flex;
      align-items: center;
      gap: 0.25rem;
    }
    .nav-links a {
      color: var(--gray-200);
      text-decoration: none;
      font-size: 0.875rem;
      font-weight: 500;
      padding: 0.5rem 0.75rem;
      border-radius: 6px;
      transition: color 0.2s, background 0.2s;
    }
    .nav-links a:hover { color: var(--white); background: rgba(255,255,255,0.08); }
    .nav-links .nav-cta {
      background: var(--blue);
      color: var(--white);
      padding: 0.5rem 1.1rem;
      margin-left: 0.5rem;
    }
    .nav-links .nav-cta:hover { background: var(--blue-light); }

    /* ── BREADCRUMB ── */
    .breadcrumb-bar {
      background: var(--gray-50);
      border-bottom: 1px solid var(--gray-100);
      padding: 0.6rem 2rem;
    }
    .breadcrumb-inner {
      max-width: 1100px;
      margin: 0 auto;
    }
    .breadcrumb {
      display: flex;
      align-items: center;
      gap: 0.4rem;
      font-size: 0.8rem;
      color: var(--gray-400);
    }
    .breadcrumb a {
      color: var(--gray-400);
      text-decoration: none;
      transition: color 0.15s;
    }
    .breadcrumb a:hover { color: var(--blue); }
    .breadcrumb-sep { color: var(--gray-300); }
    .breadcrumb-current { color: var(--gray-600); font-weight: 500; }

    /* ── FOOTER ── */
    footer {
      background: var(--navy);
      color: var(--gray-300);
      padding: 3rem 2rem 2rem;
      margin-top: 5rem;
    }
    .footer-inner {
      max-width: 1100px;
      margin: 0 auto;
      display: grid;
      grid-template-columns: 1.5fr 1fr 1fr;
      gap: 3rem;
    }
    .footer-brand .footer-logo {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-bottom: 0.75rem;
      text-decoration: none;
    }
    .footer-brand .footer-logo img { height: 32px; }
    .footer-brand .footer-logo-text { color: var(--white); font-weight: 600; font-size: 0.9rem; }
    .footer-brand p { font-size: 0.85rem; line-height: 1.6; color: var(--gray-400); }
    .footer-col h4 { color: var(--gray-200); font-size: 0.8rem; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; margin-bottom: 0.9rem; }
    .footer-col ul { list-style: none; }
    .footer-col ul li { margin-bottom: 0.5rem; }
    .footer-col ul li a { color: var(--gray-400); text-decoration: none; font-size: 0.85rem; transition: color 0.15s; }
    .footer-col ul li a:hover { color: var(--white); }
    .footer-bottom {
      max-width: 1100px;
      margin: 2rem auto 0;
      padding-top: 1.5rem;
      border-top: 1px solid rgba(255,255,255,0.08);
      display: flex;
      align-items: center;
      justify-content: space-between;
      font-size: 0.8rem;
      color: var(--gray-500);
    }

    @media (max-width: 768px) {
      .footer-inner { grid-template-columns: 1fr; gap: 2rem; }
      .footer-bottom { flex-direction: column; gap: 0.5rem; text-align: center; }
      .nav-links a:not(.nav-cta) { display: none; }
    }
  </style>
</head>
<body>

<!-- Navigation -->
<nav class="nav">
  <div class="nav-inner">
    <a href="/" class="nav-logo">
      <img src="${logoUrl}" alt="New Tech Aviation">
      <div class="nav-logo-text">
        New Tech Aviation
        <span class="nav-logo-sub">KPSK · New River Valley, VA</span>
      </div>
    </a>
    <div class="nav-links">
      <a href="/#programs">Programs</a>
      <a href="/#fleet">Fleet</a>
      <a href="/blog">Blog</a>
      <a href="/book-discovery-flight" class="nav-cta">Book a Flight</a>
    </div>
  </div>
</nav>

<!-- Breadcrumb -->
<div class="breadcrumb-bar">
  <div class="breadcrumb-inner">
    <nav class="breadcrumb" aria-label="Breadcrumb">
      ${breadcrumbs}
    </nav>
  </div>
</div>

<!-- Page Content -->
${content}

<!-- Footer -->
<footer>
  <div class="footer-inner">
    <div class="footer-brand">
      <a href="/" class="footer-logo">
        <img src="${logoUrl}" alt="New Tech Aviation">
        <span class="footer-logo-text">New Tech Aviation</span>
      </a>
      <p>Flight training in New River Valley, Virginia. Private Pilot, Instrument Rating, and Commercial certificates. Based at KPSK (Dublin, VA).</p>
    </div>
    <div class="footer-col">
      <h4>Training</h4>
      <ul>
        <li><a href="/#programs">Private Pilot (PPL)</a></li>
        <li><a href="/#programs">Instrument Rating (IFR)</a></li>
        <li><a href="/#programs">Commercial Pilot</a></li>
        <li><a href="/#programs">Discovery Flight</a></li>
      </ul>
    </div>
    <div class="footer-col">
      <h4>Resources</h4>
      <ul>
        <li><a href="/blog">Pilot Blog</a></li>
        <li><a href="/blog/discovery-flight">Discovery Flight Guide</a></li>
        <li><a href="/blog/learn-to-fly-virginia">Learn to Fly in Virginia</a></li>
        <li><a href="/blog/how-much-does-it-cost-to-become-a-pilot">Pilot Training Cost</a></li>
        <li><a href="/blog/student-pilot-requirements">Student Pilot Requirements</a></li>
        <li><a href="/blog/private-pilot-license-timeline">PPL Timeline</a></li>
      </ul>
    </div>
  </div>
  <div class="footer-bottom">
    <span>© ${new Date().getFullYear()} New Tech Aviation · KPSK, Dublin, VA 24084</span>
    <span>Part 61 Flight School · FAA Registered</span>
  </div>
</footer>

</body>
</html>`;
}

// ─── BLOG LISTING ──────────────────────────────────────────
router.get('/', (req, res) => {
  const schema = {
    '@context': 'https://schema.org',
    '@type': 'Blog',
    name: 'New Tech Aviation — Pilot Education Blog',
    description: 'Flight training guides, pilot requirements, and aviation education resources from New Tech Aviation in New River Valley, Virginia.',
    url: `${BASE_URL}/blog`,
    publisher: {
      '@type': 'Organization',
      name: 'New Tech Aviation',
      url: BASE_URL,
      logo: { '@type': 'ImageObject', url: 'https://pub-629428d185ca4960a0a73c850d32294b.r2.dev/company_96457/images/6131da51-11d1-4327-8e6f-470c3e242f0b.png?v=2' }
    }
  };

  const cards = ARTICLES.map(a => `
    <article class="blog-card">
      <div class="card-category">${a.category}</div>
      <h2 class="card-title"><a href="/blog/${a.slug}">${a.title}</a></h2>
      <p class="card-excerpt">${a.excerpt}</p>
      <div class="card-meta">
        <span class="card-date">${formatDate(a.published)}</span>
        <span class="card-dot">·</span>
        <span class="card-read">${a.readTime}</span>
      </div>
      <a href="/blog/${a.slug}" class="card-link">Read article →</a>
    </article>
  `).join('');

  const content = `
    <style>
      .blog-hero {
        background: linear-gradient(160deg, var(--navy) 0%, var(--navy-light) 100%);
        padding: 5rem 2rem 4rem;
        text-align: center;
      }
      .blog-hero-label {
        display: inline-block;
        background: rgba(37, 99, 235, 0.25);
        color: var(--sky);
        font-size: 0.75rem;
        font-weight: 600;
        letter-spacing: 0.1em;
        text-transform: uppercase;
        padding: 0.35rem 0.9rem;
        border-radius: 100px;
        border: 1px solid rgba(14, 165, 233, 0.2);
        margin-bottom: 1.25rem;
      }
      .blog-hero h1 {
        font-family: var(--font-serif);
        font-size: clamp(2rem, 5vw, 3rem);
        color: var(--white);
        font-weight: normal;
        line-height: 1.15;
        max-width: 600px;
        margin: 0 auto 1rem;
      }
      .blog-hero p {
        color: var(--gray-300);
        font-size: 1.05rem;
        max-width: 520px;
        margin: 0 auto;
      }
      .blog-grid {
        max-width: 1100px;
        margin: 4rem auto;
        padding: 0 2rem;
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
        gap: 2rem;
      }
      .blog-card {
        background: var(--white);
        border: 1px solid var(--gray-100);
        border-radius: 12px;
        padding: 2rem;
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
        transition: box-shadow 0.2s, transform 0.2s, border-color 0.2s;
      }
      .blog-card:hover {
        box-shadow: 0 8px 32px rgba(15, 29, 47, 0.1);
        transform: translateY(-2px);
        border-color: var(--gray-200);
      }
      .card-category {
        font-size: 0.72rem;
        font-weight: 700;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: var(--blue);
      }
      .card-title {
        font-family: var(--font-serif);
        font-size: 1.3rem;
        font-weight: normal;
        line-height: 1.3;
        flex: 1;
      }
      .card-title a {
        color: var(--navy);
        text-decoration: none;
        transition: color 0.15s;
      }
      .card-title a:hover { color: var(--blue); }
      .card-excerpt {
        font-size: 0.9rem;
        color: var(--gray-500);
        line-height: 1.65;
      }
      .card-meta {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        font-size: 0.8rem;
        color: var(--gray-400);
      }
      .card-dot { color: var(--gray-300); }
      .card-link {
        font-size: 0.85rem;
        font-weight: 600;
        color: var(--blue);
        text-decoration: none;
        display: inline-flex;
        align-items: center;
        gap: 0.25rem;
        transition: gap 0.15s;
        margin-top: 0.25rem;
      }
      .card-link:hover { gap: 0.5rem; }
      .blog-cta-section {
        background: var(--navy);
        text-align: center;
        padding: 4rem 2rem;
        margin-top: 2rem;
      }
      .blog-cta-section h2 {
        font-family: var(--font-serif);
        font-size: 2rem;
        color: var(--white);
        font-weight: normal;
        margin-bottom: 0.75rem;
      }
      .blog-cta-section p {
        color: var(--gray-300);
        margin-bottom: 2rem;
        font-size: 1rem;
        max-width: 480px;
        margin-left: auto;
        margin-right: auto;
        margin-bottom: 2rem;
      }
      .btn-primary {
        display: inline-block;
        background: var(--blue);
        color: var(--white);
        padding: 0.875rem 2rem;
        border-radius: 8px;
        text-decoration: none;
        font-weight: 600;
        font-size: 0.95rem;
        transition: background 0.2s, transform 0.15s;
      }
      .btn-primary:hover { background: var(--blue-light); transform: translateY(-1px); }
      @media (max-width: 640px) {
        .blog-grid { grid-template-columns: 1fr; }
      }
    </style>

    <header class="blog-hero">
      <span class="blog-hero-label">Pilot Education</span>
      <h1>Learn Everything About<br><em>Becoming a Pilot</em></h1>
      <p>Honest guides on flight training costs, requirements, and timelines — from the instructors at New Tech Aviation.</p>
    </header>

    <div class="blog-grid">
      ${cards}
    </div>

    <section class="blog-cta-section">
      <h2>Ready to Start Flying?</h2>
      <p>Discovery flights are the best way to see if aviation is right for you. 20 minutes in the air, with an instructor by your side.</p>
      <a href="/book-discovery-flight" class="btn-primary">Book a Discovery Flight</a>
    </section>
  `;

  const breadcrumbs = `
    <a href="/">Home</a>
    <span class="breadcrumb-sep">›</span>
    <span class="breadcrumb-current">Blog</span>
  `;

  res.set('Cache-Control', 'public, max-age=3600'); // 1 hour
  res.type('html').send(blogLayout({
    title: 'Pilot Training Blog — New Tech Aviation | New River Valley, VA',
    description: 'Honest guides on pilot training costs, student pilot requirements, and realistic timelines — from New Tech Aviation in New River Valley, Virginia.',
    keywords: 'pilot training blog, flight school Virginia, learn to fly, pilot education',
    canonical: `${BASE_URL}/blog`,
    og: {
      title: 'Pilot Training Blog — New Tech Aviation',
      description: 'Honest guides on pilot training costs, student requirements, and PPL timelines from New Tech Aviation in Virginia.',
      url: `${BASE_URL}/blog`,
      type: 'website',
    },
    schema,
    breadcrumbs,
    content,
  }));
});

// ─── INDIVIDUAL ARTICLE ROUTES ─────────────────────────────
router.get('/how-much-does-it-cost-to-become-a-pilot', (req, res) => {
  const article = ARTICLES[0];
  res.set('Cache-Control', 'public, max-age=3600');
  res.type('html').send(renderCostArticle(article));
});

router.get('/student-pilot-requirements', (req, res) => {
  const article = ARTICLES[1];
  res.set('Cache-Control', 'public, max-age=3600');
  res.type('html').send(renderRequirementsArticle(article));
});

router.get('/private-pilot-license-timeline', (req, res) => {
  const article = ARTICLES[2];
  res.set('Cache-Control', 'public, max-age=3600');
  res.type('html').send(renderTimelineArticle(article));
});

router.get('/discovery-flight', (req, res) => {
  const article = ARTICLES[3];
  res.set('Cache-Control', 'public, max-age=3600');
  res.type('html').send(renderDiscoveryFlightArticle(article));
});

router.get('/learn-to-fly-virginia', (req, res) => {
  const article = ARTICLES[4];
  res.set('Cache-Control', 'public, max-age=3600');
  res.type('html').send(renderLearnToFlyVirginiaArticle(article));
});

// 404 fallback for /blog/* slugs not found
router.get('/:slug', (req, res) => {
  res.redirect(301, '/blog');
});

// ─── ARTICLE RENDERERS ─────────────────────────────────────
function articleShell(article, bodyHtml, faqs) {
  const { slug, title, description, keywords, published, readTime, category } = article;
  const canonical = `${BASE_URL}/blog/${slug}`;
  const logoUrl = 'https://pub-629428d185ca4960a0a73c850d32294b.r2.dev/company_96457/images/6131da51-11d1-4327-8e6f-470c3e242f0b.png?v=2';

  const schema = [
    {
      '@context': 'https://schema.org',
      '@type': 'Article',
      headline: title,
      description,
      datePublished: published,
      dateModified: published,
      author: {
        '@type': 'Organization',
        name: 'New Tech Aviation',
        url: BASE_URL,
      },
      publisher: {
        '@type': 'Organization',
        name: 'New Tech Aviation',
        url: BASE_URL,
        logo: { '@type': 'ImageObject', url: logoUrl },
      },
      mainEntityOfPage: { '@type': 'WebPage', '@id': canonical },
    },
    faqs && faqs.length > 0 ? {
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      mainEntity: faqs.map(f => ({
        '@type': 'Question',
        name: f.q,
        acceptedAnswer: { '@type': 'Answer', text: f.a },
      })),
    } : null,
  ].filter(Boolean);

  const breadcrumbs = `
    <a href="/">Home</a>
    <span class="breadcrumb-sep">›</span>
    <a href="/blog">Blog</a>
    <span class="breadcrumb-sep">›</span>
    <span class="breadcrumb-current">${category}</span>
  `;

  const content = `
    <style>
      .article-wrap {
        max-width: 1100px;
        margin: 3rem auto;
        padding: 0 2rem;
        display: grid;
        grid-template-columns: 1fr 280px;
        gap: 4rem;
        align-items: start;
      }
      .article-header { margin-bottom: 2rem; }
      .article-category {
        font-size: 0.72rem;
        font-weight: 700;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: var(--blue);
        margin-bottom: 0.6rem;
      }
      .article-title {
        font-family: var(--font-serif);
        font-size: clamp(1.75rem, 4vw, 2.5rem);
        color: var(--navy);
        font-weight: normal;
        line-height: 1.2;
        margin-bottom: 1rem;
      }
      .article-meta {
        display: flex;
        align-items: center;
        gap: 0.75rem;
        font-size: 0.83rem;
        color: var(--gray-400);
        padding-bottom: 1.5rem;
        border-bottom: 1px solid var(--gray-100);
        margin-bottom: 2rem;
      }
      .article-meta-sep { color: var(--gray-200); }
      .article-body { font-size: 1rem; line-height: 1.8; color: var(--gray-600); }
      .article-body h2 {
        font-family: var(--font-serif);
        font-size: 1.55rem;
        color: var(--navy);
        font-weight: normal;
        margin: 2.5rem 0 0.9rem;
        line-height: 1.3;
      }
      .article-body h3 {
        font-size: 1.05rem;
        font-weight: 700;
        color: var(--gray-700);
        margin: 1.75rem 0 0.5rem;
      }
      .article-body p { margin-bottom: 1.25rem; }
      .article-body ul, .article-body ol {
        margin: 0 0 1.25rem 1.5rem;
      }
      .article-body li { margin-bottom: 0.4rem; }
      .article-body strong { color: var(--navy); font-weight: 600; }
      .article-body a { color: var(--blue); text-decoration: underline; text-decoration-color: rgba(37,99,235,0.3); }
      .article-body a:hover { text-decoration-color: var(--blue); }

      /* Cost/data callout boxes */
      .callout {
        background: var(--gray-50);
        border-left: 3px solid var(--blue);
        padding: 1.1rem 1.25rem;
        margin: 1.5rem 0;
        border-radius: 0 8px 8px 0;
        font-size: 0.93rem;
      }
      .callout-amber { border-color: var(--amber); }
      .callout-green { border-color: #059669; }
      .callout strong { display: block; margin-bottom: 0.3rem; color: var(--navy); }

      /* Cost table */
      .cost-table { width: 100%; border-collapse: collapse; margin: 1.5rem 0; font-size: 0.9rem; }
      .cost-table th {
        background: var(--navy);
        color: var(--white);
        text-align: left;
        padding: 0.65rem 0.9rem;
        font-size: 0.8rem;
        font-weight: 600;
        letter-spacing: 0.03em;
      }
      .cost-table td { padding: 0.65rem 0.9rem; border-bottom: 1px solid var(--gray-100); }
      .cost-table tr:last-child td { border-bottom: none; }
      .cost-table tr:nth-child(even) td { background: var(--gray-50); }
      .cost-table .total { font-weight: 700; color: var(--navy); }
      .cost-table .total td { border-top: 2px solid var(--navy); background: var(--gray-50); }

      /* FAQ section */
      .faq-section { margin-top: 3rem; }
      .faq-section h2 {
        font-family: var(--font-serif);
        font-size: 1.55rem;
        color: var(--navy);
        font-weight: normal;
        margin-bottom: 1.25rem;
      }
      .faq-item {
        border-bottom: 1px solid var(--gray-100);
        padding: 1.1rem 0;
      }
      .faq-q {
        font-weight: 600;
        color: var(--navy);
        font-size: 0.95rem;
        margin-bottom: 0.5rem;
        cursor: pointer;
      }
      .faq-a { font-size: 0.9rem; color: var(--gray-500); line-height: 1.65; }

      /* Sidebar */
      .article-sidebar { position: sticky; top: 88px; }
      .sidebar-card {
        background: var(--white);
        border: 1px solid var(--gray-100);
        border-radius: 12px;
        padding: 1.5rem;
        margin-bottom: 1.25rem;
      }
      .sidebar-card h3 {
        font-size: 0.85rem;
        font-weight: 700;
        color: var(--navy);
        letter-spacing: 0.02em;
        margin-bottom: 0.9rem;
      }
      .article-inline-cta {
        margin: 3rem 0 1rem;
        border-radius: 10px;
        background: linear-gradient(135deg, #1B2A4A 0%, #243660 100%);
        padding: 2px;
      }
      .article-inline-cta-inner {
        background: linear-gradient(135deg, #1B2A4A 0%, #243660 100%);
        border-radius: 9px;
        padding: 28px 32px;
        text-align: center;
      }
      .article-inline-cta-label {
        color: #F5A623;
        font-weight: 700;
        font-size: 0.85rem;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        margin-bottom: 8px !important;
      }
      .article-inline-cta-text {
        color: rgba(255,255,255,0.82);
        font-size: 0.95rem;
        line-height: 1.6;
        margin-bottom: 20px !important;
      }
      .article-inline-cta-btn {
        display: inline-block;
        background: #F5A623;
        color: #1B2A4A;
        font-weight: 800;
        text-decoration: none;
        padding: 12px 28px;
        border-radius: 7px;
        font-size: 0.95rem;
        transition: background 0.15s;
      }
      .article-inline-cta-btn:hover { background: #d9901a; color: #1B2A4A; text-decoration: none; }
      .sidebar-cta {
        background: var(--navy);
        border-color: var(--navy);
      }
      .sidebar-cta h3 { color: var(--white); }
      .sidebar-cta p { color: var(--gray-300); font-size: 0.85rem; line-height: 1.5; margin-bottom: 1rem; }
      .sidebar-btn {
        display: block;
        background: var(--blue);
        color: var(--white);
        text-align: center;
        padding: 0.75rem 1rem;
        border-radius: 8px;
        text-decoration: none;
        font-weight: 600;
        font-size: 0.875rem;
        transition: background 0.2s;
      }
      .sidebar-btn:hover { background: var(--blue-light); }
      .sidebar-btn-ghost {
        display: block;
        background: transparent;
        color: var(--gray-300);
        text-align: center;
        padding: 0.65rem 1rem;
        border-radius: 8px;
        text-decoration: none;
        font-size: 0.85rem;
        margin-top: 0.5rem;
        border: 1px solid rgba(255,255,255,0.12);
        transition: border-color 0.2s;
      }
      .sidebar-btn-ghost:hover { border-color: rgba(255,255,255,0.3); color: var(--white); }
      .toc-list { list-style: none; }
      .toc-list li { margin-bottom: 0.4rem; }
      .toc-list a { color: var(--gray-500); text-decoration: none; font-size: 0.85rem; transition: color 0.15s; display: block; padding: 0.1rem 0; }
      .toc-list a:hover { color: var(--blue); }
      .related-list { list-style: none; }
      .related-list li { margin-bottom: 0.6rem; padding-bottom: 0.6rem; border-bottom: 1px solid var(--gray-100); }
      .related-list li:last-child { border-bottom: none; margin-bottom: 0; }
      .related-list a { color: var(--navy); text-decoration: none; font-size: 0.83rem; font-weight: 500; line-height: 1.35; transition: color 0.15s; }
      .related-list a:hover { color: var(--blue); }

      /* CTA block inside article */
      .inline-cta {
        background: linear-gradient(135deg, var(--navy) 0%, var(--navy-light) 100%);
        border-radius: 12px;
        padding: 1.75rem;
        margin: 2.5rem 0;
        text-align: center;
      }
      .inline-cta h3 { font-family: var(--font-serif); font-size: 1.3rem; color: var(--white); font-weight: normal; margin-bottom: 0.5rem; }
      .inline-cta p { color: var(--gray-300); font-size: 0.9rem; margin-bottom: 1.25rem; }
      .inline-cta a {
        display: inline-block;
        background: var(--blue);
        color: var(--white);
        padding: 0.75rem 1.75rem;
        border-radius: 8px;
        text-decoration: none;
        font-weight: 600;
        font-size: 0.9rem;
        transition: background 0.2s;
      }
      .inline-cta a:hover { background: var(--blue-light); }

      @media (max-width: 900px) {
        .article-wrap { grid-template-columns: 1fr; gap: 2rem; }
        .article-sidebar { position: static; }
      }
    </style>

    <div class="article-wrap">
      <main>
        <div class="article-header">
          <div class="article-category">${category}</div>
          <h1 class="article-title">${title}</h1>
          <div class="article-meta">
            <span>New Tech Aviation</span>
            <span class="article-meta-sep">·</span>
            <span>${formatDate(published)}</span>
            <span class="article-meta-sep">·</span>
            <span>${readTime}</span>
          </div>
        </div>
        <div class="article-body">
          ${bodyHtml}
        </div>
        ${faqs && faqs.length > 0 ? `
        <div class="faq-section">
          <h2>Frequently Asked Questions</h2>
          ${faqs.map(f => `
          <div class="faq-item">
            <div class="faq-q">${f.q}</div>
            <div class="faq-a">${f.a}</div>
          </div>`).join('')}
        </div>` : ''}
        <div class="article-inline-cta">
          <div class="article-inline-cta-inner">
            <p class="article-inline-cta-label">✈️ Ready to start?</p>
            <p class="article-inline-cta-text">Book a no-obligation discovery flight with New Tech Aviation. 20 minutes in the air, all experience levels welcome.</p>
            <a href="/book-discovery-flight" class="article-inline-cta-btn">Book a Discovery Flight →</a>
          </div>
        </div>
      </main>
      <aside class="article-sidebar">
        <div class="sidebar-card sidebar-cta">
          <h3>Ready to Start?</h3>
          <p>Book a discovery flight at New Tech Aviation. 20 minutes in the air — no experience needed.</p>
          <a href="/book-discovery-flight" class="sidebar-btn">Book a Discovery Flight</a>
          <a href="/#programs" class="sidebar-btn-ghost">View Training Programs</a>
        </div>
        <div class="sidebar-card">
          <h3>Related Articles</h3>
          <ul class="related-list">
            ${ARTICLES.filter(a => a.slug !== slug).map(a => `
            <li><a href="/blog/${a.slug}">${a.title}</a></li>`).join('')}
          </ul>
        </div>
      </aside>
    </div>
  `;

  return blogLayout({
    title: `${title} | New Tech Aviation`,
    description,
    keywords,
    canonical,
    og: {
      title: `${title} | New Tech Aviation`,
      description,
      url: canonical,
      type: 'article',
    },
    schema: schema.length === 1 ? schema[0] : schema,
    breadcrumbs,
    content,
  });
}

function renderCostArticle(article) {
  const faqs = [
    { q: 'How much does a private pilot license cost in 2026?', a: 'Most students spend between $9,000 and $15,000 for a Private Pilot License (PPL) in 2026. The FAA minimum is 40 hours of flight time, but the national average is closer to 60–70 hours. At typical rates of $150–$200/hr for aircraft rental and $60–$80/hr for instruction, total costs can vary widely.' },
    { q: 'What is included in flight training costs?', a: 'Flight training costs include aircraft rental (wet, per Hobbs hour), instructor fees (per flight hour), ground instruction (often bundled), FAA written exam fee ($175), FAA medical exam ($150–$200), and the practical checkride fee paid to the Designated Pilot Examiner (DPE), typically $700–$900.' },
    { q: 'Can I finance pilot training?', a: 'Yes. Several options exist: AOPA Finance, Meritize, and flight school payment plans. Some schools offer interest-free installment plans. VA benefits cover training for eligible veterans at Part 141 schools. Student loans can also be used.' },
    { q: 'Is it cheaper to get a private pilot license at a Part 61 vs Part 141 school?', a: 'Part 141 schools have a structured syllabus with an FAA-approved curriculum, which can reduce hours (35-hour minimum vs. 40). Part 61 schools offer more flexibility. Actual cost depends on student progress more than the certificate type — a motivated student at a Part 61 school often finishes faster.' },
    { q: 'How can I reduce the cost of flight training?', a: 'Study intensively between lessons to reduce re-review time, fly consistently (2–3 times per week), complete the FAA written exam early, consider renting a flight simulator for procedure practice, and choose an airport with lower fuel costs and competitive rental rates.' },
  ];

  const body = `
    <p>The honest answer: getting your private pilot license (PPL) in 2026 costs between <strong>$9,000 and $15,000</strong> for most students. The variation is real — and knowing where it comes from is the first step to controlling it.</p>

    <div class="callout">
      <strong>Quick Summary</strong>
      FAA minimum: 40 hours flight time. National average: 60–70 hours. Total cost range: $9,000–$15,000. Time to complete: 6–18 months depending on training pace.
    </div>

    <h2 id="breakdown">The Complete Cost Breakdown</h2>
    <p>Here's every line item you should expect when budgeting for your PPL:</p>

    <table class="cost-table">
      <thead>
        <tr><th>Cost Item</th><th>Low Estimate</th><th>High Estimate</th><th>Notes</th></tr>
      </thead>
      <tbody>
        <tr><td>Aircraft rental (40–70 hrs)</td><td>$5,600</td><td>$11,200</td><td>$140–$160/hr wet (fuel included)</td></tr>
        <tr><td>Flight instructor (40–70 hrs)</td><td>$2,400</td><td>$4,200</td><td>$60–$80/hr for dual instruction</td></tr>
        <tr><td>Ground instruction</td><td>$300</td><td>$800</td><td>Often bundled with flight hours</td></tr>
        <tr><td>FAA written (knowledge) test</td><td>$175</td><td>$175</td><td>Fixed fee at testing centers</td></tr>
        <tr><td>FAA 3rd Class Medical</td><td>$130</td><td>$200</td><td>Required before solo</td></tr>
        <tr><td>Practical test (checkride)</td><td>$700</td><td>$900</td><td>Paid directly to DPE</td></tr>
        <tr><td>Study materials &amp; headset</td><td>$300</td><td>$700</td><td>Books, Foreflight, headset</td></tr>
        <tr class="total"><td>Total</td><td>$9,605</td><td>$18,175</td><td></td></tr>
      </tbody>
    </table>

    <h2 id="hours">Why Most Students Don't Finish in 40 Hours</h2>
    <p>The FAA minimum is <strong>40 hours of total flight time</strong> (including at least 20 hours with an instructor and 10 hours solo). But the <a href="https://www.faa.gov/data_research/aviation_data_statistics" target="_blank" rel="noopener">FAA's own data</a> shows the national average is 60–70 hours.</p>
    <p>The gap happens because:</p>
    <ul>
      <li><strong>Training consistency</strong> — Flying once a week means forgetting maneuvers between lessons, requiring re-review</li>
      <li><strong>Weather delays</strong> — Poor visibility or wind cancels lessons, breaking momentum</li>
      <li><strong>Work and study pace</strong> — Students who fall behind on ground knowledge slow down flight training</li>
      <li><strong>Checkride prep</strong> — Many students need extra hours once checkride prep begins</li>
    </ul>

    <div class="callout callout-green">
      <strong>The single biggest cost driver is training frequency.</strong>
      Students who fly 3+ times per week consistently finish closer to 40–50 hours. Students flying once a week often need 65–80 hours.
    </div>

    <h2 id="hidden">Hidden Costs Most Schools Don't Mention</h2>
    <p>Beyond the core training costs, budget for these items that often catch new students off guard:</p>
    <ul>
      <li><strong>Ground transportation</strong> — getting to and from the airport</li>
      <li><strong>Flight bag and gear</strong> — kneeboard, charts, E6B, log book (~$100–$200)</li>
      <li><strong>Aviation headset</strong> — budget options start at $200; quality sets run $800–$1,200</li>
      <li><strong>ForeFlight or Garmin Pilot subscription</strong> — ~$200/year, widely required by instructors</li>
      <li><strong>Failed checkride re-test</strong> — re-examination fees ($700–$900 again) if you don't pass the first time</li>
      <li><strong>Written test retake</strong> — $175 if you fail (expires after 24 months)</li>
    </ul>

    <div class="callout callout-amber">
      <strong>Medical certificate gotcha:</strong>
      If you have any medical history (diabetes, heart conditions, history of depression, DUI convictions), get your medical certificate BEFORE investing in flight training. A special issuance can take months, and a denial can end training entirely. Contact an Aviation Medical Examiner (AME) before you start.
    </div>

    <h2 id="financing">How to Pay for Pilot Training</h2>
    <p>Pilot training is a significant investment. Here are the most common financing options:</p>
    <ul>
      <li><strong>Flight school payment plans</strong> — Many schools offer 0% interest installment plans</li>
      <li><strong>AOPA Finance</strong> — Dedicated aviation loans through the Aircraft Owners and Pilots Association</li>
      <li><strong>Meritize</strong> — Skills-based loans for flight training</li>
      <li><strong>VA education benefits</strong> — Covers approved Part 141 flight training for eligible veterans</li>
      <li><strong>529 education savings</strong> — Some states allow 529 funds for vocational training</li>
    </ul>

    <div class="inline-cta">
      <h3>See What Training Costs at New Tech Aviation</h3>
      <p>Our rates are transparent. No hidden fees. We train at KPSK in the New River Valley — contact us for a current rate sheet and to schedule your first lesson.</p>
      <a href="/#contact">Get Our Current Rates →</a>
    </div>

    <h2 id="reduce">5 Ways to Reduce Your Training Cost</h2>
    <ol>
      <li><strong>Fly consistently.</strong> 2–3 flights per week is the sweet spot. Less than once a week and you'll spend half of each lesson reviewing what you forgot.</li>
      <li><strong>Complete the written test early.</strong> Studying for and passing the FAA written exam before or during early training keeps ground knowledge fresh and reduces instructor ground time.</li>
      <li><strong>Use a simulator.</strong> Many schools offer simulator time at a fraction of aircraft cost. Great for instrument procedures and emergency maneuvers.</li>
      <li><strong>Pre-brief thoroughly.</strong> Every 15 minutes of pre-flight briefing can save 30 minutes of in-aircraft time. Know exactly what you're practicing before you get in the plane.</li>
      <li><strong>Choose a training-focused aircraft.</strong> A simple Cessna 172 or Piper Cherokee is cheaper to operate than a complex or high-performance aircraft. Save those for after your certificate.</li>
    </ol>

    <h2>Is It Worth It?</h2>
    <p>A private pilot license gives you freedom that's hard to put a price on — the ability to fly yourself across the country, visit small airports unreachable by airlines, or simply experience the world from 3,000 feet. For many students, the first solo flight is a defining moment they remember for the rest of their lives.</p>
    <p>For those pursuing a career in aviation, the PPL is just the beginning — but it's the foundation everything else builds on. See our guide on the <a href="/blog/private-pilot-license-timeline">realistic PPL timeline</a> to understand what the full journey looks like.</p>

    <p>At New Tech Aviation, we're transparent about costs because we think you deserve to plan properly. <a href="/#contact">Contact us</a> to discuss your training goals and get a personalized estimate based on your schedule and availability.</p>
  `;

  return articleShell(article, body, faqs);
}

function renderRequirementsArticle(article) {
  const faqs = [
    { q: 'What is the minimum age for a student pilot certificate?', a: 'To solo a powered aircraft (airplane, helicopter), you must be at least 16 years old. For gliders and balloons, the minimum is 14. There is no minimum age to begin ground training or take introductory flights with an instructor.' },
    { q: 'What medical certificate do I need to fly solo?', a: 'At minimum, a 3rd Class FAA Medical Certificate is required to act as pilot in command of a powered aircraft. It can be obtained from an Aviation Medical Examiner (AME) and involves a basic physical examination. A BasicMed alternative exists for recreational flying in certain circumstances.' },
    { q: 'Do I need to be a US citizen to get a student pilot certificate?', a: 'No. Non-US citizens can obtain student pilot certificates and train in the US. However, foreign nationals must register with the TSA\'s Alien Flight Student Program (AFSP) before beginning flight training at a certificated flight school.' },
    { q: 'How do I get a student pilot certificate?', a: 'You apply through the FAA\'s Integrated Airman Certification and Rating Application (IACRA) system at iacra.faa.gov. Your flight instructor will certify your application after verifying your identity. The certificate is free and takes 3–5 business days to receive.' },
    { q: 'What documents do I need for my first flight lesson?', a: 'For your introductory lesson, you just need a government-issued photo ID. Before your first solo flight, you\'ll need a valid student pilot certificate and a 3rd Class Medical Certificate (or BasicMed). Your instructor will keep a student logbook for you.' },
  ];

  const body = `
    <p>Before you can fly solo as a student pilot, the FAA requires a few things — and none of them are as complicated as people think. Here's the complete list, in the order you'll actually need them.</p>

    <div class="callout">
      <strong>The short version:</strong>
      You need to be at least 16, pass a basic medical exam, speak English, and apply for a student pilot certificate. That's it. You can start ground lessons and flight instruction with an instructor before any of these are complete.
    </div>

    <h2 id="age">1. Minimum Age</h2>
    <p>The FAA's minimum age requirements depend on the type of aircraft:</p>
    <table class="cost-table">
      <thead>
        <tr><th>Aircraft Type</th><th>Minimum Age to Solo</th></tr>
      </thead>
      <tbody>
        <tr><td>Airplanes, helicopters, gyroplane</td><td>16 years old</td></tr>
        <tr><td>Gliders, balloons</td><td>14 years old</td></tr>
      </tbody>
    </table>
    <p>There's <strong>no minimum age to start training</strong>. Students as young as 14 begin ground school and fly with an instructor regularly — you just can't solo until you hit the age minimum. Many pilots get a head start this way and solo on their 16th birthday.</p>

    <h2 id="medical">2. FAA Medical Certificate</h2>
    <p>Before you can fly solo, you need a valid FAA medical certificate. For student pilots, the <strong>3rd Class Medical</strong> is the minimum required and is the easiest to obtain.</p>
    <p>The 3rd Class Medical examination includes:</p>
    <ul>
      <li>Vision test (correctable to 20/40; no color vision requirement for VFR)</li>
      <li>Hearing test (conversational distance)</li>
      <li>Blood pressure check</li>
      <li>General physical examination</li>
      <li>Review of medical history</li>
    </ul>

    <div class="callout callout-amber">
      <strong>Do this FIRST.</strong>
      Get your medical exam before investing heavily in training. Certain medical conditions, medications, or history (DUI, certain mental health diagnoses) can complicate or delay certification. An Aviation Medical Examiner (AME) can advise you in advance. Don't spend thousands training only to discover a medical issue later.
    </div>

    <h3>Where to Get Your Medical</h3>
    <p>Find an <strong>Aviation Medical Examiner (AME)</strong> through the <a href="https://designee.faa.gov/designeeLocator" target="_blank" rel="noopener">FAA Designee Locator</a>. The exam costs $130–$200 and takes about 30 minutes. A 3rd Class Medical is valid for 60 calendar months for pilots under 40, and 24 months for pilots 40 and older.</p>

    <h3>BasicMed Alternative</h3>
    <p>Pilots who previously held a valid FAA medical may qualify for <strong>BasicMed</strong>, which allows limited private flying under a state driver's license medical standard after a simple online course and a regular doctor's visit. Consult an AME if you're considering this path.</p>

    <h2 id="english">3. English Language Proficiency</h2>
    <p>FAA regulations require that student pilots be able to <strong>read, speak, write, and understand the English language</strong>. There is no formal test — your instructor certifies that you meet this standard when endorsing your student pilot certificate application.</p>
    <p>English proficiency is required because aviation communication (ATC instructions, NOTAMs, charts, FARs) is conducted in English in US airspace.</p>

    <h2 id="certificate">4. Student Pilot Certificate</h2>
    <p>The student pilot certificate is your official authorization to fly solo. It's free, and the process is straightforward:</p>
    <ol>
      <li><strong>Create an account</strong> at <a href="https://iacra.faa.gov" target="_blank" rel="noopener">iacra.faa.gov</a> (FAA's IACRA system)</li>
      <li><strong>Complete the application</strong> online</li>
      <li><strong>Visit your instructor</strong> — they'll verify your identity with a government-issued photo ID and certify your application</li>
      <li><strong>Receive your certificate</strong> — mailed within 3–5 business days (a printed copy from IACRA is valid in the meantime)</li>
    </ol>
    <p>You don't need your student pilot certificate to take your first lessons with an instructor. You need it before your first solo flight.</p>

    <h2 id="foreign">5. Foreign National Requirements</h2>
    <p>Non-US citizens are welcome to train in the US, but must complete one additional step before training at a <strong>certificated flight school</strong> (Part 141 or Part 61 with a TSA-defined curriculum):</p>
    <ul>
      <li>Register with the <strong>TSA Alien Flight Student Program (AFSP)</strong> at <a href="https://afsp.dhs.gov" target="_blank" rel="noopener">afsp.dhs.gov</a></li>
      <li>Submit to a security threat assessment</li>
      <li>Receive approval before flight training begins</li>
    </ul>
    <p>The AFSP process typically takes 2–4 weeks. Citizens of certain countries may face additional review. Check the TSA website for current processing times and requirements.</p>

    <div class="inline-cta">
      <h3>Meet All the Requirements? Let's Start.</h3>
      <p>An intro flight at New Tech Aviation is the best first step — you'll meet your instructor, fly the aircraft, and know immediately if aviation is for you.</p>
      <a href="/#contact">Schedule an Intro Flight →</a>
    </div>

    <h2 id="documents">Documents Checklist: What to Bring</h2>
    <p>Here's exactly what you need at each stage of training:</p>
    <table class="cost-table">
      <thead>
        <tr><th>Stage</th><th>Required Documents</th></tr>
      </thead>
      <tbody>
        <tr><td>Introductory / early lessons</td><td>Government-issued photo ID (driver's license, passport)</td></tr>
        <tr><td>Before first solo</td><td>Student pilot certificate + current 3rd Class Medical</td></tr>
        <tr><td>Solo cross-country</td><td>Instructor endorsement in logbook + above</td></tr>
        <tr><td>Written test (knowledge exam)</td><td>Photo ID + instructor knowledge test endorsement</td></tr>
        <tr><td>Practical test (checkride)</td><td>Logbook with endorsements, medical, student cert, written test results, completed FAA 8710-1 form</td></tr>
      </tbody>
    </table>

    <h2>Ready to Learn More?</h2>
    <p>Now that you know the requirements, the natural next question is: how long will this take? See our guide on the <a href="/blog/private-pilot-license-timeline">realistic private pilot license timeline</a> — including what actually determines whether you finish in 40 hours or 70.</p>
    <p>And if you're thinking about the cost side: our guide on <a href="/blog/how-much-does-it-cost-to-become-a-pilot">pilot training costs in 2026</a> breaks down every line item with honest estimates.</p>
  `;

  return articleShell(article, body, faqs);
}

function renderTimelineArticle(article) {
  const faqs = [
    { q: 'How long does it take to get a private pilot license on average?', a: 'Most students complete their private pilot license in 6–18 months. Students who fly 3+ times per week can finish in as few as 3–4 months. Students who fly once a week or less often take 18–24 months or longer due to forgetting skills between lessons.' },
    { q: 'Can I get my pilot license in 3 months?', a: 'Yes, but it requires intense commitment — flying 4–5 days per week, studying daily, and passing the written exam early. Students who train full-time at accelerated programs can finish in 8–12 weeks. This is not realistic for most people who have jobs or school.' },
    { q: 'What is the FAA minimum flight time for a private pilot license?', a: 'The FAA requires a minimum of 40 hours total flight time for a private pilot certificate (Part 61). This includes at least 20 hours with an instructor and 10 hours of solo flight time. The national average is 60–70 hours.' },
    { q: 'Does it take longer to get a pilot license part-time vs full-time?', a: 'Yes, significantly. Full-time training (4–5 flights/week) can produce a private pilot in 3–6 months. Part-time training (1–2 flights/week) typically takes 12–24 months. The extra time comes from skills needing re-review between infrequent lessons, not from any FAA requirement.' },
    { q: 'What slows down flight training the most?', a: 'The biggest factors are training frequency (less than 2x/week dramatically increases total hours), weather cancellations that break training momentum, falling behind on the FAA written exam, and not studying ground material between lessons. Picking a flight school with good aircraft availability also matters.' },
  ];

  const body = `
    <p>The FAA requires 40 hours. The national average is 60–70. The difference isn't incompetence — it's the reality of what flight training looks like for people with jobs, families, and unpredictable schedules.</p>
    <p>Here's an honest breakdown of timelines based on training intensity, and what actually moves the needle.</p>

    <div class="callout">
      <strong>Realistic timelines at a glance:</strong>
      Full-time intensive: 2–4 months. Consistent part-time (3x/week): 4–8 months. Typical part-time (1–2x/week): 12–18 months. Irregular schedule: 18–36 months.
    </div>

    <h2 id="faa-minimum">The FAA Minimum: 40 Hours</h2>
    <p>Under FAR Part 61, a private pilot certificate requires a minimum of <strong>40 hours total flight time</strong>, including:</p>
    <ul>
      <li><strong>20 hours</strong> with a flight instructor (dual)</li>
      <li><strong>10 hours</strong> solo flight time</li>
      <li>3 hours cross-country with instructor</li>
      <li>3 hours night flying (including a cross-country and 10 night T&amp;Gs)</li>
      <li>3 hours instrument flight training (under the hood)</li>
      <li>3 hours checkride prep within 60 days of the test</li>
    </ul>
    <p>Under <strong>Part 141</strong> (structured flight schools with FAA-approved syllabi), the minimum is reduced to <strong>35 hours</strong>. But whether you finish at 35, 40, or 70 hours depends far more on how you train than which regulation governs your school.</p>

    <h2 id="phases">The Five Phases of Private Pilot Training</h2>
    <p>Understanding where you are in training helps set realistic expectations for what's left:</p>

    <table class="cost-table">
      <thead>
        <tr><th>Phase</th><th>Approx. Hours</th><th>What You're Learning</th></tr>
      </thead>
      <tbody>
        <tr><td>Pre-solo</td><td>10–20 hrs</td><td>Basic maneuvers, traffic pattern, emergency procedures, first solo</td></tr>
        <tr><td>Solo practice</td><td>5–10 hrs</td><td>Solo T&Gs, solo local flight, building confidence</td></tr>
        <tr><td>Cross-country</td><td>10–15 hrs</td><td>Navigation, weather planning, flying to unfamiliar airports</td></tr>
        <tr><td>Night &amp; IFR hood</td><td>6–8 hrs</td><td>Night ops, attitude instrument flying, approaches</td></tr>
        <tr><td>Checkride prep</td><td>3–5 hrs</td><td>Oral exam prep, maneuver polish, mock checkride</td></tr>
        <tr class="total"><td>Total</td><td>34–58 hrs</td><td>Private pilot certificate</td></tr>
      </tbody>
    </table>

    <h2 id="frequency">The #1 Factor: Training Frequency</h2>
    <p>This is the variable that matters more than anything else. Here's the data on how training frequency affects total hours:</p>

    <table class="cost-table">
      <thead>
        <tr><th>Flights per Week</th><th>Typical Total Hours</th><th>Estimated Timeline</th></tr>
      </thead>
      <tbody>
        <tr><td>4–5x (full-time)</td><td>40–50 hrs</td><td>2–4 months</td></tr>
        <tr><td>3x per week</td><td>45–60 hrs</td><td>4–6 months</td></tr>
        <tr><td>2x per week</td><td>55–70 hrs</td><td>6–10 months</td></tr>
        <tr><td>1x per week</td><td>65–90 hrs</td><td>12–18 months</td></tr>
        <tr><td>Irregular/sporadic</td><td>80–120+ hrs</td><td>18–36+ months</td></tr>
      </tbody>
    </table>

    <p>Why does infrequent training cost so many extra hours? <strong>Skill decay.</strong> Crosswind landings, stall recovery, and emergency procedures require physical muscle memory — if you go 10+ days between flights, you start the next lesson partly reviewing the previous one rather than building on it.</p>

    <div class="callout callout-green">
      <strong>The fastest thing you can do right now:</strong>
      Commit to a minimum training frequency before you start. If you can't fly at least twice a week, set a realistic 12–18 month expectation — not 6 months. Students who set unrealistic expectations often quit when they don't hit them.
    </div>

    <h2 id="weather">Weather: The Variable You Can't Control</h2>
    <p>Student pilots train under <strong>Visual Flight Rules (VFR)</strong>, which require reasonable visibility and cloud clearance. In many parts of the US, weather cancels 20–40% of planned training days, especially in winter.</p>
    <p>Ways to minimize weather impact:</p>
    <ul>
      <li>Schedule early morning lessons when weather is most stable</li>
      <li>Build ground training and simulator sessions into cancelled-flight days</li>
      <li>Choose a region with good VFR weather frequency — the Southwest US has the fewest weather delays</li>
      <li>Be ready to fly on short notice when a weather window opens</li>
    </ul>
    <p>At <strong>New River Valley, Virginia (KPSK)</strong>, we typically have excellent VFR weather through spring, summer, and fall. Winter brings more instrument days, but our instructors use those for ground and simulator work.</p>

    <h2 id="written">The Written Exam: Don't Ignore It</h2>
    <p>The FAA Private Pilot Knowledge Test (written exam) covers aerodynamics, weather, regulations, navigation, and aircraft systems. Many students underestimate how much ground preparation is needed and end up delaying their checkride because they haven't passed it.</p>
    <p><strong>Best practice:</strong> Aim to pass the written exam within your first 20–30 hours of flight training. Study with <a href="https://www.sportys.com" target="_blank" rel="noopener">Sporty's</a> or <a href="https://www.kingschools.com" target="_blank" rel="noopener">King Schools</a>. The written test score is valid for 24 calendar months — more than enough time to finish training.</p>

    <div class="inline-cta">
      <h3>Not Sure Where to Start?</h3>
      <p>A discovery flight is 20 minutes in the air with one of our instructors. No commitment — just find out if flying is for you before planning a timeline.</p>
      <a href="/#contact">Book Your Discovery Flight →</a>
    </div>

    <h2 id="checkride">Checkride: The Final Step</h2>
    <p>The FAA practical test (checkride) consists of an <strong>oral exam</strong> (typically 1–2 hours) followed by a <strong>flight test</strong> (1–2 hours). It's administered by an FAA Designated Pilot Examiner (DPE).</p>
    <p>Checkride readiness depends on:</p>
    <ul>
      <li>Consistently performing all required maneuvers to <strong>Airman Certification Standards (ACS)</strong> tolerances</li>
      <li>Demonstrating sound aeronautical decision-making (ADM) and risk management</li>
      <li>Completing all required logbook endorsements from your instructor</li>
      <li>Passing the FAA written exam (score must be current)</li>
    </ul>
    <p>Most students schedule their checkride once their instructor gives the "ready" endorsement — don't rush this step. A checkride failure costs another $700–$900 for the re-test.</p>

    <h2>Part-Time vs. Full-Time Training: What's Right for You?</h2>
    <p>Both paths lead to the same certificate. The question is your constraints:</p>
    <ul>
      <li><strong>Full-time training</strong> is ideal for career-track students, military-path applicants, or anyone with the time and budget to compress training. Faster completion means less total cost in most cases.</li>
      <li><strong>Part-time training</strong> is the reality for most adult students with jobs and families. It works — it just takes longer. The key is maintaining minimum frequency (at least twice a week) and treating ground study seriously between lessons.</li>
    </ul>
    <p>Read more about the full cost picture in our guide on <a href="/blog/how-much-does-it-cost-to-become-a-pilot">how much it costs to become a pilot in 2026</a>, and check the requirements you'll need to start in our <a href="/blog/student-pilot-requirements">student pilot requirements guide</a>.</p>
  `;

  return articleShell(article, body, faqs);
}

function renderDiscoveryFlightArticle(article) {
  const faqs = [
    { q: 'What is a discovery flight?', a: 'A discovery flight (also called an introductory flight) is a short, instructor-led flight lesson — typically 20 minutes in the air — designed to give you a real taste of flying before committing to a full training program. You\'ll sit in the left seat, handle the controls during flight, and experience what it\'s like to pilot a small aircraft.' },
    { q: 'How much does a discovery flight cost?', a: 'Discovery flights typically cost between $150 and $250 depending on the school, aircraft type, and flight duration. At New Tech Aviation, a discovery flight covers aircraft rental and instructor time for a 20-minute flight. Some schools offer discounted intro flights as a promotional rate.' },
    { q: 'Do I need any experience to take a discovery flight?', a: 'None. Discovery flights are specifically designed for people with zero aviation experience. Your instructor handles all the complex tasks — radio communication, takeoff, and landing. You\'ll get to fly straight-and-level, make some turns, and experience the aircraft controls first-hand.' },
    { q: 'What should I wear on a discovery flight?', a: 'Dress comfortably, as you would for a casual outdoor activity. Closed-toe shoes are required. Avoid very bulky clothing that might restrict movement in the cockpit. Sunglasses are helpful. There\'s no special gear required — the school provides headsets.' },
    { q: 'Does a discovery flight count toward a pilot license?', a: 'Yes. The flight time logged during a discovery flight counts toward the 40 hours required for a private pilot license. Your instructor logs the time in your logbook, so you\'re already building hours from day one.' },
    { q: 'How do I book a discovery flight at New Tech Aviation?', a: 'You can book directly through the New Tech Aviation website at newtechaviation.com/book-discovery-flight. Slots fill quickly, so booking in advance is recommended, especially on weekends.' },
  ];

  const body = `
    <p>A discovery flight is the best $150–$200 you can spend to find out if aviation is for you — or your kid. You sit in the pilot's seat, take the controls in the air, and land knowing whether this is something you want to pursue.</p>
    <p>Here's exactly what to expect, start to finish.</p>

    <div class="callout">
      <strong>Quick overview:</strong>
      Duration: About 1 hour total (20 min in the air). Cost: $150–$250. Experience required: None. What you'll do: Pre-flight walk-around, takeoff, fly the aircraft, landing. It counts toward your pilot license logbook hours.
    </div>

    <h2 id="what-is">What Is a Discovery Flight?</h2>
    <p>A discovery flight — also called an introductory flight or intro lesson — is a structured introductory flight with a certified flight instructor (CFI). Unlike a scenic air tour, you're in the left seat (the pilot's seat) and you're handling the controls.</p>
    <p>The purpose is twofold: give you a real feel for flying, and let you see whether you want to pursue a pilot license. Flight schools offer discovery flights specifically because most people don't know what it feels like to fly a small aircraft until they do it.</p>
    <p>The FAA logs it as actual flight instruction time, so every minute counts toward your <a href="/blog/private-pilot-license-timeline">private pilot training hours</a>.</p>

    <h2 id="what-happens">What Happens During a Discovery Flight</h2>
    <p>Here's the typical sequence for a discovery flight visit:</p>

    <table class="cost-table">
      <thead>
        <tr><th>Phase</th><th>Time</th><th>What Happens</th></tr>
      </thead>
      <tbody>
        <tr><td>Ground briefing</td><td>~20 min</td><td>Instructor explains the flight plan, cockpit controls, and what you'll do in the air</td></tr>
        <tr><td>Pre-flight inspection</td><td>~15 min</td><td>Walk-around of the aircraft — fuel, oil, control surfaces, tires</td></tr>
        <tr><td>Taxi and takeoff</td><td>~5 min</td><td>Instructor handles radio and taxi; you may assist on rudder pedals</td></tr>
        <tr><td>Flight time</td><td>20 min</td><td>You take the controls in cruise: straight-and-level, turns, climbs, descents</td></tr>
        <tr><td>Landing</td><td>~5 min</td><td>Instructor typically handles the landing (some students land with guidance)</td></tr>
        <tr><td>Debrief</td><td>~10 min</td><td>What you did well, what flight training looks like, next steps</td></tr>
      </tbody>
    </table>

    <h2 id="controls">What You'll Actually Do in the Air</h2>
    <p>Once you're at cruise altitude (typically 2,000–4,000 feet above the ground), your instructor will hand you the controls and walk you through basic maneuvers:</p>
    <ul>
      <li><strong>Straight-and-level flight</strong> — holding a heading and altitude</li>
      <li><strong>Coordinated turns</strong> — banking left and right using the control yoke and rudder pedals together</li>
      <li><strong>Climbs and descents</strong> — pointing the nose up or down while maintaining airspeed</li>
      <li><strong>Looking outside</strong> — scanning for traffic, reading the horizon as your primary reference</li>
    </ul>
    <p>The instructor is always there with duplicate controls. There's no way to put yourself in danger — they're watching every input and can take control instantly.</p>

    <div class="callout callout-green">
      <strong>Most first-time flyers are surprised by this:</strong>
      A small aircraft like a Cessna 172 is remarkably responsive and stable. Most people who think they'll be nervous find themselves relaxed and focused within the first few minutes. The hardest part is usually looking at the horizon instead of the instruments — which is actually the right technique.
    </div>

    <h2 id="cost">Discovery Flight Cost</h2>
    <p>Expect to pay <strong>$150–$250</strong> for a typical discovery flight. The rate usually covers:</p>
    <ul>
      <li>Aircraft rental (wet, fuel included) — charged per Hobbs hour</li>
      <li>Instructor time — charged per flight hour</li>
      <li>Logbook entry (counts toward your PPL hours)</li>
    </ul>
    <p>Some flight schools offer discounted intro flights ($99–$149) as a promotional price, but these may be shorter or have restrictions. At New Tech Aviation, we price discovery flights transparently — what you see is what you pay.</p>

    <div class="article-inline-cta">
      <div class="article-inline-cta-inner">
        <p class="article-inline-cta-label">✈️ Book Your Discovery Flight</p>
        <p class="article-inline-cta-text">20 minutes in the air at KPSK in New River Valley, VA. Certified instructor. You take the controls. No experience needed.</p>
        <a href="/book-discovery-flight" class="article-inline-cta-btn">Book at New Tech Aviation →</a>
      </div>
    </div>

    <h2 id="prepare">How to Prepare</h2>
    <p>You don't need to study anything for a discovery flight — but a few things will make the experience better:</p>
    <ul>
      <li><strong>Eat a light meal beforehand.</strong> Flying on a full stomach in a small aircraft can cause motion sickness, especially in bumpy air. Avoid greasy or heavy food 2 hours before the flight.</li>
      <li><strong>Hydrate normally</strong> — but not excessively, since there are no restrooms in a Cessna.</li>
      <li><strong>Bring your ID.</strong> Instructors are required to verify student identity.</li>
      <li><strong>Wear sunglasses.</strong> The cockpit gets bright, especially in the afternoon.</li>
      <li><strong>Ask questions.</strong> This is the point. Instructors are used to curious students — nothing is a dumb question.</li>
    </ul>

    <h2 id="wear">What to Wear</h2>
    <p>Dress as you would for a comfortable outdoor activity:</p>
    <ul>
      <li><strong>Closed-toe shoes</strong> — required for operating rudder pedals</li>
      <li>Comfortable pants or shorts — the cockpit can get warm</li>
      <li>Layers — small aircraft can be chilly at altitude even in summer</li>
      <li>No wide-brimmed hats — they don't fit with headsets</li>
    </ul>
    <p>The school provides aviation headsets. You don't need to bring any equipment.</p>

    <h2 id="after">What Happens After</h2>
    <p>After the flight, your instructor will debrief — what you did well, what would improve with practice, and what a full training program looks like. There's no pressure to commit to anything immediately.</p>
    <p>If you decide to continue, you'll typically:</p>
    <ol>
      <li>Get your <a href="/blog/student-pilot-requirements">FAA Student Pilot Certificate</a> (free, online application)</li>
      <li>Schedule a 3rd Class Medical exam with an Aviation Medical Examiner</li>
      <li>Start a structured training program toward your <a href="/blog/how-much-does-it-cost-to-become-a-pilot">Private Pilot License</a></li>
    </ol>
    <p>The discovery flight hours you already logged count — you've already started.</p>
  `;

  return articleShell(article, body, faqs);
}

function renderLearnToFlyVirginiaArticle(article) {
  const faqs = [
    { q: 'How much does flight training cost in Virginia?', a: 'Flight training in Virginia costs between $9,000 and $15,000 for a Private Pilot License, comparable to national averages. Aircraft rental typically runs $140–$200/hr (wet) and instructor fees $60–$90/hr. Total cost depends primarily on how quickly you progress and how often you fly.' },
    { q: 'How long does it take to get a pilot license in Virginia?', a: 'Most students in Virginia complete their private pilot license in 6–18 months. Students who fly 3+ times per week can finish in 4–6 months. The FAA minimum is 40 hours of flight time, but the national average is 60–70 hours.' },
    { q: 'What are the FAA requirements to get a pilot license?', a: 'To earn a Private Pilot Certificate, you need: minimum 40 hours flight time (20 with instructor, 10 solo), pass the FAA written knowledge test, pass the practical test (checkride) with a Designated Pilot Examiner, and hold a valid 3rd Class Medical Certificate. You must be at least 16 to solo and 17 to hold a private certificate.' },
    { q: 'What is the best flight school in Virginia?', a: 'The right school depends on your location, budget, and goals. For students in the New River Valley, Roanoke, or Southwest Virginia area, New Tech Aviation at KPSK (Dublin, VA) offers structured training with a modern fleet, competitive rates, and flexible scheduling. Touring the facility and meeting instructors before committing is always the right move.' },
    { q: 'Is New Tech Aviation a Part 61 or Part 141 school?', a: 'New Tech Aviation operates under FAR Part 61, which offers flexible scheduling and is ideal for adult learners who can\'t commit to a rigid structured curriculum. Part 61 requires a minimum of 40 flight hours for a PPL. A motivated Part 61 student progresses just as fast — or faster — than a Part 141 student.' },
    { q: 'What airports does New Tech Aviation operate from?', a: 'New Tech Aviation is based at New River Valley Airport (KPSK) in Dublin, Virginia. The airport serves the New River Valley region including Blacksburg, Christiansburg, Radford, Pulaski, and surrounding areas in Southwest Virginia.' },
  ];

  const body = `
    <p>Virginia is a genuinely good place to learn to fly. Diverse terrain — Appalachian ridges, Shenandoah Valley, coastal plain — translates into varied and interesting training environments. Seasonal VFR weather is solid across most of the state. And training costs are in line with or below East Coast averages.</p>
    <p>If you're in Virginia and thinking about a pilot license, here's what you need to know — including how to pick the right school and what the path actually looks like.</p>

    <div class="callout">
      <strong>The quick version:</strong>
      Private pilot license in Virginia costs $9,000–$15,000 and takes 6–18 months depending on training frequency. FAA minimum is 40 hours. You need a 3rd Class Medical and to pass a written test and practical checkride. Start with a discovery flight.
    </div>

    <h2 id="why-virginia">Why Learn to Fly in Virginia</h2>
    <p>Virginia offers several genuine advantages for flight training:</p>
    <ul>
      <li><strong>VFR weather</strong> — Central and Western Virginia average 200+ VFR days per year, particularly in spring, summer, and fall</li>
      <li><strong>Terrain variety</strong> — The Appalachians, Shenandoah Valley, and Piedmont offer diverse cross-country training environments</li>
      <li><strong>Airspace</strong> — Multiple Class D airports, Class C airspace at Roanoke Regional, and coastal Class B at Norfolk provide real-world ATC experience without being overwhelming for students</li>
      <li><strong>Cost of living</strong> — Compared to major metro areas on the East Coast, smaller Virginia communities offer more affordable overall training costs</li>
    </ul>

    <h2 id="requirements">FAA Requirements for a Private Pilot License</h2>
    <p>The requirements are set federally — the same in Virginia as everywhere in the US:</p>

    <table class="cost-table">
      <thead>
        <tr><th>Requirement</th><th>Details</th></tr>
      </thead>
      <tbody>
        <tr><td>Minimum age</td><td>16 to fly solo; 17 to hold a private pilot certificate</td></tr>
        <tr><td>Medical certificate</td><td>3rd Class FAA Medical from an Aviation Medical Examiner (AME)</td></tr>
        <tr><td>Flight hours</td><td>Minimum 40 hours total (20 dual, 10 solo) under Part 61</td></tr>
        <tr><td>Written test</td><td>FAA Private Pilot Knowledge Test — passing score 70+</td></tr>
        <tr><td>Practical test</td><td>Oral and flight exam with a Designated Pilot Examiner (DPE)</td></tr>
        <tr><td>English proficiency</td><td>Must read, speak, write, and understand English</td></tr>
      </tbody>
    </table>

    <p>See our full guide on <a href="/blog/student-pilot-requirements">student pilot requirements</a> for a deeper breakdown of each step.</p>

    <h2 id="cost">Cost Breakdown for Flight Training in Virginia</h2>
    <p>Costs in Virginia are generally consistent with national averages, with some variation based on location and school:</p>

    <table class="cost-table">
      <thead>
        <tr><th>Cost Item</th><th>Typical Range</th><th>Notes</th></tr>
      </thead>
      <tbody>
        <tr><td>Aircraft rental (40–70 hrs)</td><td>$5,600–$11,200</td><td>$140–$160/hr wet at most VA flight schools</td></tr>
        <tr><td>Instructor fees</td><td>$2,400–$4,200</td><td>$60–$80/hr for dual instruction</td></tr>
        <tr><td>Ground instruction</td><td>$300–$800</td><td>Often bundled with flight time</td></tr>
        <tr><td>FAA written test</td><td>$175</td><td>Fixed, taken at testing centers</td></tr>
        <tr><td>3rd Class Medical</td><td>$130–$200</td><td>One-time exam with an AME</td></tr>
        <tr><td>Checkride fee</td><td>$700–$900</td><td>Paid to Designated Pilot Examiner</td></tr>
        <tr><td>Headset and materials</td><td>$300–$700</td><td>Logbook, charts, headset, ForeFlight</td></tr>
        <tr class="total"><td>Total</td><td>$9,600–$18,200</td><td>Varies significantly by training pace</td></tr>
      </tbody>
    </table>

    <p>The biggest variable isn't the school — it's how often you fly. Students who fly 3+ times per week consistently finish closer to 40–50 hours. Students who fly once a week often need 65–80 hours. See our guide on <a href="/blog/how-much-does-it-cost-to-become-a-pilot">pilot training costs</a> for a full breakdown.</p>

    <div class="callout callout-green">
      <strong>The most important factor in cost:</strong>
      Training frequency. Commit to flying at least twice a week — ideally three times — and you'll finish faster with fewer total hours. Every extra week between lessons means re-reviewing material you already covered.
    </div>

    <h2 id="timeline">Timeline: How Long Does It Take</h2>
    <p>Based on training frequency, here's what to expect:</p>

    <table class="cost-table">
      <thead>
        <tr><th>Training Frequency</th><th>Estimated Completion</th><th>Typical Total Hours</th></tr>
      </thead>
      <tbody>
        <tr><td>4–5 flights/week (full-time)</td><td>3–5 months</td><td>40–55 hrs</td></tr>
        <tr><td>3 flights/week</td><td>5–7 months</td><td>45–60 hrs</td></tr>
        <tr><td>2 flights/week</td><td>7–12 months</td><td>55–70 hrs</td></tr>
        <tr><td>1 flight/week</td><td>12–20 months</td><td>65–90 hrs</td></tr>
      </tbody>
    </table>

    <p>For a detailed look at the phases of training and what determines your pace, read our <a href="/blog/private-pilot-license-timeline">private pilot license timeline guide</a>.</p>

    <h2 id="choosing">How to Choose a Flight School in Virginia</h2>
    <p>There are dozens of flight schools across Virginia. Here's how to evaluate them:</p>

    <h3>Aircraft Fleet Condition</h3>
    <p>Ask how many aircraft they have and when each was last inspected. A school with two planes and a busy schedule means more weather delays will knock you off the schedule. Modern glass-cockpit aircraft (Garmin G1000, Garmin G3X) are preferable for training — they build skills transferable to more advanced aircraft.</p>

    <h3>Instructor Stability</h3>
    <p>Instructor turnover is the silent killer of student progress. Ask how many instructors have been there more than a year. Schools with high turnover mean you'll switch instructors mid-training, which costs hours as the new instructor learns your skill level.</p>

    <h3>Part 61 vs. Part 141</h3>
    <p>Part 141 schools have an FAA-approved curriculum and a 35-hour minimum — but the structured syllabus means less scheduling flexibility. Part 61 offers flexibility with a 40-hour minimum. For adult learners with work schedules, Part 61 is usually the better fit. The difference in actual completion time is typically minimal for motivated students.</p>

    <h3>Location and Airport</h3>
    <p>Choose a school within 20–30 minutes of where you live or work. A 45-minute drive each direction adds friction that leads to cancelled lessons. Also consider the airspace: training at a busy Class C or near Class B airspace can be beneficial but may delay solo endorsements.</p>

    <div class="article-inline-cta">
      <div class="article-inline-cta-inner">
        <p class="article-inline-cta-label">✈️ Train at New Tech Aviation — KPSK, Virginia</p>
        <p class="article-inline-cta-text">New River Valley Airport (KPSK) in Dublin, VA. Modern fleet, experienced instructors, transparent pricing. Start with a discovery flight — you take the controls.</p>
        <a href="/book-discovery-flight" class="article-inline-cta-btn">Book a Discovery Flight →</a>
      </div>
    </div>

    <h2 id="new-tech">Why New Tech Aviation</h2>
    <p>New Tech Aviation is based at <strong>New River Valley Airport (KPSK)</strong> in Dublin, Virginia — serving Blacksburg, Christiansburg, Radford, Pulaski, and the broader New River Valley region.</p>
    <p>What makes KPSK an ideal training environment:</p>
    <ul>
      <li><strong>Uncongested airspace</strong> — KPSK is a non-towered airport, which means students learn radio self-announce procedures from day one, then transition to towered airspace (Roanoke, Lynchburg) for cross-country training</li>
      <li><strong>Terrain variety</strong> — The surrounding Appalachian ridgelines, valleys, and nearby mountains build situational awareness skills that flat-terrain training simply can't</li>
      <li><strong>Proximity to multiple airports</strong> — Short cross-countries to Roanoke (KROA), Lynchburg (KLYH), and Pulaski (KPSK area) provide ATC experience without long travel times</li>
      <li><strong>Modern aircraft</strong> — Our fleet includes well-maintained trainers with modern avionics</li>
    </ul>

    <h2 id="start">How to Start</h2>
    <p>The right first step is a <a href="/blog/discovery-flight">discovery flight</a>. It's 20 minutes in the air with an instructor, you take the controls, and it counts toward your logbook hours. It costs $150–$250 and answers the question "Is this something I actually want to do?" definitively.</p>
    <p>After that:</p>
    <ol>
      <li>Get your FAA 3rd Class Medical — find an AME at the FAA Designee Locator</li>
      <li>Apply for a student pilot certificate at iacra.faa.gov (free)</li>
      <li>Start ground study (Sporty's or King Schools online courses) alongside flight training</li>
      <li>Pass the FAA written test within your first 20–30 flight hours</li>
      <li>Build hours toward your checkride at a consistent training pace</li>
    </ol>
    <p>Virginia has everything you need to become a pilot. The only variable is starting.</p>
  `;

  return articleShell(article, body, faqs);
}

// ─── HELPERS ──────────────────────────────────────────────
function formatDate(isoDate) {
  const d = new Date(isoDate + 'T00:00:00');
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

module.exports = router;
module.exports.ARTICLES = ARTICLES;
