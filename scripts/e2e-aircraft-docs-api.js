'use strict';

/**
 * API E2E: upload aircraft document as admin, verify view for all roles.
 * Usage: QA_BASE=https://flightslate-staging-production.up.railway.app node scripts/e2e-aircraft-docs-api.js
 */
const BASE = process.env.QA_BASE || 'http://localhost:3000';
const PASSWORD = process.env.TEST_USER_PASSWORD || 'TestPass123!';

const ACCOUNTS = [
  { email: 'qa-admin@test.local', role: 'admin', canUpload: true },
  { email: 'evaughntaemw@gmail.com', role: 'owner', canUpload: true, optional: true },
  { email: 'qa-instructor@test.local', role: 'instructor', canUpload: false },
  { email: 'qa-student@test.local', role: 'student', canUpload: false },
  { email: 'qa-maintenance@test.local', role: 'maintenance', canUpload: false },
  { email: 'qa-renter@test.local', role: 'renter', canUpload: false },
];

const failures = [];

function ok(name, cond, detail) {
  if (cond) console.log(`  OK ${name}`);
  else {
    const msg = name + (detail ? `: ${detail}` : '');
    failures.push(msg);
    console.log(`  FAIL ${msg}`);
  }
}

async function api(path, opts = {}) {
  const res = await fetch(`${BASE}${path}`, opts);
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { raw: text.slice(0, 300) }; }
  if (!res.ok) {
    const err = new Error(json.error || `HTTP ${res.status}`);
    err.status = res.status;
    err.body = json;
    throw err;
  }
  return json;
}

async function login(email) {
  const data = await api('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  return data.token;
}

// Minimal valid PDF
const PDF_BYTES = Buffer.from(
  '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/MediaBox[0 0 612 792]/Parent 2 0 R>>endobj\nxref\n0 4\n0000000000 65535 f\n0000000009 00000 n\n0000000052 00000 n\n0000000101 00000 n\ntrailer<</Size 4/Root 1 0 R>>\nstartxref\n178\n%%EOF\n',
  'utf8'
);

async function main() {
  console.log('Aircraft docs API E2E:', BASE);

  let adminToken;
  try {
    adminToken = await login('qa-admin@test.local');
    ok('admin login', !!adminToken);
  } catch (e) {
    console.error('Cannot login as admin:', e.message);
    process.exit(1);
  }

  const auth = (token) => ({ Authorization: `Bearer ${token}` });

  const aircraft = await api('/api/aircraft', { headers: auth(adminToken) });
  const list = aircraft.aircraft || aircraft || [];
  ok('aircraft list', Array.isArray(list) && list.length > 0, `count=${list.length}`);
  if (!list.length) process.exit(1);

  const aircraftId = list[0].id;
  console.log(`  Using aircraft id=${aircraftId} tail=${list[0].tail_number}`);

  const payload = {
    doc_type: 'other',
    title: 'E2E Test POH',
    file_name: 'e2e-test-doc.pdf',
    file_data: PDF_BYTES.toString('base64'),
    notes: 'Automated test upload',
  };

  let docId;
  let fileUrl;
  try {
    const created = await api(`/api/aircraft/${aircraftId}/documents`, {
      method: 'POST',
      headers: { ...auth(adminToken), 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    docId = created.document && created.document.id;
    fileUrl = created.document && created.document.file_url;
    ok('admin upload', !!docId && !!fileUrl, fileUrl || 'no url');
  } catch (e) {
    ok('admin upload', false, e.message);
    process.exit(1);
  }

  // Verify file is fetchable (public URL)
  try {
    const fileRes = await fetch(fileUrl, { redirect: 'follow' });
    const ct = fileRes.headers.get('content-type') || '';
    const buf = Buffer.from(await fileRes.arrayBuffer());
    ok('document URL fetchable', fileRes.ok && buf.length > 50, `status=${fileRes.status} bytes=${buf.length}`);
    ok('document is PDF', buf.slice(0, 4).toString() === '%PDF' || ct.includes('pdf'), ct);
  } catch (e) {
    ok('document URL fetchable', false, e.message);
  }

  for (const acct of ACCOUNTS) {
    let token;
    try {
      token = await login(acct.email);
    } catch (e) {
      if (acct.optional) {
        console.log(`  SKIP ${acct.role} (${acct.email} not on staging)`);
        continue;
      }
      ok(`${acct.role} login`, false, e.message);
      continue;
    }

    try {
      const data = await api(`/api/aircraft/${aircraftId}/documents`, { headers: auth(token) });
      const docs = data.documents || [];
      const found = docs.some((d) => d.id === docId);
      ok(`${acct.role} can list documents`, found, `docs=${docs.length}`);
      if (found) {
        const doc = docs.find((d) => d.id === docId);
        ok(`${acct.role} has file_url`, !!doc.file_url);
      }
    } catch (e) {
      ok(`${acct.role} can list documents`, false, e.message);
    }

    if (!acct.canUpload) {
      try {
        await api(`/api/aircraft/${aircraftId}/documents`, {
          method: 'POST',
          headers: { ...auth(token), 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        ok(`${acct.role} upload blocked`, false, 'upload succeeded unexpectedly');
      } catch (e) {
        ok(`${acct.role} upload blocked`, e.status === 403 || e.status === 401, String(e.status));
      }
    }
  }

  // Cleanup
  try {
    await api(`/api/aircraft/${aircraftId}/documents/${docId}`, {
      method: 'DELETE',
      headers: auth(adminToken),
    });
    ok('cleanup delete', true);
  } catch (e) {
    ok('cleanup delete', false, e.message);
  }

  console.log('\n' + (failures.length ? `FAILED (${failures.length}):\n` + failures.map((f) => ' - ' + f).join('\n') : 'ALL API TESTS PASSED'));
  process.exit(failures.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
