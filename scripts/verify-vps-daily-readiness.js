#!/usr/bin/env node
/**
 * Post-deploy check: default price list has services for Daily Entry canonical categories.
 * Run on VPS: node scripts/verify-vps-daily-readiness.js
 */

const { initDatabase, query } = require('../database/db');

const CANONICAL_CATEGORIES = [
  'MEDICAL_EXAMS',
  'LAB',
  'RADIOLOGY',
  'PHYSIO',
  'ACCOMMODATION',
  'COMPANION',
  'NURSING',
  'STAMPS',
  'GENERAL',
  'PROSTHETICS',
];

async function main() {
  await initDatabase();

  const { rows: lists } = await query(
    `SELECT id, name, code, is_default, is_active FROM price_lists WHERE is_default = TRUE AND is_active = TRUE LIMIT 1`
  );
  if (!lists.length) {
    console.error('FAIL: no active default price list');
    process.exit(1);
  }
  const list = lists[0];
  console.log(`OK default price list: ${list.name} (#${list.id})`);

  const { rows: sections } = await query(
    `SELECT code FROM daily_charge_sections WHERE is_active = TRUE AND code = 'patient_assistant'`
  );
  if (!sections.length) {
    console.error('FAIL: patient_assistant section missing — restart app to seed');
    process.exit(1);
  }
  console.log('OK patient_assistant daily section exists');

  let missing = 0;
  for (const code of CANONICAL_CATEGORIES) {
    const { rows } = await query(
      `SELECT COUNT(*)::int AS n FROM services s
       INNER JOIN service_categories c ON c.id = s.category_id
       WHERE s.price_list_id = $1 AND c.code = $2 AND s.is_active = TRUE`,
      [list.id, code]
    );
    const n = rows[0].n;
    if (n === 0) {
      console.warn(`WARN category ${code}: 0 services — re-import DOCX if needed`);
      missing += 1;
    } else {
      console.log(`OK category ${code}: ${n} services`);
    }
  }

  if (missing > 0) {
    console.error(`FAIL: ${missing} canonical categories empty on default price list`);
    process.exit(1);
  }

  console.log('ALL VPS DAILY READINESS CHECKS PASSED');
  process.exit(0);
}

main().catch((err) => {
  console.error('FAIL:', err.message);
  process.exit(1);
});
