#!/usr/bin/env node
/**
 * Customer invoice presentation aggregation (no database required).
 * Run: node scripts/test-invoice-presentation.js
 */

const { round2 } = require('../services/calculations');
const { enrichInvoice } = require('../services/pdfService');
const {
  aggregateCustomerFacingLines,
  buildCustomerPrintLines,
  DEFAULT_SECTION_LABELS,
} = require('../services/invoicePresentationService');
const { inferBundleKeyFromItem } = require('../services/dailySectionBundles');

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

function sumLineTotals(items) {
  return round2((items || []).reduce((sum, item) => sum + (Number(item.total) || 0), 0));
}

let nextTestDailyLineId = 9000;

function makeCatalogItem(sectionCode, label, total, overrides = {}) {
  const lineId = overrides.daily_entry_line_id ?? ++nextTestDailyLineId;
  return {
    section_code: sectionCode,
    section_name: label,
    description: overrides.description || `${sectionCode}-product-${overrides.idx || 1}`,
    quantity: overrides.quantity ?? 1,
    amount: overrides.amount ?? total,
    total,
    total_raw: overrides.total_raw ?? total,
    daily_entry_line_id: lineId,
    ...overrides,
    daily_entry_line_id: lineId,
  };
}

function testThreeMedicinesAggregateToOneRow() {
  const items = [
    makeCatalogItem('medicines', 'الأدوية', 52, { idx: 1, description: 'Med A' }),
    makeCatalogItem('medicines', 'الأدوية', 30, { idx: 2, description: 'Med B', quantity: 2, amount: 15 }),
    makeCatalogItem('medicines', 'الأدوية', 22, { idx: 3, description: 'Med C' }),
  ];
  const display = aggregateCustomerFacingLines(items);
  const medRows = display.filter((r) => r.section_code === 'medicines');
  assertEq(medRows.length, 1, 'one medicines row');
  assert(medRows[0]._customer_display_aggregate, 'medicines row flagged aggregate');
  assertEq(medRows[0].total, 104, 'medicines summed total');
  assertEq(medRows[0].description, 'الأدوية', 'medicines section label');
  console.log('OK three medicine items aggregate to one row');
}

function testTwoSuppliesAggregateToOneRow() {
  const items = [
    makeCatalogItem('supplies', 'المستلزمات', 84, { idx: 1 }),
    makeCatalogItem('supplies', 'المستلزمات', 168, { idx: 2, quantity: 2, amount: 84 }),
  ];
  const display = aggregateCustomerFacingLines(items);
  const supplyRows = display.filter((r) => r.section_code === 'supplies');
  assertEq(supplyRows.length, 1, 'one supplies row');
  assertEq(supplyRows[0].total, 252, 'supplies summed total');
  assertEq(supplyRows[0].description, 'المستلزمات', 'supplies section label');
  console.log('OK two supply items aggregate to one row');
}

function testIdenticalClinicalServicesGrouped() {
  const items = [
    {
      section_code: 'analyses',
      section_name: 'تحاليل',
      service_id: 101,
      service_name_snapshot: 'CBC',
      description: 'CBC',
      quantity: 1,
      amount: 75,
      total: 75,
      total_raw: 75,
      daily_entry_line_id: 201,
    },
    {
      section_code: 'analyses',
      section_name: 'تحاليل',
      service_id: 101,
      service_name_snapshot: 'CBC',
      description: 'CBC',
      quantity: 1,
      amount: 75,
      total: 75,
      total_raw: 75,
      daily_entry_line_id: 202,
    },
    {
      section_code: 'analyses',
      section_name: 'تحاليل',
      service_id: 102,
      service_name_snapshot: 'Glucose',
      description: 'Glucose',
      quantity: 1,
      amount: 40,
      total: 40,
      total_raw: 40,
      daily_entry_line_id: 203,
    },
  ];
  const display = aggregateCustomerFacingLines(items);
  assertEq(display.length, 1, 'one lab bundle row');
  assertEq(display[0].total, 190, 'lab bundle summed total');
  assert(display[0]._customer_display_aggregate, 'lab bundle flagged');
  assertEq(display[0].description, 'التحاليل', 'lab bundle label');
  console.log('OK lab daily lines aggregate to one screen total');
}

function testMixedSectionsStaySeparated() {
  const items = [
    makeCatalogItem('medicines', 'الأدوية', 52, { description: 'Med X' }),
    makeCatalogItem('supplies', 'المستلزمات', 84, { description: 'Supply Y' }),
    {
      section_code: 'analyses',
      section_name: 'تحاليل',
      description: 'CBC Lab',
      quantity: 1,
      amount: 75,
      total: 75,
      total_raw: 75,
      daily_entry_line_id: 501,
    },
    {
      section_code: 'xray_total',
      section_name: 'أشعة',
      description: 'Chest X-Ray',
      quantity: 1,
      amount: 120,
      total: 120,
      total_raw: 120,
      daily_entry_line_id: 502,
    },
  ];
  const display = aggregateCustomerFacingLines(items);
  assertEq(display.length, 4, 'four bundle rows');
  assertEq(display[0].description, 'الأدوية', 'first aggregated medicines');
  assertEq(display[1].description, 'المستلزمات', 'second aggregated supplies');
  assertEq(display[2].description, 'التحاليل', 'lab bundle label');
  assertEq(display[3].description, 'الأشعة', 'radiology bundle label');
  console.log('OK medicine + supply + lab + radiology bundles stay separated');
}

async function testGrandTotalUnchanged() {
  const invoice = {
    items: [
      makeCatalogItem('medicines', 'الأدوية', 104, { description: 'Med A', quantity: 2, amount: 52 }),
      makeCatalogItem('supplies', 'المستلزمات', 252, { description: 'Supply A', quantity: 3, amount: 84 }),
    {
      section_code: 'analyses',
      description: 'Lab',
      quantity: 1,
      amount: 75,
      total: 75,
      total_raw: 75,
      daily_entry_line_id: 301,
    },
    ],
    stamp_duty: 0,
    professional_fees: 0,
    admin_expenses_percent: 12,
    discount_percent: 0,
    payments: [],
    method_payments: [],
    stay_entries: [],
  };
  const enriched = await enrichInvoice(invoice);
  const display = aggregateCustomerFacingLines(enriched.items);
  assertEq(sumLineTotals(display), sumLineTotals(enriched.items), 'display line totals sum');
  assert(enriched.final_total > 0, 'final total computed');
  console.log('OK grand total unchanged after aggregation');
}

function testPartialReturnAggregatedMedicinesTotal() {
  const items = [
    {
      section_code: 'medicines',
      section_name: 'الأدوية',
      description: 'Med A',
      quantity: 2,
      original_quantity: 2,
      returned_quantity: 1,
      net_quantity: 1,
      amount: 52,
      total: 52,
      total_raw: 52,
    },
    {
      section_code: 'medicines',
      section_name: 'الأدوية',
      description: 'Med B',
      quantity: 1,
      original_quantity: 1,
      returned_quantity: 0,
      net_quantity: 1,
      amount: 30,
      total: 30,
      total_raw: 30,
    },
  ];
  const display = aggregateCustomerFacingLines(items);
  const med = display.find((r) => r.section_code === 'medicines');
  assert(med, 'aggregated medicines row exists');
  assertEq(med.total, 82, 'aggregated medicines net total');
  console.log('OK partial return reflected in aggregated medicines total');
}

function testInvoiceItemsCountUnchanged() {
  const items = [
    makeCatalogItem('medicines', 'الأدوية', 10, { id: 1 }),
    makeCatalogItem('medicines', 'الأدوية', 20, { id: 2 }),
    makeCatalogItem('supplies', 'المستلزمات', 30, { id: 3 }),
  ];
  const display = aggregateCustomerFacingLines(items);
  assertEq(items.length, 3, 'source items unchanged');
  assertEq(display.length, 2, 'display rows collapsed');
  console.log('OK invoice_items count unchanged (aggregation is display-only)');
}

async function testPdfLabelsWithoutProductNames() {
  const { buildInvoiceHtml } = require('../services/pdfService');
  const invoice = await enrichInvoice({
    patient_name: 'Presentation Test',
    file_number: 'PRES-001',
    serial_number: 'SN-001',
    items: [
      makeCatalogItem('medicines', 'الأدوية', 104, { description: 'SECRET MED NAME', quantity: 2, amount: 52 }),
      makeCatalogItem('supplies', 'المستلزمات', 84, { description: 'SECRET SUPPLY NAME', quantity: 1, amount: 84 }),
      {
        section_code: 'analyses',
        description: 'Visible Lab Service',
        quantity: 1,
        amount: 75,
        total: 75,
        total_raw: 75,
        daily_entry_line_id: 401,
      },
    ],
    stamp_duty: 0,
    professional_fees: 0,
    admin_expenses_percent: 0,
    discount_percent: 0,
    payments: [],
    method_payments: [],
    stay_entries: [],
  });
  const html = await buildInvoiceHtml(invoice, { showQr: false });
  assert(html.includes(DEFAULT_SECTION_LABELS.medicines), 'PDF contains medicines label');
  assert(html.includes(DEFAULT_SECTION_LABELS.supplies), 'PDF contains supplies label');
  assert(!html.includes('SECRET MED NAME'), 'PDF hides medicine product name');
  assert(!html.includes('SECRET SUPPLY NAME'), 'PDF hides supply product name');
  assert(!html.includes('Visible Lab Service'), 'PDF hides lab line detail');
  assert(html.includes('التحاليل'), 'PDF shows lab bundle label');
  console.log('OK customer PDF shows bundle totals not line detail');
}

function testStayBundleShowsDetailInPrint() {
  const items = [
    {
      section_code: 'accommodation',
      section_name: 'إقامة',
      description: 'إقامة رعاية مركزة',
      entry_date: '2026-09-14',
      quantity: 1,
      amount: 5000,
      total: 5000,
      total_raw: 5000,
      daily_entry_line_id: 701,
    },
    {
      section_code: 'nursing_point',
      section_name: 'نقطة تمريض',
      description: 'نقطة تمريض',
      entry_date: '2026-09-14',
      quantity: 1,
      amount: 500,
      total: 500,
      total_raw: 500,
      daily_entry_line_id: 702,
    },
    {
      section_code: 'patient_assistant',
      section_name: 'مساعد تمريض',
      description: 'مساعد تمريض',
      entry_date: '2026-09-14',
      quantity: 1,
      amount: 500,
      total: 500,
      total_raw: 500,
      daily_entry_line_id: 703,
    },
    makeCatalogItem('supplies', 'المستلزمات', 487, { idx: 1 }),
  ];
  const display = buildCustomerPrintLines(items);
  assertEq(display.length, 2, 'stay aggregate + supplies aggregate');
  assertEq(display[0].description, 'إقامة ورعاية', 'stay aggregate label');
  assertEq(display[0].total, 6000, 'stay bundle total sums all stay lines');
  assertEq(display[0].quantity, 1, 'stay day count from entry dates');
  assertEq(display[1].description, 'المستلزمات', 'supplies still aggregated');
  console.log('OK stay bundle aggregated in print lines');
}

function testStampExcludedFromBundleTotals() {
  const items = [
    makeCatalogItem('consultant_exam', 'الكشوفات', 200, { idx: 1 }),
    makeCatalogItem('consultation_stamp', 'دمغة كشوفات', 25, { idx: 2 }),
  ];
  const display = aggregateCustomerFacingLines(items);
  const examRows = display.filter((r) => r.section_code === 'exams');
  assertEq(examRows.length, 1, 'one exams aggregate row');
  assertEq(examRows[0].total, 200, 'stamp excluded from exams bundle total');
  const printRows = buildCustomerPrintLines(items);
  const printExam = printRows.find((r) => r.section_code === 'exams');
  assertEq(printExam.total, 200, 'stamp excluded from print exams total');
  console.log('OK stamp excluded from bundle totals');
}

function testFreeManualItemsStayManualBundle() {
  const item = {
    description: 'رسوم عملية إضافية',
    quantity: 1,
    amount: 50,
    total: 50,
    total_raw: 50,
  };
  assertEq(inferBundleKeyFromItem(item), '__manual__', 'free manual item not grouped by description');
  const display = aggregateCustomerFacingLines([item]);
  assertEq(display.length, 1, 'one free manual row');
  assertEq(display[0].description, 'رسوم عملية إضافية', 'free manual description preserved');
  assert(!display[0]._customer_display_aggregate, 'free manual row not aggregated');
  console.log('OK free manual items stay detailed even with operation keywords');
}

async function testPdfStayDetailAndCaptainName() {
  const { buildInvoiceHtml } = require('../services/pdfService');
  const { normalizeCaptainName } = require('../services/invoiceService');
  assertEq(normalizeCaptainName('نقيب / عمرو صالح محمد'), 'نقيب عمرو صالح', 'legacy captain normalized');
  const invoice = await enrichInvoice({
    patient_name: 'ahmed adel',
    file_number: '06',
    captain_name: 'نقيب / عمرو صالح محمد',
    items: [
      {
        section_code: 'patient_assistant',
        section_name: 'مساعد تمريض',
        description: 'مساعد تمريض',
        quantity: 1,
        amount: 6000,
        total: 6000,
        total_raw: 6000,
        daily_entry_line_id: 801,
      },
      makeCatalogItem('supplies', 'المستلزمات', 487, { idx: 1 }),
    ],
    stamp_duty: 0,
    professional_fees: 0,
    admin_expenses_percent: 12,
    discount_percent: 0,
    payments: [],
    method_payments: [],
    stay_entries: [],
  });
  const html = await buildInvoiceHtml(invoice, { showQr: false });
  assert(html.includes('إقامة ورعاية'), 'PDF contains stay aggregate row');
  assert(!html.includes('مساعد تمريض'), 'PDF does not repeat individual stay lines');
  assert(html.includes('رئيس حسابات المرضى'), 'PDF contains patient accounts manager role label');
  assert(html.includes('نقيب عمرو صالح'), 'PDF contains captain name');
  assert(html.includes('المدير المالي'), 'PDF contains financial manager role label');
  const managerIdx = html.indexOf('المدير المالي');
  const captainIdx = html.indexOf('رئيس حسابات المرضى');
  assert(managerIdx >= 0 && captainIdx > managerIdx, 'financial manager appears before patient accounts manager');
  console.log('OK PDF stay aggregate and signature order');
}

async function testPatientBalanceNegativeWhenOwing() {
  const { resolvePatientInvoiceBalanceDisplay } = require('../services/patientService');
  const draftOwing = resolvePatientInvoiceBalanceDisplay(
    {
      file_number: '123',
      status: 'draft',
      patient_context: { patient: { account_balance: 0 } },
    },
    { final_total: 5000, outstanding_amount: 5000, remaining: 5000, patient_credit_applied: 0 }
  );
  assertEq(draftOwing.balance, -5000, 'draft patient owes full invoice');

  const draftWithCredit = resolvePatientInvoiceBalanceDisplay(
    {
      file_number: '123',
      status: 'draft',
      patient_context: { patient: { account_balance: 1000 } },
    },
    { final_total: 5000, outstanding_amount: 2000, remaining: 2000, patient_credit_applied: 3000 }
  );
  assertEq(draftWithCredit.balance, -4000, 'draft credit and outstanding combined');

  const approved = resolvePatientInvoiceBalanceDisplay(
    {
      file_number: '123',
      status: 'approved',
      patient_credit_deducted: true,
      patient_context: { patient: { account_balance: 0 } },
    },
    { final_total: 5000, outstanding_amount: 2000, remaining: 2000, patient_credit_applied: 3000 }
  );
  assertEq(approved.balance, -2000, 'approved invoice uses post-deduction balance');

  const withInsurance = resolvePatientInvoiceBalanceDisplay(
    {
      file_number: '123',
      status: 'draft',
      patient_context: { patient: { account_balance: 1000, room_insurance_amount: 500 } },
    },
    { final_total: 4000, outstanding_amount: 1000, remaining: 1000, patient_credit_applied: 0 }
  );
  assertEq(withInsurance.prepaid_balance, 1500, 'prepaid includes room insurance');
  assertEq(withInsurance.balance, 500, 'balance after invoice includes insurance deposit');

  const overpaid = resolvePatientInvoiceBalanceDisplay(
    {
      file_number: '123',
      status: 'draft',
      patient_context: { patient: { account_balance: 1000, room_insurance_amount: 0 } },
    },
    {
      final_total: 3000,
      outstanding_amount: 0,
      remaining: 0,
      total_collected: 3500,
      total_collected_raw: 3500,
      refundable_amount: 500,
      patient_credit_applied: 0,
    }
  );
  assertEq(overpaid.balance, 1500, 'overpayment increases patient balance after invoice');

  const enriched = await enrichInvoice({
    file_number: '123',
    status: 'draft',
    patient_context: { patient: { account_balance: 0 } },
    items: [{ description: 'خدمة', quantity: 1, amount: 5000, total: 5000, total_raw: 5000 }],
    payments: [],
    method_payments: [],
    admin_expenses_percent: 0,
    stamp_duty: 0,
    professional_fees: 0,
  });
  assert(enriched.balance < 0, 'enriched invoice balance is negative when patient owes');
  console.log('OK patient balance negative when owing');
}

async function main() {
  testThreeMedicinesAggregateToOneRow();
  testTwoSuppliesAggregateToOneRow();
  testIdenticalClinicalServicesGrouped();
  testMixedSectionsStaySeparated();
  await testGrandTotalUnchanged();
  testPartialReturnAggregatedMedicinesTotal();
  testInvoiceItemsCountUnchanged();
  testStayBundleShowsDetailInPrint();
  testStampExcludedFromBundleTotals();
  testFreeManualItemsStayManualBundle();
  await testPdfStayDetailAndCaptainName();
  await testPdfLabelsWithoutProductNames();
  await testPatientBalanceNegativeWhenOwing();
  console.log('ALL INVOICE PRESENTATION TESTS PASSED');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
