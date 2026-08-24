const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { setSetting, getSetting } = require('./settingsService');
const {
  getDatabaseConnectionString,
  isProductionEnv,
} = require('../database/connectionConfig');

const DEFAULT_BACKUP_DIR = '/var/backups/eaf-invoices';
const RETENTION_DAYS = Number(process.env.BACKUP_RETENTION_DAYS || 14);
const LOCK_FILENAME = '.backup.lock';
const DUMP_PREFIX = 'eaf-invoices_';
const DUMP_SUFFIX = '.dump';
const SCHEDULE_HOUR = Number(process.env.BACKUP_SCHEDULE_HOUR || 3);
const SCHEDULE_MINUTE = Number(process.env.BACKUP_SCHEDULE_MINUTE || 0);

const STATUS_KEYS = {
  lastAttemptAt: 'backup_last_attempt_at',
  lastStatus: 'backup_last_status',
  lastSuccessAt: 'backup_last_success_at',
  lastFailureMessage: 'backup_last_failure_message',
  lastFile: 'backup_last_file',
  lastSizeBytes: 'backup_last_size_bytes',
  lastDurationMs: 'backup_last_duration_ms',
  lastTrigger: 'backup_last_trigger',
  lastVerified: 'backup_last_verified',
  retainedCount: 'backup_retained_count',
};

function isProduction() {
  return isProductionEnv();
}

function getBackupDir() {
  return process.env.BACKUP_DIR || DEFAULT_BACKUP_DIR;
}

function getDatabaseUrlForBackup() {
  return getDatabaseConnectionString({ forBackup: true });
}

function formatBackupFilename(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${DUMP_PREFIX}${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}${DUMP_SUFFIX}`;
}

function isDumpFilename(name) {
  return name.startsWith(DUMP_PREFIX) && name.endsWith(DUMP_SUFFIX);
}

function listDumpFiles(backupDir) {
  if (!fs.existsSync(backupDir)) return [];
  return fs
    .readdirSync(backupDir)
    .filter((name) => isDumpFilename(name))
    .map((name) => {
      const fullPath = path.join(backupDir, name);
      const stat = fs.statSync(fullPath);
      return { name, path: fullPath, mtime: stat.mtimeMs, size: stat.size };
    })
    .sort((a, b) => b.mtime - a.mtime);
}

function computeNextScheduledBackup(fromDate = new Date()) {
  const next = new Date(fromDate);
  next.setHours(SCHEDULE_HOUR, SCHEDULE_MINUTE, 0, 0);
  if (next.getTime() <= fromDate.getTime()) {
    next.setDate(next.getDate() + 1);
  }
  return next;
}

function selectRetentionDeletes(files, retentionDays = RETENTION_DAYS) {
  if (!files.length) return [];
  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  const newest = files[0];
  return files.filter((file) => file.path !== newest.path && file.mtime < cutoff);
}

function getLockPath(backupDir) {
  return path.join(backupDir, LOCK_FILENAME);
}

function acquireLock(lockPath) {
  try {
    const fd = fs.openSync(lockPath, 'wx');
    fs.writeFileSync(fd, String(process.pid));
    fs.closeSync(fd);
    return true;
  } catch (err) {
    if (err.code === 'EEXIST') return false;
    throw err;
  }
}

function releaseLock(lockPath) {
  try {
    if (fs.existsSync(lockPath)) fs.unlinkSync(lockPath);
  } catch {
    /* ignore */
  }
}

function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, {
      ...options,
      env: options.env || process.env,
    });
    let stderr = '';
    proc.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    proc.on('error', (err) => {
      if (err.code === 'ENOENT') {
        reject(new Error(`${command} not found — install PostgreSQL client tools`));
        return;
      }
      reject(err);
    });
    proc.on('close', (code) => {
      if (code === 0) resolve({ code });
      else reject(new Error(stderr.trim() || `${command} exited with code ${code}`));
    });
  });
}

async function verifyDumpFile(filePath) {
  await runCommand('pg_restore', ['--list', filePath]);
  return true;
}

async function runPgDump(destPath, databaseUrl) {
  await runCommand('pg_dump', ['-Fc', '-f', destPath, databaseUrl], {
    env: { ...process.env },
  });
}

async function persistStatus(patch) {
  const entries = Object.entries(patch);
  for (const [key, value] of entries) {
    if (value === undefined || value === null) continue;
    await setSetting(key, String(value));
  }
}

async function getBackupStatus() {
  const backupDir = getBackupDir();
  const files = listDumpFiles(backupDir);
  const nextScheduled = computeNextScheduledBackup();

  return {
    backup_dir: backupDir,
    last_attempt_at: await getSetting(STATUS_KEYS.lastAttemptAt, ''),
    last_status: await getSetting(STATUS_KEYS.lastStatus, ''),
    last_success_at: await getSetting(STATUS_KEYS.lastSuccessAt, ''),
    last_failure_message: await getSetting(STATUS_KEYS.lastFailureMessage, ''),
    last_file: await getSetting(STATUS_KEYS.lastFile, ''),
    last_size_bytes: Number(await getSetting(STATUS_KEYS.lastSizeBytes, '0')) || 0,
    last_duration_ms: Number(await getSetting(STATUS_KEYS.lastDurationMs, '0')) || 0,
    last_trigger: await getSetting(STATUS_KEYS.lastTrigger, ''),
    last_verified: await getSetting(STATUS_KEYS.lastVerified, '') === 'true',
    retained_count: files.length,
    next_scheduled_at: nextScheduled.toISOString(),
    retention_days: RETENTION_DAYS,
    schedule: {
      hour: SCHEDULE_HOUR,
      minute: SCHEDULE_MINUTE,
      local: `${String(SCHEDULE_HOUR).padStart(2, '0')}:${String(SCHEDULE_MINUTE).padStart(2, '0')}`,
    },
  };
}

async function applyRetention(backupDir) {
  const files = listDumpFiles(backupDir);
  const toDelete = selectRetentionDeletes(files);
  for (const file of toDelete) {
    try {
      fs.unlinkSync(file.path);
      console.log(`[backup] retention removed ${file.name}`);
    } catch (err) {
      console.error(`[backup] retention failed to remove ${file.name}: ${err.message}`);
    }
  }
  return listDumpFiles(backupDir).length;
}

async function runBackup(options = {}) {
  const trigger = options.trigger || 'scheduled';
  const backupDir = getBackupDir();
  const startedAt = Date.now();
  const attemptIso = new Date().toISOString();

  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }

  const lockPath = getLockPath(backupDir);
  if (!acquireLock(lockPath)) {
    const message = 'Backup already in progress';
    console.warn(`[backup] ${message}`);
    await persistStatus({
      [STATUS_KEYS.lastAttemptAt]: attemptIso,
      [STATUS_KEYS.lastStatus]: 'failed',
      [STATUS_KEYS.lastFailureMessage]: message,
      [STATUS_KEYS.lastTrigger]: trigger,
    });
    return { success: false, error: message, trigger };
  }

  const filename = formatBackupFilename();
  const destPath = path.join(backupDir, filename);
  let verified = false;

  try {
    const databaseUrl = getDatabaseUrlForBackup();
    console.log(`[backup] starting (${trigger}) → ${filename}`);

    await runPgDump(destPath, databaseUrl);

    if (!fs.existsSync(destPath)) {
      throw new Error('Backup file was not created');
    }

    const size = fs.statSync(destPath).size;
    if (size <= 0) {
      throw new Error('Backup file is empty');
    }

    await verifyDumpFile(destPath);
    verified = true;

    const durationMs = Date.now() - startedAt;
    const retainedCount = await applyRetention(backupDir);

    await persistStatus({
      [STATUS_KEYS.lastAttemptAt]: attemptIso,
      [STATUS_KEYS.lastStatus]: 'success',
      [STATUS_KEYS.lastSuccessAt]: attemptIso,
      [STATUS_KEYS.lastFailureMessage]: '',
      [STATUS_KEYS.lastFile]: filename,
      [STATUS_KEYS.lastSizeBytes]: size,
      [STATUS_KEYS.lastDurationMs]: durationMs,
      [STATUS_KEYS.lastTrigger]: trigger,
      [STATUS_KEYS.lastVerified]: 'true',
      [STATUS_KEYS.retainedCount]: retainedCount,
    });

    console.log(`[backup] success (${trigger}) size=${size} durationMs=${durationMs}`);

    return {
      success: true,
      trigger,
      filename,
      path: destPath,
      size_bytes: size,
      duration_ms: durationMs,
      verified: true,
      retained_count: retainedCount,
      backup_dir: backupDir,
    };
  } catch (err) {
    const durationMs = Date.now() - startedAt;
    const message = err.message || 'Backup failed';

    if (fs.existsSync(destPath) && !verified) {
      try {
        fs.unlinkSync(destPath);
      } catch {
        /* ignore */
      }
    }

    await persistStatus({
      [STATUS_KEYS.lastAttemptAt]: attemptIso,
      [STATUS_KEYS.lastStatus]: 'failed',
      [STATUS_KEYS.lastFailureMessage]: message,
      [STATUS_KEYS.lastDurationMs]: durationMs,
      [STATUS_KEYS.lastTrigger]: trigger,
      [STATUS_KEYS.lastVerified]: 'false',
    });

    console.error(`[backup] failed (${trigger}): ${message}`);

    return {
      success: false,
      trigger,
      error: message,
      duration_ms: durationMs,
      verified: false,
      backup_dir: backupDir,
    };
  } finally {
    releaseLock(lockPath);
  }
}

module.exports = {
  DEFAULT_BACKUP_DIR,
  RETENTION_DAYS,
  STATUS_KEYS,
  isProduction,
  getBackupDir,
  formatBackupFilename,
  isDumpFilename,
  listDumpFiles,
  computeNextScheduledBackup,
  selectRetentionDeletes,
  verifyDumpFile,
  getBackupStatus,
  runBackup,
};
