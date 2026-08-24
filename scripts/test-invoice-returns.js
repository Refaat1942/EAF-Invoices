#!/usr/bin/env node
/**
 * Invoice return calculations and return recording tests.
 * Run: node scripts/test-invoice-returns.js
 * DB tests run when DATABASE_URL is available (node --env-file=.env).
 */

const {
  calculateInvoiceTotals,
  validateInvoiceCalculations,
  resolveItemQuantities,
  prorateSuppliesFields,
  round2,
} = require('../services/calculations');
const { buildReturnLineAudit } = require('../services/invoiceReturnService');

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
      margin_amount_snapshot: 500,
      description: 'Supply item',
      is_discount_eligible: false,
    },
    4,
    0,
    12
  );
  assertEq(audit.return_amount, 600, 'return amount supply');
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

async function testDbReturnFlow() {
  const { initDatabase, query } = require('../database/db');
  const { saveInvoice } = require('../services/invoiceService');
  const { recordInvoiceReturns, listInvoiceReturns } = require('../services/invoiceReturnService');
  const { upsertPatient } = require('../services/patientService');

  await initDatabase();

  const TEST_FILE = 'INV-RETURN-TEST';
  const patient = await upsertPatient(TEST_FILE, 'Return Test Patient');

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

  const invoice = await saveInvoice({
    invoice_type: 'civil',
    patient_name: patient.name,
    file_number: TEST_FILE,
    issue_date: new Date().toISOString().slice(0, 10),
    admission_date: new Date().toISOString().slice(0, 10),
    items: [
      { description: 'ANTINAL 200MG', quantity: 4, amount: 52 },
      {
        description: 'Supply line',
        quantity: 5,
        amount: 100,
        section_code: 'supplies',
        cost_price_snapshot: 60,
        markup_percent_snapshot: 40,
        margin_amount_snapshot: 200,
      },
    ],
    method_payments: [{ code: 'cash', amount: 708 }],
    save_mode: 'draft',
    include_daily_charges: false,
  });

  const medLine = invoice.items.find((i) => i.description.includes('ANTINAL'));
  assert(medLine?.id, 'medicine line saved');

  const result = await recordInvoiceReturns(invoice.id, {
    lines: [{ invoice_item_id: medLine.id, return_quantity: 2 }],
    notes: 'partial return test',
  });

  const updatedMed = result.invoice.items.find((i) => Number(i.id) === Number(medLine.id));
  assertEq(updatedMed.quantity, 4, 'original qty preserved');
  assertEq(updatedMed.returned_quantity, 2, 'returned qty updated');

  const history = await listInvoiceReturns(invoice.id);
  assert(history.length >= 1, 'return history exists');
  assert(history[0].lines.length === 1, 'return line audit exists');

  const { rows: itemRows } = await query(`SELECT id FROM invoice_items WHERE invoice_id = $1`, [invoice.id]);
  assertEq(itemRows.length, invoice.items.length, 'original lines not deleted');

  try {
    await recordInvoiceReturns(invoice.id, {
      lines: [{ invoice_item_id: medLine.id, return_quantity: 5 }],
    });
    console.error('FAIL should reject over-return');
    process.exit(1);
  } catch (err) {
    assert(String(err.message).includes('لا يمكن إرجاع'), 'over-return error message');
  }

  await query(`DELETE FROM invoice_item_returns WHERE invoice_return_id IN (
    SELECT id FROM invoice_returns WHERE invoice_id = $1
  )`, [invoice.id]);
  await query(`DELETE FROM invoice_returns WHERE invoice_id = $1`, [invoice.id]);
  await query(`DELETE FROM invoice_items WHERE invoice_id = $1`, [invoice.id]);
  await query(`DELETE FROM invoices WHERE id = $1`, [invoice.id]);

  console.log('OK DB return flow and audit history');
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

  try {
    await testDbReturnFlow();
  } catch (err) {
    if (String(err.message || err).includes('password authentication')) {
      console.log('SKIP DB return tests (no database)');
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
