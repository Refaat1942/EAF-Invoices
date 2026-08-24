#!/usr/bin/env node
/**
 * Daily entry batch save / delete consistency with invoice sync.
 * Run: node scripts/test-daily-batch-consistency.js
 * VPS: node --env-file=.env scripts/test-daily-batch-consistency.js
 */

const { initDatabase, query } = require('../database/db');
const { upsertPatient } = require('../services/patientService');
const {
  saveEntriesBatch,
  deleteEntry,
  getEntryById,
  getCurrentBusinessDateString,
} = require('../services/dailyChargeService');
const { getInvoiceById } = require('../services/invoiceService');
const invoiceService = require('../services/invoiceService');

const TEST_FILE = 'DAILY-BATCH-CONSISTENCY';

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function assert(cond, msg) {
  if (!cond) {
    console.error('FAIL:', msg);
    process.exit(1);
  }
}

function assertEq(actual, expected, msg) {
  const a = round2(actual);
  const e = round2(expected);
  if (a !== e) {
    console.error(`FAIL ${msg}: expected ${e}, got ${a}`);
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

async function countPatientEntries(patientId) {
  const { rows } = await query(`SELECT COUNT(*)::int AS n FROM patient_daily_entries WHERE patient_id = $1`, [
    patientId,
  ]);
  return rows[0]?.n || 0;
}

async function assertNoDuplicateInvoiceLines(invoiceId) {
  const { rows } = await query(
    `SELECT daily_entry_line_id, COUNT(*)::int AS n
     FROM invoice_items
     WHERE invoice_id = $1 AND daily_entry_line_id IS NOT NULL
     GROUP BY daily_entry_line_id`,
    [invoiceId]
  );
  for (const row of rows) {
    if (row.n > 1) {
      console.error(`FAIL: duplicate invoice line for daily_entry_line_id ${row.daily_entry_line_id}`);
      process.exit(1);
    }
  }
}

async function loadCatalogFixtures() {
  const meds = await query(
    `SELECT id, name, price FROM daily_entry_catalog_items
     WHERE category = 'Medicine' AND is_active = TRUE AND price > 0
     ORDER BY id LIMIT 4`
  );
  const supplies = await query(
    `SELECT id, name, price FROM daily_entry_catalog_items
     WHERE category = 'Supplies' AND is_active = TRUE AND price > 0
     ORDER BY id LIMIT 1`
  );
  if (meds.rows.length < 4 || !supplies.rows.length) {
    console.error('FAIL: need 4 medicines and 1 supply in catalog');
    process.exit(1);
  }
  return { meds: meds.rows, supply: supplies.rows[0] };
}

async function testBatchPartialSaveRollback(patient, today, meds, supply) {
  const before = await countPatientEntries(patient.id);
  const batch = [
    { entry_date: today, lines: [{ section_code: 'medicines', catalog_item_id: meds[0].id, quantity: 1 }] },
    { entry_date: today, lines: [{ section_code: 'medicines', catalog_item_id: meds[1].id, quantity: 2 }] },
    {
      entry_date: today,
      lines: [{ section_code: 'medicines', catalog_item_id: 999999999, quantity: 1 }],
    },
    { entry_date: today, lines: [{ section_code: 'supplies', catalog_item_id: supply.id, quantity: 3 }] },
  ];

  try {
    await saveEntriesBatch({
      file_number: TEST_FILE,
      patient_name: patient.name,
      entries: batch,
    });
    console.error('FAIL: batch should throw on invalid row 3');
    process.exit(1);
  } catch (err) {
    assert(String(err.message).length > 0, 'batch failure should expose error message');
  }

  const after = await countPatientEntries(patient.id);
  assertEq(after, before, 'no partial batch rows remain after row-3 failure');
  console.log('OK batch partial save rollback (row 3 fails)');
}

async function testBatchEditRollbackOnInvoiceSyncFailure(patient, today, meds) {
  const first = await saveEntriesBatch({
    file_number: TEST_FILE,
    patient_name: patient.name,
    entries: [
      { entry_date: today, lines: [{ section_code: 'medicines', catalog_item_id: meds[0].id, quantity: 1 }] },
      { entry_date: today, lines: [{ section_code: 'medicines', catalog_item_id: meds[1].id, quantity: 2 }] },
    ],
  });
  assert(first.invoice_sync?.synced, 'initial batch sync');

  const entryA = first.saved[0];
  const entryB = first.saved[1];
  const originalQtyA = entryA.lines[0].quantity;
  const originalQtyB = entryB.lines[0].quantity;

  const originalSync = invoiceService.syncPatientDailyChargesToInvoice;
  invoiceService.syncPatientDailyChargesToInvoice = async () => {
    throw new Error('FORCED_INVOICE_SYNC_FAILURE');
  };

  try {
    try {
      await saveEntriesBatch({
        file_number: TEST_FILE,
        patient_name: patient.name,
        entries: [
          {
            entry_id: entryA.id,
            entry_date: today,
            lines: [{ section_code: 'medicines', catalog_item_id: meds[0].id, quantity: 9 }],
          },
          {
            entry_id: entryB.id,
            entry_date: today,
            lines: [{ section_code: 'medicines', catalog_item_id: meds[1].id, quantity: 8 }],
          },
        ],
      });
      console.error('FAIL: edit batch should throw when invoice sync fails');
      process.exit(1);
    } catch (err) {
      assert(String(err.message).includes('FORCED_INVOICE_SYNC_FAILURE'), 'forced sync error surfaced');
    }

    const restoredA = await getEntryById(entryA.id);
    const restoredB = await getEntryById(entryB.id);
    assertEq(restoredA.lines[0].quantity, originalQtyA, 'entry A quantity restored');
    assertEq(restoredB.lines[0].quantity, originalQtyB, 'entry B quantity restored');
    console.log('OK edit batch rollback on invoice sync failure');
  } finally {
    invoiceService.syncPatientDailyChargesToInvoice = originalSync;
  }
}

async function testDeleteWithSuccessfulInvoiceSync(patient, today, meds, supply) {
  const save = await saveEntriesBatch({
    file_number: TEST_FILE,
    patient_name: patient.name,
    entries: [
      { entry_date: today, lines: [{ section_code: 'medicines', catalog_item_id: meds[2].id, quantity: 1 }] },
      { entry_date: today, lines: [{ section_code: 'supplies', catalog_item_id: supply.id, quantity: 2 }] },
    ],
  });
  const invoiceId = save.invoice_sync.invoice_id;
  const target = save.saved[0];
  const lineId = target.lines[0].id;

  const result = await deleteEntry(target.id);
  assert(result.deleted, 'delete succeeded');
  assert(result.invoice_sync?.synced, 'invoice sync after delete');

  const gone = await getEntryById(target.id);
  assert(!gone, 'daily entry removed');

  const invoice = await getInvoiceById(invoiceId);
  const stillLinked = (invoice.items || []).some((i) => Number(i.daily_entry_line_id) === Number(lineId));
  assert(!stillLinked, 'invoice line removed after delete sync');
  console.log('OK delete entry with successful invoice sync');
}

async function testDeleteRollbackOnInvoiceSyncFailure(patient, today, meds) {
  const save = await saveEntriesBatch({
    file_number: TEST_FILE,
    patient_name: patient.name,
    entries: [
      { entry_date: today, lines: [{ section_code: 'medicines', catalog_item_id: meds[3].id, quantity: 3 }] },
    ],
  });
  const entry = save.saved[0];
  const snapshotLineId = entry.lines[0].id;
  const snapshotQty = entry.lines[0].quantity;

  const originalSync = invoiceService.syncInvoiceAfterDailyChange;
  invoiceService.syncInvoiceAfterDailyChange = async () => {
    throw new Error('FORCED_DELETE_SYNC_FAILURE');
  };

  try {
    try {
      await deleteEntry(entry.id);
      console.error('FAIL: delete should throw when invoice sync fails');
      process.exit(1);
    } catch (err) {
      assert(String(err.message).includes('استعادة الحركة'), 'delete failure mentions restore');
    }

    const restored = await getEntryById(entry.id);
    assert(restored, 'daily entry still exists after failed delete sync');
    assertEq(Number(restored.lines[0].id), Number(snapshotLineId), 'restored line id preserved');
    assertEq(restored.lines[0].quantity, snapshotQty, 'restored line quantity preserved');
    console.log('OK delete rollback when invoice sync fails');
  } finally {
    invoiceService.syncInvoiceAfterDailyChange = originalSync;
  }
}

async function testResaveBatchNoDuplicateInvoiceLines(patient, today, meds, supply) {
  const first = await saveEntriesBatch({
    file_number: TEST_FILE,
    patient_name: patient.name,
    entries: [
      { entry_date: today, lines: [{ section_code: 'medicines', catalog_item_id: meds[0].id, quantity: 1 }] },
      { entry_date: today, lines: [{ section_code: 'supplies', catalog_item_id: supply.id, quantity: 4 }] },
    ],
  });
  const invoiceId = first.invoice_sync.invoice_id;

  const second = await saveEntriesBatch({
    file_number: TEST_FILE,
    patient_name: patient.name,
    entries: [
      {
        entry_id: first.saved[0].id,
        entry_date: today,
        lines: [{ section_code: 'medicines', catalog_item_id: meds[0].id, quantity: 2 }],
      },
      {
        entry_id: first.saved[1].id,
        entry_date: today,
        lines: [{ section_code: 'supplies', catalog_item_id: supply.id, quantity: 5 }],
      },
    ],
  });
  assert(second.invoice_sync?.synced, 're-save batch sync');
  assertEq(second.invoice_sync.invoice_id, invoiceId, 'same invoice id on re-save');
  await assertNoDuplicateInvoiceLines(invoiceId);
  console.log('OK re-save batch does not duplicate invoice lines');
}

async function main() {
  await initDatabase();

  const patient = await upsertPatient(TEST_FILE, 'Batch Consistency Test');
  const today = getCurrentBusinessDateString();
  const { meds, supply } = await loadCatalogFixtures();

  await cleanupPatientData(patient.id, TEST_FILE);

  await testBatchPartialSaveRollback(patient, today, meds, supply);
  await cleanupPatientData(patient.id, TEST_FILE);

  await testBatchEditRollbackOnInvoiceSyncFailure(patient, today, meds);
  await cleanupPatientData(patient.id, TEST_FILE);

  await testDeleteWithSuccessfulInvoiceSync(patient, today, meds, supply);
  await cleanupPatientData(patient.id, TEST_FILE);

  await testDeleteRollbackOnInvoiceSyncFailure(patient, today, meds);
  await cleanupPatientData(patient.id, TEST_FILE);

  await testResaveBatchNoDuplicateInvoiceLines(patient, today, meds, supply);
  await cleanupPatientData(patient.id, TEST_FILE);

  console.log('ALL DAILY BATCH CONSISTENCY TESTS PASSED');
}

main().catch((err) => {
  if (String(err.message || err).includes('password authentication')) {
    console.log('SKIP DB tests (no database)');
    return;
  }
  console.error(err);
  process.exit(1);
});
