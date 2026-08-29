/**
 * Targeted tests for daily charge service (no DB required for pure helpers).
 * Run: node scripts/test-daily-charges.js
 */

const {
  computeDailyTotal,
  entriesToInvoiceItems,
  getCurrentBusinessDateString,
  resolveAllowedDailyEntryDate,
  isManualAmountSection,
  MANUAL_AMOUNT_SECTION_CODES,
  buildDailyLinesFingerprint,
} = require('../services/dailyChargeService');

const sections = [
  { code: 'accommodation', input_type: 'amount' },
  { code: 'sessions_date', input_type: 'date' },
  { code: 'sessions_detail', input_type: 'text' },
  { code: 'supplies', input_type: 'amount' },
];

const lines = [
  { section_code: 'accommodation', amount: 1500 },
  { section_code: 'sessions_date', amount: 0, extra_date: '2026-08-01' },
  { section_code: 'supplies', amount: 1500 },
];

const total = computeDailyTotal(lines, sections);
if (total !== 3000) {
  console.error('FAIL computeDailyTotal expected 3000 got', total);
  process.exit(1);
}

const items = entriesToInvoiceItems(
  [
    {
      id: 1,
      entry_date: '2026-08-01',
      lines: [
        { id: 10, section_code: 'supplies', description: 'مستلزمات', amount: 500, quantity: 1, unit_price: 500 },
        { id: 11, section_code: 'sessions_date', description: 'تاريخ', amount: 0, extra_date: '2026-08-01' },
        { id: 12, section_code: 'sessions_detail', description: 'جلسات', amount: 0, extra_text: '3 جلسات' },
      ],
    },
  ],
  sections
);

if (items.length !== 1 || items[0].amount !== 500) {
  console.error('FAIL entriesToInvoiceItems', items);
  process.exit(1);
}

const allowedToday = getCurrentBusinessDateString();
if (resolveAllowedDailyEntryDate(allowedToday) !== allowedToday) {
  console.error('FAIL resolveAllowedDailyEntryDate allowed today');
  process.exit(1);
}

try {
  resolveAllowedDailyEntryDate('2020-01-01');
  console.error('FAIL should reject past entry_date');
  process.exit(1);
} catch (err) {
  if (!String(err.message).includes('غير مقبول')) {
    console.error('FAIL unexpected error for past date', err.message);
    process.exit(1);
  }
}

try {
  resolveAllowedDailyEntryDate('2099-12-31');
  console.error('FAIL should reject future entry_date');
  process.exit(1);
} catch (err) {
  if (!String(err.message).includes('غير مقبول')) {
    console.error('FAIL unexpected error for future date', err.message);
    process.exit(1);
  }
}

if (resolveAllowedDailyEntryDate(undefined) !== allowedToday) {
  console.error('FAIL missing entry_date should use business today');
  process.exit(1);
}

if (!isManualAmountSection('accommodation') || !isManualAmountSection('patient_assistant')) {
  console.error('FAIL manual amount section codes');
  process.exit(1);
}
if (isManualAmountSection('sessions')) {
  console.error('FAIL sessions should not be manual amount');
  process.exit(1);
}

const fp1 = buildDailyLinesFingerprint([
  { section_code: 'medicines', catalog_item_id: 5, amount: 100, quantity: 1 },
]);
const fp2 = buildDailyLinesFingerprint([
  { section_code: 'medicines', catalog_item_id: 5, amount: 100, quantity: 1 },
]);
const fp3 = buildDailyLinesFingerprint([
  { section_code: 'medicines', catalog_item_id: 6, amount: 100, quantity: 1 },
]);
if (fp1 !== fp2 || fp1 === fp3) {
  console.error('FAIL buildDailyLinesFingerprint');
  process.exit(1);
}

console.log('OK daily charge helper tests passed');
process.exit(0);
