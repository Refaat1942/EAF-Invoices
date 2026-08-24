#!/usr/bin/env node
/**
 * Customer invoice presentation aggregation (no database required).
 * Run: node scripts/test-invoice-presentation.js
 */

const { round2 } = require('../services/calculations');
const { enrichInvoice } = require('../services/pdfService');
const {
  aggregateCustomerFacingLines,
  DEFAULT_SECTION_LABELS,
} = require('../services/invoicePresentationService');

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

function makeCatalogItem(sectionCode, label, total, overrides = {}) {
  return {
    section_code: sectionCode,
    section_name: label,
    description: overrides.description || `${sectionCode}-product-${overrides.idx || 1}`,
    quantity: overrides.quantity ?? 1,
    amount: overrides.amount ?? total,
    total,
    total_raw: overrides.total_raw ?? total,
    ...overrides,
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
    },
    {
      section_code: 'xray_total',
      section_name: 'أشعة',
      description: 'Chest X-Ray',
      quantity: 1,
      amount: 120,
      total: 120,
      total_raw: 120,
    },
  ];
  const display = aggregateCustomerFacingLines(items);
  assertEq(display.length, 4, 'four display rows');
  assertEq(display[0].description, 'الأدوية', 'first aggregated medicines');
  assertEq(display[1].description, 'المستلزمات', 'second aggregated supplies');
  assert(display[2].description === 'CBC Lab', 'lab line unchanged');
  assert(display[3].description === 'Chest X-Ray', 'radiology line unchanged');
  console.log('OK medicine + supply + lab + radiology stay separated');
}

function testGrandTotalUnchanged() {
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
  const enriched = enrichInvoice(invoice);
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

function testPdfLabelsWithoutProductNames() {
  const { buildInvoiceHtml } = require('../services/pdfService');
  const invoice = enrichInvoice({
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
  const html = buildInvoiceHtml(invoice, { showQr: false });
  assert(html.includes(DEFAULT_SECTION_LABELS.medicines), 'PDF contains medicines label');
  assert(html.includes(DEFAULT_SECTION_LABELS.supplies), 'PDF contains supplies label');
  assert(!html.includes('SECRET MED NAME'), 'PDF hides medicine product name');
  assert(!html.includes('SECRET SUPPLY NAME'), 'PDF hides supply product name');
  assert(html.includes('Visible Lab Service'), 'PDF still shows lab service name');
  console.log('OK customer PDF shows section labels not product names');
}

function main() {
  testThreeMedicinesAggregateToOneRow();
  testTwoSuppliesAggregateToOneRow();
  testMixedSectionsStaySeparated();
  testGrandTotalUnchanged();
  testPartialReturnAggregatedMedicinesTotal();
  testInvoiceItemsCountUnchanged();
  testPdfLabelsWithoutProductNames();
  console.log('ALL INVOICE PRESENTATION TESTS PASSED');
}

main();
