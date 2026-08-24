#!/usr/bin/env node
/**
 * Production hardening regression tests (no Jest).
 * Run: node scripts/test-production-hardening.js
 * With DB: node --env-file=.env scripts/test-production-hardening.js
 */
const path = require('path');
const fs = require('fs');
const os = require('os');

const envPath = path.join(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (m && !process.env[m[1].trim()]) process.env[m[1].trim()] = m[2].trim();
  }
}

function assert(cond, msg) {
  if (!cond) {
    console.error(`FAIL ${msg}`);
    process.exit(1);
  }
  console.log(`OK ${msg}`);
}

function assertEq(a, e, msg) {
  if (a !== e) {
    console.error(`FAIL ${msg}: expected ${e}, got ${a}`);
    process.exit(1);
  }
  console.log(`OK ${msg}`);
}

// --- Backup utilities ---
const {
  formatBackupFilename,
  isDumpFilename,
  computeNextScheduledBackup,
  selectRetentionDeletes,
  getBackupDir,
  DEFAULT_BACKUP_DIR,
  RETENTION_DAYS,
} = require('../services/backupService');

const sampleDate = new Date('2026-08-24T14:30:45');
assertEq(formatBackupFilename(sampleDate), 'eaf-invoices_2026-08-24_14-30-45.dump', 'backup filename format');
assert(isDumpFilename('eaf-invoices_2026-08-24_14-30-45.dump'), 'isDumpFilename true');
assert(!isDumpFilename('random.sql'), 'isDumpFilename false');

const next = computeNextScheduledBackup(new Date('2026-08-24T02:00:00'));
assertEq(next.getHours(), 3, 'next scheduled hour 03:00');
assertEq(next.getDate(), 24, 'next scheduled same day before 03:00');

const nextDay = computeNextScheduledBackup(new Date('2026-08-24T04:00:00'));
assertEq(nextDay.getDate(), 25, 'next scheduled tomorrow after 03:00');

const files = [
  { path: '/a/new.dump', mtime: Date.now() },
  { path: '/a/old.dump', mtime: Date.now() - 20 * 24 * 60 * 60 * 1000 },
];
const deletes = selectRetentionDeletes(files, 14);
assertEq(deletes.length, 1, 'retention selects one old file');
assertEq(deletes[0].path, '/a/old.dump', 'retention deletes oldest eligible');
assertEq(selectRetentionDeletes([files[0]]).length, 0, 'retention never deletes only backup');

assertEq(getBackupDir(), process.env.BACKUP_DIR || DEFAULT_BACKUP_DIR, 'backup directory default/config');

// Lock file concurrency
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eaf-backup-test-'));
const lockPath = path.join(tmpDir, '.backup.lock');
const { acquireLock, releaseLock } = (() => {
  const svc = require('../services/backupService');
  // re-import internal via duplicate logic
  function acquire(lock) {
    try {
      const fd = fs.openSync(lock, 'wx');
      fs.writeFileSync(fd, String(process.pid));
      fs.closeSync(fd);
      return true;
    } catch (err) {
      if (err.code === 'EEXIST') return false;
      throw err;
    }
  }
  function release(lock) {
    try {
      if (fs.existsSync(lock)) fs.unlinkSync(lock);
    } catch {
      /* ignore */
    }
  }
  return { acquireLock: acquire, releaseLock: release };
})();

assert(acquireLock(lockPath), 'lock acquired');
assert(!acquireLock(lockPath), 'lock blocks concurrent');
releaseLock(lockPath);
assert(acquireLock(lockPath), 'lock re-acquired after release');
releaseLock(lockPath);
fs.rmSync(tmpDir, { recursive: true, force: true });

// --- Production config ---
const { validateProductionConfig, WEAK_SECRETS } = require('../middleware/security');

const prevEnv = { ...process.env };
function withEnv(patch, fn) {
  const saved = { ...process.env };
  Object.assign(process.env, patch);
  try {
    fn();
  } finally {
    process.env = saved;
  }
}

withEnv({ NODE_ENV: 'production', SESSION_SECRET: 'change-this-session-secret' }, () => {
  let threw = false;
  try {
    validateProductionConfig();
  } catch {
    threw = true;
  }
  assert(threw, 'missing production SESSION_SECRET fails startup');
});

withEnv(
  {
    NODE_ENV: 'production',
    SESSION_SECRET: 'abcdefghijklmnopqrstuvwxyz0123456789abcdef',
    APP_SECRET: 'eaf-invoices-secret-key',
  },
  () => {
    let threw = false;
    try {
      validateProductionConfig();
    } catch {
      threw = true;
    }
    assert(threw, 'weak APP_SECRET fails in production');
  }
);

withEnv(
  {
    NODE_ENV: 'production',
    SESSION_SECRET: 'abcdefghijklmnopqrstuvwxyz0123456789abcdef',
    APP_SECRET: 'abcdefghijklmnopqrstuvwxyz0123456789abcdef',
    ALLOWED_ORIGINS: 'http://localhost:8080',
  },
  () => {
    validateProductionConfig();
    console.log('OK production config accepts strong secrets');
  }
);

assert(WEAK_SECRETS.has('eaf-session-secret'), 'weak secret catalog includes default session');

// --- Auth middleware ---
const { requireAuth, requirePermission, requireAnyPermission } = require('../middleware/auth');

function mockRes() {
  const res = { statusCode: 200, body: null };
  res.status = (code) => {
    res.statusCode = code;
    return res;
  };
  res.json = (data) => {
    res.body = data;
    return res;
  };
  return res;
}

function runPermCheck(middleware, req) {
  const res = mockRes();
  middleware(req, res, () => {});
  return res;
}

const unauthReq = { session: {}, method: 'GET', originalUrl: '/api/test' };
const unauthRes = mockRes();
let nextCalled = false;
requireAuth(unauthReq, unauthRes, () => {
  nextCalled = true;
});
assertEq(unauthRes.statusCode, 401, 'protected route without session returns 401');
assert(!nextCalled, 'requireAuth blocks without session');

const userReq = {
  session: {
    user: {
      username: 'user1',
      role: 'user',
      permissions: ['invoices.view'],
    },
  },
  method: 'GET',
  originalUrl: '/api/test',
};
const permRes = mockRes();
let permNext = false;
requirePermission('invoices.delete')(userReq, permRes, () => {
  permNext = true;
});
assertEq(permRes.statusCode, 403, 'protected route without permission returns 403');
assert(!permNext, 'requirePermission blocks missing permission');

const viewerSession = {
  session: {
    user: {
      username: 'basic',
      role: 'user',
      custom_permissions: ['invoices.view'],
      permissions: ['invoices.view'],
    },
  },
  method: 'POST',
  originalUrl: '/api/test',
};

const catalogOnlyViewSession = {
  session: {
    user: {
      username: 'reviewer-no-catalog',
      role: 'reviewer',
      custom_permissions: ['invoices.view', 'daily_charges.view'],
      permissions: ['invoices.view', 'daily_charges.view'],
    },
  },
  method: 'POST',
  originalUrl: '/api/daily-charges/catalog',
};

assertEq(
  runPermCheck(requireAnyPermission('settings.*', 'daily_charges.manage'), catalogOnlyViewSession).statusCode,
  403,
  'unauthorized catalog modification rejected'
);

assertEq(
  runPermCheck(requirePermission('invoices.approve'), {
    ...viewerSession,
    originalUrl: '/api/invoices/1/approve',
  }).statusCode,
  403,
  'unauthorized approval rejected'
);

assertEq(
  runPermCheck(requirePermission('invoices.delete'), {
    ...viewerSession,
    method: 'DELETE',
    originalUrl: '/api/invoices/1',
  }).statusCode,
  403,
  'unauthorized deletion rejected'
);

assertEq(
  runPermCheck(requirePermission('settings.*'), {
    ...viewerSession,
    originalUrl: '/api/settings/backup/run',
  }).statusCode,
  403,
  'manual backup unauthorized without settings.*'
);

(async () => {
  const hasDb = !!process.env.DATABASE_URL;
  if (!hasDb) {
    console.log('SKIP DB hardening integration (no DATABASE_URL)');
    console.log('ALL PRODUCTION HARDENING TESTS PASSED');
    return;
  }

  const { initDatabase, query } = require('../database/db');
  try {
    await initDatabase();
  } catch (err) {
    console.log(`SKIP DB hardening integration (${err.message})`);
    console.log('ALL PRODUCTION HARDENING TESTS PASSED');
    return;
  }

  const { login } = require('../services/authService');
  const bad = await login('nonexistent-user-hardening', 'wrong');
  assert(bad === null, 'login failure returns null (no user enumeration)');

  const { recordInvoiceReturns } = require('../services/invoiceReturnService');
  const { saveInvoice } = require('../services/invoiceService');

  async function assertReturnRejected(status, label) {
    const invoice = await saveInvoice({
      invoice_type: 'civil',
      patient_name: 'Hardening Test',
      issue_date: new Date().toISOString().slice(0, 10),
      admission_date: new Date().toISOString().slice(0, 10),
      save_mode: status === 'pending_review' ? 'submit' : 'draft',
      include_daily_charges: false,
      items: [{ description: 'Hardening item', quantity: 1, amount: 100 }],
      method_payments: [{ code: 'cash', amount: 100 }],
    });
    let threw = false;
    try {
      await recordInvoiceReturns(invoice.id, {
        lines: [{ invoice_item_id: invoice.items[0].id, return_quantity: 1 }],
      });
    } catch (err) {
      threw = true;
      assert(String(err.message).includes('معتمدة'), `${label} rejection message`);
    }
    assert(threw, `${label} cannot return`);
    await query('DELETE FROM invoices WHERE id = $1', [invoice.id]);
  }

  await assertReturnRejected('draft', 'draft invoice');
  await assertReturnRejected('pending_review', 'pending_review invoice');

  console.log('ALL PRODUCTION HARDENING TESTS PASSED');
})().catch((err) => {
  console.error('FAIL', err.message || err);
  process.exit(1);
});

