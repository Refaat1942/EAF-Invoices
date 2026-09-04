/**
 * Invoice calculation tests (no DB).
 * Run: node scripts/test-calculations.js
 */

const {
  calculateInvoiceTotals,
  validateInvoiceCalculations,
  isItemAdminApplicable,
  computeItemAdminFeeRaw,
  round2,
} = require('../services/calculations');

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
  invoice_type: 'private',
  discount_percent: 0,
  stamp_duty: 0,
  professional_fees: 0,
  balance: 0,
  admin_expenses_percent: 12,
  stay_entries: [],
  payments: [],
  method_payments: [],
};

// Admin fee only on applicable items
const adminTotals = calculateInvoiceTotals({
  ...base,
  items: [
    {
      description: 'خدمة خاضعة',
      quantity: 1,
      amount: 1000,
      administrative_fee_applicable_snapshot: true,
    },
    {
      description: 'خدمة غير خاضعة',
      quantity: 1,
      amount: 500,
      administrative_fee_applicable_snapshot: false,
    },
  ],
});
assertEq(adminTotals.admin_expenses_raw, 120, 'admin fee');
assertEq(adminTotals.manual_items_subtotal_raw, 1500, 'manual subtotal');
const manualSum = adminTotals.items
  .filter((i) => !i.is_stay_entry)
  .reduce((s, i) => s + i.total_raw, 0);
assertEq(manualSum, 1500, 'line sum');
assertEq(adminTotals.manual_items_subtotal, 1500, 'manual subtotal rounded');

const adminValidation = validateInvoiceCalculations(base, adminTotals);
assert(adminValidation.is_valid, `validation failed: ${adminValidation.errors.join('; ')}`);

// Supplies markup totals
const suppliesTotals = calculateInvoiceTotals({
  ...base,
  items: [
    {
      description: 'مستلزمات',
      quantity: 2,
      amount: 150,
      section_code: 'supplies',
      daily_entry_line_id: 99,
      supplies_cost_raw: 200,
      supplies_margin_raw: 100,
      supplies_selling_raw: 300,
    },
  ],
});
assertEq(suppliesTotals.supplies_cost_total_raw, 200, 'supplies cost');
assertEq(suppliesTotals.supplies_margin_total_raw, 100, 'supplies margin');
assertEq(suppliesTotals.supplies_selling_total_raw, 300, 'supplies selling');

const stayNotSupplies = calculateInvoiceTotals({
  ...base,
  items: [
    {
      description: 'إقامة',
      quantity: 1,
      amount: 6000,
      section_code: 'accommodation',
      daily_entry_line_id: 88,
    },
    {
      description: 'مستلزم',
      quantity: 1,
      amount: 120,
      section_code: 'supplies',
      daily_entry_line_id: 99,
      cost_price: 100,
      supplies_cost_raw: 100,
      supplies_margin_raw: 20,
      supplies_selling_raw: 120,
    },
  ],
});
assertEq(stayNotSupplies.supplies_margin_total_raw, 20, 'only supplies margin counted');
assertEq(stayNotSupplies.manual_items_subtotal_raw, 6120, 'stay + supplies subtotal');

assertEq(suppliesTotals.daily_items_subtotal_raw, 300, 'daily subtotal');

// Final total with discount and payments
const fullTotals = calculateInvoiceTotals({
  ...base,
  invoice_type: 'contracted',
  contracted_entity_id: 1,
  discount_percent: 10,
  stamp_duty: 50,
  professional_fees: 100,
  balance: 25,
  items: [
    {
      description: 'بند',
      quantity: 1,
      amount: 1000,
      discountable_snapshot: true,
      administrative_fee_applicable_snapshot: true,
    },
  ],
  payments: [{ amount: 500 }],
  method_payments: [{ code: 'cash', amount: 500 }],
});
assertEq(fullTotals.items_subtotal_raw, 1000, 'items subtotal');
assertEq(fullTotals.subtotal_before_admin_raw, 1150, 'before admin');
assertEq(fullTotals.admin_expenses_raw, 120, 'admin on items only');
assertEq(fullTotals.total_after_admin_raw, 1270, 'after admin');
assertEq(fullTotals.discount_amount_raw, 100, 'discount on eligible');
assertEq(fullTotals.net_after_discount_raw, 1170, 'net after discount');
assertEq(fullTotals.final_total_raw, 1195, 'final with balance');
assertEq(fullTotals.remaining_raw, 695, 'remaining');
assertEq(fullTotals.final_total, 1195, 'final rounded keeps decimals');

const fullValidation = validateInvoiceCalculations(
  { invoice_type: 'contracted', contracted_entity_id: 1, discount_percent: 10 },
  fullTotals
);
assert(fullValidation.is_valid, `full validation: ${fullValidation.errors.join('; ')}`);

assert(isItemAdminApplicable({ administrative_fee_applicable_snapshot: false }) === false, 'admin flag');
assert(computeItemAdminFeeRaw({ total_raw: 1000, administrative_fee_applicable_snapshot: false }, 12) === 0, 'no admin');

// Decimal line amounts — no integer rounding
const decimalLines = calculateInvoiceTotals({
  ...base,
  items: [
    { description: 'بند 1', quantity: 1, amount: 100.4 },
    { description: 'بند 2', quantity: 1, amount: 100.6 },
    { description: 'بند 3', quantity: 1, amount: 99.99 },
    { description: 'بند 4', quantity: 1, amount: 0.01 },
  ],
});
assertEq(decimalLines.manual_items_subtotal_raw, 301, 'decimal lines subtotal raw');
assertEq(decimalLines.manual_items_subtotal, 301, 'decimal lines subtotal rounded');
const decimalSum = decimalLines.items
  .filter((i) => !i.is_stay_entry)
  .reduce((s, i) => s + i.total_raw, 0);
assertEq(decimalSum, 301, 'decimal line sum equals subtotal');

// Decimal amounts with admin fee and entity discount
const decimalDiscount = calculateInvoiceTotals({
  ...base,
  invoice_type: 'contracted',
  contracted_entity_id: 1,
  discount_percent: 10,
  admin_expenses_percent: 12,
  items: [
    {
      description: 'بند خاضع',
      quantity: 1,
      amount: 100.4,
      discountable_snapshot: true,
      administrative_fee_applicable_snapshot: true,
    },
    {
      description: 'بند خاضع 2',
      quantity: 1,
      amount: 99.99,
      discountable_snapshot: true,
      administrative_fee_applicable_snapshot: true,
    },
  ],
  method_payments: [{ code: 'cash', amount: 200.4 }],
});
assertEq(decimalDiscount.items_subtotal_raw, 200.39, 'decimal discount items subtotal');
assertEq(decimalDiscount.admin_expenses_raw, 24.05, 'decimal admin fee');
assertEq(decimalDiscount.total_after_admin_raw, 224.44, 'decimal after admin');
assertEq(decimalDiscount.discount_amount_raw, 20.04, 'decimal entity discount');
assertEq(decimalDiscount.net_after_discount_raw, 204.4, 'decimal net after discount');
assertEq(decimalDiscount.final_total_raw, 204.4, 'decimal final total');
assertEq(decimalDiscount.total_collected_raw, 200.4, 'decimal collected');
assertEq(decimalDiscount.remaining_raw, 4, 'decimal remaining');

const decimalValidation = validateInvoiceCalculations(
  { invoice_type: 'contracted', contracted_entity_id: 1, discount_percent: 10 },
  decimalDiscount
);
assert(decimalValidation.is_valid, `decimal validation: ${decimalValidation.errors.join('; ')}`);

// Fractional unit price × quantity
const qtyTotals = calculateInvoiceTotals({
  ...base,
  items: [{ description: 'بند', quantity: 3, amount: 33.33 }],
});
assertEq(qtyTotals.manual_items_subtotal_raw, 99.99, 'qty × unit price');
assertEq(qtyTotals.items[0].total, 99.99, 'line total rounded');

console.log('OK invoice calculation tests passed');
process.exit(0);
