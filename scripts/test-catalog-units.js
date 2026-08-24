#!/usr/bin/env node
/**
 * Catalog major/minor units, 7-digit codes, import dedupe, daily→invoice transfer.
 * Run: node --env-file=.env scripts/test-catalog-units.js
 */

const { initDatabase, query, withTransaction, pool } = require('../database/db');
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
  importCatalogRowsTransactional,
  findCatalogItemByProduct,
  normalizeUnitFields,
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

function assertThrows(label, fn) {
  try {
    fn();
    console.error(`FAIL ${label}: expected throw`);
    process.exit(1);
  } catch (err) {
    if (!err.message) {
      console.error(`FAIL ${label}: throw without message`);
      process.exit(1);
    }
  }
}

async function cleanupCatalogByName(name) {
  const { rows } = await query(
    `SELECT code FROM daily_entry_catalog_items WHERE LOWER(TRIM(name)) = LOWER(TRIM($1))`,
    [name]
  );
  for (const row of rows) {
    await query(`DELETE FROM daily_entry_catalog_items WHERE code = $1`, [row.code]);
    await query(`DELETE FROM daily_entry_catalog_code_registry WHERE code = $1`, [row.code]);
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

const ANTINAL_ROWS = [
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
];

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
      batch.push(await allocateNextCatalogCode(client));
    }
    return batch;
  });
  const unique = new Set(codes);
  assertEq('concurrent codes all unique', unique.size, codes.length);
  codes.forEach((code) => assert(`code ${code} valid`, isValidSevenDigitCode(code)));
  console.log('OK concurrent code generation');
}

async function testParallelConcurrentCodeGeneration() {
  const workers = 6;
  const perWorker = 4;
  const batches = await Promise.all(
    Array.from({ length: workers }, () =>
      withTransaction(async (client) => {
        const codes = [];
        for (let i = 0; i < perWorker; i++) {
          codes.push(await allocateNextCatalogCode(client));
        }
        return codes;
      })
    )
  );
  const allCodes = batches.flat();
  const unique = new Set(allCodes);
  assertEq('parallel codes all unique', unique.size, allCodes.length);
  allCodes.forEach((code) => assert(`parallel code ${code} valid`, isValidSevenDigitCode(code)));
  console.log('OK parallel concurrent code generation');
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

async function testSingleUnitProduct() {
  const units = normalizeUnitFields({
    name: 'Supply item',
    major_unit: 'EA',
    major_unit_selling_price: 15,
  });
  assertEq('single unit major', units.major_unit, 'EA');
  assertEq('single unit minor equals major', units.minor_unit, 'EA');
  assertEq('single unit ratio 1', units.minor_quantity_per_major, 1);
  assertEq('single unit one price tier', units.minor_unit_selling_price, 15);

  const picker = catalogItemToPicker({
    id: 99,
    code: '0000099',
    name: `${TEST_PREFIX} SINGLE UNIT`,
    category: 'Cosmetics',
    ...units,
  });
  assertEq('single unit picker options', picker.unit_options.length, 1);
  assertEq('single unit picker price', picker.unit_options[0].price, 15);
  console.log('OK single-unit product without fake second unit');
}

async function testExplicitMinorPricePreserved() {
  const units = normalizeUnitFields({
    major_unit: 'PAC',
    minor_unit: 'STR',
    minor_quantity_per_major: 2,
    major_unit_selling_price: 52,
    minor_unit_selling_price: 26,
  });
  assertEq('explicit minor price preserved', units.minor_unit_selling_price, 26);
  console.log('OK explicit minor price preserved');
}

async function testMinorMajorPriceConsistencyRejects() {
  assertThrows('inconsistent minor price rejected', () =>
    validateCatalogPayload({
      name: 'Bad price item',
      category: 'Medicine',
      major_unit: 'PAC',
      minor_unit: 'STR',
      minor_quantity_per_major: 2,
      major_unit_selling_price: 52,
      minor_unit_selling_price: 30,
    })
  );
  console.log('OK minor/major price consistency validation');
}

async function testMergeSplitUnitRowsIntoOneCatalogItem() {
  const mapped = mergeImportRowsByProduct(ANTINAL_ROWS);
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

  const analysis = analyzeImportRows(ANTINAL_ROWS);
  assertEq(
    'import preview one product',
    analysis.preview_rows.filter((r) => r.name === 'ANTINAL 200MG 24/CAP').length,
    1
  );
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

async function testDuplicateCodeRejected() {
  const first = await createCatalogItem({
    code: '9000002',
    name: `${TEST_PREFIX} CODE DUP A`,
    category: 'Medicine',
    major_unit: 'EA',
    major_unit_selling_price: 10,
  });
  let rejected = false;
  try {
    await createCatalogItem({
      code: '9000002',
      name: `${TEST_PREFIX} CODE DUP B`,
      category: 'Medicine',
      major_unit: 'EA',
      major_unit_selling_price: 11,
    });
  } catch (err) {
    rejected = err.message.includes('9000002');
  }
  assert('duplicate code rejected on create', rejected);
  await cleanupCatalogCodes([first.code]);
  console.log('OK duplicate code rejected');
}

async function testDuplicateProductRejected() {
  const first = await createCatalogItem({
    name: `${TEST_PREFIX} PRODUCT DUP`,
    category: 'Cosmetics',
    major_unit: 'EA',
    major_unit_selling_price: 12,
  });
  let rejected = false;
  try {
    await createCatalogItem({
      name: `${TEST_PREFIX} PRODUCT DUP`,
      category: 'Cosmetics',
      major_unit: 'EA',
      major_unit_selling_price: 13,
    });
  } catch (err) {
    rejected = err.message.includes('موجود بالفعل');
  }
  assert('duplicate product rejected on create', rejected);
  await cleanupCatalogCodes([first.code]);
  console.log('OK duplicate product rejected');
}

async function testImportWithoutCodeGeneratesCode() {
  const importName = `${TEST_PREFIX} IMPORT NO CODE`;
  await cleanupCatalogByName(importName);

  const result = await importCatalogRowsTransactional([
    {
      row_number: 2,
      name: importName,
      category: 'Medicine',
      major_unit: 'PAC',
      minor_unit: 'STR',
      minor_quantity_per_major: 2,
      major_unit_selling_price: 52,
      minor_unit_selling_price: 26,
    },
  ]);
  assertEq('import inserted one', result.inserted, 1);
  const found = await findCatalogItemByProduct({ name: importName, category: 'Medicine' });
  assert('imported item found', found);
  assert('import generated 7-digit code', isValidSevenDigitCode(found.code));
  await cleanupCatalogCodes([found.code]);
  console.log('OK import without code generates code');
}

async function testRepeatedImportNoDuplicateCatalogItems() {
  const importName = 'ANTINAL 200MG 24/CAP';
  await cleanupCatalogByName(importName);

  const first = await importCatalogRowsTransactional(ANTINAL_ROWS);
  assertEq('first import inserted', first.inserted, 1);

  const second = await importCatalogRowsTransactional(ANTINAL_ROWS);
  assertEq('second import skipped duplicate', second.skipped, 1);
  assertEq('second import inserted none', second.inserted, 0);

  const { rows } = await query(
    `SELECT COUNT(*)::int AS count FROM daily_entry_catalog_items
     WHERE LOWER(TRIM(name)) = LOWER(TRIM($1)) AND category = 'Medicine'`,
    [importName]
  );
  assertEq('one ANTINAL catalog item only', rows[0].count, 1);

  const item = await findCatalogItemByProduct({ name: importName, category: 'Medicine' });
  assertEq('ANTINAL major unit PAC', item.major_unit, 'PAC');
  assertEq('ANTINAL minor unit STR', item.minor_unit, 'STR');
  assertEq('ANTINAL major price 52', round2(item.major_unit_selling_price), 52);
  assertEq('ANTINAL minor price 26', round2(item.minor_unit_selling_price), 26);
  assertEq('ANTINAL ratio 2', round2(item.minor_quantity_per_major), 2);

  await cleanupCatalogCodes([item.code]);
  console.log('OK repeated import does not duplicate catalog items');
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
  await testParallelConcurrentCodeGeneration();
  await testUnitConversionAndPricing();
  await testSingleUnitProduct();
  await testExplicitMinorPricePreserved();
  await testMinorMajorPriceConsistencyRejects();
  await testMergeSplitUnitRowsIntoOneCatalogItem();
  await testDuplicateImportDetection();
  await testDuplicateCodeRejected();
  await testDuplicateProductRejected();
  await testImportWithoutCodeGeneratesCode();
  await testRepeatedImportNoDuplicateCatalogItems();
  await testPreserveImportedCode();
  await testDailyEntryToInvoiceTransfer();
  console.log('ALL CATALOG UNIT TESTS PASSED');
  await pool.end();
}

main().catch(async (err) => {
  console.error(err);
  try {
    await pool.end();
  } catch (_) {
    /* ignore */
  }
  process.exit(1);
});
