/**
 * One-time backfill: post missing stay days + sync open invoices for all registered patients.
 *
 * Usage:
 *   node scripts/backfill-existing-patients.js
 *   node scripts/backfill-existing-patients.js --dry-run
 */

const path = require('path');
const { loadProjectEnv } = require('../database/loadEnv');

loadProjectEnv(path.join(__dirname, '..'));

const { reconcileAllOpenPatients, listOpenPatientFileNumbers } = require('../services/patientReconcileService');
const { pool } = require('../database/db');

async function main() {
  const dryRun = process.argv.includes('--dry-run');

  const patients = await listOpenPatientFileNumbers();
  console.log(`Open invoices: ${patients.length} patient(s)`);
  if (!patients.length) {
    console.log('Nothing to reconcile.');
    return;
  }

  if (dryRun) {
    for (const row of patients) {
      console.log(`  - ${row.file_number} (${row.patient_type || 'internal'}) ${row.patient_name || ''}`);
    }
    console.log('Dry run only — no changes made.');
    return;
  }

  const result = await reconcileAllOpenPatients({
    skip_existing: true,
    include_today: false,
    post_stay: true,
  });

  console.log(`Processed: ${result.processed}/${result.total}`);
  console.log(`Invoices synced: ${result.invoices_synced}`);
  console.log(`Stay days posted: ${result.stay_days_posted}`);
  if (result.errors.length) {
    console.log(`Errors (${result.errors.length}):`);
    for (const err of result.errors) {
      console.log(`  - ${err.file_number}: ${err.error}`);
    }
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await pool.end();
    } catch {
      /* ignore */
    }
  });
