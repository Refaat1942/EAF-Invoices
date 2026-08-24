#!/usr/bin/env node
/**
 * Database connection resolution tests (app pool vs backup).
 * Run: node scripts/test-database-connection.js
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');
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

function clearModule(pathToModule) {
  try {
    delete require.cache[require.resolve(pathToModule)];
  } catch {
    /* not loaded */
  }
}

function withMockedBackupDeps({ spawnHandler, settingsStub = true }, fn) {
  const childPath = require.resolve('child_process');
  const settingsPath = require.resolve('../services/settingsService');
  const backupPath = require.resolve('../services/backupService');
  const savedChild = require.cache[childPath];
  const savedSettings = require.cache[settingsPath];

  const realCp = savedChild ? savedChild.exports : require(childPath);
  const originalSpawn = realCp.spawn;
  const fakeCp = { ...realCp, spawn: spawnHandler(originalSpawn) };
  require.cache[childPath] = {
    id: childPath,
    filename: childPath,
    loaded: true,
    exports: fakeCp,
  };

  if (settingsStub) {
    require.cache[settingsPath] = {
      id: settingsPath,
      filename: settingsPath,
      loaded: true,
      exports: {
        setSetting: async () => {},
        getSetting: async (_key, defaultValue = '') => defaultValue,
      },
    };
  }

  clearModule('../services/backupService');

  return Promise.resolve()
    .then(() => fn())
    .finally(() => {
      if (savedChild) require.cache[childPath] = savedChild;
      else delete require.cache[childPath];
      if (savedSettings) require.cache[settingsPath] = savedSettings;
      else delete require.cache[settingsPath];
      clearModule('../services/backupService');
    });
}

async function testBackupUsesResolvedConnectionString() {
  const explicitUrl = 'postgresql://backupuser:secret@localhost:5432/eaf_invoices';
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eaf-db-conn-'));
  let pgDumpUrl = null;
  let pgDumpCalled = false;

  try {
    await withEnvAsync(
      { DATABASE_URL: explicitUrl, NODE_ENV: 'development', BACKUP_DIR: tmpDir },
      () =>
        withMockedBackupDeps({
          spawnHandler: (originalSpawn) =>
            function(command, args, options) {
              if (String(command).includes('pg_dump')) {
                pgDumpCalled = true;
                pgDumpUrl = args[args.length - 1];
                const proc = new EventEmitter();
                proc.stderr = new EventEmitter();
                setImmediate(() => proc.emit('close', 0));
                return proc;
              }
              return originalSpawn.call(this, command, args, options);
            },
        }, async () => {
          const { runBackup } = require('../services/backupService');
          const result = await runBackup({ trigger: 'test' });
          assert(pgDumpCalled, 'backup invokes pg_dump');
          assertEq(pgDumpUrl, explicitUrl, 'backup pg_dump uses resolved DATABASE_URL');
          assert(!result.success, 'backup fails after mocked pg_dump without dump file (expected)');
        })
    );
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

async function testProductionBackupSkipsPgDumpWithoutDatabaseUrl() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eaf-db-conn-'));
  let pgDumpCalled = false;

  try {
    await withEnvAsync(
      { NODE_ENV: 'production', DATABASE_URL: undefined, BACKUP_DIR: tmpDir },
      () =>
        withMockedBackupDeps({
          spawnHandler: (originalSpawn) =>
            function(command, args, options) {
              if (String(command).includes('pg_dump')) {
                pgDumpCalled = true;
                const proc = new EventEmitter();
                proc.stderr = new EventEmitter();
                setImmediate(() => proc.emit('close', 0));
                return proc;
              }
              return originalSpawn.call(this, command, args, options);
            },
        }, async () => {
          const { runBackup } = require('../services/backupService');
          const result = await runBackup({ trigger: 'test' });
          assert(!pgDumpCalled, 'production backup without DATABASE_URL does not call pg_dump');
          assert(!result.success, 'production backup without DATABASE_URL returns failure');
          assert(
            (result.error || '').includes('DATABASE_URL'),
            'production backup failure message mentions DATABASE_URL'
          );
        })
    );
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

function testBackupServiceUsesSharedResolver() {
  const backupSrc = fs.readFileSync(
    path.join(__dirname, '..', 'services', 'backupService.js'),
    'utf8'
  );
  assert(
    backupSrc.includes('getDatabaseConnectionString({ forBackup: true })'),
    'backupService resolves connection via shared getDatabaseConnectionString'
  );
  assert(
    !backupSrc.includes('DEV_FALLBACK_CONNECTION_STRING'),
    'backupService does not reference dev fallback directly'
  );
}

function withEnvAsync(overrides, fn) {
  const keys = new Set([...Object.keys(process.env), ...Object.keys(overrides)]);
  const saved = {};
  for (const k of keys) saved[k] = process.env[k];
  for (const [k, v] of Object.entries(overrides)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  return Promise.resolve()
    .then(() => fn())
    .finally(() => {
      for (const k of keys) {
        if (saved[k] === undefined) delete process.env[k];
        else process.env[k] = saved[k];
      }
    });
}

(async () => {
  testBackupServiceUsesSharedResolver();
  await testBackupUsesResolvedConnectionString();
  await testProductionBackupSkipsPgDumpWithoutDatabaseUrl();
  console.log('ALL DATABASE CONNECTION TESTS PASSED');
})().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
