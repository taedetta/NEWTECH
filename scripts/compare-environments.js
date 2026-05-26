'use strict';

const RENDER_URL = 'https://newtech-zek5.onrender.com';
const RAILWAY_URL = 'https://flightslate-web-production.up.railway.app';

async function getRenderCounts(token) {
  const endpoints = [
    ['/api/users', 'users'],
    ['/api/aircraft', 'aircraft'],
    ['/api/bookings', 'bookings'],
    ['/api/site-content?full=1', 'cms'],
  ];
  const counts = {};
  for (const [path, key] of endpoints) {
    const r = await fetch(`${RENDER_URL}${path}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    const j = await r.json();
    if (Array.isArray(j)) counts[key] = j.length;
    else if (typeof j === 'object' && j !== null) counts[key] = Object.keys(j).length;
    else counts[key] = '?';
  }
  return counts;
}

async function getRailwayCounts(token) {
  return getRenderCounts.call(null, token).catch(() => ({}));
}

async function login(url, email, pass) {
  const r = await fetch(`${url}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: pass }),
  });
  return r.json();
}

(async () => {
  const renderAuth = await login(RENDER_URL, 'evaughntaemw@gmail.com', 'NewTech2026!');
  const railwayAuth = await login(RAILWAY_URL, 'evaughntaemw@gmail.com', 'NewTech2026!');

  const renderCounts = {};
  const railwayCounts = {};

  for (const [label, base, token] of [
    ['Render', RENDER_URL, renderAuth.token],
    ['Railway', RAILWAY_URL, railwayAuth.token],
  ]) {
    const r = await fetch(`${base}/api/users`, { headers: { Authorization: `Bearer ${token}` } });
    const users = await r.json();
    const rc = Array.isArray(users) ? users : users.users || [];
    const ac = await fetch(`${base}/api/aircraft`, { headers: { Authorization: `Bearer ${token}` } });
    const aircraft = await ac.json();
    const bc = await fetch(`${base}/api/bookings`, { headers: { Authorization: `Bearer ${token}` } });
    const bookings = await bc.json();
    const cms = await fetch(`${base}/api/site-content?full=1`);
    const cmsData = await cms.json();
    const counts = {
      users: rc.length,
      aircraft: Array.isArray(aircraft) ? aircraft.length : aircraft.aircraft?.length || 0,
      bookings: Array.isArray(bookings) ? bookings.length : bookings.bookings?.length || 0,
      cms: typeof cmsData === 'object' ? Object.keys(cmsData).length : 0,
    };
    if (label === 'Render') Object.assign(renderCounts, counts);
    else Object.assign(railwayCounts, counts);
    console.log(`${label}:`, counts);
  }

  console.log('\nDiff (Railway - Render):');
  for (const k of Object.keys(renderCounts)) {
    const diff = railwayCounts[k] - renderCounts[k];
    console.log(`  ${k}: ${diff === 0 ? 'match' : `${railwayCounts[k]} vs ${renderCounts[k]} (${diff > 0 ? '+' : ''}${diff})`}`);
  }

  // Test all production user logins on Railway (password hashes copied - same passwords work)
  console.log('\nRailway login tests for all Render users:');
  const users = await fetch(`${RENDER_URL}/api/users`, { headers: { Authorization: `Bearer ${renderAuth.token}` } });
  const userList = await users.json();
  const list = Array.isArray(userList) ? userList : userList.users || [];

  // We can only test owner password; verify others have password_hash on Railway
  const { Pool } = require('pg');
  const p = new Pool({
    host: 'shortline.proxy.rlwy.net', port: 26871,
    user: 'postgres', password: 'cxrFQ1P3ZoQgtNWCIQn_c1a4sQIkaPij',
    database: 'railway', ssl: false,
  });
  const pwCheck = await p.query(`
    SELECT email, password_hash IS NOT NULL AND length(password_hash) > 20 AS has_password, approval_status
    FROM users WHERE email NOT LIKE '%@test.local' ORDER BY id
  `);
  await p.end();
  for (const u of pwCheck.rows) {
    console.log(`  ${u.email}: password=${u.has_password ? 'YES' : 'MISSING'} status=${u.approval_status}`);
  }
})().catch((e) => { console.error(e); process.exit(1); });
