#!/usr/bin/env node
/**
 * Reconciliation report logic (no database).
 * Run: node scripts/test-reconciliation-report.js
 */

const { round2 } = require('../services/calculations');

function roundReport(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function isBalancedAmount(diff) {
  return Math.abs(roundReport(diff)) < 0.02;
}

function assert(cond, msg) {
  if (!cond) {
    console.error('FAIL:', msg);
    process.exit(1);
  }
}

const finalTotal = 1000;
const collected = 600;
const remaining = 400;
assert(isBalancedAmount(finalTotal - (collected + remaining)), 'balanced invoice equation');

const methodSum = 550;
assert(!isBalancedAmount(collected - methodSum), 'method mismatch detected');

console.log('OK reconciliation helper tests passed');
