'use strict';

const express = require('express');
const path = require('path');
const fs = require('fs');
const { getCmsData, getHtmlTemplate } = require('./cms');

const router = express.Router();

router.get('/robots.txt', (req, res) => {
  res.set('Content-Type', 'text/plain');
  res.set('Cache-Control', 'public, max-age=86400');
  res.send(
`User-agent: *
Allow: /
Disallow: /app
Disallow: /app/
Disallow: /api/

Sitemap: https://www.newtechaviation.com/sitemap.xml
`
  );
});

router.get('/sitemap.xml', (req, res) => {
  const today = new Date().toISOString().slice(0, 10);
  res.set('Content-Type', 'application/xml');
  res.set('Cache-Control', 'public, max-age=86400');
  res.send(
`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
        xsi:schemaLocation="http://www.sitemaps.org/schemas/sitemap/0.9
        http://www.sitemaps.org/schemas/sitemap/0.9/sitemap.xsd">
  <url>
    <loc>https://www.newtechaviation.com/</loc>
    <lastmod>${today}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>1.0</priority>
  </url>
  <url>
    <loc>https://www.newtechaviation.com/#programs</loc>
    <lastmod>${today}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.9</priority>
  </url>
  <url>
    <loc>https://www.newtechaviation.com/#fleet</loc>
    <lastmod>${today}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.7</priority>
  </url>
  <url>
    <loc>https://www.newtechaviation.com/#instructors</loc>
    <lastmod>${today}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.7</priority>
  </url>
  <url>
    <loc>https://www.newtechaviation.com/#location</loc>
    <lastmod>${today}</lastmod>
    <changefreq>yearly</changefreq>
    <priority>0.8</priority>
  </url>
  <url>
    <loc>https://www.newtechaviation.com/#faq</loc>
    <lastmod>${today}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.8</priority>
  </url>
  <url>
    <loc>https://www.newtechaviation.com/#contact</loc>
    <lastmod>${today}</lastmod>
    <changefreq>yearly</changefreq>
    <priority>0.6</priority>
  </url>
  <url>
    <loc>https://www.newtechaviation.com/mosaic</loc>
    <lastmod>${today}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.85</priority>
  </url>
  <url>
    <loc>https://www.newtechaviation.com/become-a-pilot</loc>
    <lastmod>${today}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.9</priority>
  </url>
  <url>
    <loc>https://www.newtechaviation.com/book-discovery-flight</loc>
    <lastmod>${today}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.95</priority>
  </url>
  <url>
    <loc>https://www.newtechaviation.com/blog</loc>
    <lastmod>${today}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.8</priority>
  </url>
  <url>
    <loc>https://www.newtechaviation.com/blog/discovery-flight</loc>
    <lastmod>2026-05-19</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.85</priority>
  </url>
  <url>
    <loc>https://www.newtechaviation.com/blog/learn-to-fly-virginia</loc>
    <lastmod>2026-05-19</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.85</priority>
  </url>
  <url>
    <loc>https://www.newtechaviation.com/blog/how-much-does-it-cost-to-become-a-pilot</loc>
    <lastmod>2026-05-10</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.8</priority>
  </url>
  <url>
    <loc>https://www.newtechaviation.com/blog/student-pilot-requirements</loc>
    <lastmod>2026-05-10</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.8</priority>
  </url>
  <url>
    <loc>https://www.newtechaviation.com/blog/private-pilot-license-timeline</loc>
    <lastmod>2026-05-10</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.8</priority>
  </url>
</urlset>`
  );
});

router.get('/', async (req, res) => {
  const slug = process.env.POLSIA_ANALYTICS_SLUG || '';
  const template = getHtmlTemplate();

  if (!template) {
    return res.json({ message: 'New Tech Aviation API' });
  }

  const DEFAULTS = {
    hero_bg_image: 'https://images.unsplash.com/photo-1474302770737-173ee21bab63?w=1920&q=95&fit=crop',
    about_image: 'https://images.unsplash.com/photo-1540962351504-03099e0a754b?w=1600&q=95&fit=crop',
    fleet_1_image: 'https://images.unsplash.com/photo-1559628233-100c798642d4?w=1400&q=95&fit=crop',
    fleet_2_image: 'https://images.unsplash.com/photo-1464037866556-6812c9d1c72e?w=1400&q=95&fit=crop',
  };

  let cmsData = {};
  try {
    cmsData = await getCmsData();
  } catch (err) {
    console.error('CMS data fetch for SSR:', err.message);
  }

  let html = template.replace('__POLSIA_SLUG__', slug);

  function ssrImageUrl(key, fallback) {
    const val = cmsData[key];
    if (!val) return fallback;
    if (val.startsWith('data:') && val.length > 500) {
      return '/api/site-content/image/' + encodeURIComponent(key);
    }
    return val;
  }

  const heroBgUrl = ssrImageUrl('hero_bg_image', DEFAULTS.hero_bg_image);
  const heroPreload = `<link rel="preload" as="image" href="${heroBgUrl}" fetchpriority="high">`;
  html = html.replace('__HERO_PRELOAD__', heroPreload);

  html = html.replace('__CMS_HERO_BG__', heroBgUrl);
  const heroScale = parseInt(cmsData.hero_bg_image_scale || '100', 10) || 100;
  html = html.replace('background-size: cover;', `background-size: ${heroScale === 100 ? 'cover' : heroScale + '%'};`);
  html = html.replace('__CMS_ABOUT_IMAGE__', ssrImageUrl('about_image', DEFAULTS.about_image));
  html = html.replace('__CMS_FLEET_1_IMAGE__', ssrImageUrl('fleet_1_image', DEFAULTS.fleet_1_image));
  html = html.replace('__CMS_FLEET_2_IMAGE__', ssrImageUrl('fleet_2_image', DEFAULTS.fleet_2_image));

  if (cmsData.hidden_elements) {
    try {
      const hiddenList = JSON.parse(cmsData.hidden_elements);
      if (Array.isArray(hiddenList) && hiddenList.length > 0) {
        const hiddenCss = hiddenList.map(sel => `${sel} { display: none !important; }`).join('\n');
        html = html.replace('</head>', `<style id="cms-hidden-elements">${hiddenCss}</style>\n</head>`);
      }
    } catch (e) { /* invalid JSON — skip */ }
  }

  if (Object.keys(cmsData).length > 0) {
    const lightCmsData = {};
    for (const [key, value] of Object.entries(cmsData)) {
      if (value && typeof value === 'string' && value.startsWith('data:') && value.length > 500) {
        lightCmsData[key] = '/api/site-content/image/' + encodeURIComponent(key);
      } else {
        lightCmsData[key] = value;
      }
    }
    const cmsScript = '<script>window.__CMS_DATA__=' + JSON.stringify(lightCmsData).replace(/</g, '\\u003c') + ';</script>';
    html = html.replace('__CMS_INJECT__', cmsScript);
  } else {
    html = html.replace('__CMS_INJECT__', '');
  }

  res.set('Cache-Control', 'no-cache');
  res.set('Pragma', 'no-cache');
  res.type('html').send(html);
});

router.get('/mosaic', (req, res) => {
  res.set('Cache-Control', 'no-cache');
  res.sendFile(path.join(__dirname, '..', 'public', 'mosaic.html'));
});

router.get('/become-a-pilot', (req, res) => {
  res.set('Cache-Control', 'public, max-age=3600');
  res.sendFile(path.join(__dirname, '..', 'public', 'become-a-pilot.html'));
});

router.get('/book-discovery-flight', (req, res) => {
  res.set('Cache-Control', 'no-cache');
  res.sendFile(path.join(__dirname, '..', 'public', 'book-discovery-flight.html'));
});

router.get('/api/app-version', (req, res) => {
  const buildTimestamp = process.env.BUILD_TIMESTAMP || String(Date.now());
  res.json({ version: buildTimestamp, deployed: new Date().toISOString() });
});

router.get('/app', (req, res) => {
  const filePath = path.join(__dirname, '..', 'public', 'app.html');
  fs.stat(filePath, (err, stats) => {
    if (err) {
      console.error('[app] Could not stat app.html:', err.message);
      return res.status(500).send('Service temporarily unavailable');
    }
    const v = String(stats.mtimeMs);
    fs.readFile(filePath, 'utf8', (err2, content) => {
      if (err2) {
        console.error('[app] Could not read app.html:', err2.message);
        return res.status(500).send('Service temporarily unavailable');
      }
      res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
      res.set('Pragma', 'no-cache');
      res.set('Expires', '0');
      res.set('Surrogate-Control', 'no-store');
      const inject = `<meta name="app-version" content="${v}">`;
      const html = content.replace('</head>', inject + '</head>');
      res.type('html').send(html);
    });
  });
});

// Cache-busting: serve app.html with ?v=filemtime so browser fetches fresh copy on every deploy
router.get('/app/index.html', (req, res) => {
  const filePath = path.join(__dirname, '..', 'public', 'app.html');
  fs.stat(filePath, (err, stats) => {
    if (err) {
      console.error('[app] Could not stat app.html:', err.message);
      return res.status(500).send('Service temporarily unavailable');
    }
    const v = String(stats.mtimeMs);
    fs.readFile(filePath, 'utf8', (err2, content) => {
      if (err2) {
        console.error('[app] Could not read app.html:', err2.message);
        return res.status(500).send('Service temporarily unavailable');
      }
      res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
      res.set('Pragma', 'no-cache');
      res.set('Expires', '0');
      res.set('Surrogate-Control', 'no-store');
      // Inject cache-busting meta into <head> — makes ?v=... visible to the SPA router
      const inject = `<meta name="app-version" content="${v}">`;
      const html = content.replace('</head>', inject + '</head>');
      res.type('html').send(html);
    });
  });
});

// Fallback: /app/* (e.g. /app/progress) — serve app.html with same cache-busting
router.get('/app/*', (req, res) => {
  const filePath = path.join(__dirname, '..', 'public', 'app.html');
  fs.stat(filePath, (err, stats) => {
    if (err) {
      console.error('[app] Could not stat app.html:', err.message);
      return res.status(500).send('Service temporarily unavailable');
    }
    const v = String(stats.mtimeMs);
    fs.readFile(filePath, 'utf8', (err2, content) => {
      if (err2) {
        console.error('[app] Could not read app.html:', err2.message);
        return res.status(500).send('Service temporarily unavailable');
      }
      res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
      res.set('Pragma', 'no-cache');
      res.set('Expires', '0');
      res.set('Surrogate-Control', 'no-store');
      const inject = `<meta name="app-version" content="${v}">`;
      const html = content.replace('</head>', inject + '</head>');
      res.type('html').send(html);
    });
  });
});

// admin pages served from /admin prefix via routes/admin-pages.js (mounted in server.js)

module.exports = router;