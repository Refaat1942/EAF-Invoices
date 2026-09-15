/**
 * Remove bulk price-list services from the database.
 * Daily charge screens use per-tab uploaded sheets (daily_entry_catalog_items) instead.
 *
 * Keeps: price_lists, service_categories, catalog items, patients, invoices, settings.
 * Deletes: all rows in services (and dependent service_components/tiers via FK).
 *
 * Usage:
 *   node scripts/purge-price-list-services.js --dry-run
 *   node scripts/purge-price-list-services.js --yes --confirm-db=eaf_invoices
 */

const path = require('path');
const { loadProjectEnv } = require('../database/loadEnv');

loadProjectEnv(path.join(__dirname, '..'));

const { getDatabaseConnectionString } = require('../database/connectionConfig');
const { query, pool } = require('../database/db');

function currentDatabaseName() {
  try {
    return new URL(getDatabaseConnectionString()).pathname.replace(/^\//, '') || '(unknown)';
  } catch {
    return '(unknown)';
  }
}

function argValue(flag) {
  const prefix = `${flag}=`;
  const arg = process.argv.find((a) => a.startsWith(prefix));
  return arg ? arg.slice(prefix.length) : null;
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const autoYes = process.argv.includes('--yes') || process.argv.includes('-y');
  const dbName = currentDatabaseName();

  const { rows } = await query(`SELECT COUNT(*)::int AS c FROM services`);
  const count = rows[0]?.c || 0;
  console.log(`Services in price list tables: ${count}`);
  console.log(`Database: "${dbName}"`);

  if (!count) {
    console.log('Nothing to purge.');
    return;
  }

  if (dryRun) {
    console.log('Dry run — no changes made.');
    return;
  }

  if (autoYes) {
    const confirmedDb = argValue('--confirm-db');
    if (confirmedDb !== dbName) {
      console.error(`Refusing to run: pass --confirm-db=${dbName}`);
      process.exit(1);
    }
  } else {
    console.error('Pass --yes --confirm-db=<database_name> to execute.');
    process.exit(1);
  }

  await query('DELETE FROM services');
  const after = await query(`SELECT COUNT(*)::int AS c FROM services`);
  console.log(`Deleted. Remaining services: ${after.rows[0]?.c || 0}`);
  console.log('Per-tab catalog sheets (daily_entry_catalog_items) are unchanged.');
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
