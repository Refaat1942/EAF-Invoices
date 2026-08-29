#!/usr/bin/env node
/**
 * Patient transaction kind labels (no database).
 * Run: node scripts/test-patient-transaction-kinds.js
 */

const { labelTransactionKind } = require('../services/patientTransactionKinds');

function assert(cond, msg) {
  if (!cond) {
    console.error('FAIL:', msg);
    process.exit(1);
  }
}

assert(labelTransactionKind('collection') === 'تحصيل', 'collection label');
assert(labelTransactionKind('prepaid_deduct') === 'خصم من الرصيد', 'prepaid label');
assert(labelTransactionKind('legacy') === 'حركة سابقة', 'legacy label');
assert(labelTransactionKind('unknown_code') === 'unknown_code', 'fallback to code');

console.log('OK patient transaction kind labels');
