#!/usr/bin/env node
/**
 * Scheduled/manual PostgreSQL backup runner for systemd timer or CLI.
 * Usage: node --env-file=.env scripts/run-backup.js
 */
const path = require('path');
const { loadProjectEnv } = require('../database/loadEnv');

loadProjectEnv(path.join(__dirname, '..'));

const { initDatabase } = require('../database/db');
const { runBackup } = require('../services/backupService');

async function main() {
  try {
    await initDatabase();
    const trigger = process.argv.includes('--manual') ? 'manual' : 'scheduled';
    const result = await runBackup({ trigger });
    if (!result.success) {
      console.error(result.error || 'Backup failed');
      process.exit(1);
    }
    process.exit(0);
  } catch (err) {
    console.error(err.message || err);
    process.exit(1);
  }
}

main();
