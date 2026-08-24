#!/usr/bin/env node
/**
 * Daily entry batch save / delete consistency with invoice sync.
 * Run: node scripts/test-daily-batch-consistency.js
 * VPS: node --env-file=.env scripts/test-daily-batch-consistency.js
 */

const { initDatabase, query } = require('../database/db');
const { upsertPatient } = require('../services/patientService');
const { createCatalogItem } = require('../services/dailyEntryCatalogService');
const {
  saveEntriesBatch,
  deleteEntry,
  getEntryById,
  getCurrentBusinessDateString,
} = require('../services/dailyChargeService');
const { getInvoiceById } = require('../services/invoiceService');
const invoiceService = require('../services/invoiceService');

const TEST_FILE = 'DAILY-BATCH-CONSISTENCY';
const TEST_PREFIX = 'BATCH-E2E';

const CATALOG_CODES = {
  med1: '9010001',
  med2: '9010002',
  med3: '9010003',
  med4: '9010004',
  supply: '9010005',
};

const MEDICINE_FIXTURE = {
  category: 'Medicine',
  major_unit: 'قرص',
  minor_unit: 'قرص',
  minor_quantity_per_major: 1,
};

const SUPPLY_FIXTURE = {
  category: 'Supplies',
  major_unit: 'قطعة',
  minor_unit: 'قطعة',
  minor_quantity_per_major: 1,
  cost_price: 60,
  markup_percent: 40,
};

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function assert(cond, msg) {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

function assertEq(actual, expected, msg) {
  const a = round2(actual);
  const e = round2(expected);
  if (a !== e) throw new Error(`FAIL ${msg}: expected ${e}, got ${a}`);
}

async function createTestCatalogItem(spec) {
  try {
    return await createCatalogItem(spec);
  } catch (err) {
    const codeLabel = spec.code ? `code=${spec.code}` : 'code=auto';
    throw new Error(
      `Catalog provisioning failed for «${spec.name}» (${codeLabel}, category=${spec.category}): ${err.message}`
    );
  }
}

async function cleanupTestCatalog() {
  for (const code of Object.values(CATALOG_CODES)) {
    await query(`DELETE FROM daily_entry_catalog_items WHERE code = $1`, [code]);
    await query(`DELETE FROM daily_entry_catalog_code_registry WHERE code = $1`, [code]);
  }
}

async function provisionTestCatalog() {
  const medPrices = [52, 48, 44, 40];
  const meds = [];

  for (let i = 0; i < 4; i++) {
    const price = medPrices[i];
    const key = `med${i + 1}`;
    meds.push(
      await createTestCatalogItem({
        code: CATALOG_CODES[key],
        name: `${TEST_PREFIX} Medicine ${String(i + 1).padStart(2, '0')}`,
        ...MEDICINE_FIXTURE,
        major_unit_selling_price: price,
        minor_unit_selling_price: price,
        price: price,
      })
    );
  }

  const supply = await createTestCatalogItem({
    code: CATALOG_CODES.supply,
    name: `${TEST_PREFIX} Supply 01`,
    ...SUPPLY_FIXTURE,
  });

  return { meds, supply };
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
      throw new Error(`FAIL: duplicate invoice line for daily_entry_line_id ${row.daily_entry_line_id}`);
    }
  }
}

async function testSuccessfulBatchPreservesAllRows(patient, today, meds) {
  const save = await saveEntriesBatch({
    file_number: TEST_FILE,
    patient_name: patient.name,
    entries: [
      { entry_date: today, lines: [{ section_code: 'medicines', catalog_item_id: meds[0].id, quantity: 1 }] },
      { entry_date: today, lines: [{ section_code: 'medicines', catalog_item_id: meds[1].id, quantity: 2 }] },
    ],
  });
  assert(save.invoice_sync?.synced, 'successful batch sync');
  assertEq(save.count, 2, 'successful batch count');
  assertEq(await countPatientEntries(patient.id), 2, 'successful batch rows persisted');
  console.log('OK successful batch preserves all rows');
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
    throw new Error('FAIL: batch should throw on invalid row 3');
  } catch (err) {
    assert(String(err.message).length > 0, 'batch failure should expose error message');
    assert(!String(err.message).startsWith('FAIL: batch should throw'), err.message);
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
      throw new Error('FAIL: edit batch should throw when invoice sync fails');
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
      throw new Error('FAIL: delete should throw when invoice sync fails');
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

  let patient = null;
  try {
    await cleanupTestCatalog();
    const { meds, supply } = await provisionTestCatalog();

    patient = await upsertPatient(TEST_FILE, 'Batch Consistency Test');
    const today = getCurrentBusinessDateString();

    await cleanupPatientData(patient.id, TEST_FILE);

    await testSuccessfulBatchPreservesAllRows(patient, today, meds);
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
  } finally {
    if (patient?.id) {
      await cleanupPatientData(patient.id, TEST_FILE);
    }
    await cleanupTestCatalog();
  }
}

main().catch((err) => {
  if (String(err.message || err).includes('password authentication')) {
    console.log('SKIP DB tests (no database)');
    return;
  }
  console.error(err);
  process.exit(1);
});
