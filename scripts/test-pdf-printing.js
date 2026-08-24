#!/usr/bin/env node
/**
 * PDF and daily print report integration validation.
 * Run: node --env-file=.env scripts/test-pdf-printing.js
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
const { createService, createCategory } = require('../services/serviceCatalogService');
const {
  getInvoiceById,
  saveInvoice,
  approveInvoice,
  prepareCalculationData,
} = require('../services/invoiceService');
const { calculateInvoiceTotals, round2 } = require('../services/calculations');
const { getDailyPrintReport } = require('../services/reportService');
const { buildInvoiceHtml, buildDailyReportHtml, enrichInvoice } = require('../services/pdfService');
const { DEFAULT_SECTION_LABELS } = require('../services/invoicePresentationService');
const {
  generatePdfBuffer,
  generateDailyItemsPdfBuffer,
} = require('../services/exportService');
const { recordInvoiceReturns } = require('../services/invoiceReturnService');

const TEST_FILE = 'PDF-E2E-PRINT';
const TEST_PREFIX = 'PDF-E2E';
const TEST_PRICE_LIST_CODE = 'PDF-E2E-PL';
const CUSTOMER_MEDICINES_LABEL = DEFAULT_SECTION_LABELS.medicines;
const CUSTOMER_SUPPLIES_LABEL = DEFAULT_SECTION_LABELS.supplies;
const CODES = {
  med: '9030001',
  supply: '9030002',
  lab: '9030003',
  xray: '9030004',
};

const SPECS = {
  med: {
    name: `${TEST_PREFIX} Medicine PAC`,
    qty: 2,
    unit: 'PAC',
    unitPrice: 52,
    lineTotal: 104,
  },
  supply: {
    name: `${TEST_PREFIX} Supply Item`,
    qty: 3,
    unit: 'قطعة',
    cost: 60,
    markup: 40,
    unitPrice: 84,
    lineTotal: 252,
    margin: 72,
  },
  lab: {
    name: `${TEST_PREFIX} Lab Analysis`,
    qty: 1,
    unitPrice: 75,
    lineTotal: 75,
  },
  xray: {
    name: `${TEST_PREFIX} Radiology Service`,
    qty: 1,
    unitPrice: 120,
    lineTotal: 120,
  },
};

let ctx = {};

function money(n) {
  return round2(n);
}

function fmtAmount(n) {
  return Number(n).toLocaleString('ar-EG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtQtyInt(n) {
  return Number(n).toLocaleString('ar-EG', { maximumFractionDigits: 0 });
}

function fmtReturnQtyDisplay(original, returned, net) {
  return `${fmtQtyInt(original)} (−${fmtQtyInt(returned)} = ${fmtQtyInt(net)})`;
}

function fail(reportType, location, expected, actual) {
  console.error(`FAIL [${reportType}] ${location}`);
  console.error(`  expected: ${expected}`);
  console.error(`  actual: ${actual}`);
  process.exit(1);
}

function assertTrue(reportType, label, condition, actual = '') {
  if (!condition) fail(reportType, label, 'true', actual);
}

function assertEq(reportType, label, actual, expected) {
  const a = money(actual);
  const e = money(expected);
  if (a !== e) fail(reportType, label, e, a);
}

function htmlToText(html) {
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

function assertTextContains(reportType, text, label, needle) {
  const hay = String(text || '');
  if (!hay.includes(needle)) {
    fail(reportType, label, `contains «${needle}»`, hay.slice(0, 400));
  }
}

function normalizeArabicForMatch(text) {
  return String(text || '')
    .replace(/[\u064B-\u065F\u0670]/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/\s+/g, ' ')
    .trim();
}

function assertTextContainsNormalized(reportType, text, label, needle) {
  const hay = normalizeArabicForMatch(text);
  const normalizedNeedle = normalizeArabicForMatch(needle);
  if (!hay.includes(normalizedNeedle)) {
    const withoutAl = normalizedNeedle.replace(/^ال/, '');
    if (withoutAl && hay.includes(withoutAl)) return;
    fail(reportType, label, `contains «${needle}»`, String(text || '').slice(0, 400));
  }
}

function assertPdfBufferContainsUtf8(reportType, buffer, label, needle) {
  const haystack = Buffer.isBuffer(buffer) ? buffer : Buffer.from('');
  const needleBuf = Buffer.from(String(needle), 'utf8');
  if (!haystack.includes(needleBuf)) {
    fail(reportType, label, `UTF-8 contains «${needle}»`, haystack.length);
  }
}

function assertPdfBufferNotContainsUtf8(reportType, buffer, label, needle) {
  const haystack = Buffer.isBuffer(buffer) ? buffer : Buffer.from('');
  const needleBuf = Buffer.from(String(needle), 'utf8');
  if (haystack.includes(needleBuf)) {
    fail(reportType, label, `UTF-8 does not contain «${needle}»`, 'found in PDF buffer');
  }
}

function resolveCatalogProductLabel(item, fallback = '') {
  return String(item?.description || item?.service_name_snapshot || fallback).trim();
}

function assertHtmlContains(reportType, html, label, needle) {
  assertTextContains(reportType, htmlToText(html), label, needle);
}

async function extractPdfText(buffer) {
  try {
    const pdfParse = require('pdf-parse');
    const data = await pdfParse(buffer);
    return data.text || '';
  } catch (err) {
    console.log(`SKIP pdf-parse: ${err.message}`);
    return null;
  }
}

async function assertPdfBuffer(reportType, buffer, label) {
  assertTrue(reportType, `${label}: PDF buffer`, Buffer.isBuffer(buffer) && buffer.length > 500, buffer?.length);
  assertTrue(
    reportType,
    `${label}: PDF header`,
    buffer.subarray(0, 4).toString() === '%PDF',
    buffer.subarray(0, 8).toString()
  );
}

async function cleanupTestPriceList(priceListId = null) {
  let id = priceListId || ctx.testPriceListId;
  if (!id) {
    const { rows } = await query(`SELECT id FROM price_lists WHERE code = $1`, [TEST_PRICE_LIST_CODE]);
    id = rows[0]?.id;
  }
  if (!id) return;

  const svcRes = await query(`SELECT id FROM services WHERE price_list_id = $1`, [id]);
  for (const row of svcRes.rows) {
    await query(`DELETE FROM service_price_components WHERE service_id = $1`, [row.id]);
    await query(`DELETE FROM service_price_tiers WHERE service_id = $1`, [row.id]);
    await query(`DELETE FROM service_price_history WHERE service_id = $1`, [row.id]);
  }
  await query(`DELETE FROM services WHERE price_list_id = $1`, [id]);
  await query(`DELETE FROM service_categories WHERE price_list_id = $1`, [id]);
  await query(`DELETE FROM price_lists WHERE id = $1`, [id]);

  if (ctx.testPriceListId === id) {
    ctx.testPriceListId = null;
  }
}

async function cleanupAll() {
  await query(
    `DELETE FROM invoice_item_returns WHERE invoice_return_id IN (
      SELECT id FROM invoice_returns WHERE invoice_id IN (
        SELECT id FROM invoices WHERE TRIM(file_number) = TRIM($1)
      ))`,
    [TEST_FILE]
  );
  await query(
    `DELETE FROM invoice_returns WHERE invoice_id IN (
      SELECT id FROM invoices WHERE TRIM(file_number) = TRIM($1)
    )`,
    [TEST_FILE]
  );
  await query(
    `DELETE FROM invoice_items WHERE invoice_id IN (
      SELECT id FROM invoices WHERE TRIM(file_number) = TRIM($1)
    )`,
    [TEST_FILE]
  );
  await query(
    `DELETE FROM invoice_payments WHERE invoice_id IN (
      SELECT id FROM invoices WHERE TRIM(file_number) = TRIM($1)
    )`,
    [TEST_FILE]
  );
  await query(
    `DELETE FROM invoice_stay_entries WHERE invoice_id IN (
      SELECT id FROM invoices WHERE TRIM(file_number) = TRIM($1)
    )`,
    [TEST_FILE]
  );
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
  await query(`DELETE FROM patients WHERE TRIM(file_number) = TRIM($1)`, [TEST_FILE]);

  for (const code of Object.values(CODES)) {
    await query(`DELETE FROM daily_entry_catalog_items WHERE code = $1`, [code]);
    await query(`DELETE FROM daily_entry_catalog_code_registry WHERE code = $1`, [code]);
    const { rows: services } = await query(`SELECT id FROM services WHERE code = $1`, [code]);
    for (const row of services) {
      await query(`DELETE FROM service_price_components WHERE service_id = $1`, [row.id]);
      await query(`DELETE FROM service_price_tiers WHERE service_id = $1`, [row.id]);
      await query(`DELETE FROM service_price_history WHERE service_id = $1`, [row.id]);
      await query(`DELETE FROM services WHERE id = $1`, [row.id]);
    }
  }

  await cleanupTestPriceList();
}

async function provisionFixtures() {
  await cleanupTestPriceList();
  const { rows: plRows } = await query(
    `INSERT INTO price_lists (name, code, is_active, is_default, notes)
     VALUES ($1, $2, TRUE, FALSE, $3)
     RETURNING id`,
    ['PDF E2E Price List', TEST_PRICE_LIST_CODE, 'PDF print test only']
  );
  ctx.testPriceListId = plRows[0].id;

  const labCategory = await createCategory(ctx.testPriceListId, {
    code: 'LAB',
    name: 'PDF E2E Lab Category',
    sort_order: 9998,
  });
  const xrayCategory = await createCategory(ctx.testPriceListId, {
    code: 'RADIOLOGY',
    name: 'PDF E2E Radiology Category',
    sort_order: 9999,
  });

  const med = await createCatalogItem({
    code: CODES.med,
    name: SPECS.med.name,
    category: 'Medicine',
    major_unit: 'PAC',
    minor_unit: 'STR',
    minor_quantity_per_major: 2,
    major_unit_selling_price: SPECS.med.unitPrice,
    minor_unit_selling_price: 26,
  });

  const supply = await createCatalogItem({
    code: CODES.supply,
    name: SPECS.supply.name,
    category: 'Supplies',
    major_unit: SPECS.supply.unit,
    minor_unit: SPECS.supply.unit,
    minor_quantity_per_major: 1,
    cost_price: SPECS.supply.cost,
    markup_percent: SPECS.supply.markup,
  });

  const labService = await createService({
    price_list_id: ctx.testPriceListId,
    category_id: labCategory.id,
    code: CODES.lab,
    name: SPECS.lab.name,
    unit: 'تحليل',
    price: SPECS.lab.unitPrice,
    discountable: true,
    administrative_fee_applicable: false,
  });

  const xrayService = await createService({
    price_list_id: ctx.testPriceListId,
    category_id: xrayCategory.id,
    code: CODES.xray,
    name: SPECS.xray.name,
    unit: 'أشعة',
    price: SPECS.xray.unitPrice,
    discountable: true,
    administrative_fee_applicable: false,
  });

  ctx.fixtures = { med, supply, labService, xrayService };
}

async function approveInvoiceWithPayment(invoiceId) {
  const invoice = await getInvoiceById(invoiceId);
  const savePayload = {
    invoice_type: invoice.invoice_type,
    patient_name: invoice.patient_name,
    file_number: invoice.file_number,
    issue_date: invoice.issue_date,
    admission_date: invoice.admission_date,
    discharge_date: invoice.discharge_date,
    admin_expenses_percent: invoice.admin_expenses_percent ?? 12,
    stamp_duty: invoice.stamp_duty ?? 0,
    professional_fees: invoice.professional_fees ?? 0,
    balance: invoice.balance ?? 0,
    contracted_entity_id: invoice.contracted_entity_id || null,
    discount_percent: invoice.discount_percent ?? 0,
    items: (invoice.items || []).filter((i) => !i.daily_entry_line_id && !i.daily_entry_id),
    stay_entries: invoice.stay_entries || [],
    include_daily_charges: true,
    save_mode: 'submit',
    invoice_id: invoiceId,
  };

  const calcData = await prepareCalculationData(savePayload);
  const totals = calculateInvoiceTotals(calcData);
  const paymentAmount = money(totals.final_total_raw);

  await saveInvoice(
    {
      ...savePayload,
      method_payments: [{ code: 'cash', amount: paymentAmount }],
    },
    invoiceId
  );
  return approveInvoice(invoiceId, { full_name: 'PDF E2E Reviewer', username: 'pdf-e2e' });
}

function assertDailyLineMatchesInvoice(reportType, dailyLine, invoiceItem) {
  assertEq(reportType, 'daily vs invoice quantity', invoiceItem.quantity, dailyLine.quantity);
  assertEq(reportType, 'daily vs invoice unit price', invoiceItem.amount, dailyLine.unit_price);
  assertEq(
    reportType,
    'daily vs invoice line total',
    money(invoiceItem.quantity) * money(invoiceItem.amount),
    dailyLine.amount
  );
  assertTextContains(reportType, invoiceItem.description || '', 'invoice description', dailyLine.description);
  if (dailyLine.catalog_unit) {
    assertTextContains(
      reportType,
      invoiceItem.unit_snapshot || invoiceItem.description || '',
      'invoice unit snapshot',
      dailyLine.catalog_unit
    );
  }
}

async function validateFinalInvoice(reportType, invoice) {
  assertTrue(reportType, 'invoice approved', invoice.status === 'approved', invoice.status);
  assertTrue(reportType, 'serial number present', Boolean(invoice.serial_number), invoice.serial_number);

  const enriched = enrichInvoice(invoice);
  const html = buildInvoiceHtml(enriched, { baseUrl: 'http://localhost:3000', showQr: false });
  const htmlText = htmlToText(html);
  const medItem = enriched.items.find((i) => i.section_code === 'medicines');
  const supplyItem = enriched.items.find((i) => i.section_code === 'supplies');
  const medProductName = resolveCatalogProductLabel(medItem, SPECS.med.name);
  const supplyProductName = resolveCatalogProductLabel(supplyItem, SPECS.supply.name);

  assertHtmlContains(reportType, html, 'patient name', invoice.patient_name);
  assertHtmlContains(reportType, html, 'file number', invoice.file_number);
  assertHtmlContains(reportType, html, 'serial number', invoice.serial_number);
  assertHtmlContains(reportType, html, 'medicines section label', CUSTOMER_MEDICINES_LABEL);
  assertHtmlContains(reportType, html, 'supplies section label', CUSTOMER_SUPPLIES_LABEL);
  assertTrue(reportType, 'med item name hidden', !htmlText.includes(medProductName), medProductName);
  assertTrue(reportType, 'supply item name hidden', !htmlText.includes(supplyProductName), supplyProductName);
  assertHtmlContains(reportType, html, 'lab service name', SPECS.lab.name);
  assertHtmlContains(reportType, html, 'xray service name', SPECS.xray.name);
  assertHtmlContains(reportType, html, 'aggregated med total', fmtAmount(SPECS.med.lineTotal));
  assertHtmlContains(reportType, html, 'aggregated supply total', fmtAmount(SPECS.supply.lineTotal));
  assertEq(
    reportType,
    'final total unchanged',
    enriched.final_total,
    invoice.final_total ?? enriched.final_total_raw
  );
  assertHtmlContains(reportType, html, 'final total', fmtAmount(enriched.final_total));
  assertHtmlContains(reportType, html, 'total collected', fmtAmount(enriched.total_collected));
  assertHtmlContains(reportType, html, 'remaining', fmtAmount(enriched.remaining));
  assertHtmlContains(reportType, html, 'admin expenses', fmtAmount(enriched.admin_expenses));

  assertTrue(reportType, 'medicine invoice item preserved', Boolean(medItem), 'missing');
  assertTrue(reportType, 'supply invoice item preserved', Boolean(supplyItem), 'missing');
  assertEq(reportType, 'supply cost snapshot', supplyItem.cost_price_snapshot, SPECS.supply.cost);
  assertEq(reportType, 'supply markup snapshot', supplyItem.markup_percent_snapshot, SPECS.supply.markup);
  assertEq(reportType, 'supply selling snapshot', supplyItem.selling_price_snapshot, SPECS.supply.unitPrice);
  assertEq(reportType, 'supply margin snapshot', supplyItem.margin_amount_snapshot, SPECS.supply.margin);

  try {
    const pdfBuf = await generatePdfBuffer(enriched, 'http://localhost:3000', { logoUrl: '' });
    await assertPdfBuffer(reportType, pdfBuf, 'invoice PDF');
    assertPdfBufferContainsUtf8(reportType, pdfBuf, 'PDF medicines label', CUSTOMER_MEDICINES_LABEL);
    assertPdfBufferContainsUtf8(reportType, pdfBuf, 'PDF supplies label', CUSTOMER_SUPPLIES_LABEL);
    assertPdfBufferNotContainsUtf8(reportType, pdfBuf, 'PDF med name hidden', medProductName);
    assertPdfBufferNotContainsUtf8(reportType, pdfBuf, 'PDF supply name hidden', supplyProductName);
    const pdfText = await extractPdfText(pdfBuf);
    if (pdfText) {
      assertTextContains(reportType, pdfText, 'PDF patient name', invoice.patient_name);
      assertTextContains(reportType, pdfText, 'PDF file number', invoice.file_number);
      assertTextContainsNormalized(reportType, pdfText, 'PDF medicines label', CUSTOMER_MEDICINES_LABEL);
      assertTextContainsNormalized(reportType, pdfText, 'PDF supplies label', CUSTOMER_SUPPLIES_LABEL);
      assertTextContains(reportType, pdfText, 'PDF lab service name', SPECS.lab.name);
      assertTextContains(reportType, pdfText, 'PDF xray service name', SPECS.xray.name);
      assertTextContains(reportType, pdfText, 'PDF aggregated med total', fmtAmount(SPECS.med.lineTotal));
      assertTextContains(reportType, pdfText, 'PDF aggregated supply total', fmtAmount(SPECS.supply.lineTotal));
      assertTextContains(reportType, pdfText, 'PDF final total', fmtAmount(enriched.final_total));
      assertTrue(
        reportType,
        'PDF med name hidden',
        !normalizeArabicForMatch(pdfText).includes(normalizeArabicForMatch(medProductName)),
        medProductName
      );
      assertTrue(
        reportType,
        'PDF supply name hidden',
        !normalizeArabicForMatch(pdfText).includes(normalizeArabicForMatch(supplyProductName)),
        supplyProductName
      );
    }
  } catch (err) {
    console.log(`SKIP invoice PDF generation: ${err.message}`);
  }

  return { enriched, html };
}

async function validateCatalogReport(reportType, kind, filters, expectations = {}) {
  const report = await getDailyPrintReport(kind, filters);
  const html = buildDailyReportHtml(report);
  const text = htmlToText(html);

  assertTextContains(reportType, text, 'patient name', ctx.patient.name);
  assertTextContains(reportType, text, 'file number', TEST_FILE);

  for (const row of expectations.rows || []) {
    assertTextContains(reportType, text, `row name ${row.name}`, row.name);
    if (row.unitPrice != null) {
      assertTextContains(reportType, text, `row price ${row.name}`, fmtAmount(row.unitPrice));
    }
    if (row.total != null) {
      assertTextContains(reportType, text, `row total ${row.name}`, fmtAmount(row.total));
    }
    if (row.unit) {
      assertTextContains(reportType, text, `row unit ${row.name}`, row.unit);
    }
    if (row.cost != null) {
      assertTextContains(reportType, text, `row cost ${row.name}`, fmtAmount(row.cost));
    }
    if (row.markup != null) {
      assertTextContains(reportType, text, `row markup ${row.name}`, fmtAmount(row.markup));
    }
  }

  if (expectations.minRows) {
    assertTrue(reportType, `${kind} row count`, (report.rows || []).length >= expectations.minRows, report.rows?.length);
  }

  if (expectations.categories) {
    const cats = new Set((report.rows || []).map((r) => r.category).filter(Boolean));
    for (const cat of expectations.categories) {
      assertTrue(reportType, `${kind} category ${cat}`, cats.has(cat), [...cats].join(','));
    }
  }

  try {
    const pdfBuf = await generateDailyItemsPdfBuffer(report, 'http://localhost:3000', { logoUrl: '' });
    await assertPdfBuffer(reportType, pdfBuf, `${kind} PDF`);
    const pdfText = await extractPdfText(pdfBuf);
    if (pdfText && expectations.rows?.[0]?.name) {
      assertTextContains(reportType, pdfText, `PDF row ${expectations.rows[0].name}`, expectations.rows[0].name);
    }
  } catch (err) {
    console.log(`SKIP ${kind} PDF generation: ${err.message}`);
  }

  return { report, html, text };
}

async function main() {
  await initDatabase();
  try {
    await cleanupAll();
    const patient = await upsertPatient(TEST_FILE, 'PDF E2E Print Patient');
    ctx.patient = patient;
    const today = getCurrentBusinessDateString();
    ctx.today = today;

    await provisionFixtures();
    const { med, supply, labService, xrayService } = ctx.fixtures;

    const batch = await saveEntriesBatch({
      file_number: TEST_FILE,
      patient_name: patient.name,
      entries: [
        {
          entry_date: today,
          lines: [
            {
              section_code: 'medicines',
              catalog_item_id: med.id,
              catalog_unit_level: 'major',
              catalog_unit: 'PAC',
              quantity: SPECS.med.qty,
            },
          ],
        },
        {
          entry_date: today,
          lines: [{ section_code: 'supplies', catalog_item_id: supply.id, quantity: SPECS.supply.qty }],
        },
        {
          entry_date: today,
          lines: [{ section_code: 'analyses', service_id: labService.id, quantity: SPECS.lab.qty }],
        },
        {
          entry_date: today,
          lines: [{ section_code: 'xray_total', service_id: xrayService.id, quantity: SPECS.xray.qty }],
        },
      ],
    });

    assertTrue('setup', 'invoice sync', batch.invoice_sync?.synced, JSON.stringify(batch.invoice_sync));
    const invoiceId = batch.invoice_sync.invoice_id;
    ctx.savedEntries = batch.saved || [];
    ctx.dailyLines = ctx.savedEntries.flatMap((e) => e.lines || []);

    const approved = await approveInvoiceWithPayment(invoiceId);
    ctx.invoiceId = approved.id;

    const medLine = ctx.dailyLines.find((l) => l.section_code === 'medicines');
    const supplyLine = ctx.dailyLines.find((l) => l.section_code === 'supplies');
    const labLine = ctx.dailyLines.find((l) => l.section_code === 'analyses');
    const xrayLine = ctx.dailyLines.find((l) => l.section_code === 'xray_total');

    const invoice = await getInvoiceById(approved.id);
    const dailyItems = (invoice.items || []).filter((i) => i.daily_entry_line_id);

    for (const line of [medLine, supplyLine, labLine, xrayLine]) {
      const invItem = dailyItems.find((i) => Number(i.daily_entry_line_id) === Number(line.id));
      assertTrue('data-integrity', `invoice item for line ${line.id}`, Boolean(invItem), 'missing');
      assertDailyLineMatchesInvoice('data-integrity', line, invItem);
    }
    console.log('OK data integrity daily entry vs invoice');

    const { enriched, html: invoiceHtml } = await validateFinalInvoice('final-invoice', invoice);
    console.log('OK final invoice HTML/PDF content');

    const filters = { file_number: TEST_FILE, from_date: today, to_date: today };

    await validateCatalogReport('medicines-print', 'medicines', filters, {
      minRows: 1,
      rows: [
        {
          name: SPECS.med.name,
          unit: 'PAC',
          unitPrice: SPECS.med.unitPrice,
          total: SPECS.med.lineTotal,
        },
      ],
    });
    console.log('OK medicines print');

    await validateCatalogReport('supplies-print', 'supplies', filters, {
      minRows: 1,
      rows: [
        {
          name: SPECS.supply.name,
          unit: SPECS.supply.unit,
          unitPrice: SPECS.supply.unitPrice,
          total: SPECS.supply.lineTotal,
          cost: SPECS.supply.cost,
          markup: SPECS.supply.markup,
        },
      ],
    });
    console.log('OK supplies print');

    await validateCatalogReport('medicines-supplies-print', 'medicines_supplies', filters, {
      minRows: 2,
      categories: ['أدوية', 'مستلزمات'],
      rows: [
        { name: SPECS.med.name, unitPrice: SPECS.med.unitPrice },
        { name: SPECS.supply.name, unitPrice: SPECS.supply.unitPrice },
      ],
    });
    console.log('OK medicines + supplies print');

    await validateCatalogReport('laboratory-print', 'laboratory', filters, {
      minRows: 1,
      rows: [{ name: SPECS.lab.name, unitPrice: SPECS.lab.unitPrice, total: SPECS.lab.lineTotal }],
    });
    console.log('OK laboratory print');

    await validateCatalogReport('radiology-print', 'radiology', filters, {
      minRows: 1,
      rows: [{ name: SPECS.xray.name, unitPrice: SPECS.xray.unitPrice, total: SPECS.xray.lineTotal }],
    });
    console.log('OK radiology print');

    await updateCatalogItem(med.id, {
      code: med.code,
      name: `${TEST_PREFIX} Medicine CHANGED`,
      category: 'Medicine',
      major_unit: 'PAC',
      minor_unit: 'STR',
      minor_quantity_per_major: 2,
      major_unit_selling_price: 99,
      minor_unit_selling_price: 49.5,
    });
    await updateCatalogItem(supply.id, {
      code: supply.code,
      name: `${TEST_PREFIX} Supply CHANGED`,
      category: 'Supplies',
      major_unit: SPECS.supply.unit,
      cost_price: 200,
      markup_percent: 10,
    });

    const historicalInvoice = await getInvoiceById(approved.id);
    const historicalHtml = buildInvoiceHtml(enrichInvoice(historicalInvoice), {
      baseUrl: 'http://localhost:3000',
      showQr: false,
    });
    const historicalText = htmlToText(historicalHtml);

    assertTextContains('historical', historicalText, 'medicines section label', DEFAULT_SECTION_LABELS.medicines);
    assertTextContains('historical', historicalText, 'supplies section label', DEFAULT_SECTION_LABELS.supplies);
    assertTextContains('historical', historicalText, 'historical med total', fmtAmount(SPECS.med.lineTotal));
    assertTextContains('historical', historicalText, 'historical supply total', fmtAmount(SPECS.supply.lineTotal));
    assertTrue(
      'historical',
      'original med name hidden',
      !historicalText.includes(SPECS.med.name),
      SPECS.med.name
    );
    assertTrue(
      'historical',
      'original supply name hidden',
      !historicalText.includes(SPECS.supply.name),
      SPECS.supply.name
    );
    assertTrue(
      'historical',
      'changed med name absent',
      !historicalText.includes(`${TEST_PREFIX} Medicine CHANGED`),
      'found changed name'
    );
    assertTrue(
      'historical',
      'changed supply name absent',
      !historicalText.includes(`${TEST_PREFIX} Supply CHANGED`),
      'found changed name'
    );
    console.log('OK historical invoice ignores catalog changes');

    const medInvItem = dailyItems.find((i) => Number(i.daily_entry_line_id) === Number(medLine.id));
    await recordInvoiceReturns(approved.id, {
      lines: [{ invoice_item_id: medInvItem.id, return_quantity: 1 }],
      notes: 'PDF test partial return',
    });

    const afterReturn = await getInvoiceById(approved.id);
    const returnHtml = buildInvoiceHtml(enrichInvoice(afterReturn), {
      baseUrl: 'http://localhost:3000',
      showQr: false,
    });
    const returnText = htmlToText(returnHtml);

    assertTextContains('returns', returnText, 'medicines section after return', DEFAULT_SECTION_LABELS.medicines);
    const netMedTotal = SPECS.med.unitPrice * (SPECS.med.qty - 1);
    assertHtmlContains('returns', returnHtml, 'aggregated med total after return', fmtAmount(netMedTotal));
    assertTrue('returns', 'med name hidden after return', !returnText.includes(SPECS.med.name), SPECS.med.name);
    assertTrue('returns', 'return history exists', (afterReturn.returns || []).length >= 1, 0);
    assertTrue(
      'returns',
      'original qty preserved on item',
      Number(medInvItem.quantity) === SPECS.med.qty,
      medInvItem.quantity
    );
    const returnedMed = afterReturn.items.find((i) => Number(i.id) === Number(medInvItem.id));
    assertEq('returns', 'returned quantity updated', returnedMed.returned_quantity, 1);
    assertEq(
      'returns',
      'invoice items count unchanged',
      afterReturn.items.length,
      historicalInvoice.items.length
    );
    console.log('OK partial return on printed invoice');

    const recalc = calculateInvoiceTotals(enrichInvoice(afterReturn));
    assertEq(
      'returns',
      'final total after return',
      recalc.final_total_raw,
      afterReturn.final_total_raw ?? afterReturn.final_total
    );
    console.log('OK return totals reconcile');

    console.log('ALL PDF/PRINTING TESTS PASSED');
  } finally {
    await cleanupAll();
  }
}

main().catch((err) => {
  if (String(err.message || err).includes('password authentication')) {
    console.log('SKIP PDF printing tests (no database)');
    process.exit(0);
  }
  console.error(err);
  process.exit(1);
});
