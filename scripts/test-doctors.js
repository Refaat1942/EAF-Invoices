#!/usr/bin/env node
/**
 * Doctors module tests.
 * Run: node scripts/test-doctors.js
 * With DB: node --env-file=.env scripts/test-doctors.js
 */
const path = require('path');
const fs = require('fs');

const envPath = path.join(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (m && !process.env[m[1].trim()]) process.env[m[1].trim()] = m[2].trim();
  }
}

function assert(cond, msg) {
  if (!cond) {
    console.error(`FAIL ${msg}`);
    process.exit(1);
  }
  console.log(`OK ${msg}`);
}

function assertEq(a, e, msg) {
  if (a !== e) {
    console.error(`FAIL ${msg}: expected ${e}, got ${a}`);
    process.exit(1);
  }
  console.log(`OK ${msg}`);
}

const {
  normalizeDoctorText,
  doctorIdentityKey,
  listDoctors,
  createDoctor,
  findDoctorByIdentity,
  analyzeDoctorImportFile,
  importDoctorRowsTransactional,
  getDoctorReportSummary,
} = require('../services/doctorService');

const { detectColumnMapping } = require('../services/importService');

assertEq(normalizeDoctorText('  مسالك  '), 'مسالك', 'normalize doctor text');
assertEq(
  doctorIdentityKey('أطباء', 'مسالك', 'حاتم سلطان عطية سيد محمد'),
  doctorIdentityKey('أطباء', 'مسالك', 'حاتم سلطان عطية سيد محمد'),
  'doctor identity stable'
);

const mapping = detectColumnMapping(['م', 'القسم', 'التخصص', 'الاسم'], {
  serial: { aliases: ['م'], required: false },
  department: { aliases: ['القسم'], required: true },
  specialty: { aliases: ['التخصص'], required: true },
  name: { aliases: ['الاسم'], required: true },
});
assert(mapping.mapping.department === 'القسم', 'excel maps القسم');
assert(mapping.mapping.specialty === 'التخصص', 'excel maps التخصص');
assert(mapping.mapping.name === 'الاسم', 'excel maps الاسم');
console.log('OK excel column mapping independent of order');

const { entriesToInvoiceItems } = require('../services/dailyChargeService');
const doctorName = 'حاتم سلطان عطية سيد محمد';
const entry = {
  id: 99,
  entry_date: '2026-08-24',
  doctor_id: 1,
  doctor_name_snapshot: doctorName,
  doctor_specialty: 'مسالك',
  doctor_department_snapshot: 'أطباء',
  lines: [
    {
      id: 1,
      section_code: 'consultant_exam',
      description: 'كشف استشاري',
      amount: 100,
      quantity: 1,
      unit_price: 100,
      service_name: 'كشف استشاري',
      extra_text: '',
    },
  ],
};
const sections = [{ code: 'consultant_exam', input_type: 'amount', name: 'كشف', sort_order: 1 }];
const invoiceItems = entriesToInvoiceItems([entry], sections);
assert(invoiceItems.length === 1, 'invoice item created from daily entry');
assert(!invoiceItems[0].description.includes(doctorName), 'doctor name not in invoice description');
assert(!invoiceItems[0].description.includes('مسالك'), 'specialty not in invoice description');
console.log('OK invoice isolation from doctor metadata');

(async () => {
  if (!process.env.DATABASE_URL) {
    console.log('SKIP DB doctor tests (no DATABASE_URL)');
    console.log('ALL DOCTOR TESTS PASSED');
    return;
  }

  const { initDatabase, query } = require('../database/db');
  await initDatabase();

  const testDept = 'أطباء-TEST';
  const testSpec = 'مسالك-TEST';
  const testName = `د. اختبار ${Date.now()}`;

  const created = await createDoctor({
    department: testDept,
    specialty: testSpec,
    name: testName,
  });
  assert(created.id, 'doctor creation');

  let dupThrew = false;
  try {
    await createDoctor({ department: testDept, specialty: testSpec, name: testName });
  } catch {
    dupThrew = true;
  }
  assert(dupThrew, 'duplicate doctor prevention');

  const rows = [
    {
      row_number: 2,
      department: testDept,
      specialty: testSpec,
      name: testName,
    },
    {
      row_number: 3,
      department: testDept,
      specialty: testSpec,
      name: `${testName} ثاني`,
    },
  ];
  const import1 = await importDoctorRowsTransactional(rows);
  assert(import1.inserted === 1, 'import skips existing');
  assert(import1.skipped >= 1, 'import skips duplicate in batch');

  const reimport = await importDoctorRowsTransactional(rows);
  assertEq(reimport.inserted, 0, 're-import same rows inserts zero');
  assert(reimport.skipped >= 2, 're-import skips all');

  const { saveEntry } = require('../services/dailyChargeService');
  const { getInvoiceById } = require('../services/invoiceService');
  const { buildInvoiceHtml } = require('../services/pdfService');

  const { rows: patients } = await query(
    `INSERT INTO patients (file_number, name) VALUES ($1, $2) RETURNING *`,
    [`DOC-TEST-${Date.now()}`, 'مريض اختبار أطباء']
  );
  const patient = patients[0];

  const inactive = await createDoctor({
    department: testDept,
    specialty: 'inactive-spec',
    name: `inactive ${Date.now()}`,
  });
  await query(`UPDATE doctors SET is_active = FALSE WHERE id = $1`, [inactive.id]);

  let inactiveThrew = false;
  try {
    await saveEntry({
      file_number: patient.file_number,
      patient_name: patient.name,
      entry_date: new Date().toISOString().slice(0, 10),
      doctor_id: inactive.id,
      doctor_specialty: 'inactive-spec',
      lines: [
        {
          section_code: 'consultant_exam',
          service_id: null,
          amount: 0,
        },
      ],
    });
  } catch (err) {
    inactiveThrew = String(err.message).includes('غير نشط');
  }
  assert(inactiveThrew, 'inactive doctor cannot be selected for new entry');

  const saved = await saveEntry({
    file_number: patient.file_number,
    patient_name: patient.name,
    entry_date: new Date().toISOString().slice(0, 10),
    doctor_id: created.id,
    doctor_specialty: testSpec,
    lines: await (async () => {
      const { listSections, getSectionsWithServices } = require('../services/dailyChargeService');
      const sectionsList = await listSections();
      const consultant = sectionsList.find((s) => s.code === 'consultant_exam');
      const withServices = await getSectionsWithServices();
      const full = withServices.find((s) => s.code === 'consultant_exam');
      const service = full?.services?.[0];
      if (!service) throw new Error('no consultant service in price list for test');
      return [
        {
          section_code: 'consultant_exam',
          service_id: service.id,
          amount: 0,
          quantity: 1,
        },
      ];
    })(),
  });

  assertEq(saved.doctor_id, created.id, 'daily entry saves doctor_id');
  assert(saved.doctor_name_snapshot === testName, 'daily entry saves name snapshot');

  const { updateDoctor } = require('../services/doctorService');
  const renamed = `د. معدّل ${Date.now()}`;
  await updateDoctor(created.id, { name: renamed });
  const reloaded = await query(`SELECT doctor_name_snapshot FROM patient_daily_entries WHERE id = $1`, [
    saved.id,
  ]);
  assertEq(reloaded.rows[0].doctor_name_snapshot, testName, 'editing doctor does not alter historical snapshot');

  if (saved.invoice_id) {
    const invoice = await getInvoiceById(saved.invoice_id);
    const html = await buildInvoiceHtml(invoice, { baseUrl: 'http://localhost' });
    assert(!html.includes(testName), 'doctor name not in invoice PDF html');
    assert(!html.includes(renamed), 'renamed doctor not in invoice PDF html');
    console.log('OK doctor not in invoice PDF html');
  }

  const report = await getDoctorReportSummary({
    from_date: new Date().toISOString().slice(0, 10),
    to_date: new Date().toISOString().slice(0, 10),
    doctor_id: created.id,
  });
  assert(report.rows.length >= 1, 'doctor report has rows');

  await query('DELETE FROM patient_daily_entries WHERE patient_id = $1', [patient.id]);
  await query('DELETE FROM patients WHERE id = $1', [patient.id]);
  await query('DELETE FROM doctors WHERE department = $1', [testDept]);

  console.log('ALL DOCTOR TESTS PASSED');
})().catch((err) => {
  console.error('FAIL', err.message || err);
  process.exit(1);
});
