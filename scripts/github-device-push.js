'use strict';
/**
 * GitHub OAuth Device Flow — authenticates without a PAT, then pushes the repo.
 * User must visit https://github.com/login/device and enter the code shown.
 *
 * Usage: node scripts/github-device-push.js
 */
const fs = require('fs');
const path = require('path');
const https = require('https');
const { execSync } = require('child_process');

const CLIENT_ID = '178c6fc778cc68e8d0884'; // GitHub CLI OAuth app
const REPO = process.env.GITHUB_REPO || 'taedetta/NEWTECH';
const SCOPES = 'repo';

function post(hostname, apiPath, form) {
  const body = new URLSearchParams(form).toString();
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname,
      path: apiPath,
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body),
        Accept: 'application/json',
        'User-Agent': 'FlightSlate-Deploy/1.0',
      },
    }, (res) => {
      let raw = '';
      res.on('data', (c) => { raw += c; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(raw) }); }
        catch { resolve({ status: res.statusCode, data: raw }); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function requestDeviceCode() {
  const { status, data } = await post('github.com', '/login/device/code', {
    client_id: CLIENT_ID,
    scope: SCOPES,
  });
  if (status !== 200 || data.error) throw new Error(`Device code failed: ${JSON.stringify(data)}`);
  return data;
}

async function pollForToken(deviceCode, interval) {
  for (let i = 0; i < 120; i++) {
    await sleep(interval * 1000);
    const { status, data } = await post('github.com', '/login/oauth/access_token', {
      client_id: CLIENT_ID,
      device_code: deviceCode,
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
    });
    if (data.access_token) return data.access_token;
    if (data.error === 'authorization_pending') continue;
    if (data.error === 'slow_down') { interval += 5; continue; }
    if (data.error) throw new Error(`OAuth poll: ${data.error_description || data.error}`);
  }
  throw new Error('Timed out waiting for GitHub authorization (2 min). Run again and approve faster.');
}

async function main() {
  console.log('=== GitHub Device Login + Push ===\n');
  const device = await requestDeviceCode();
  console.log(`\n>>> Open: ${device.verification_uri}`);
  console.log(`>>> Enter code: ${device.user_code}\n`);
  console.log('Waiting for you to authorize in the browser...\n');

  const token = await pollForToken(device.device_code, device.interval || 5);
  console.log('GitHub authorized.\n');

  process.env.GITHUB_TOKEN = token;
  execSync('node scripts/push-to-github-api.js', {
    cwd: path.join(__dirname, '..'),
    stdio: 'inherit',
    env: { ...process.env, GITHUB_TOKEN: token },
  });

  // Configure gh for future use
  try {
    execSync(`"${process.env.ProgramFiles}\\GitHub CLI\\gh.exe" auth setup-git`, { stdio: 'inherit' });
  } catch { /* optional */ }

  console.log(`\nDone. Repo: https://github.com/${REPO}`);
}

main().catch((err) => {
  console.error('Failed:', err.message);
  process.exit(1);
});
