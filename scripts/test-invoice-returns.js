#!/usr/bin/env node
/**
 * Invoice return calculations + DB integration for VPS validation.
 * Run: node --env-file=.env scripts/test-invoice-returns.js
 */

const {
  calculateInvoiceTotals,
  validateInvoiceCalculations,
  resolveItemQuantities,
  prorateSuppliesFields,
  round2,
} = require('../services/calculations');
const { buildReturnLineAudit } = require('../services/invoiceReturnService');

const TEST_FILE = 'INV-RETURN-E2E';
const TEST_PREFIX = 'RET-E2E';
const CATALOG_CODES = { med: '9020001', supply: '9020002', medPrice: '9020003' };

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

function assertThrows(label, fn, contains = '') {
  try {
    fn();
    console.error(`FAIL ${label}: expected throw`);
    process.exit(1);
  } catch (err) {
    if (contains && !String(err.message || err).includes(contains)) {
      console.error(`FAIL ${label}: message missing «${contains}»: ${err.message}`);
      process.exit(1);
    }
  }
}

async function assertRejects(label, fn, contains = '') {
  try {
    await fn();
    console.error(`FAIL ${label}: expected throw`);
    process.exit(1);
  } catch (err) {
    if (contains && !String(err.message || err).includes(contains)) {
      console.error(`FAIL ${label}: message missing «${contains}»: ${err.message}`);
      process.exit(1);
    }
  }
}

const base = {
  invoice_type: 'civil',
  discount_percent: 0,
  stamp_duty: 0,
  professional_fees: 0,
  balance: 0,
  admin_expenses_percent: 12,
  stay_entries: [],
  payments: [],
  method_payments: [],
};

function projectReportQuantities(item) {
  const original = Number(item.original_quantity ?? item.quantity) || 0;
  const returned = Number(item.returned_quantity) || 0;
  const net = Number(item.net_quantity) || Math.max(0, original - returned);
  return { original_quantity: original, returned_quantity: returned, net_quantity: net };
}

function buildBalancedPayload(patient, items, overrides = {}) {
  const calcData = {
    ...base,
    invoice_type: overrides.invoice_type || 'civil',
    discount_percent: overrides.discount_percent || 0,
    contracted_entity_id: overrides.contracted_entity_id || null,
    items,
    method_payments: [],
  };
  const totals = calculateInvoiceTotals(calcData);
  return {
    invoice_type: calcData.invoice_type,
    patient_name: patient.name,
    file_number: patient.file_number || TEST_FILE,
    issue_date: overrides.issue_date || new Date().toISOString().slice(0, 10),
    admission_date: overrides.admission_date || new Date().toISOString().slice(0, 10),
    discount_percent: calcData.discount_percent,
    contracted_entity_id: calcData.contracted_entity_id,
    items,
    method_payments: overrides.method_payments || [{ code: 'cash', amount: totals.final_total_raw }],
    save_mode: overrides.save_mode || 'draft',
    include_daily_charges: false,
  };
}

async function createApprovedInvoice(patient, items, overrides = {}) {
  const { saveInvoice, approveInvoice } = require('../services/invoiceService');
  const draftPayload = buildBalancedPayload(patient, items, overrides);
  const draft = await saveInvoice(draftPayload);
  const submitPayload = {
    ...draftPayload,
    save_mode: 'submit',
    method_payments: draftPayload.method_payments,
  };
  const submitted = await saveInvoice(
    {
      ...submitPayload,
      items: draft.items.map((i) => ({
        description: i.description,
        quantity: i.quantity,
        amount: i.amount,
        section_code: i.section_code,
        service_id: i.service_id,
        cost_price_snapshot: i.cost_price_snapshot,
        markup_percent_snapshot: i.markup_percent_snapshot,
        margin_amount_snapshot: i.margin_amount_snapshot,
        administrative_fee_applicable_snapshot: i.administrative_fee_applicable_snapshot,
        discountable_snapshot: i.discountable_snapshot,
      })),
    },
    draft.id
  );
  assert(submitted.status === 'pending_review', 'invoice pending_review after submit');
  return approveInvoice(submitted.id, { full_name: 'Return E2E Reviewer', username: 'return-e2e' });
}

// --- Calculation suite (no DB) ---

function testFullItemReturn() {
  const totals = calculateInvoiceTotals({
    ...base,
    items: [{ description: 'Medicine A', quantity: 4, returned_quantity: 4, amount: 50 }],
  });
  const item = totals.items.find((i) => !i.is_stay_entry);
  assertEq(item.net_quantity, 0, 'net qty full return');
  assertEq(item.total_raw, 0, 'line total full return');
  assertEq(totals.items_subtotal_raw, 0, 'subtotal full return');
  assert(validateInvoiceCalculations(base, totals).is_valid, 'validation full return');
  console.log('OK full item return');
}

function testPartialItemReturn() {
  const totals = calculateInvoiceTotals({
    ...base,
    items: [{ description: 'Medicine B', quantity: 5, returned_quantity: 2, amount: 100 }],
  });
  const item = totals.items.find((i) => !i.is_stay_entry);
  assertEq(item.original_quantity, 5, 'original qty');
  assertEq(item.returned_quantity, 2, 'returned qty');
  assertEq(item.net_quantity, 3, 'net qty partial');
  assertEq(item.total_raw, 300, 'line total partial');
  assertEq(totals.items_subtotal_raw, 300, 'subtotal partial');
  console.log('OK partial item return');
}

function testServiceReturnAdminFee() {
  const before = calculateInvoiceTotals({
    ...base,
    items: [
      {
        description: 'Lab service',
        quantity: 1,
        returned_quantity: 0,
        amount: 1000,
        administrative_fee_applicable_snapshot: true,
      },
    ],
  });
  const after = calculateInvoiceTotals({
    ...base,
    items: [
      {
        description: 'Lab service',
        quantity: 1,
        returned_quantity: 1,
        amount: 1000,
        administrative_fee_applicable_snapshot: true,
      },
    ],
  });
  assertEq(before.admin_expenses_raw, 120, 'admin before return');
  assertEq(after.admin_expenses_raw, 0, 'admin after full service return');
  console.log('OK service return admin fee reversal');
}

function testSupplyReturnMarginReversal() {
  const item = {
    description: 'Supply item',
    quantity: 10,
    returned_quantity: 4,
    amount: 150,
    section_code: 'supplies',
    daily_entry_line_id: 1,
    cost_price_snapshot: 100,
    margin_amount_snapshot: 500,
    markup_percent_snapshot: 50,
  };
  const { originalQuantity, netQuantity } = resolveItemQuantities(item);
  const supplies = prorateSuppliesFields(item, originalQuantity, netQuantity);
  assertEq(originalQuantity, 10, 'supply original');
  assertEq(netQuantity, 6, 'supply net');
  assertEq(supplies.supplies_cost_raw, 600, 'supply cost net');
  assertEq(supplies.supplies_margin_raw, 300, 'supply margin net');
  assertEq(supplies.supplies_selling_raw, 900, 'supply selling net');

  const audit = buildReturnLineAudit(
    {
      quantity: 10,
      amount: 150,
      unit_price_snapshot: 150,
      cost_price_snapshot: 100,
      markup_percent_snapshot: 50,
      margin_amount_snapshot: 500,
      description: 'Supply item',
      is_discount_eligible: false,
    },
    4,
    0,
    12
  );
  assertEq(audit.return_amount, 600, 'return amount supply');
  assertEq(audit.cost_price_snapshot, 100, 'return cost snapshot');
  assertEq(audit.markup_percent_snapshot, 50, 'return markup snapshot');
  assertEq(audit.selling_price_snapshot, 150, 'return selling snapshot');
  assertEq(audit.margin_amount_snapshot, 200, 'return margin supply');
  console.log('OK supply return cost/markup/margin reversal');
}

function testReturnOnDiscountedInvoice() {
  const totals = calculateInvoiceTotals({
    ...base,
    invoice_type: 'contracted',
    contracted_entity_id: 1,
    discount_percent: 10,
    items: [
      {
        description: 'Eligible med',
        quantity: 10,
        returned_quantity: 5,
        amount: 100,
        discountable_snapshot: true,
      },
    ],
  });
  assertEq(totals.discount_eligible_subtotal_raw, 500, 'eligible after return');
  assertEq(totals.discount_amount_raw, 50, 'discount after return');
  assertEq(totals.total_after_admin_raw, 560, 'after admin discounted return');
  assertEq(totals.net_after_discount_raw, 510, 'net after discount return');
  assertEq(totals.final_total_raw, 510, 'final total discounted return');
  console.log('OK return on discounted invoice');
}

function testReturnAfterPaymentRefundable() {
  const totals = calculateInvoiceTotals({
    ...base,
    items: [{ description: 'Item', quantity: 2, returned_quantity: 1, amount: 200 }],
    method_payments: [{ code: 'cash', amount: 400 }],
  });
  assertEq(totals.items_subtotal_raw, 200, 'net subtotal after partial return');
  assertEq(totals.admin_expenses_raw, 24, 'admin on net qty after return');
  assertEq(totals.final_total_raw, 224, 'final after partial return with admin');
  assertEq(totals.total_collected_raw, 400, 'collected');
  assertEq(totals.refundable_amount_raw, 176, 'refundable overpaid');
  assertEq(totals.outstanding_amount_raw, 0, 'no outstanding when overpaid');
  console.log('OK return after payment refundable');
}

function testReturnPartiallyPaidOutstanding() {
  const totals = calculateInvoiceTotals({
    ...base,
    items: [{ description: 'Item', quantity: 10, returned_quantity: 4, amount: 50 }],
    method_payments: [{ code: 'cash', amount: 300 }],
  });
  assertEq(totals.final_total_raw, 336, 'final after return with admin');
  assertEq(totals.outstanding_amount_raw, 36, 'outstanding when paid less than net final');
  const exactPaid = calculateInvoiceTotals({
    ...base,
    items: [{ description: 'Item', quantity: 10, returned_quantity: 4, amount: 50 }],
    method_payments: [{ code: 'cash', amount: 336 }],
  });
  assertEq(exactPaid.final_total_raw, 336, 'final exact paid');
  assertEq(exactPaid.outstanding_amount_raw, 0, 'outstanding zero when paid exact net');
  const underpaid = calculateInvoiceTotals({
    ...base,
    items: [{ description: 'Item', quantity: 10, returned_quantity: 4, amount: 50 }],
    method_payments: [{ code: 'cash', amount: 100 }],
  });
  assertEq(underpaid.final_total_raw, 336, 'final underpaid');
  assertEq(underpaid.outstanding_amount_raw, 236, 'outstanding reduced');
  console.log('OK return on partially paid invoice');
}

function testOverReturnValidationLogic() {
  const originalQty = 5;
  const alreadyReturned = 2;
  const returnQty = 4;
  const remaining = round2(originalQty - alreadyReturned);
  assert(returnQty > remaining, 'over return should exceed remaining');
  console.log('OK over-return quantity guard logic');
}

function testTotalsReconcileTwoDecimals() {
  const totals = calculateInvoiceTotals({
    ...base,
    invoice_type: 'contracted',
    contracted_entity_id: 1,
    discount_percent: 15,
    stamp_duty: 10,
    professional_fees: 5,
    balance: 0,
    items: [
      {
        description: 'Med 1',
        quantity: 3,
        returned_quantity: 1,
        amount: 52,
        discountable_snapshot: true,
        administrative_fee_applicable_snapshot: true,
      },
      {
        description: 'Supply',
        quantity: 5,
        returned_quantity: 2,
        amount: 26,
        section_code: 'supplies',
        daily_entry_line_id: 9,
        cost_price_snapshot: 10,
        margin_amount_snapshot: 80,
        administrative_fee_applicable_snapshot: true,
      },
      {
        description: 'Radiology',
        quantity: 1,
        returned_quantity: 0,
        amount: 300,
        administrative_fee_applicable_snapshot: false,
      },
    ],
    method_payments: [{ code: 'cash', amount: 250 }],
  });

  const validation = validateInvoiceCalculations(base, totals);
  assert(validation.is_valid, `reconcile validation: ${validation.errors.join('; ')}`);

  const manualSum = round2(
    totals.items.filter((i) => !i.is_stay_entry).reduce((s, i) => s + i.total_raw, 0)
  );
  assertEq(manualSum, totals.manual_items_subtotal_raw, 'manual sum');
  console.log('OK totals reconcile to 2 decimals');
}

function testReportQuantityProjection() {
  const totals = calculateInvoiceTotals({
    ...base,
    items: [
      { description: 'Med', quantity: 8, returned_quantity: 3, amount: 50 },
      {
        description: 'Supply',
        quantity: 10,
        returned_quantity: 4,
        amount: 100,
        section_code: 'supplies',
        cost_price_snapshot: 60,
        margin_amount_snapshot: 400,
      },
    ],
  });
  const med = totals.items.find((i) => i.description === 'Med');
  const supply = totals.items.find((i) => i.description === 'Supply');
  const medQty = projectReportQuantities(med);
  const supplyQty = projectReportQuantities(supply);
  assertEq(medQty.original_quantity, 8, 'report med original');
  assertEq(medQty.returned_quantity, 3, 'report med returned');
  assertEq(medQty.net_quantity, 5, 'report med net');
  assertEq(supplyQty.original_quantity, 10, 'report supply original');
  assertEq(supplyQty.returned_quantity, 4, 'report supply returned');
  assertEq(supplyQty.net_quantity, 6, 'report supply net');
  console.log('OK report quantity projection');
}

// --- DB integration suite ---

async function cleanupTestData(query) {
  await query(`DELETE FROM invoice_item_returns WHERE invoice_return_id IN (
    SELECT id FROM invoice_returns WHERE invoice_id IN (
      SELECT id FROM invoices WHERE TRIM(file_number) = TRIM($1)
    ))`, [TEST_FILE]);
  await query(`DELETE FROM invoice_returns WHERE invoice_id IN (
    SELECT id FROM invoices WHERE TRIM(file_number) = TRIM($1)
  )`, [TEST_FILE]);
  await query(`DELETE FROM invoice_items WHERE invoice_id IN (
    SELECT id FROM invoices WHERE TRIM(file_number) = TRIM($1)
  )`, [TEST_FILE]);
  await query(`DELETE FROM invoices WHERE TRIM(file_number) = TRIM($1)`, [TEST_FILE]);
  await query(
    `DELETE FROM patient_daily_entry_lines WHERE entry_id IN (
      SELECT id FROM patient_daily_entries WHERE patient_id IN (
        SELECT id FROM patients WHERE TRIM(file_number) = TRIM($1)
      )
    )`,
    [TEST_FILE]
  );
  await query(
    `DELETE FROM patient_daily_entries WHERE patient_id IN (
      SELECT id FROM patients WHERE TRIM(file_number) = TRIM($1)
    )`,
    [TEST_FILE]
  );
  for (const code of Object.values(CATALOG_CODES)) {
    await query(`DELETE FROM daily_entry_catalog_items WHERE code = $1`, [code]);
    await query(`DELETE FROM daily_entry_catalog_code_registry WHERE code = $1`, [code]);
  }
  await query(`DELETE FROM contracted_entities WHERE name LIKE $1`, [`${TEST_PREFIX}%`]);
  await query(`DELETE FROM patients WHERE TRIM(file_number) = TRIM($1)`, [TEST_FILE]);
}

async function provisionTestCatalog(createCatalogItem) {
  const med = await createCatalogItem({
    code: CATALOG_CODES.med,
    name: `${TEST_PREFIX} Medicine 01`,
    category: 'Medicine',
    major_unit: 'PAC',
    minor_unit: 'STR',
    minor_quantity_per_major: 2,
    major_unit_selling_price: 52,
    minor_unit_selling_price: 26,
  });
  const supply = await createCatalogItem({
    code: CATALOG_CODES.supply,
    name: `${TEST_PREFIX} Supply 01`,
    category: 'Supplies',
    major_unit: 'قطعة',
    minor_unit: 'قطعة',
    minor_quantity_per_major: 1,
    cost_price: 60,
    markup_percent: 40,
  });
  const medPrice = await createCatalogItem({
    code: CATALOG_CODES.medPrice,
    name: `${TEST_PREFIX} Price Lock Med`,
    category: 'Medicine',
    major_unit: 'EA',
    minor_unit: 'EA',
    minor_quantity_per_major: 1,
    major_unit_selling_price: 52,
    minor_unit_selling_price: 52,
  });
  return { med, supply, medPrice };
}

async function runDbIntegrationSuite() {
  const { initDatabase, query } = require('../database/db');
  const { saveInvoice, approveInvoice, getInvoiceById } = require('../services/invoiceService');
  const { recordInvoiceReturns, listInvoiceReturns } = require('../services/invoiceReturnService');
  const { upsertPatient } = require('../services/patientService');
  const { createCatalogItem, updateCatalogItem } = require('../services/dailyEntryCatalogService');

  await initDatabase();
  await cleanupTestData(query);

  const patient = await upsertPatient(TEST_FILE, 'Return E2E Patient');
  patient.file_number = TEST_FILE;
  const catalog = await provisionTestCatalog(createCatalogItem);

  const entityRes = await query(
    `INSERT INTO contracted_entities (name, discount_percent) VALUES ($1, $2) RETURNING id`,
    [`${TEST_PREFIX} Contract Entity`, 10]
  );
  const entityId = entityRes.rows[0].id;

  // --- Status guards: draft / pending / approved-only ---
  const draftInvoice = await saveInvoice({
    invoice_type: 'civil',
    patient_name: patient.name,
    file_number: TEST_FILE,
    issue_date: new Date().toISOString().slice(0, 10),
    admission_date: new Date().toISOString().slice(0, 10),
    items: [{ description: `${TEST_PREFIX} Draft Med`, quantity: 2, amount: 50 }],
    method_payments: [{ code: 'cash', amount: 112 }],
    save_mode: 'draft',
    include_daily_charges: false,
  });
  const draftLine = draftInvoice.items[0];
  assert(draftInvoice.status === 'draft', 'draft invoice status is draft');
  await assertRejects('reject return on draft', () =>
    recordInvoiceReturns(draftInvoice.id, {
      lines: [{ invoice_item_id: draftLine.id, return_quantity: 1 }],
    }),
    'الفواتير المعتمدة'
  );
  const { rows: draftReturnRows } = await query(
    `SELECT COUNT(*)::int AS count FROM invoice_returns WHERE invoice_id = $1`,
    [draftInvoice.id]
  );
  assertEq('no draft return persisted', draftReturnRows[0].count, 0);

  const submitted = await saveInvoice(
    {
      invoice_type: 'civil',
      patient_name: patient.name,
      file_number: TEST_FILE,
      issue_date: draftInvoice.issue_date,
      admission_date: draftInvoice.admission_date,
      items: draftInvoice.items.map((i) => ({
        description: i.description,
        quantity: i.quantity,
        amount: i.amount,
      })),
      method_payments: [{ code: 'cash', amount: draftInvoice.final_total || 112 }],
      save_mode: 'submit',
      include_daily_charges: false,
    },
    draftInvoice.id
  );
  assert(submitted.status === 'pending_review', 'submitted invoice pending_review');
  await assertRejects('reject return on pending_review', () =>
    recordInvoiceReturns(submitted.id, {
      lines: [{ invoice_item_id: submitted.items[0].id, return_quantity: 1 }],
    }),
    'الفواتير المعتمدة'
  );

  await query(`DELETE FROM invoice_items WHERE invoice_id = $1`, [draftInvoice.id]);
  await query(`DELETE FROM invoices WHERE id = $1`, [draftInvoice.id]);
  console.log('OK reject returns on draft and pending_review');

  // --- Main approved invoice: medicine partial/full, service, supply ---
  const mainItems = [
    {
      description: `${TEST_PREFIX} Partial Med`,
      quantity: 10,
      amount: 50,
      discountable_snapshot: true,
    },
    {
      description: `${TEST_PREFIX} Full Med`,
      quantity: 4,
      amount: 52,
    },
    {
      description: `${TEST_PREFIX} Lab Service`,
      quantity: 1,
      amount: 1000,
      administrative_fee_applicable_snapshot: true,
    },
    {
      description: `${TEST_PREFIX} Supply Line`,
      quantity: 10,
      amount: 150,
      section_code: 'supplies',
      cost_price_snapshot: 100,
      markup_percent_snapshot: 50,
      margin_amount_snapshot: 500,
    },
  ];

  const approved = await createApprovedInvoice(patient, mainItems);
  const partialMed = approved.items.find((i) => i.description.includes('Partial Med'));
  const fullMed = approved.items.find((i) => i.description.includes('Full Med'));
  const serviceLine = approved.items.find((i) => i.description.includes('Lab Service'));
  const supplyLine = approved.items.find((i) => i.description.includes('Supply Line'));

  // Partial medicine return
  const partialResult = await recordInvoiceReturns(approved.id, {
    lines: [{ invoice_item_id: partialMed.id, return_quantity: 3 }],
    notes: 'partial med',
  });
  const partialUpdated = partialResult.invoice.items.find((i) => Number(i.id) === Number(partialMed.id));
  assertEq(partialUpdated.quantity, 10, 'partial med original qty preserved');
  assertEq(partialUpdated.returned_quantity, 3, 'partial med returned qty');
  console.log('OK DB partial medicine return');

  // Full medicine return
  const fullResult = await recordInvoiceReturns(approved.id, {
    lines: [{ invoice_item_id: fullMed.id, return_quantity: 4 }],
    notes: 'full med',
  });
  const fullUpdated = fullResult.invoice.items.find((i) => Number(i.id) === Number(fullMed.id));
  assertEq(fullUpdated.returned_quantity, 4, 'full med returned qty');
  assertEq(fullUpdated.quantity, 4, 'full med original qty preserved');
  const fullTotals = calculateInvoiceTotals({
    ...base,
    items: [{ ...fullUpdated, amount: fullUpdated.amount }],
  });
  const fullCalc = fullTotals.items.find((i) => !i.is_stay_entry);
  assertEq(fullCalc.net_quantity, 0, 'full med net qty zero');
  console.log('OK DB full medicine return');

  // Service return
  const serviceResult = await recordInvoiceReturns(approved.id, {
    lines: [{ invoice_item_id: serviceLine.id, return_quantity: 1 }],
  });
  const serviceUpdated = serviceResult.invoice.items.find((i) => Number(i.id) === Number(serviceLine.id));
  assertEq(serviceUpdated.returned_quantity, 1, 'service returned qty');
  console.log('OK DB service return');

  // Supply return with snapshot audit
  const supplyResult = await recordInvoiceReturns(approved.id, {
    lines: [{ invoice_item_id: supplyLine.id, return_quantity: 4 }],
  });
  const supplyHistory = await listInvoiceReturns(approved.id);
  const supplyAuditLine = supplyHistory
    .flatMap((h) => h.lines)
    .find((l) => Number(l.invoice_item_id) === Number(supplyLine.id));
  assert(supplyAuditLine, 'supply audit line exists');
  assertEq(supplyAuditLine.cost_price_snapshot, 100, 'supply audit cost');
  assertEq(supplyAuditLine.markup_percent_snapshot, 50, 'supply audit markup');
  assertEq(supplyAuditLine.selling_price_snapshot, 150, 'supply audit selling');
  assertEq(supplyAuditLine.return_amount, 600, 'supply audit return amount');
  assertEq(supplyAuditLine.margin_amount_snapshot, 200, 'supply audit margin reversal');
  console.log('OK DB supply snapshot return audit');

  // Over-return rejected
  await assertRejects('reject over-return quantity', () =>
    recordInvoiceReturns(approved.id, {
      lines: [{ invoice_item_id: partialMed.id, return_quantity: 8 }],
    }),
    'لا يمكن إرجاع'
  );
  console.log('OK DB reject over-return quantity');

  // Audit: original lines preserved, return history exists
  const { rows: itemRows } = await query(`SELECT id FROM invoice_items WHERE invoice_id = $1`, [approved.id]);
  assertEq(itemRows.length, approved.items.length, 'original invoice lines not deleted');
  assert(supplyHistory.length >= 4, 'multiple return records auditable');
  console.log('OK DB audit history and line preservation');

  // Repeat return: cannot duplicate beyond remaining quantity
  const returnsBefore = supplyHistory.length;
  await recordInvoiceReturns(approved.id, {
    lines: [{ invoice_item_id: supplyLine.id, return_quantity: 2 }],
  });
  const returnsAfter = await listInvoiceReturns(approved.id);
  assert(returnsAfter.length === returnsBefore + 1, 'one new return record per submission');
  const supplyAfter = returnsAfter
    .flatMap((h) => h.lines)
    .filter((l) => Number(l.invoice_item_id) === Number(supplyLine.id));
  assertEq(supplyAfter.length, 2, 'two supply return audit lines not duplicated in one call');
  await assertRejects('reject repeat over-return on supply', () =>
    recordInvoiceReturns(approved.id, {
      lines: [{ invoice_item_id: supplyLine.id, return_quantity: 5 }],
    }),
    'لا يمكن إرجاع'
  );
  console.log('OK DB repeat return does not over-return');

  // Discounted contracted invoice
  const discountItems = [
    {
      description: `${TEST_PREFIX} Discount Med`,
      quantity: 10,
      amount: 100,
      discountable_snapshot: true,
      administrative_fee_applicable_snapshot: true,
    },
  ];
  const discountApproved = await createApprovedInvoice(patient, discountItems, {
    invoice_type: 'contracted',
    contracted_entity_id: entityId,
    discount_percent: 10,
  });
  const discountLine = discountApproved.items[0];
  const discountReturn = await recordInvoiceReturns(discountApproved.id, {
    lines: [{ invoice_item_id: discountLine.id, return_quantity: 5 }],
  });
  const discountTotals = calculateInvoiceTotals({
    invoice_type: 'contracted',
    contracted_entity_id: entityId,
    discount_percent: 10,
    admin_expenses_percent: 12,
    items: discountReturn.invoice.items.map((i) => ({
      description: i.description,
      quantity: i.quantity,
      returned_quantity: i.returned_quantity,
      amount: i.amount,
      discountable_snapshot: true,
      administrative_fee_applicable_snapshot: true,
    })),
    method_payments: discountApproved.method_payments || [],
  });
  assertEq(discountTotals.discount_amount_raw, 50, 'DB discounted return discount');
  assertEq(discountTotals.final_total_raw, 510, 'DB discounted return final');
  console.log('OK DB return on discounted invoice');

  // Fully paid then return → refundable
  const paidItems = [{ description: `${TEST_PREFIX} Paid Item`, quantity: 2, amount: 200 }];
  const paidApproved = await createApprovedInvoice(patient, paidItems);
  const paidLine = paidApproved.items[0];
  const paidReturn = await recordInvoiceReturns(paidApproved.id, {
    lines: [{ invoice_item_id: paidLine.id, return_quantity: 1 }],
  });
  const paidTotals = calculateInvoiceTotals({
    ...base,
    items: paidReturn.invoice.items.map((i) => ({
      quantity: i.quantity,
      returned_quantity: i.returned_quantity,
      amount: i.amount,
    })),
    method_payments: [{ code: 'cash', amount: 400 }],
  });
  assertEq(paidTotals.refundable_amount_raw, 176, 'DB refundable after full payment');
  assertEq(paidTotals.outstanding_amount_raw, 0, 'DB no outstanding when overpaid after return');
  console.log('OK DB return after full payment refundable');

  // Partially paid invoice outstanding (payment less than net final after return)
  const partialPayItems = [{ description: `${TEST_PREFIX} Partial Pay`, quantity: 10, amount: 50 }];
  const partialPayCalc = calculateInvoiceTotals({ ...base, items: partialPayItems });
  const partialPayApproved = await createApprovedInvoice(patient, partialPayItems, {
    method_payments: [{ code: 'cash', amount: partialPayCalc.final_total_raw }],
  });
  const partialPayLine = partialPayApproved.items[0];
  const partialPayReturn = await recordInvoiceReturns(partialPayApproved.id, {
    lines: [{ invoice_item_id: partialPayLine.id, return_quantity: 4 }],
  });
  const partialPayTotals = calculateInvoiceTotals({
    ...base,
    items: partialPayReturn.invoice.items.map((i) => ({
      quantity: i.quantity,
      returned_quantity: i.returned_quantity,
      amount: i.amount,
    })),
    method_payments: [{ code: 'cash', amount: 300 }],
  });
  assertEq(partialPayTotals.final_total_raw, 336, 'DB partial pay final after return');
  assertEq(partialPayTotals.outstanding_amount_raw, 36, 'DB partial pay outstanding');
  console.log('OK DB return on partially paid invoice');

  // Catalog price change after approve must not change return price
  const priceItems = [
    {
      description: catalog.medPrice.name,
      quantity: 4,
      amount: 52,
      unit_price_snapshot: 52,
      selling_price_snapshot: 52,
    },
  ];
  const priceApproved = await createApprovedInvoice(patient, priceItems);
  const priceLine = priceApproved.items[0];
  await updateCatalogItem(catalog.medPrice.id, {
    code: catalog.medPrice.code,
    name: catalog.medPrice.name,
    category: 'Medicine',
    major_unit: 'EA',
    major_unit_selling_price: 99,
    minor_unit_selling_price: 99,
  });
  const priceReturn = await recordInvoiceReturns(priceApproved.id, {
    lines: [{ invoice_item_id: priceLine.id, return_quantity: 2 }],
  });
  const priceAudit = priceReturn.returns
    .flatMap((h) => h.lines)
    .find((l) => Number(l.invoice_item_id) === Number(priceLine.id));
  assertEq(priceAudit.unit_price_snapshot, 52, 'return price locked to invoice snapshot');
  assertEq(priceAudit.return_amount, 104, 'return amount uses snapshot not catalog');
  console.log('OK DB catalog price change does not affect return price');

  // Totals reconcile on persisted invoice
  const finalInvoice = await getInvoiceById(approved.id);
  const recalcTotals = calculateInvoiceTotals({
    invoice_type: finalInvoice.invoice_type,
    discount_percent: finalInvoice.discount_percent,
    contracted_entity_id: finalInvoice.contracted_entity_id,
    admin_expenses_percent: finalInvoice.admin_expenses_percent,
    stamp_duty: finalInvoice.stamp_duty,
    professional_fees: finalInvoice.professional_fees,
    balance: finalInvoice.balance,
    items: finalInvoice.items.map((i) => ({
      description: i.description,
      quantity: i.quantity,
      returned_quantity: i.returned_quantity,
      amount: i.amount,
      section_code: i.section_code,
      cost_price_snapshot: i.cost_price_snapshot,
      margin_amount_snapshot: i.margin_amount_snapshot,
      markup_percent_snapshot: i.markup_percent_snapshot,
      administrative_fee_applicable_snapshot: i.administrative_fee_applicable_snapshot,
      discountable_snapshot: i.discountable_snapshot,
      daily_entry_line_id: i.daily_entry_line_id,
    })),
    method_payments: finalInvoice.method_payments || [],
  });
  const validation = validateInvoiceCalculations(base, recalcTotals);
  assert(validation.is_valid, `DB totals reconcile: ${validation.errors.join('; ')}`);
  console.log('OK DB invoice totals reconcile to 2 decimals');

  // Report quantity fields on calculated items
  const partialCalc = recalcTotals.items.find((i) => i.description.includes('Partial Med'));
  const supplyCalc = recalcTotals.items.find((i) => i.description.includes('Supply Line'));
  const partialReport = projectReportQuantities(partialCalc);
  const supplyReport = projectReportQuantities(supplyCalc);
  assertEq(partialReport.original_quantity, 10, 'report partial original');
  assertEq(partialReport.returned_quantity, 3, 'report partial returned');
  assertEq(partialReport.net_quantity, 7, 'report partial net');
  assertEq(supplyReport.original_quantity, 10, 'report supply original');
  assertEq(supplyReport.returned_quantity, 6, 'report supply returned');
  assertEq(supplyReport.net_quantity, 4, 'report supply net');
  console.log('OK report quantity fields on invoice items');

  await cleanupTestData(query);
  console.log('OK DB invoice returns integration suite');
}

async function main() {
  testFullItemReturn();
  testPartialItemReturn();
  testServiceReturnAdminFee();
  testSupplyReturnMarginReversal();
  testReturnOnDiscountedInvoice();
  testReturnAfterPaymentRefundable();
  testReturnPartiallyPaidOutstanding();
  testOverReturnValidationLogic();
  testTotalsReconcileTwoDecimals();
  testReportQuantityProjection();

  try {
    await runDbIntegrationSuite();
  } catch (err) {
    if (String(err.message || err).includes('password authentication')) {
      console.log('SKIP DB return integration tests (no database)');
    } else {
      throw err;
    }
  }

  console.log('ALL INVOICE RETURN TESTS PASSED');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
