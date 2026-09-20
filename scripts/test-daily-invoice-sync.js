#!/usr/bin/env node
/**
 * Daily entry batch save must produce matching invoice lines (no duplicates on re-save).
 * Run: node scripts/test-daily-invoice-sync.js
 */

const { initDatabase, query } = require('../database/db');
const { upsertPatient } = require('../services/patientService');
const {
  saveEntriesBatch,
  getCurrentBusinessDateString,
} = require('../services/dailyChargeService');
const {
  getInvoiceById,
  deleteInvoice,
  syncPatientDailyChargesToInvoice,
} = require('../services/invoiceService');

const TEST_FILE = 'DAILY-INV-SYNC-TEST';

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function assertMoney(label, actual, expected) {
  const a = round2(actual);
  const e = round2(expected);
  if (a !== e) {
    console.error(`FAIL ${label}: expected ${e}, got ${a}`);
    process.exit(1);
  }
}

function assertCount(label, actual, expected) {
  if (actual !== expected) {
    console.error(`FAIL ${label}: expected ${expected}, got ${actual}`);
    process.exit(1);
  }
}

async function cleanupPatientData(patientId, fileNumber) {
  await query(
    `DELETE FROM invoice_items WHERE invoice_id IN (
      SELECT id FROM invoices WHERE TRIM(file_number) = TRIM($1)
    )`,
    [fileNumber]
  );
  await query(`DELETE FROM invoices WHERE TRIM(file_number) = TRIM($1)`, [fileNumber]);
  await query(
    `DELETE FROM patient_daily_entry_lines WHERE entry_id IN (
      SELECT id FROM patient_daily_entries WHERE patient_id = $1
    )`,
    [patientId]
  );
  await query(
    `DELETE FROM patient_daily_entry_history WHERE entry_id IN (
      SELECT id FROM patient_daily_entries WHERE patient_id = $1
    )`,
    [patientId]
  );
  await query(`DELETE FROM patient_daily_entries WHERE patient_id = $1`, [patientId]);
}

async function assertNoDuplicateDailyLines(invoiceId) {
  const { rows } = await query(
    `SELECT daily_entry_line_id, COUNT(*)::int AS n
     FROM invoice_items
     WHERE invoice_id = $1 AND daily_entry_line_id IS NOT NULL
     GROUP BY daily_entry_line_id`,
    [invoiceId]
  );
  for (const row of rows) {
    if (row.n > 1) {
      console.error(`FAIL: duplicate invoice lines for daily_entry_line_id ${row.daily_entry_line_id}`);
      process.exit(1);
    }
  }
}

async function assertInvoiceMatchesExpectations(invoiceId, expectations, expectedSubtotal) {
  const invoice = await getInvoiceById(invoiceId);
  const dailyItems = (invoice.items || []).filter((i) => i.daily_entry_line_id);

  assertCount('daily invoice line count', dailyItems.length, expectations.length);

  for (const exp of expectations) {
    const item = dailyItems.find((i) => Number(i.daily_entry_line_id) === Number(exp.lineId));
    if (!item) {
      console.error(`FAIL: missing invoice line for daily_entry_line_id ${exp.lineId}`);
      process.exit(1);
    }
    assertMoney(`qty line ${exp.lineId}`, item.quantity, exp.quantity);
    assertMoney(`amount line ${exp.lineId}`, item.amount, exp.unitPrice);
    assertMoney(`line total ${exp.lineId}`, round2(item.quantity) * round2(item.amount), exp.lineTotal);
  }

  assertNoDuplicateDailyLines(invoiceId);
  assertMoney('invoice items_subtotal', invoice.items_subtotal_raw ?? invoice.items_subtotal, expectedSubtotal);
}

async function main() {
  await initDatabase();

  const meds = await query(
    `SELECT id, name, price FROM daily_entry_catalog_items
     WHERE category = 'Medicine' AND is_active = TRUE AND price > 0
     ORDER BY id LIMIT 2`
  );
  const supplies = await query(
    `SELECT id, name, price FROM daily_entry_catalog_items
     WHERE category = 'Supplies' AND is_active = TRUE AND price > 0
     ORDER BY id LIMIT 1`
  );

  if (meds.rows.length < 2 || !supplies.rows.length) {
    console.error('FAIL: need at least 2 medicines and 1 supply in catalog');
    process.exit(1);
  }

  const patient = await upsertPatient({ file_number: TEST_FILE, name: 'Daily Invoice Sync Test' });
  const today = getCurrentBusinessDateString();

  await cleanupPatientData(patient.id, TEST_FILE);

  const med1 = meds.rows[0];
  const med2 = meds.rows[1];
  const supply = supplies.rows[0];

  const firstBatch = [
    {
      entry_date: today,
      lines: [{ section_code: 'medicines', catalog_item_id: med1.id, quantity: 1 }],
    },
    {
      entry_date: today,
      lines: [{ section_code: 'medicines', catalog_item_id: med2.id, quantity: 2 }],
    },
    {
      entry_date: today,
      lines: [{ section_code: 'supplies', catalog_item_id: supply.id, quantity: 5 }],
    },
  ];

  const firstSave = await saveEntriesBatch({
    file_number: TEST_FILE,
    patient_name: patient.name,
    entries: firstBatch,
  });

  if (!firstSave.invoice_sync?.synced || !firstSave.invoice_sync.invoice_id) {
    console.error('FAIL: first invoice sync failed', firstSave.invoice_sync);
    process.exit(1);
  }

  assertCount('saved entries', firstSave.count, 3);

  const invoiceId = firstSave.invoice_sync.invoice_id;
  const savedEntries = firstSave.saved;

  const firstExpectations = savedEntries.map((entry) => {
    const line = entry.lines[0];
    const catalog =
      line.section_code === 'supplies'
        ? supply
        : Number(line.catalog_item_id) === Number(med1.id)
          ? med1
          : med2;
    const unitPrice = round2(catalog.price);
    const quantity = round2(line.quantity);
    return {
      lineId: line.id,
      quantity,
      unitPrice,
      lineTotal: round2(unitPrice * quantity),
    };
  });

  const firstSubtotal = firstExpectations.reduce((sum, row) => round2(sum + row.lineTotal), 0);
  await assertInvoiceMatchesExpectations(invoiceId, firstExpectations, firstSubtotal);

  const secondBatch = [
    {
      entry_id: savedEntries[0].id,
      entry_date: today,
      lines: [{ section_code: 'medicines', catalog_item_id: med1.id, quantity: 2 }],
    },
    {
      entry_id: savedEntries[1].id,
      entry_date: today,
      lines: [{ section_code: 'medicines', catalog_item_id: med2.id, quantity: 3 }],
    },
    {
      entry_id: savedEntries[2].id,
      entry_date: today,
      lines: [{ section_code: 'supplies', catalog_item_id: supply.id, quantity: 4 }],
    },
  ];

  const secondSave = await saveEntriesBatch({
    file_number: TEST_FILE,
    patient_name: patient.name,
    entries: secondBatch,
  });

  if (!secondSave.invoice_sync?.synced) {
    console.error('FAIL: second invoice sync failed', secondSave.invoice_sync);
    process.exit(1);
  }

  assertCount('re-saved entries', secondSave.count, 3);

  const secondExpectations = secondSave.saved.map((entry) => {
    const line = entry.lines[0];
    const catalog =
      line.section_code === 'supplies'
        ? supply
        : Number(line.catalog_item_id) === Number(med1.id)
          ? med1
          : med2;
    const unitPrice = round2(catalog.price);
    const quantity = round2(line.quantity);
    return {
      lineId: line.id,
      quantity,
      unitPrice,
      lineTotal: round2(unitPrice * quantity),
    };
  });

  const secondSubtotal = secondExpectations.reduce((sum, row) => round2(sum + row.lineTotal), 0);
  await assertInvoiceMatchesExpectations(invoiceId, secondExpectations, secondSubtotal);

  console.log('OK: 3 daily rows → 3 invoice lines with correct qty/price/total');
  console.log('OK: re-save updated lines without duplicates');
  console.log(`  Invoice #${invoiceId} items_subtotal=${secondSubtotal}`);

  await testDraftDeleteDoesNotRecreate(patient);
  await cleanupPatientData(patient.id, TEST_FILE);
}

async function testDraftDeleteDoesNotRecreate(patient) {
  await cleanupPatientData(patient.id, TEST_FILE);
  const today = getCurrentBusinessDateString();
  const meds = await query(
    `SELECT id FROM daily_entry_catalog_items
     WHERE category = 'Medicine' AND is_active = TRUE AND price > 0
     ORDER BY id LIMIT 1`
  );
  if (!meds.rows.length) {
    console.error('FAIL: need medicine catalog for draft delete test');
    process.exit(1);
  }

  const save = await saveEntriesBatch({
    file_number: TEST_FILE,
    patient_name: patient.name,
    entries: [
      {
        entry_date: today,
        lines: [{ section_code: 'medicines', catalog_item_id: meds.rows[0].id, quantity: 1 }],
      },
    ],
  });
  const invoiceId = save.invoice_sync?.invoice_id;
  if (!invoiceId) {
    console.error('FAIL: draft delete test could not create invoice', save.invoice_sync);
    process.exit(1);
  }

  await query(
    `UPDATE patient_daily_entries SET invoice_id = NULL
     WHERE patient_id = $1 AND entry_date = $2`,
    [patient.id, today]
  );

  const deleted = await deleteInvoice(invoiceId);
  if (!deleted) {
    console.error('FAIL: deleteInvoice returned false');
    process.exit(1);
  }

  const { rows: entryRows } = await query(
    `SELECT COUNT(*)::int AS n FROM patient_daily_entries WHERE patient_id = $1`,
    [patient.id]
  );
  assertCount('daily entries after draft delete', entryRows[0].n, 0);

  const openRes = await query(
    `SELECT id FROM invoices
     WHERE TRIM(file_number) = TRIM($1) AND status IN ('draft', 'pending_review')
     LIMIT 1`,
    [TEST_FILE]
  );
  if (openRes.rows.length) {
    console.error(`FAIL: open draft still exists after delete (#${openRes.rows[0].id})`);
    process.exit(1);
  }

  const resync = await syncPatientDailyChargesToInvoice(TEST_FILE, patient.name);
  if (resync.synced) {
    console.error('FAIL: sync recreated draft without daily entries', resync);
    process.exit(1);
  }

  console.log('OK: deleting draft removes orphan daily entries and does not recreate invoice');
}

main().catch((err) => {
  console.error('FAIL:', err.message || err);
  process.exit(1);
});
