/**
 * Delete invoices and patient operational data only.
 *
 * Removes: invoices (+ items, payments, stay entries), patients (+ daily entries,
 * transactions, entry history).
 *
 * Keeps: price lists, services, daily catalog, users, settings, stay types,
 * invoice types, payment methods, contracted entities, discount exclusions.
 *
 * Usage:
 *   node scripts/clear-patient-invoice-data.js --yes
 *
 * On VPS:
 *   cd /var/www/EAF-Invoices
 *   node scripts/clear-patient-invoice-data.js --yes
 */

const readline = require('readline');
const { query, withTransaction, pool } = require('../database/db');

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

function askConfirm(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(/^y(es)?$/i.test(String(answer).trim()));
    });
  });
}

async function main() {
  const autoYes = process.argv.includes('--yes') || process.argv.includes('-y');

  console.log('This will DELETE all invoices and patient data.');
  console.log('Price lists, catalog, services, users, and settings are kept.\n');

  if (!autoYes) {
    const ok = await askConfirm('Type yes to continue: ');
    if (!ok) {
      console.log('Cancelled.');
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
