#!/usr/bin/env node
/**
 * Run UAT / production-hardening unit tests (no Jest).
 * DB-backed tests run only when DATABASE_URL connects.
 *
 * Usage: node scripts/run-uat-tests.js
 */

const { spawnSync } = require('child_process');
const path = require('path');

const ROOT = path.join(__dirname, '..');

const SCRIPTS = [
  'test-calculations.js',
  'test-api-client.js',
  'test-invoice-presentation.js',
  'test-invoice-edit-guard.js',
  'test-reconciliation-report.js',
  'test-patient-transaction-kinds.js',
  'test-daily-charges.js',
  'test-price-list-import-normalizer.js',
  'test-production-hardening.js',
  'test-daily-picker-search.js',
];

let failed = 0;

for (const script of SCRIPTS) {
  const file = path.join(__dirname, script);
  process.stdout.write(`\n--- ${script} ---\n`);
  const result = spawnSync(process.execPath, [file], {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: 'inherit',
  });
  if (result.status !== 0) {
    failed += 1;
    console.error(`FAILED: ${script}`);
  }
}

if (failed) {
  console.error(`\n${failed} test suite(s) failed`);
  process.exit(1);
}

console.log('\nALL UAT TEST SUITES PASSED');
