'use strict';
/**
 * Push project files to GitHub via REST API (no git remote needed).
 * Usage: set GITHUB_TOKEN or GITHUB_USER + GITHUB_PASSWORD env vars.
 */
const fs = require('fs');
const path = require('path');
const https = require('https');

const REPO = process.env.GITHUB_REPO || 'taedetta/NEWTECH';
const BRANCH = process.env.GITHUB_BRANCH || 'main';
const ROOT = path.join(__dirname, '..');

const SKIP_DIRS = new Set([
  'node_modules', '.git', '.claude', '.tmp', 'data', 'terminals',
  'scripts/push-to-github-api.js',
]);
const SKIP_FILES = new Set(['.env', '.DS_Store']);
const SKIP_PREFIXES = ['do_fix', 'check_', 'verify-', 'test-', 'fix-', 'debug', 'browser_'];

function shouldInclude(rel) {
  const base = path.basename(rel);
  if (SKIP_FILES.has(base)) return false;
  if (base.startsWith('.') && !['.gitignore', '.nvmrc', '.npmrc'].includes(base)) return false;
  const parts = rel.split(/[/\\]/);
  if (parts.some(p => SKIP_DIRS.has(p))) return false;
  if (SKIP_PREFIXES.some(p => base.startsWith(p))) return false;
  if (base.endsWith('.png') && base.includes('availability')) return false;
  return true;
}

function walk(dir, prefix = '') {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (!shouldInclude(rel)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full, rel));
    else {
      try {
        if (fs.statSync(full).size > 5 * 1024 * 1024) continue;
        out.push({ rel: rel.replace(/\\/g, '/'), full });
      } catch { /* skip */ }
    }
  }
  return out;
}

function api(method, apiPath, body, auth) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = https.request({
      hostname: 'api.github.com',
      path: apiPath,
      method,
      headers: {
        'User-Agent': 'FlightSlate-Deploy/1.0',
        Accept: 'application/vnd.github+json',
        Authorization: auth,
        ...(data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}),
      },
    }, (res) => {
      let raw = '';
      res.on('data', c => { raw += c; });
      res.on('end', () => {
        let parsed;
        try { parsed = raw ? JSON.parse(raw) : {}; } catch { parsed = { raw }; }
        if (res.statusCode >= 400) reject(new Error(`GitHub ${res.statusCode}: ${raw.slice(0, 500)}`));
        else resolve(parsed);
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function getAuthHeader() {
  if (process.env.GITHUB_TOKEN) return `Bearer ${process.env.GITHUB_TOKEN}`;
  const user = process.env.GITHUB_USER;
  const pass = process.env.GITHUB_PASSWORD;
  if (!user || !pass) throw new Error('Set GITHUB_TOKEN or GITHUB_USER + GITHUB_PASSWORD');
  return `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`;
}

async function main() {
  const auth = await getAuthHeader();
  const [owner, repo] = REPO.split('/');

  // Verify access
  await api('GET', `/repos/${owner}/${repo}`, null, auth);
  console.log(`Connected to ${REPO}`);

  let baseSha;
  try {
    const ref = await api('GET', `/repos/${owner}/${repo}/git/ref/heads/${BRANCH}`, null, auth);
    baseSha = ref.object.sha;
  } catch {
    // Empty repo — create initial commit via contents API
    baseSha = null;
  }

  const files = walk(ROOT);
  console.log(`Uploading ${files.length} files...`);

  if (!baseSha) {
    // Empty repo: use git blob/tree/commit API
    const blobs = [];
    for (let i = 0; i < files.length; i++) {
      const { rel, full } = files[i];
      const content = fs.readFileSync(full);
      const blob = await api('POST', `/repos/${owner}/${repo}/git/blobs`, {
        content: content.toString('base64'),
        encoding: 'base64',
      }, auth);
      blobs.push({ path: rel, mode: '100644', type: 'blob', sha: blob.sha });
      if ((i + 1) % 25 === 0) console.log(`  blobs ${i + 1}/${files.length}`);
    }
    const tree = await api('POST', `/repos/${owner}/${repo}/git/trees`, { tree: blobs }, auth);
    const commit = await api('POST', `/repos/${owner}/${repo}/git/commits`, {
      message: 'Deploy FlightSlate — New Tech Aviation full codebase',
      tree: tree.sha,
    }, auth);
    await api('POST', `/repos/${owner}/${repo}/git/refs`, {
      ref: `refs/heads/${BRANCH}`,
      sha: commit.sha,
    }, auth);
    console.log(`Pushed initial commit ${commit.sha.slice(0, 7)} to ${BRANCH}`);
    return;
  }

  // Existing repo: update files via contents API in batches
  const baseCommit = await api('GET', `/repos/${owner}/${repo}/git/commits/${baseSha}`, null, auth);
  const treeItems = [];
  for (let i = 0; i < files.length; i++) {
    const { rel, full } = files[i];
    const content = fs.readFileSync(full);
    const blob = await api('POST', `/repos/${owner}/${repo}/git/blobs`, {
      content: content.toString('base64'),
      encoding: 'base64',
    }, auth);
    treeItems.push({ path: rel, mode: '100644', type: 'blob', sha: blob.sha });
    if ((i + 1) % 25 === 0) console.log(`  blobs ${i + 1}/${files.length}`);
  }
  const tree = await api('POST', `/repos/${owner}/${repo}/git/trees`, {
    base_tree: baseCommit.tree.sha,
    tree: treeItems,
  }, auth);
  const commit = await api('POST', `/repos/${owner}/${repo}/git/commits`, {
    message: 'Deploy FlightSlate — sync full codebase from local',
    tree: tree.sha,
    parents: [baseSha],
  }, auth);
  await api('PATCH', `/repos/${owner}/${repo}/git/refs/heads/${BRANCH}`, { sha: commit.sha }, auth);
  console.log(`Pushed commit ${commit.sha.slice(0, 7)} to ${BRANCH}`);
}

main().catch(err => {
  console.error('Push failed:', err.message);
  process.exit(1);
});
