#!/usr/bin/env node
/**
 * Catalog major/minor units, 7-digit codes, import dedupe, daily→invoice transfer.
 * Run: node --env-file=.env scripts/test-catalog-units.js
 */

const { initDatabase, query, withTransaction } = require('../database/db');
const { upsertPatient } = require('../services/patientService');
const {
  createCatalogItem,
  analyzeImportRows,
  mergeImportRowsByProduct,
  validateCatalogPayload,
  resolveCatalogUnitPrice,
  convertMinorToMajorQuantity,
  getCatalogItemByCode,
  catalogItemToPicker,
} = require('../services/dailyEntryCatalogService');
const {
  allocateNextCatalogCode,
  isValidSevenDigitCode,
} = require('../services/catalogCodeService');
const {
  saveEntriesBatch,
  getCurrentBusinessDateString,
} = require('../services/dailyChargeService');
const { getInvoiceById } = require('../services/invoiceService');

const TEST_PREFIX = 'CAT-UNIT-TEST';
const TEST_FILE = 'CAT-UNIT-DAILY';

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function assert(label, condition) {
  if (!condition) {
    console.error(`FAIL ${label}`);
    process.exit(1);
  }
}

function assertEq(label, actual, expected) {
  if (actual !== expected) {
    console.error(`FAIL ${label}: expected ${expected}, got ${actual}`);
    process.exit(1);
  }
}

async function cleanupCatalogCodes(codes = []) {
  for (const code of codes) {
    await query(`DELETE FROM daily_entry_catalog_items WHERE code = $1`, [code]);
    await query(`DELETE FROM daily_entry_catalog_code_registry WHERE code = $1`, [code]);
  }
}

async function cleanupPatient(fileNumber) {
  await query(
    `DELETE FROM invoice_items WHERE invoice_id IN (
      SELECT id FROM invoices WHERE TRIM(file_number) = TRIM($1)
    )`,
    [fileNumber]
  );
  await query(`DELETE FROM invoices WHERE TRIM(file_number) = TRIM($1)`, [fileNumber]);
  const { rows } = await query(`SELECT id FROM patients WHERE TRIM(file_number) = TRIM($1)`, [fileNumber]);
  const patientId = rows[0]?.id;
  if (!patientId) return;
  await query(
    `DELETE FROM patient_daily_entry_lines WHERE entry_id IN (
      SELECT id FROM patient_daily_entries WHERE patient_id = $1
    )`,
    [patientId]
  );
  await query(`DELETE FROM patient_daily_entries WHERE patient_id = $1`, [patientId]);
  await query(`DELETE FROM patients WHERE id = $1`, [patientId]);
}

async function testAutoCodeGeneration() {
  const item = await createCatalogItem({
    name: `${TEST_PREFIX} AUTO CODE`,
    category: 'Medicine',
    major_unit: 'PAC',
    minor_unit: 'STR',
    minor_quantity_per_major: 2,
    major_unit_selling_price: 52,
    minor_unit_selling_price: 26,
  });
  assert('auto code is 7 digits', isValidSevenDigitCode(item.code));
  const registry = await query(
    `SELECT code, catalog_item_id FROM daily_entry_catalog_code_registry WHERE code = $1`,
    [item.code]
  );
  assertEq('registry links item', Number(registry.rows[0].catalog_item_id), Number(item.id));
  await cleanupCatalogCodes([item.code]);
  console.log('OK auto 7-digit code generation');
}

async function testConcurrentCodeGeneration() {
  const codes = await withTransaction(async (client) => {
    const batch = [];
    for (let i = 0; i < 8; i++) {
      batch.push(allocateNextCatalogCode(client));
    }
    return batch;
  });
  const unique = new Set(codes);
  assertEq('concurrent codes all unique', unique.size, codes.length);
  codes.forEach((code) => assert(`code ${code} valid`, isValidSevenDigitCode(code)));
  console.log('OK concurrent code generation');
}

async function testUnitConversionAndPricing() {
  const catalogItem = {
    major_unit: 'PAC',
    minor_unit: 'STR',
    minor_quantity_per_major: 2,
    major_unit_selling_price: 52,
    minor_unit_selling_price: 26,
    price: 52,
    unit: 'PAC',
  };
  const major = resolveCatalogUnitPrice(catalogItem, 'major');
  const minor = resolveCatalogUnitPrice(catalogItem, 'minor');
  assertEq('major unit', major.unit, 'PAC');
  assertEq('major price', major.unitPrice, 52);
  assertEq('minor unit', minor.unit, 'STR');
  assertEq('minor price', minor.unitPrice, 26);
  assertEq('minor to major qty', convertMinorToMajorQuantity(4, catalogItem), 2);
  console.log('OK major/minor conversion and pricing');
}

async function testMergeSplitUnitRowsIntoOneCatalogItem() {
  const mapped = mergeImportRowsByProduct([
    {
      row_number: 2,
      name: 'ANTINAL 200MG 24/CAP',
      category: 'Medicine',
      major_unit: 'PAC',
      major_unit_selling_price: 52,
    },
    {
      row_number: 3,
      name: 'ANTINAL 200MG 24/CAP',
      category: 'Medicine',
      minor_unit: 'STR',
      minor_unit_selling_price: 26,
      minor_quantity_per_major: 2,
    },
  ]);
  assertEq('merged to one row', mapped.length, 1);
  const payload = validateCatalogPayload(mapped[0], { allowMissingCode: true });
  assertEq('item name', payload.name, 'ANTINAL 200MG 24/CAP');
  assertEq('major unit PAC', payload.major_unit, 'PAC');
  assertEq('minor unit STR', payload.minor_unit, 'STR');
  assertEq('1 PAC = 2 STR', payload.minor_quantity_per_major, 2);
  assertEq('PAC price 52', payload.major_unit_selling_price, 52);
  assertEq('STR price 26', payload.minor_unit_selling_price, 26);

  const picker = catalogItemToPicker({
    id: 1,
    code: '0000001',
    name: payload.name,
    category: payload.category,
    ...payload,
  });
  assertEq('one picker item', picker.unit_options.length, 2);
  assertEq('picker major price', picker.unit_options[0].price, 52);
  assertEq('picker minor price', picker.unit_options[1].price, 26);

  const analysis = analyzeImportRows([
    {
      row_number: 2,
      name: 'ANTINAL 200MG 24/CAP',
      category: 'Medicine',
      major_unit: 'PAC',
      major_unit_selling_price: 52,
    },
    {
      row_number: 3,
      name: 'ANTINAL 200MG 24/CAP',
      category: 'Medicine',
      minor_unit: 'STR',
      minor_unit_selling_price: 26,
      minor_quantity_per_major: 2,
    },
  ]);
  assertEq('import preview one product', analysis.preview_rows.filter((r) => r.name === 'ANTINAL 200MG 24/CAP').length, 1);
  console.log('OK merge split unit rows into one catalog item');
}

async function testDuplicateImportDetection() {
  const rows = [
    {
      row_number: 2,
      name: 'ANTINAL 200MG 24/CAP',
      category: 'Medicine',
      major_unit: 'PAC',
      minor_unit: 'STR',
      minor_quantity_per_major: 2,
      major_unit_selling_price: 52,
      minor_unit_selling_price: 26,
    },
    {
      row_number: 3,
      name: 'ANTINAL 200MG 24/CAP',
      category: 'Medicine',
      major_unit: 'PAC',
      minor_unit: 'STR',
      minor_quantity_per_major: 2,
      major_unit_selling_price: 52,
      minor_unit_selling_price: 26,
    },
    {
      row_number: 4,
      name: 'OTHER ITEM',
      category: 'Medicine',
      code: '1234567',
      major_unit: 'BOX',
      major_unit_selling_price: 10,
    },
    {
      row_number: 5,
      name: 'OTHER ITEM 2',
      category: 'Medicine',
      code: '1234567',
      major_unit: 'BOX',
      major_unit_selling_price: 20,
    },
  ];
  const analysis = analyzeImportRows(rows);
  const dup = analysis.duplicate_rows.filter((r) => r.row_number === 3);
  const conflict = analysis.conflict_rows.filter((r) => r.row_number === 5);
  assert('duplicate row detected', dup.length === 1);
  assert('code conflict detected', conflict.length === 1);
  console.log('OK duplicate import detection');
}

async function testDailyEntryToInvoiceTransfer() {
  const item = await createCatalogItem({
    name: `${TEST_PREFIX} ANTINAL STYLE`,
    category: 'Medicine',
    major_unit: 'PAC',
    minor_unit: 'STR',
    minor_quantity_per_major: 2,
    major_unit_selling_price: 52,
    minor_unit_selling_price: 26,
  });

  const patient = await upsertPatient(TEST_FILE, 'Catalog Unit Daily Test');
  await cleanupPatient(TEST_FILE);
  const today = getCurrentBusinessDateString();

  const save = await saveEntriesBatch({
    file_number: TEST_FILE,
    patient_name: patient.name,
    entries: [
      {
        entry_date: today,
        lines: [
          {
            section_code: 'medicines',
            catalog_item_id: item.id,
            catalog_unit_level: 'major',
            catalog_unit: 'PAC',
            quantity: 1,
          },
        ],
      },
      {
        entry_date: today,
        lines: [
          {
            section_code: 'medicines',
            catalog_item_id: item.id,
            catalog_unit_level: 'minor',
            catalog_unit: 'STR',
            quantity: 2,
          },
        ],
      },
    ],
  });

  const invoiceId = save.invoice_sync?.invoice_id;
  assert('invoice synced', invoiceId);
  const invoice = await getInvoiceById(invoiceId);
  const dailyItems = (invoice.items || []).filter((i) => i.daily_entry_line_id);

  const majorEntry = save.saved.find((e) =>
    e.lines.some((l) => l.catalog_unit_level === 'major')
  );
  const minorEntry = save.saved.find((e) =>
    e.lines.some((l) => l.catalog_unit_level === 'minor')
  );
  const majorLine = majorEntry.lines.find((l) => l.section_code === 'medicines');
  const minorLine = minorEntry.lines.find((l) => l.section_code === 'medicines');

  assertEq('daily major unit_price', round2(majorLine.unit_price), 52);
  assertEq('daily major catalog_unit', majorLine.catalog_unit, 'PAC');
  assertEq('daily major description', majorLine.description, item.name);

  assertEq('daily minor unit_price', round2(minorLine.unit_price), 26);
  assertEq('daily minor catalog_unit', minorLine.catalog_unit, 'STR');

  const invMajor = dailyItems.find((i) => Number(i.daily_entry_line_id) === Number(majorLine.id));
  const invMinor = dailyItems.find((i) => Number(i.daily_entry_line_id) === Number(minorLine.id));
  assert('invoice major line exists', invMajor);
  assert('invoice minor line exists', invMinor);
  assertEq('invoice major unit price', round2(invMajor.amount), 52);
  assertEq('invoice major unit snapshot', invMajor.unit_snapshot, 'PAC');
  assertEq('invoice minor unit price', round2(invMinor.amount), 26);
  assertEq('invoice minor unit snapshot', invMinor.unit_snapshot, 'STR');
  assert(invMajor.description.includes(item.name), 'invoice major name');
  assert(invMinor.description.includes(item.name), 'invoice minor name');

  await cleanupPatient(TEST_FILE);
  await cleanupCatalogCodes([item.code]);
  console.log('OK daily entry to invoice transfer');
}

async function testPreserveImportedCode() {
  const existing = await createCatalogItem({
    code: '9000001',
    name: `${TEST_PREFIX} PRESERVE`,
    category: 'Cosmetics',
    major_unit: 'EA',
    major_unit_selling_price: 15,
  });
  assertEq('preserved code', existing.code, '9000001');
  const byCode = await getCatalogItemByCode('9000001');
  assert('code lookup works', byCode && byCode.id === existing.id);
  await cleanupCatalogCodes(['9000001']);
  console.log('OK preserve valid imported 7-digit code');
}

async function main() {
  await initDatabase();
  await testAutoCodeGeneration();
  await testConcurrentCodeGeneration();
  await testUnitConversionAndPricing();
  await testMergeSplitUnitRowsIntoOneCatalogItem();
  await testDuplicateImportDetection();
  await testPreserveImportedCode();
  await testDailyEntryToInvoiceTransfer();
  console.log('ALL CATALOG UNIT TESTS PASSED');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
