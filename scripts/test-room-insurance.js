#!/usr/bin/env node
/**
 * Room insurance (مبلغ التأمين) is a deposit, never a charge: it must not be added to the
 * companion line — not on the admission day and not on any other day.
 * Run: node --env-file=.env scripts/test-room-insurance.js
 */

const { initDatabase, query } = require('../database/db');
const { openPatientStay } = require('../services/invoiceService');
const { upsertPatient } = require('../services/patientService');
const { getCurrentBusinessDateString } = require('../services/dailyChargeService');
const { syncAdmissionDayRoomInsurance } = require('../services/stayBatchPostingService');

const TEST_FILE = 'ROOM-INS-TEST';
const COMPANION = 900;
const INSURANCE = 20000;

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function fail(message) {
  console.error(`FAIL ${message}`);
  process.exit(1);
}

async function cleanup() {
  const { rows } = await query(`SELECT id FROM patients WHERE TRIM(file_number) = $1`, [TEST_FILE]);
  const patientId = rows[0]?.id;
  await query(
    `DELETE FROM invoice_items WHERE invoice_id IN (SELECT id FROM invoices WHERE TRIM(file_number) = $1)`,
    [TEST_FILE]
  );
  await query(
    `DELETE FROM invoice_stay_entries WHERE invoice_id IN (SELECT id FROM invoices WHERE TRIM(file_number) = $1)`,
    [TEST_FILE]
  );
  await query(
    `DELETE FROM invoice_payments WHERE invoice_id IN (SELECT id FROM invoices WHERE TRIM(file_number) = $1)`,
    [TEST_FILE]
  );
  if (patientId) {
    await query(
      `DELETE FROM patient_daily_entry_lines WHERE entry_id IN (SELECT id FROM patient_daily_entries WHERE patient_id = $1)`,
      [patientId]
    );
    await query(
      `DELETE FROM patient_daily_entry_history WHERE entry_id IN (SELECT id FROM patient_daily_entries WHERE patient_id = $1)`,
      [patientId]
    );
    await query(`DELETE FROM patient_daily_entries WHERE patient_id = $1`, [patientId]);
    await query(`DELETE FROM patient_room_assignments WHERE patient_id = $1`, [patientId]);
  }
  await query(`DELETE FROM invoices WHERE TRIM(file_number) = $1`, [TEST_FILE]);
  await query(`DELETE FROM patients WHERE TRIM(file_number) = $1`, [TEST_FILE]);
}

async function companionLinesFor(patientId) {
  const { rows } = await query(
    `SELECT l.id, l.entry_id, e.entry_date::text AS entry_date, l.amount
     FROM patient_daily_entry_lines l
     JOIN patient_daily_entries e ON e.id = l.entry_id
     WHERE e.patient_id = $1 AND l.section_code = 'companion'
     ORDER BY e.entry_date, l.id`,
    [patientId]
  );
  return rows;
}

async function main() {
  await initDatabase();
  await cleanup();

  const { rows: stayTypes } = await query(
    `SELECT id FROM stay_types WHERE is_active = TRUE ORDER BY id LIMIT 1`
  );
  if (!stayTypes.length) fail('need an active stay type');

  const today = getCurrentBusinessDateString();
  // New patients get an auto-allocated file number; register first so the stay reuses ours.
  await upsertPatient(TEST_FILE, { name: 'Room Insurance Test', patient_type: 'internal' });
  await openPatientStay({
    file_number: TEST_FILE,
    patient_name: 'Room Insurance Test',
    patient_type: 'internal',
    admission_date: today,
    stay_type_id: stayTypes[0].id,
    companion_amount: COMPANION,
    room_insurance_amount: INSURANCE,
  });

  const { rows: patients } = await query(
    `SELECT id, room_insurance_amount FROM patients WHERE TRIM(file_number) = $1`,
    [TEST_FILE]
  );
  const patient = patients[0];
  if (!patient) fail('patient not created');
  if (round2(patient.room_insurance_amount) !== INSURANCE) {
    fail(`room insurance kept on the patient: expected ${INSURANCE}, got ${patient.room_insurance_amount}`);
  }

  let lines = await companionLinesFor(patient.id);
  if (!lines.length) fail('admission day companion line was not posted');
  for (const line of lines) {
    if (round2(line.amount) !== COMPANION) {
      fail(`companion line on ${line.entry_date} must be ${COMPANION} (no insurance), got ${line.amount}`);
    }
  }
  console.log('OK admission-day companion line carries the companion price only');

  // Older versions stored companion + insurance on the admission day; the sync must undo it.
  await query(`UPDATE patient_daily_entry_lines SET amount = $1, unit_price = $1 WHERE id = $2`, [
    COMPANION + INSURANCE,
    lines[0].id,
  ]);
  const sync = await syncAdmissionDayRoomInsurance(TEST_FILE);
  lines = await companionLinesFor(patient.id);
  if (round2(lines[0]?.amount) !== COMPANION) {
    fail(`old companion+insurance line not cleaned: got ${lines[0]?.amount} (${JSON.stringify(sync)})`);
  }
  console.log('OK old companion + insurance amount is cleaned back to the companion price');

  // A hand-typed companion price that is not exactly companion + insurance is left alone.
  await query(`UPDATE patient_daily_entry_lines SET amount = 1500, unit_price = 1500 WHERE id = $1`, [
    lines[0].id,
  ]);
  await syncAdmissionDayRoomInsurance(TEST_FILE);
  lines = await companionLinesFor(patient.id);
  if (round2(lines[0]?.amount) !== 1500) fail(`hand-typed companion changed: got ${lines[0]?.amount}`);
  console.log('OK hand-typed companion price is not touched');

  await cleanup();
  console.log('ALL ROOM INSURANCE TESTS PASSED');
}

main()
  .then(() => process.exit(0))
  .catch(async (err) => {
    console.error('FAIL', err.message || err);
    try {
      await cleanup();
    } catch {
      /* ignore */
    }
    process.exit(1);
  });
