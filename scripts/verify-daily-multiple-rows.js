#!/usr/bin/env node
/**
 * Verify multiple daily-entry UI rows on the same date save as separate records.
 * Run: node scripts/verify-daily-multiple-rows.js
 */

const { initDatabase, query } = require('../database/db');
const { saveEntriesBatch } = require('../services/dailyChargeService');
const { upsertPatient } = require('../services/patientService');

const TEST_FILE = 'MULTI-ROW-TEST';

async function main() {
  await initDatabase();

  const constraintRes = await query(
    `SELECT 1 FROM pg_constraint
     WHERE conname = 'patient_daily_entries_patient_id_entry_date_key'`
  );
  if (constraintRes.rows.length) {
    console.error('FAIL: unique constraint patient_daily_entries_patient_id_entry_date_key still exists');
    process.exit(1);
  }

  const meds = await query(
    `SELECT id, name, price FROM daily_entry_catalog_items
     WHERE category = 'Medicine' AND is_active = TRUE AND price > 0
     ORDER BY id LIMIT 2`
  );
  const supplies = await query(
    `SELECT id, name, price FROM daily_entry_catalog_items
     WHERE category = 'Supplies' AND is_active = TRUE AND price > 0
     ORDER BY id LIMIT 1`
  );

  if (meds.rows.length < 2 || !supplies.rows.length) {
    console.error('FAIL: need at least 2 medicines and 1 supply in catalog');
    process.exit(1);
  }

  const patient = await upsertPatient({ file_number: TEST_FILE, name: 'Multi Row Test' });
  const today = new Date().toISOString().slice(0, 10);

  await query(
    `DELETE FROM patient_daily_entry_lines
     WHERE entry_id IN (SELECT id FROM patient_daily_entries WHERE patient_id = $1)`,
    [patient.id]
  );
  await query(`DELETE FROM patient_daily_entry_history WHERE entry_id IN (
    SELECT id FROM patient_daily_entries WHERE patient_id = $1
  )`, [patient.id]);
  await query(`DELETE FROM patient_daily_entries WHERE patient_id = $1`, [patient.id]);

  const entries = [
    {
      entry_date: today,
      lines: [{ section_code: 'medicines', catalog_item_id: meds.rows[0].id, quantity: 1 }],
    },
    {
      entry_date: today,
      lines: [{ section_code: 'medicines', catalog_item_id: meds.rows[1].id, quantity: 2 }],
    },
    {
      entry_date: today,
      lines: [{ section_code: 'supplies', catalog_item_id: supplies.rows[0].id, quantity: 5 }],
    },
  ];

  const result = await saveEntriesBatch({
    file_number: TEST_FILE,
    patient_name: patient.name,
    entries,
  });

  if (result.count !== 3 || result.saved.length !== 3) {
    console.error('FAIL: batch save expected 3 entries, got', result);
    process.exit(1);
  }

  const ids = new Set(result.saved.map((e) => e.id));
  if (ids.size !== 3) {
    console.error('FAIL: saved entries have duplicate ids', [...ids]);
    process.exit(1);
  }

  const countRes = await query(
    `SELECT COUNT(*)::int AS n FROM patient_daily_entries WHERE patient_id = $1 AND entry_date = $2`,
    [patient.id, today]
  );
  const dbCount = countRes.rows[0].n;
  if (dbCount !== 3) {
    console.error('FAIL: database has', dbCount, 'entries for today, expected 3');
    process.exit(1);
  }

  const linesRes = await query(
    `SELECT l.section_code, l.catalog_item_id, l.quantity, l.amount
     FROM patient_daily_entry_lines l
     JOIN patient_daily_entries e ON e.id = l.entry_id
     WHERE e.patient_id = $1 AND e.entry_date = $2
     ORDER BY e.id`,
    [patient.id, today]
  );
  if (linesRes.rows.length !== 3) {
    console.error('FAIL: expected 3 lines across entries, got', linesRes.rows);
    process.exit(1);
  }

  console.log('OK: 3 same-date daily rows saved as 3 separate records');
  console.log('  Entry ids:', [...ids].join(', '));
  linesRes.rows.forEach((row, i) => {
    console.log(`  Line ${i + 1}: ${row.section_code} catalog=${row.catalog_item_id} qty=${row.quantity} amt=${row.amount}`);
  });

  await query(
    `DELETE FROM patient_daily_entry_lines
     WHERE entry_id IN (SELECT id FROM patient_daily_entries WHERE patient_id = $1)`,
    [patient.id]
  );
  await query(`DELETE FROM patient_daily_entry_history WHERE entry_id IN (
    SELECT id FROM patient_daily_entries WHERE patient_id = $1
  )`, [patient.id]);
  await query(`DELETE FROM patient_daily_entries WHERE patient_id = $1`, [patient.id]);
  await query(`DELETE FROM patients WHERE id = $1`, [patient.id]);

  process.exit(0);
}

main().catch((err) => {
  console.error('FAIL:', err.message);
  process.exit(1);
});
