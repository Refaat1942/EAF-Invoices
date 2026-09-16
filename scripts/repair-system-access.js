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
const { query, pool } = require('../database/db');
const { repairLogoSetting } = require('../services/settingsService');

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

async function main() {
  const resetAdmin = process.argv.includes('--reset-admin');

  console.log('=== System access repair ===\n');

  await query('SELECT 1');
  console.log('Database: connected');

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

  const logo = await repairLogoSetting();
  console.log(`Logo setting: ${logo}`);

  if (usersRes.rows.length === 0 || resetAdmin) {
    const password = resolveResetPassword();
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
    if (!process.env.ADMIN_PASSWORD && !argValue('--password')) {
      console.log('Temporary password: Admin@2026  (change it after login)');
    }
  } else {
    console.log('\nUsers exist — login was not changed. Pass --reset-admin to reset admin password.');
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
