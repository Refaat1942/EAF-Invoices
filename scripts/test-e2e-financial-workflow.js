#!/usr/bin/env node
/**
 * End-to-end financial workflow test (real DB + application services).
 * Run: node scripts/test-e2e-financial-workflow.js
 */

const { initDatabase, query } = require('../database/db');
const { upsertPatient } = require('../services/patientService');
const {
  saveEntriesBatch,
  getCurrentBusinessDateString,
} = require('../services/dailyChargeService');
const {
  createCatalogItem,
  updateCatalogItem,
} = require('../services/dailyEntryCatalogService');
const { createService, updateService } = require('../services/serviceCatalogService');
const { getDefaultPriceList } = require('../services/priceListService');
const { createContractedEntity } = require('../services/contractedEntityService');
const {
  getInvoiceById,
  saveInvoice,
  prepareCalculationData,
} = require('../services/invoiceService');
const { calculateInvoiceTotals, round2 } = require('../services/calculations');
const {
  getDailyItemsReport,
  getSuppliesMarkupReport,
} = require('../services/reportService');

const TEST_FILE = 'E2E-FIN-WORKFLOW';
const ENTITY_NAME = 'E2E-FIN-CONTRACT-ENTITY';
const CODES = {
  med1: 'E2E-FIN-MED-10040',
  med2: 'E2E-FIN-MED-9999',
  supply: 'E2E-FIN-SUP-120',
  lab: 'E2E-FIN-LAB-75',
};

const SPECS = {
  med1: { qty: 2, unitPrice: 100.4, lineTotal: 200.8 },
  med2: { qty: 1, unitPrice: 99.99, lineTotal: 99.99 },
  supply: { qty: 3, cost: 100, markup: 20, unitPrice: 120, lineTotal: 360, margin: 60 },
  lab: { qty: 1, unitPrice: 75, lineTotal: 75 },
};

const REMAINING_TARGET = 50.51;

function money(n) {
  return round2(n);
}

class Assertions {
  constructor() {
    this.results = [];
    this.bugs = [];
  }

  pass(label) {
    this.results.push({ label, ok: true });
    console.log(`PASS: ${label}`);
  }

  fail(label, detail = '') {
    const msg = detail ? `${label} — ${detail}` : label;
    this.results.push({ label, ok: false, detail });
    console.log(`FAIL: ${msg}`);
  }

  assertTrue(label, cond, detail = '') {
    if (cond) this.pass(label);
    else this.fail(label, detail);
  }

  assertEq(label, actual, expected) {
    const a = money(actual);
    const e = money(expected);
    if (a === e) this.pass(label);
    else this.fail(label, `expected ${e}, got ${a}`);
  }

  reportBug({ bug, file, function: fn, expected, actual }) {
    this.bugs.push({ bug, file, function: fn, expected, actual });
    console.log(`BUG REPORT: ${bug}`);
    console.log(`  file: ${file}`);
    console.log(`  function: ${fn}`);
    console.log(`  expected: ${expected}`);
    console.log(`  actual: ${actual}`);
  }

  summary() {
    const passed = this.results.filter((r) => r.ok).length;
    const failed = this.results.length - passed;
    console.log('');
    console.log(`=== RESULT: ${passed}/${this.results.length} assertions passed ===`);
    if (failed) {
      console.log('Failed assertions:');
      this.results.filter((r) => !r.ok).forEach((r) => console.log(`  - ${r.label}: ${r.detail || ''}`));
    }
    if (this.bugs.length) {
      console.log('');
      console.log(`=== ${this.bugs.length} potential bug(s) reported ===`);
    }
    return failed === 0 && this.bugs.length === 0;
  }
}

async function findLabCategoryId(priceListId) {
  const { rows } = await query(
    `SELECT id FROM service_categories WHERE price_list_id = $1 AND code = 'LAB' LIMIT 1`,
    [priceListId]
  );
  return rows[0]?.id || null;
}

async function cleanupAll(patientId, entityId, fixtures) {
  if (patientId) {
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

  for (const code of Object.values(CODES)) {
    await query(`DELETE FROM daily_entry_catalog_items WHERE code = $1`, [code]);
    await query(`DELETE FROM services WHERE code = $1`, [code]);
  }

  if (entityId) {
    await query(`DELETE FROM contracted_entities WHERE id = $1`, [entityId]);
  }

  if (fixtures?.labServiceId) {
    await query(`DELETE FROM service_price_components WHERE service_id = $1`, [fixtures.labServiceId]);
    await query(`DELETE FROM service_price_tiers WHERE service_id = $1`, [fixtures.labServiceId]);
    await query(`DELETE FROM service_price_history WHERE service_id = $1`, [fixtures.labServiceId]);
    await query(`DELETE FROM services WHERE id = $1`, [fixtures.labServiceId]);
  }
}

function buildFinancialSavePayload(invoice, entityId, paymentAmount) {
  return {
    invoice_id: invoice.id,
    invoice_type: 'contracted',
    patient_name: invoice.patient_name,
    file_number: invoice.file_number,
    issue_date: invoice.issue_date,
    admission_date: invoice.admission_date,
    discharge_date: invoice.discharge_date,
    contracted_entity_id: entityId,
    admin_expenses_percent: 12,
    stamp_duty: 0,
    professional_fees: 0,
    balance: 0,
    financial_treatment: invoice.financial_treatment || '',
    notes: invoice.notes || '',
    letter_from_date: invoice.letter_from_date,
    letter_to_date: invoice.letter_to_date,
    items: (invoice.items || []).filter(
      (item) => !item.daily_entry_line_id && !item.daily_entry_id
    ),
    include_daily_charges: true,
    method_payments: [{ code: 'cash', amount: paymentAmount }],
    payments: [],
    stay_entries: invoice.stay_entries || [],
    save_mode: 'draft',
  };
}

async function countDailyInvoiceItems(invoiceId) {
  const { rows } = await query(
    `SELECT COUNT(*)::int AS n FROM invoice_items
     WHERE invoice_id = $1 AND daily_entry_line_id IS NOT NULL`,
    [invoiceId]
  );
  return rows[0].n;
}

async function assertNoDuplicateInvoiceLines(invoiceId, A) {
  const { rows } = await query(
    `SELECT daily_entry_line_id, COUNT(*)::int AS n
     FROM invoice_items
     WHERE invoice_id = $1 AND daily_entry_line_id IS NOT NULL
     GROUP BY daily_entry_line_id`,
    [invoiceId]
  );
  const dup = rows.find((r) => r.n > 1);
  A.assertTrue('no duplicate invoice items by daily_entry_line_id', !dup, dup ? `line ${dup.daily_entry_line_id} x${dup.n}` : '');
}

function entryLineByIndex(savedEntries, index) {
  return savedEntries[index]?.lines?.[0] || null;
}

async function main() {
  const A = new Assertions();
  await initDatabase();

  const patient = await upsertPatient({
    file_number: TEST_FILE,
    name: 'E2E Financial Workflow Patient',
  });
  const today = getCurrentBusinessDateString();
  const fixtures = { labServiceId: null };
  let entityId = null;

  await cleanupAll(patient.id, null, fixtures);

  const priceList = await getDefaultPriceList();
  A.assertTrue('default price list exists', Boolean(priceList?.id), 'required for laboratory service');
  if (!priceList?.id) {
    const ok = A.summary();
    process.exit(ok ? 0 : 1);
  }

  const labCategoryId = await findLabCategoryId(priceList.id);
  A.assertTrue('LAB service category exists', Boolean(labCategoryId), 'seed service_categories LAB');
  if (!labCategoryId) {
    const ok = A.summary();
    process.exit(ok ? 0 : 1);
  }

  const med1 = await createCatalogItem({
    code: CODES.med1,
    name: 'E2E Medicine 100.40',
    category: 'Medicine',
    unit: 'قرص',
    price: SPECS.med1.unitPrice,
  });
  const med2 = await createCatalogItem({
    code: CODES.med2,
    name: 'E2E Medicine 99.99',
    category: 'Medicine',
    unit: 'قرص',
    price: SPECS.med2.unitPrice,
  });
  const supply = await createCatalogItem({
    code: CODES.supply,
    name: 'E2E Supply 120',
    category: 'Supplies',
    unit: 'قطعة',
    cost_price: SPECS.supply.cost,
    markup_percent: SPECS.supply.markup,
  });

  A.assertEq('catalog med1 price from DB', med1.price, SPECS.med1.unitPrice);
  A.assertEq('catalog med2 price from DB', med2.price, SPECS.med2.unitPrice);
  A.assertEq('catalog supply selling price', supply.price, SPECS.supply.unitPrice);
  A.assertEq('catalog supply cost price', supply.cost_price, SPECS.supply.cost);
  A.assertEq('catalog supply markup %', supply.markup_percent, SPECS.supply.markup);

  const labService = await createService({
    price_list_id: priceList.id,
    category_id: labCategoryId,
    code: CODES.lab,
    name: 'E2E Laboratory Test 75',
    unit: 'تحليل',
    price: SPECS.lab.unitPrice,
    discountable: true,
    administrative_fee_applicable: false,
  });
  fixtures.labServiceId = labService.id;
  A.assertEq('lab service price from DB', labService.price, SPECS.lab.unitPrice);

  const entity = await createContractedEntity({
    name: ENTITY_NAME,
    discount_percent: 10,
  });
  entityId = entity.id;
  A.assertEq('contracted entity discount %', entity.discount_percent, 10);

  const dailyBatch = [
    {
      entry_date: today,
      lines: [{ section_code: 'medicines', catalog_item_id: med1.id, quantity: SPECS.med1.qty }],
    },
    {
      entry_date: today,
      lines: [{ section_code: 'medicines', catalog_item_id: med2.id, quantity: SPECS.med2.qty }],
    },
    {
      entry_date: today,
      lines: [{ section_code: 'supplies', catalog_item_id: supply.id, quantity: SPECS.supply.qty }],
    },
    {
      entry_date: today,
      lines: [{ section_code: 'analyses', service_id: labService.id, quantity: SPECS.lab.qty }],
    },
  ];

  let batchResult;
  try {
    batchResult = await saveEntriesBatch({
      file_number: TEST_FILE,
      patient_name: patient.name,
      entries: dailyBatch,
    });
  } catch (err) {
    A.fail('saveEntriesBatch succeeds', err.message);
    const ok = A.summary();
    await cleanupAll(patient.id, entityId, fixtures);
    process.exit(ok ? 0 : 1);
  }

  A.assertTrue('invoice sync succeeded', batchResult.invoice_sync?.synced === true);
  A.assertTrue('invoice id returned', Boolean(batchResult.invoice_sync?.invoice_id));
  A.assertEq('four daily entries saved', batchResult.count, 4);

  const savedEntries = batchResult.saved || [];
  const entryIds = new Set(savedEntries.map((e) => e.id));
  A.assertEq('four distinct daily entry ids', entryIds.size, 4);

  const { rows: dbEntries } = await query(
    `SELECT id, entry_date, patient_id FROM patient_daily_entries
     WHERE patient_id = $1 AND entry_date = $2::date`,
    [patient.id, today]
  );
  A.assertEq('four DB daily entries for patient/date', dbEntries.length, 4);
  A.assertTrue(
    'all DB entries same patient',
    dbEntries.every((r) => Number(r.patient_id) === Number(patient.id))
  );
  A.assertTrue(
    'all DB entries same date',
    dbEntries.every((r) => String(r.entry_date).slice(0, 10) === today)
  );

  const invoiceId = batchResult.invoice_sync.invoice_id;

  const entryChecks = [
    { key: 'med1', spec: SPECS.med1, isSupply: false },
    { key: 'med2', spec: SPECS.med2, isSupply: false },
    { key: 'supply', spec: SPECS.supply, isSupply: true },
    { key: 'lab', spec: SPECS.lab, isSupply: false },
  ];

  for (let i = 0; i < entryChecks.length; i++) {
    const { key, spec, isSupply } = entryChecks[i];
    const line = entryLineByIndex(savedEntries, i);
    if (!line) {
      A.fail(`daily line exists (${key})`, 'missing line');
      continue;
    }
    A.assertEq(`${key} daily line quantity`, line.quantity, spec.qty);
    A.assertEq(`${key} daily line unit_price from catalog`, line.unit_price, spec.unitPrice);
    A.assertEq(`${key} daily line amount`, line.amount, spec.lineTotal);
    if (isSupply) {
      A.assertEq(`${key} daily line cost_price`, line.cost_price, spec.cost);
      A.assertEq(`${key} daily line markup_percent`, line.markup_percent, spec.markup);
    }
  }

  const med1LineId = entryLineByIndex(savedEntries, 0)?.id;
  const med2LineId = entryLineByIndex(savedEntries, 1)?.id;
  const supplyLineId = entryLineByIndex(savedEntries, 2)?.id;
  const labLineId = entryLineByIndex(savedEntries, 3)?.id;

  A.assertEq('invoice has four daily-linked items', await countDailyInvoiceItems(invoiceId), 4);
  await assertNoDuplicateInvoiceLines(invoiceId, A);

  let invoice = await getInvoiceById(invoiceId);
  const dailyInvoiceItems = (invoice.items || []).filter((i) => i.daily_entry_line_id);
  A.assertEq('getInvoiceById daily item count', dailyInvoiceItems.length, 4);

  const expectedSubtotal = money(
    SPECS.med1.lineTotal + SPECS.med2.lineTotal + SPECS.supply.lineTotal + SPECS.lab.lineTotal
  );
  A.assertEq('invoice items_subtotal equals sum of lines', invoice.items_subtotal_raw ?? invoice.items_subtotal, expectedSubtotal);

  for (const item of dailyInvoiceItems) {
    const dailyLine = savedEntries
      .flatMap((e) => e.lines || [])
      .find((l) => Number(l.id) === Number(item.daily_entry_line_id));
    if (!dailyLine) {
      A.fail(`invoice item matches a daily line (${item.daily_entry_line_id})`, 'line not found');
      continue;
    }
    A.assertEq(
      `invoice qty matches daily line #${item.daily_entry_line_id}`,
      item.quantity,
      dailyLine.quantity
    );
    A.assertEq(
      `invoice unit price matches daily line #${item.daily_entry_line_id}`,
      item.amount,
      dailyLine.unit_price
    );
    A.assertEq(
      `invoice line total matches daily line #${item.daily_entry_line_id}`,
      money(item.quantity) * money(item.amount),
      dailyLine.amount
    );
  }

  const supplyInvoiceItem = dailyInvoiceItems.find((i) => {
    const line = savedEntries.flatMap((e) => e.lines).find((l) => Number(l.id) === Number(i.daily_entry_line_id));
    return line?.section_code === 'supplies';
  });
  if (supplyInvoiceItem) {
    A.assertEq('supply invoice selling price', supplyInvoiceItem.amount, SPECS.supply.unitPrice);
    A.assertEq('supply invoice cost snapshot', supplyInvoiceItem.cost_price_snapshot, SPECS.supply.cost);
    A.assertEq('supply invoice markup snapshot %', supplyInvoiceItem.markup_percent_snapshot, SPECS.supply.markup);
    A.assertEq('supply invoice selling snapshot', supplyInvoiceItem.selling_price_snapshot, SPECS.supply.unitPrice);
    A.assertEq('supply invoice margin snapshot', supplyInvoiceItem.margin_amount_snapshot, SPECS.supply.margin);
    A.assertEq('supply invoice margin raw', supplyInvoiceItem.supplies_margin_raw, SPECS.supply.margin);
  } else {
    A.fail('supply invoice item found', 'missing');
  }

  const calcPayload = buildFinancialSavePayload(invoice, entityId, 0);
  const calcData = await prepareCalculationData(calcPayload);
  const expectedTotals = calculateInvoiceTotals(calcData);

  A.assertEq('expected items subtotal', expectedTotals.items_subtotal_raw, expectedSubtotal);

  const labCalcItem = expectedTotals.items.find((i) => Number(i.daily_entry_line_id) === Number(labLineId));
  const medCalcItem = expectedTotals.items.find(
    (i) => Number(i.daily_entry_line_id) === Number(med1LineId)
  );
  if (labCalcItem) {
    A.assertEq('admin fee on lab item (not applicable)', labCalcItem.admin_fee_amount_raw, 0);
  } else {
    A.fail('lab item in calculation totals', 'missing');
  }
  if (medCalcItem) {
    A.assertTrue(
      'admin fee on medicine item (applicable)',
      money(medCalcItem.admin_fee_amount_raw) > 0,
      `got ${medCalcItem.admin_fee_amount_raw}`
    );
  } else {
    A.fail('medicine item in calculation totals', 'missing');
  }

  A.assertTrue(
    'discount calculated for contracted invoice',
    money(expectedTotals.discount_amount_raw) > 0,
    `got ${expectedTotals.discount_amount_raw}`
  );
  A.assertEq(
    'discount eligible subtotal',
    expectedTotals.discount_eligible_subtotal_raw,
    expectedSubtotal
  );

  const paymentAmount = money(expectedTotals.final_total_raw - REMAINING_TARGET);
  const financialPayload = buildFinancialSavePayload(invoice, entityId, paymentAmount);
  const savedFinancial = await saveInvoice(financialPayload, invoiceId, null, {
    save_mode: 'draft',
    preserve_status: true,
  });

  A.assertEq('saved invoice items_subtotal', savedFinancial.items_subtotal_raw ?? savedFinancial.items_subtotal, expectedSubtotal);
  A.assertEq('saved invoice admin expenses', savedFinancial.admin_expenses_raw ?? savedFinancial.admin_expenses, expectedTotals.admin_expenses_raw);
  A.assertEq('saved invoice discount amount', savedFinancial.discount_amount_raw ?? savedFinancial.discount_amount, expectedTotals.discount_amount_raw);
  A.assertEq('saved invoice final total (2dp)', savedFinancial.final_total_raw ?? savedFinancial.final_total, expectedTotals.final_total_raw);
  A.assertEq('saved invoice total collected', savedFinancial.total_collected_raw ?? savedFinancial.total_collected, paymentAmount);
  A.assertEq('saved invoice remaining balance', savedFinancial.remaining_raw ?? savedFinancial.remaining, REMAINING_TARGET);
  A.assertEq(
    'payment + remaining reconciles to final total',
    money(paymentAmount + REMAINING_TARGET),
    expectedTotals.final_total_raw
  );

  const resaveBatch = [
    {
      entry_id: savedEntries[0].id,
      entry_date: today,
      lines: [{ section_code: 'medicines', catalog_item_id: med1.id, quantity: SPECS.med1.qty }],
    },
    {
      entry_id: savedEntries[1].id,
      entry_date: today,
      lines: [{ section_code: 'medicines', catalog_item_id: med2.id, quantity: SPECS.med2.qty }],
    },
    {
      entry_id: savedEntries[2].id,
      entry_date: today,
      lines: [{ section_code: 'supplies', catalog_item_id: supply.id, quantity: SPECS.supply.qty }],
    },
    {
      entry_id: savedEntries[3].id,
      entry_date: today,
      lines: [{ section_code: 'analyses', service_id: labService.id, quantity: SPECS.lab.qty }],
    },
  ];

  const resaveResult = await saveEntriesBatch({
    file_number: TEST_FILE,
    patient_name: patient.name,
    entries: resaveBatch,
  });
  A.assertTrue('re-save batch invoice sync', resaveResult.invoice_sync?.synced === true);
  A.assertEq('re-save still four invoice items', await countDailyInvoiceItems(invoiceId), 4);
  await assertNoDuplicateInvoiceLines(invoiceId, A);

  invoice = await getInvoiceById(invoiceId);
  A.assertEq(
    're-save invoice subtotal unchanged',
    invoice.items_subtotal_raw ?? invoice.items_subtotal,
    expectedSubtotal
  );

  await updateCatalogItem(med1.id, {
    code: CODES.med1,
    name: 'E2E Medicine 100.40 UPDATED',
    category: 'Medicine',
    unit: 'قرص',
    price: 250,
  });
  await updateCatalogItem(supply.id, {
    code: CODES.supply,
    name: 'E2E Supply 120 UPDATED',
    category: 'Supplies',
    unit: 'قطعة',
    cost_price: 200,
    markup_percent: 50,
  });
  await updateService(labService.id, {
    price_list_id: priceList.id,
    category_id: labCategoryId,
    code: CODES.lab,
    name: 'E2E Laboratory Test 75 UPDATED',
    unit: 'تحليل',
    price: 150,
    discountable: true,
    administrative_fee_applicable: false,
  });

  const invoiceAfterCatalogChange = await getInvoiceById(invoiceId);
  const med1InvoiceItem = invoiceAfterCatalogChange.items.find(
    (i) => Number(i.daily_entry_line_id) === Number(med1LineId)
  );
  const supplyAfter = invoiceAfterCatalogChange.items.find(
    (i) => Number(i.daily_entry_line_id) === Number(supplyLineId)
  );
  const labAfter = invoiceAfterCatalogChange.items.find(
    (i) => Number(i.daily_entry_line_id) === Number(labLineId)
  );

  if (med1InvoiceItem) {
    A.assertEq('invoice med1 price unchanged after catalog edit', med1InvoiceItem.amount, SPECS.med1.unitPrice);
  }
  if (supplyAfter) {
    A.assertEq('invoice supply selling unchanged after catalog edit', supplyAfter.amount, SPECS.supply.unitPrice);
    A.assertEq('invoice supply cost snapshot unchanged', supplyAfter.cost_price_snapshot, SPECS.supply.cost);
    A.assertEq('invoice supply markup snapshot unchanged', supplyAfter.markup_percent_snapshot, SPECS.supply.markup);
    A.assertEq('invoice supply selling snapshot unchanged', supplyAfter.selling_price_snapshot, SPECS.supply.unitPrice);
    A.assertEq('invoice supply margin snapshot unchanged', supplyAfter.margin_amount_snapshot, SPECS.supply.margin);
  }
  if (labAfter) {
    A.assertEq('invoice lab price unchanged after service edit', labAfter.amount, SPECS.lab.unitPrice);
  }

  const suppliesReport = await getSuppliesMarkupReport({ file_number: TEST_FILE, from_date: today, to_date: today });
  const supplyReportRow = suppliesReport.rows.find((r) => r.item_code === CODES.supply);
  if (supplyReportRow) {
    A.assertEq('report supply cost from invoice snapshot', supplyReportRow.cost_price, SPECS.supply.cost);
    A.assertEq('report supply selling from invoice snapshot', supplyReportRow.selling_price, SPECS.supply.unitPrice);
    A.assertEq('report supply margin from invoice snapshot', supplyReportRow.margin_amount, SPECS.supply.margin);
    A.assertEq('report supply line total', supplyReportRow.line_total, SPECS.supply.lineTotal);
  } else {
    A.fail('supplies markup report row', 'missing supply row');
  }

  const itemsReport = await getDailyItemsReport('medicines_supplies', {
    file_number: TEST_FILE,
    from_date: today,
    to_date: today,
  });
  const med1ReportRow = itemsReport.rows.find((r) => money(r.unit_price) === SPECS.med1.unitPrice);
  const supplyReportRow2 = itemsReport.rows.find((r) => money(r.unit_price) === SPECS.supply.unitPrice);
  if (med1ReportRow) {
    A.assertEq('daily items report med1 unit price (stored)', med1ReportRow.unit_price, SPECS.med1.unitPrice);
    A.assertEq('daily items report med1 line total', med1ReportRow.total, SPECS.med1.lineTotal);
  } else {
    A.fail('daily items report med1 row', 'not found at stored price');
  }
  if (supplyReportRow2) {
    A.assertEq('daily items report supply unit price (snapshot)', supplyReportRow2.unit_price, SPECS.supply.unitPrice);
    A.assertEq('daily items report supply line total', supplyReportRow2.total, SPECS.supply.lineTotal);
  } else {
    A.fail('daily items report supply row', 'not found at stored price');
  }

  A.assertEq(
    'final invoice total still matches stored calculation',
    invoiceAfterCatalogChange.final_total_raw ?? invoiceAfterCatalogChange.final_total,
    expectedTotals.final_total_raw
  );

  await cleanupAll(patient.id, entityId, fixtures);

  const ok = A.summary();
  process.exit(ok ? 0 : 1);
}

main().catch(async (err) => {
  console.error('FATAL:', err.message || err);
  process.exit(1);
});
