/**
 * Delete invoices and patient operational data only.
 *
 * Removes: invoices (+ items, payments, stay entries), patients (+ daily entries,
 * transactions, entry history).
 *
 * Keeps: price lists, services, daily catalog, users, settings, stay types,
 * invoice types, payment methods, contracted entities, discount exclusions.
 *
 * Usage (interactive — type the database name shown on screen to confirm):
 *   node scripts/clear-patient-invoice-data.js
 *
 * Non-interactive (must name the exact database being wiped, or it refuses to run):
 *   node scripts/clear-patient-invoice-data.js --yes --confirm-db=eaf_invoices
 */

const readline = require('readline');
const { loadProjectEnv } = require('../database/loadEnv');
loadProjectEnv(require('path').join(__dirname, '..'));
const { getDatabaseConnectionString, isProductionEnv } = require('../database/connectionConfig');
const { query, withTransaction, pool } = require('../database/db');

function currentDatabaseName() {
  try {
    return new URL(getDatabaseConnectionString()).pathname.replace(/^\//, '') || '(unknown)';
  } catch {
    return '(unknown)';
  }
}

async function countTable(table) {
  const { rows } = await query(`SELECT COUNT(*)::int AS c FROM ${table}`);
  return rows[0]?.c || 0;
}

async function clearPatientInvoiceData() {
  const before = {
    invoices: await countTable('invoices'),
    patients: await countTable('patients'),
    daily_entries: await countTable('patient_daily_entries'),
    daily_lines: await countTable('patient_daily_entry_lines'),
    patient_transactions: await countTable('patient_transactions'),
  };

  await withTransaction(async (client) => {
    await client.query('DELETE FROM invoices');
    await client.query('DELETE FROM patients');
    await client.query('DELETE FROM invoice_serial_counter');
  });

  const after = {
    invoices: await countTable('invoices'),
    patients: await countTable('patients'),
    daily_entries: await countTable('patient_daily_entries'),
    daily_lines: await countTable('patient_daily_entry_lines'),
    patient_transactions: await countTable('patient_transactions'),
  };

  return { before, after };
}

function askAnswer(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(String(answer).trim());
    });
  });
}

function argValue(flag) {
  const prefix = `${flag}=`;
  const arg = process.argv.find((a) => a.startsWith(prefix));
  return arg ? arg.slice(prefix.length) : null;
}

async function main() {
  const autoYes = process.argv.includes('--yes') || process.argv.includes('-y');
  const dbName = currentDatabaseName();

  console.log('This will DELETE ALL invoices and patient data.');
  console.log('Price lists, catalog, services, users, and settings are kept.');
  console.log(`Target database: "${dbName}"${isProductionEnv() ? ' (NODE_ENV=production)' : ''}\n`);

  // Require the operator to type/confirm the exact database name, not just "yes" —
  // a bare --yes on a copy-pasted command is exactly how this gets run against the
  // wrong (production) database by mistake.
  if (autoYes) {
    const confirmedDb = argValue('--confirm-db');
    if (confirmedDb !== dbName) {
      console.error(
        `Refusing to run: pass --confirm-db=${dbName} to confirm you intend to wipe THIS database ` +
          `("${dbName}"). This check exists so --yes can never be blindly copy-pasted onto a different ` +
          `(e.g. production) database.`
      );
      process.exit(1);
    }
  } else {
    const answer = await askAnswer(`Type the database name ("${dbName}") to continue: `);
    if (answer !== dbName) {
      console.log('Cancelled — input did not match the database name.');
      process.exit(0);
    }
  }

  try {
    const { before, after } = await clearPatientInvoiceData();
    console.log('\nDone.\n');
    console.log('Before:', before);
    console.log('After:', after);
    console.log('\nInvoice serial counter reset. New invoices start numbering from 1 per fiscal year.');
  } catch (err) {
    console.error('Failed:', err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
