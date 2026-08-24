#!/usr/bin/env node
/**
 * Scheduled/manual PostgreSQL backup runner for systemd timer or CLI.
 * Usage: node --env-file=.env scripts/run-backup.js
 */
const path = require('path');
const fs = require('fs');

const envPath = path.join(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (m && !process.env[m[1].trim()]) process.env[m[1].trim()] = m[2].trim();
  }
}

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
