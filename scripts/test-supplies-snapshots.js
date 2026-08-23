#!/usr/bin/env node
/**
 * Verify supply invoice_items snapshots survive catalog price changes.
 * Run: node scripts/test-supplies-snapshots.js
 */

const { initDatabase, query } = require('../database/db');
const { upsertPatient } = require('../services/patientService');
const { saveEntry, saveEntriesBatch } = require('../services/dailyChargeService');
const { getInvoiceById } = require('../services/invoiceService');
const { createCatalogItem, updateCatalogItem } = require('../services/dailyEntryCatalogService');

const TEST_FILE = 'SUPPLY-SNAP-TEST';
const TEST_CODE = 'SUP-SNAP-TEST-001';

async function findSupplyInvoiceItem(invoiceId) {
  const { rows } = await query(
    `SELECT * FROM invoice_items
     WHERE invoice_id = $1 AND daily_entry_line_id IS NOT NULL
       AND cost_price_snapshot IS NOT NULL
     ORDER BY id LIMIT 1`,
    [invoiceId]
  );
  return rows[0] || null;
}

async function main() {
  await initDatabase();

  const patient = await upsertPatient({ file_number: TEST_FILE, name: 'Supply Snapshot Test' });
  const today = new Date().toISOString().slice(0, 10);

  await query(
    `DELETE FROM invoice_items WHERE invoice_id IN (
      SELECT id FROM invoices WHERE TRIM(file_number) = TRIM($1)
    )`,
    [TEST_FILE]
  );
  await query(`DELETE FROM invoices WHERE TRIM(file_number) = TRIM($1)`, [TEST_FILE]);
  await query(
    `DELETE FROM patient_daily_entry_lines WHERE entry_id IN (
      SELECT id FROM patient_daily_entries WHERE patient_id = $1
    )`,
    [patient.id]
  );
  await query(`DELETE FROM patient_daily_entry_history WHERE entry_id IN (
    SELECT id FROM patient_daily_entries WHERE patient_id = $1
  )`, [patient.id]);
  await query(`DELETE FROM patient_daily_entries WHERE patient_id = $1`, [patient.id]);
  await query(`DELETE FROM daily_entry_catalog_items WHERE code = $1`, [TEST_CODE]);

  const catalogItem = await createCatalogItem({
    code: TEST_CODE,
    name: 'Supply Snapshot Test Item',
    category: 'Supplies',
    unit: 'قطعة',
    cost_price: 100,
    markup_percent: 20,
  });

  if (Number(catalogItem.price) !== 120) {
    console.error('FAIL: expected catalog selling price 120, got', catalogItem.price);
    process.exit(1);
  }

  const batch = await saveEntriesBatch({
    file_number: TEST_FILE,
    patient_name: patient.name,
    entries: [
      {
        entry_date: today,
        lines: [{ section_code: 'supplies', catalog_item_id: catalogItem.id, quantity: 1 }],
      },
    ],
  });

  if (!batch.invoice_sync?.synced || !batch.invoice_sync.invoice_id) {
    console.error('FAIL: invoice sync failed', batch.invoice_sync);
    process.exit(1);
  }

  const invoiceId = batch.invoice_sync.invoice_id;
  const dbItem = await findSupplyInvoiceItem(invoiceId);
  if (!dbItem) {
    console.error('FAIL: no invoice item with supply snapshots');
    process.exit(1);
  }

  const assertSnap = (label, actual, expected) => {
    const a = Number(actual);
    const e = Number(expected);
    if (Math.abs(a - e) > 0.009) {
      console.error(`FAIL ${label}: expected ${e}, got ${a}`);
      process.exit(1);
    }
  };

  assertSnap('cost_price_snapshot', dbItem.cost_price_snapshot, 100);
  assertSnap('markup_percent_snapshot', dbItem.markup_percent_snapshot, 20);
  assertSnap('selling_price_snapshot', dbItem.selling_price_snapshot, 120);
  assertSnap('margin_amount_snapshot', dbItem.margin_amount_snapshot, 20);

  await updateCatalogItem(catalogItem.id, {
    code: TEST_CODE,
    name: 'Supply Snapshot Test Item Updated',
    category: 'Supplies',
    unit: 'قطعة',
    cost_price: 200,
    markup_percent: 50,
  });

  const invoice = await getInvoiceById(invoiceId);
  const viewItem = invoice.items.find((i) => Number(i.daily_entry_line_id) === Number(dbItem.daily_entry_line_id));
  if (!viewItem) {
    console.error('FAIL: invoice view item not found');
    process.exit(1);
  }

  assertSnap('view cost_price', viewItem.cost_price, 100);
  assertSnap('view markup_percent', viewItem.markup_percent, 20);
  assertSnap('view amount (selling)', viewItem.amount, 120);
  assertSnap('view supplies_margin_raw', viewItem.supplies_margin_raw, 20);
  assertSnap('loaded cost_price_snapshot', viewItem.cost_price_snapshot, 100);

  console.log('OK supply invoice snapshots preserved after catalog change');
  console.log('  cost=100 markup=20% selling=120 margin=20');

  await query(`DELETE FROM invoice_items WHERE invoice_id = $1`, [invoiceId]);
  await query(`DELETE FROM invoices WHERE id = $1`, [invoiceId]);
  await query(
    `DELETE FROM patient_daily_entry_lines WHERE entry_id IN (
      SELECT id FROM patient_daily_entries WHERE patient_id = $1
    )`,
    [patient.id]
  );
  await query(`DELETE FROM patient_daily_entries WHERE patient_id = $1`, [patient.id]);
  await query(`DELETE FROM daily_entry_catalog_items WHERE id = $1`, [catalogItem.id]);
  await query(`DELETE FROM patients WHERE id = $1`, [patient.id]);

  process.exit(0);
}

main().catch((err) => {
  console.error('FAIL:', err.message);
  process.exit(1);
});
