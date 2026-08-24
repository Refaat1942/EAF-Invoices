#!/usr/bin/env node
/**
 * Database connection resolution tests (app pool vs backup).
 * Run: node scripts/test-database-connection.js
 */
const {
  getDatabaseConnectionString,
  DEV_FALLBACK_CONNECTION_STRING,
} = require('../database/connectionConfig');

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

function withEnv(overrides, fn) {
  const keys = new Set([...Object.keys(process.env), ...Object.keys(overrides)]);
  const saved = {};
  for (const k of keys) saved[k] = process.env[k];
  for (const [k, v] of Object.entries(overrides)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    fn();
  } finally {
    for (const k of keys) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
}

const explicitUrl = 'postgresql://backupuser:secret@localhost:5432/eaf_invoices';

withEnv({ DATABASE_URL: explicitUrl, NODE_ENV: 'production' }, () => {
  assertEq(getDatabaseConnectionString(), explicitUrl, 'explicit DATABASE_URL for app pool');
  assertEq(
    getDatabaseConnectionString({ forBackup: true }),
    explicitUrl,
    'explicit DATABASE_URL for backup'
  );
});

withEnv({ NODE_ENV: 'development', DATABASE_URL: undefined }, () => {
  assertEq(
    getDatabaseConnectionString(),
    DEV_FALLBACK_CONNECTION_STRING,
    'dev app pool uses fallback when DATABASE_URL unset'
  );
  assertEq(
    getDatabaseConnectionString({ forBackup: true }),
    DEV_FALLBACK_CONNECTION_STRING,
    'dev backup uses fallback when DATABASE_URL unset'
  );
});

withEnv({ NODE_ENV: 'test', DATABASE_URL: undefined }, () => {
  assertEq(
    getDatabaseConnectionString({ forBackup: true }),
    DEV_FALLBACK_CONNECTION_STRING,
    'non-production backup fallback'
  );
});

withEnv({ NODE_ENV: 'production', DATABASE_URL: undefined }, () => {
  assertEq(
    getDatabaseConnectionString(),
    DEV_FALLBACK_CONNECTION_STRING,
    'production app pool still allows dev fallback (unchanged behavior)'
  );

  let backupThrew = false;
  let message = '';
  try {
    getDatabaseConnectionString({ forBackup: true });
  } catch (err) {
    backupThrew = true;
    message = err.message || '';
  }
  assert(backupThrew, 'production backup without DATABASE_URL fails');
  assert(message.includes('DATABASE_URL'), 'production backup failure mentions DATABASE_URL');
  assert(
    !message.includes(DEV_FALLBACK_CONNECTION_STRING),
    'production backup error does not expose dev fallback URL'
  );
});

withEnv({ NODE_ENV: 'production', DATABASE_URL: undefined }, () => {
  let usedFallback = false;
  try {
    const url = getDatabaseConnectionString({ forBackup: true });
    if (url === DEV_FALLBACK_CONNECTION_STRING) usedFallback = true;
  } catch {
    /* expected throw */
  }
  assert(!usedFallback, 'production backup never falls back to development connection string');
});

console.log('ALL DATABASE CONNECTION TESTS PASSED');
