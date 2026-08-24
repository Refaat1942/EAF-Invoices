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

function ok(cond, msg) {
  if (!cond) throw new Error(msg);
  console.log(`OK ${msg}`);
}

function okEq(a, e, msg) {
  if (a !== e) throw new Error(`${msg}: expected ${e}, got ${a}`);
  console.log(`OK ${msg}`);
}

const TEST_MEDICAL_EXAMS_CATEGORY = 'MEDICAL_EXAMS';
const TEST_CONSULTANT_SERVICE_CODE = 'EXAM-CONSULTANT';

async function capturePriceListState(query) {
  const { getSetting } = require('../services/settingsService');
  const activePriceListIdSetting = await getSetting('active_price_list_id', '');
  const { rows } = await query(`SELECT id FROM price_lists WHERE is_default = TRUE ORDER BY id LIMIT 1`);
  return {
    activePriceListIdSetting: activePriceListIdSetting || '',
    defaultFlagListId: rows[0]?.id || null,
  };
}

async function restorePriceListState(query, state) {
  const { setSetting } = require('../services/settingsService');
  await query('UPDATE price_lists SET is_default = FALSE');
  if (state.activePriceListIdSetting) {
    await setSetting('active_price_list_id', state.activePriceListIdSetting);
  } else {
    await setSetting('active_price_list_id', '');
  }
  if (state.defaultFlagListId) {
    await query('UPDATE price_lists SET is_default = TRUE, updated_at = NOW() WHERE id = $1', [
      state.defaultFlagListId,
    ]);
  }
}

async function cleanupDoctorTestPriceList(query, priceListId) {
  if (!priceListId) return;
  const svcRes = await query(`SELECT id FROM services WHERE price_list_id = $1`, [priceListId]);
  for (const row of svcRes.rows) {
    await query(`DELETE FROM service_price_components WHERE service_id = $1`, [row.id]);
    await query(`DELETE FROM service_price_tiers WHERE service_id = $1`, [row.id]);
    await query(`DELETE FROM service_price_history WHERE service_id = $1`, [row.id]);
  }
  await query(`DELETE FROM services WHERE price_list_id = $1`, [priceListId]);
  await query(`DELETE FROM service_categories WHERE price_list_id = $1`, [priceListId]);
  await query(`DELETE FROM price_lists WHERE id = $1`, [priceListId]);
}

async function provisionDoctorConsultantPriceList(query) {
  const { createCategory, createService } = require('../services/serviceCatalogService');
  const { setDefaultPriceList } = require('../services/priceListService');

  const priceListCode = `DOCTOR-TEST-PL-${Date.now()}`;
  const { rows } = await query(
    `INSERT INTO price_lists (name, code, is_active, is_default, notes)
     VALUES ($1, $2, TRUE, FALSE, $3)
     RETURNING *`,
    [
      'Doctor Test Price List',
      priceListCode,
      'Isolated doctor DB integration test — not production catalog',
    ]
  );
  const priceListId = rows[0].id;

  const category = await createCategory(priceListId, {
    code: TEST_MEDICAL_EXAMS_CATEGORY,
    name: 'Doctor Test Medical Exams',
    sort_order: 9999,
    notes: 'Doctor test fixture only',
  });

  const service = await createService({
    price_list_id: priceListId,
    category_id: category.id,
    code: TEST_CONSULTANT_SERVICE_CODE,
    name: 'كشف استشاري TEST',
    unit: 'كشف',
    price: 500,
    price_type: 'fixed',
    discountable: true,
    administrative_fee_applicable: true,
    notes: 'Doctor test fixture only',
  });

  await setDefaultPriceList(priceListId);

  return {
    priceListId,
    priceListCode,
    categoryId: category.id,
    serviceId: service.id,
  };
}

async function cleanupDoctorTestPatient(query, fileNumber) {
  if (!fileNumber) return;
  await query(
    `DELETE FROM invoice_items WHERE invoice_id IN (
      SELECT id FROM invoices WHERE TRIM(file_number) = TRIM($1)
    )`,
    [fileNumber]
  );
  await query(`DELETE FROM invoices WHERE TRIM(file_number) = TRIM($1)`, [fileNumber]);
  await query(
    `DELETE FROM patient_daily_entry_lines WHERE entry_id IN (
      SELECT id FROM patient_daily_entries WHERE patient_id IN (
        SELECT id FROM patients WHERE TRIM(file_number) = TRIM($1)
      )
    )`,
    [fileNumber]
  );
  await query(
    `DELETE FROM patient_daily_entry_history WHERE entry_id IN (
      SELECT id FROM patient_daily_entries WHERE patient_id IN (
        SELECT id FROM patients WHERE TRIM(file_number) = TRIM($1)
      )
    )`,
    [fileNumber]
  );
  await query(
    `DELETE FROM patient_daily_entries WHERE patient_id IN (
      SELECT id FROM patients WHERE TRIM(file_number) = TRIM($1)
    )`,
    [fileNumber]
  );
  await query(`DELETE FROM patients WHERE TRIM(file_number) = TRIM($1)`, [fileNumber]);
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

  let priceListState = null;
  let priceListFixture = null;
  let patientFileNumber = null;
  const testDept = 'أطباء-TEST';

  try {
    priceListState = await capturePriceListState(query);
    priceListFixture = await provisionDoctorConsultantPriceList(query);
    ok(priceListFixture.serviceId, 'consultant price-list fixture provisioned');

    const testSpec = 'مسالك-TEST';
    const testName = `د. اختبار ${Date.now()}`;

    const created = await createDoctor({
      department: testDept,
      specialty: testSpec,
      name: testName,
    });
    ok(created.id, 'doctor creation');

    let dupThrew = false;
    try {
      await createDoctor({ department: testDept, specialty: testSpec, name: testName });
    } catch {
      dupThrew = true;
    }
    ok(dupThrew, 'duplicate doctor prevention');

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
    ok(import1.inserted === 1, 'import skips existing');
    ok(import1.skipped >= 1, 'import skips duplicate in batch');

    const reimport = await importDoctorRowsTransactional(rows);
    okEq(reimport.inserted, 0, 're-import same rows inserts zero');
    ok(reimport.skipped >= 2, 're-import skips all');

    const { saveEntry } = require('../services/dailyChargeService');
    const { getInvoiceById } = require('../services/invoiceService');
    const { buildInvoiceHtml } = require('../services/pdfService');

    const { rows: patients } = await query(
      `INSERT INTO patients (file_number, name) VALUES ($1, $2) RETURNING *`,
      [`DOC-TEST-${Date.now()}`, 'مريض اختبار أطباء']
    );
    const patient = patients[0];
    patientFileNumber = patient.file_number;

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
    ok(inactiveThrew, 'inactive doctor cannot be selected for new entry');

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

    okEq(saved.doctor_id, created.id, 'daily entry saves doctor_id');
    ok(saved.doctor_name_snapshot === testName, 'daily entry saves name snapshot');

    const { updateDoctor } = require('../services/doctorService');
    const renamed = `د. معدّل ${Date.now()}`;
    await updateDoctor(created.id, { name: renamed });
    const reloaded = await query(`SELECT doctor_name_snapshot FROM patient_daily_entries WHERE id = $1`, [
      saved.id,
    ]);
    okEq(reloaded.rows[0].doctor_name_snapshot, testName, 'editing doctor does not alter historical snapshot');

    if (saved.invoice_id) {
      const invoice = await getInvoiceById(saved.invoice_id);
      const html = await buildInvoiceHtml(invoice, { baseUrl: 'http://localhost' });
      ok(!html.includes(testName), 'doctor name not in invoice PDF html');
      ok(!html.includes(renamed), 'renamed doctor not in invoice PDF html');
      console.log('OK doctor not in invoice PDF html');
    }

    const report = await getDoctorReportSummary({
      from_date: new Date().toISOString().slice(0, 10),
      to_date: new Date().toISOString().slice(0, 10),
      doctor_id: created.id,
    });
    ok(report.rows.length >= 1, 'doctor report has rows');

    console.log('ALL DOCTOR TESTS PASSED');
  } finally {
    try {
      await cleanupDoctorTestPatient(query, patientFileNumber);
      await query('DELETE FROM doctors WHERE department = $1', [testDept]);
      if (priceListState) {
        await restorePriceListState(query, priceListState);
      }
      await cleanupDoctorTestPriceList(query, priceListFixture?.priceListId);
    } catch (cleanupErr) {
      console.error('FAIL cleanup:', cleanupErr.message || cleanupErr);
      process.exit(1);
    }
  }
})().catch((err) => {
  console.error('FAIL', err.message || err);
  process.exit(1);
});
