/**
 * Diagnose and repair login/logo after accidental data issues.
 * Does NOT delete patient or invoice data.
 *
 * Usage:
 *   node scripts/repair-system-access.js
 *   node scripts/repair-system-access.js --reset-admin
 *   node scripts/repair-system-access.js --reset-admin --password='YourNewPassword12'
 */

const bcrypt = require('bcryptjs');
const { loadProjectEnv } = require('../database/loadEnv');
loadProjectEnv(require('path').join(__dirname, '..'));
const fs = require('fs');
const path = require('path');
const { query, pool } = require('../database/db');
const { repairLogoSetting } = require('../services/settingsService');

const ASSETS_DIR = path.join(__dirname, '..', 'public', 'assets');

function argValue(flag) {
  const prefix = `${flag}=`;
  const arg = process.argv.find((a) => a.startsWith(prefix));
  return arg ? arg.slice(prefix.length) : null;
}

function resolveResetPassword() {
  const fromArg = argValue('--password');
  if (fromArg) return fromArg;
  const fromEnv = String(process.env.ADMIN_PASSWORD || '').trim();
  if (fromEnv) return fromEnv;
  return 'Admin@2026';
}

async function diagnoseLogo() {
  const { rows } = await query(`SELECT value FROM app_settings WHERE key = 'invoice_logo'`);
  const setting = rows[0]?.value || '(not set)';
  const assets = fs.existsSync(ASSETS_DIR) ? fs.readdirSync(ASSETS_DIR).filter((f) => f.startsWith('logo.')) : [];
  console.log(`Logo DB setting: ${setting}`);
  console.log(`Logo files in public/assets: ${assets.length ? assets.join(', ') : '(none)'}`);
  for (const file of assets) {
    const full = path.join(ASSETS_DIR, file);
    const size = fs.statSync(full).size;
    console.log(`  - ${file}: ${size} bytes`);
  }
}

function httpRequest(options, body = null) {
  const http = require('http');
  return new Promise((resolve) => {
    const req = http.request(options, (res) => {
      let text = '';
      res.on('data', (chunk) => {
        text += chunk;
      });
      res.on('end', () => {
        resolve({
          status: res.statusCode,
          headers: res.headers,
          body: text,
        });
      });
    });
    req.on('error', (err) => resolve({ status: 0, body: err.message, headers: {} }));
    if (body) req.write(body);
    req.end();
  });
}

function extractSessionCookie(headers = {}) {
  const raw = headers['set-cookie'];
  if (!raw) return '';
  const list = Array.isArray(raw) ? raw : [raw];
  return list.map((c) => c.split(';')[0]).join('; ');
}

async function testLogin(username, password) {
  const payload = JSON.stringify({ username, password });
  const login = await httpRequest(
    {
      hostname: '127.0.0.1',
      port: Number(process.env.PORT) || 17159,
      path: '/api/auth/login',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
      },
    },
    payload
  );
  const cookie = extractSessionCookie(login.headers);
  let meStatus = 0;
  if (cookie) {
    const me = await httpRequest({
      hostname: '127.0.0.1',
      port: Number(process.env.PORT) || 17159,
      path: '/api/auth/me',
      method: 'GET',
      headers: { Cookie: cookie },
    });
    meStatus = me.status;
  }
  return { loginStatus: login.status, meStatus, body: login.body };
}

async function main() {
  const resetAdmin = process.argv.includes('--reset-admin');
  const resetLogo = process.argv.includes('--reset-logo');

  console.log('=== System access repair ===\n');

  await query('SELECT 1');
  console.log('Database: connected');
  console.log(`NODE_ENV: ${process.env.NODE_ENV || '(unset)'}`);
  console.log(`COOKIE_SECURE: ${process.env.COOKIE_SECURE || '(unset)'}`);
  if (process.env.COOKIE_SECURE === 'true') {
    console.log('WARNING: COOKIE_SECURE=true on HTTP will block login cookies — use HTTPS or set COOKIE_SECURE=false');
  }
  const envPassword = String(process.env.ADMIN_PASSWORD || '').trim();
  if (envPassword.startsWith('$2') || (envPassword.length > 40 && !envPassword.includes(' '))) {
    console.log(
      'WARNING: ADMIN_PASSWORD in .env looks like a hash, not a plain password. Use --password=... when resetting admin.'
    );
  }

  const usersRes = await query(
    `SELECT id, username, full_name, role, is_active, last_login
     FROM users ORDER BY id`
  );
  console.log(`Users: ${usersRes.rows.length}`);
  usersRes.rows.forEach((u) => {
    console.log(
      `  - #${u.id} ${u.username} (${u.full_name || '—'}) role=${u.role} active=${u.is_active}`
    );
  });

  await diagnoseLogo();
  const logo = await repairLogoSetting({ forceDefault: resetLogo });
  console.log(`Logo setting after repair: ${logo}`);

  if (usersRes.rows.length === 0 || resetAdmin) {
    const password = resolveResetPassword();
    const passwordSource = argValue('--password')
      ? '--password argument'
      : process.env.ADMIN_PASSWORD
        ? 'ADMIN_PASSWORD in .env'
        : 'default Admin@2026';
    if (password.length < 8) {
      throw new Error('Password must be at least 8 characters (use --password=... or ADMIN_PASSWORD)');
    }
    const hash = await bcrypt.hash(password, 10);
    const existing = usersRes.rows.find((u) => u.username === 'admin');
    if (existing) {
      await query(
        `UPDATE users
         SET password_hash = $1, full_name = $2, role = 'admin', is_active = TRUE, custom_permissions = '[]'::jsonb
         WHERE id = $3`,
        [hash, 'مدير النظام', existing.id]
      );
      console.log('\nAdmin password reset for user "admin".');
    } else {
      await query(
        `INSERT INTO users (username, password_hash, full_name, role, custom_permissions, is_active)
         VALUES ($1, $2, $3, 'admin', '[]'::jsonb, TRUE)`,
        ['admin', hash, 'مدير النظام']
      );
      console.log('\nAdmin user "admin" created.');
    }
    console.log('Login with username: admin');
    console.log(`Password source: ${passwordSource}`);
    if (!process.env.ADMIN_PASSWORD && !argValue('--password')) {
      console.log('Temporary password: Admin@2026  (change it after login)');
    }

    const loginTest = await testLogin('admin', password);
    console.log(`\nLocal login test: login HTTP ${loginTest.loginStatus}, session /me HTTP ${loginTest.meStatus}`);
    if (loginTest.loginStatus !== 200) {
      console.log(`Login response: ${String(loginTest.body).slice(0, 300)}`);
    }
  } else {
    console.log('\nUsers exist — login was not changed. Pass --reset-admin to reset admin password.');
    const envPassword = String(process.env.ADMIN_PASSWORD || '').trim();
    if (envPassword) {
      const loginTest = await testLogin('admin', envPassword);
      console.log(`ADMIN_PASSWORD login test: login HTTP ${loginTest.loginStatus}, session /me HTTP ${loginTest.meStatus}`);
      if (loginTest.loginStatus !== 200) {
        console.log('ADMIN_PASSWORD in .env does NOT match the stored admin hash — run with --reset-admin');
      }
    }
  }

  if (!resetLogo) {
    console.log('\nIf logo still missing, run with --reset-logo to force logo.svg');
  }

  console.log('\nNext: pm2 restart eaf-invoices');
  console.log('Then hard refresh the browser (Ctrl+F5).');
}

main()
  .catch((err) => {
    console.error('Repair failed:', err.message);
    process.exit(1);
  })
  .finally(() => pool.end());
