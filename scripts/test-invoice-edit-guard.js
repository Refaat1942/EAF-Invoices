#!/usr/bin/env node
/**
 * Invoice structural edit guard tests (no database).
 * Run: node scripts/test-invoice-edit-guard.js
 */

const {
  hasStructuralInvoiceChanges,
} = require('../services/invoiceEditGuard');

function assert(cond, msg) {
  if (!cond) {
    console.error('FAIL:', msg);
    process.exit(1);
  }
}

const base = {
  patient_name: 'Test',
  file_number: 'F1',
  invoice_type: 'civil',
  items: [{ description: 'Line A', amount: 100, quantity: 1 }],
  stay_entries: [],
};

assert(!hasStructuralInvoiceChanges(base, { ...base }), 'identical payload');
assert(
  hasStructuralInvoiceChanges(base, { ...base, items: [{ description: 'Line B', amount: 100, quantity: 1 }] }),
  'item description change'
);
assert(hasStructuralInvoiceChanges(base, { ...base, stamp_duty: 50 }), 'header stamp change');

console.log('OK invoice edit guard tests passed');
