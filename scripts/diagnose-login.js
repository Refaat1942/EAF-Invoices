/**
 * Diagnose browser login issues (CORS, password, logo, pm2 env).
 *
 * Usage:
 *   node scripts/diagnose-login.js
 *   node scripts/diagnose-login.js --password='YourPassword'
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { loadProjectEnv } = require('../database/loadEnv');
loadProjectEnv(path.join(__dirname, '..'));
const { getDatabaseConnectionString } = require('../database/connectionConfig');
const { query, pool } = require('../database/db');

function argValue(flag) {
  const prefix = `${flag}=`;
  const arg = process.argv.find((a) => a.startsWith(prefix));
  return arg ? arg.slice(prefix.length) : null;
}

function httpRequest(options, body = null, headers = {}) {
  return new Promise((resolve) => {
    const req = http.request({ ...options, headers: { ...options.headers, ...headers } }, (res) => {
      let text = '';
      res.on('data', (c) => {
        text += c;
      });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: text }));
    });
    req.on('error', (err) => resolve({ status: 0, body: err.message, headers: {} }));
    if (body) req.write(body);
    req.end();
  });
}

function cookieHeader(setCookie) {
  if (!setCookie) return '';
  const list = Array.isArray(setCookie) ? setCookie : [setCookie];
  return list.map((c) => c.split(';')[0]).join('; ');
}

async function main() {
  const port = Number(process.env.PORT) || 17159;
  const password = argValue('--password') || String(process.env.ADMIN_PASSWORD || '').trim() || 'Admin@2026';
  const dbName = (() => {
    try {
      return new URL(getDatabaseConnectionString()).pathname.replace(/^\//, '');
    } catch {
      return '(unknown)';
    }
  })();

  console.log('=== Login diagnostics ===\n');
  console.log(`Project dir: ${path.join(__dirname, '..')}`);
  console.log(`Database: ${dbName}`);
  console.log(`PORT: ${port}`);
  console.log(`NODE_ENV: ${process.env.NODE_ENV || '(unset)'}`);
  console.log(`COOKIE_SECURE: ${process.env.COOKIE_SECURE || '(unset)'}`);
  console.log(`ALLOWED_ORIGINS: ${process.env.ALLOWED_ORIGINS || '(unset)'}`);
  console.log(`PUBLIC_APP_URL: ${process.env.PUBLIC_APP_URL || process.env.APP_URL || '(unset)'}`);

  const users = await query(`SELECT id, username, is_active FROM users ORDER BY id`);
  console.log(`\nUsers: ${users.rows.length}`);
  users.rows.forEach((u) => console.log(`  - ${u.username} (active=${u.is_active})`));

  const logoPath = path.join(__dirname, '..', 'public', 'assets', 'logo.jpeg');
  console.log(`\nLogo file: ${fs.existsSync(logoPath) ? `OK (${fs.statSync(logoPath).size} bytes)` : 'MISSING'}`);

  const branding = await httpRequest({
    hostname: '127.0.0.1',
    port,
    path: '/api/public/branding',
    method: 'GET',
  });
  console.log(`\nBranding API: HTTP ${branding.status}`);
  console.log(branding.body.slice(0, 200));

  const payload = JSON.stringify({ username: 'admin', password });
  const loginNoOrigin = await httpRequest(
    {
      hostname: '127.0.0.1',
      port,
      path: '/api/auth/login',
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
    },
    payload
  );
  console.log(`\nLogin (no Origin header): HTTP ${loginNoOrigin.status}`);

  const loginWithOrigin = await httpRequest(
    {
      hostname: '127.0.0.1',
      port,
      path: '/api/auth/login',
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
    },
    payload,
    { Origin: `http://127.0.0.1:${port}` }
  );
  console.log(`Login (Origin http://127.0.0.1:${port}): HTTP ${loginWithOrigin.status}`);
  if (loginWithOrigin.status !== 200) {
    console.log(`Body: ${loginWithOrigin.body.slice(0, 300)}`);
    console.log('\n>>> If this fails but "no Origin" works, CORS is blocking the browser — git pull + pm2 restart');
  }

  const cookie = cookieHeader(loginWithOrigin.headers['set-cookie'] || loginNoOrigin.headers['set-cookie']);
  if (cookie) {
    const me = await httpRequest(
      {
        hostname: '127.0.0.1',
        port,
        path: '/api/auth/me',
        method: 'GET',
        headers: { Cookie: cookie },
      }
    );
    console.log(`Session /me: HTTP ${me.status}`);
  } else {
    console.log('Session cookie: NOT SET — login response did not create a session');
  }

  console.log('\nAdd to .env if you open the site by IP:');
  console.log(`ALLOWED_ORIGINS=http://YOUR_SERVER_IP:${port}`);
  console.log(`PUBLIC_APP_URL=http://YOUR_SERVER_IP:${port}`);
}

main()
  .catch((err) => {
    console.error('Diagnose failed:', err.message);
    process.exit(1);
  })
  .finally(() => pool.end());
