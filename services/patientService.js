const { query, withTransaction } = require('../database/db');
const { buildSearchPattern, sqlNormalizeArabic } = require('./searchNormalize');

function normalizePatientType(type) {
  const t = String(type || '').trim().toLowerCase();
  return t === 'external' || t === 'خارجي' ? 'external' : 'internal';
}

function parseOptionalInt(value) {
  if (value === undefined || value === null || value === '') return null;
  const n = parseInt(String(value).trim(), 10);
  return Number.isFinite(n) ? n : null;
}

function parseOptionalDate(value) {
  if (!value) return null;
  const s = String(value).trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

function parseAmount(value) {
  const n = Number(String(value ?? '').replace(/,/g, '').trim());
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

function normalizeUpsertData(fileNumber, dataOrName = '') {
  if (typeof dataOrName === 'string') {
    return {
      file_number: String(fileNumber || '').trim(),
      name: dataOrName || '',
      phone: '',
      other_phone: '',
      nationality: '',
      gender: '',
      // null = "not specified" (preserved on conflict below) rather than forcing 'internal',
      // since this string-shorthand form is used for name-only touch-up upserts of existing
      // patients (e.g. setPatientBalance, saveInvoice) that must not flip an external
      // patient's type back to internal just because they weren't asked to set it.
      patient_type: null,
      floor: '',
      age: null,
      disability_degree: '',
      disability_type: '',
      stay_grade_id: null,
      room_insurance_amount: 0,
      military_auth_from: null,
      military_auth_to: null,
      military_auth_amount: 0,
      glasses_lens_type: '',
      glasses_start_date: null,
      glasses_price: 0,
      glasses_discount_percent: 0,
    };
  }
  const data = dataOrName || {};
  return {
    file_number: String(fileNumber || data.file_number || '').trim(),
    name: String(data.name || '').trim(),
    phone: String(data.phone || '').trim(),
    other_phone: String(data.other_phone || '').trim(),
    nationality: String(data.nationality || '').trim(),
    gender: String(data.gender || '').trim(),
    // Same "not specified" convention as the string-shorthand branch above — only
    // normalize (and thus write) patient_type when the caller actually passed one.
    patient_type:
      data.patient_type !== undefined && data.patient_type !== null && String(data.patient_type).trim() !== ''
        ? normalizePatientType(data.patient_type)
        : data.patientType !== undefined && data.patientType !== null && String(data.patientType).trim() !== ''
          ? normalizePatientType(data.patientType)
          : null,
    floor: String(data.floor || '').trim(),
    age: parseOptionalInt(data.age),
    disability_degree: String(data.disability_degree || '').trim(),
    disability_type: String(data.disability_type || '').trim(),
    stay_grade_id: parseOptionalInt(data.stay_grade_id),
    room_insurance_amount: parseAmount(data.room_insurance_amount),
    military_auth_from: parseOptionalDate(data.military_auth_from),
    military_auth_to: parseOptionalDate(data.military_auth_to),
    military_auth_amount: parseAmount(data.military_auth_amount),
    glasses_lens_type: String(data.glasses_lens_type || '').trim(),
    glasses_start_date: parseOptionalDate(data.glasses_start_date),
    glasses_price: parseAmount(data.glasses_price),
    glasses_discount_percent: parseAmount(data.glasses_discount_percent),
  };
}

async function getPatientByFileNumber(fileNumber) {
  if (!fileNumber?.trim()) return null;
  const { rows } = await query('SELECT * FROM patients WHERE file_number = $1', [fileNumber.trim()]);
  return rows[0] || null;
}

async function upsertPatient(fileNumber, dataOrName = '') {
  const data = normalizeUpsertData(fileNumber, dataOrName);
  if (!data.file_number) return null;

  const { rows } = await query(
    `INSERT INTO patients (
       file_number, name, phone, other_phone, nationality, gender, patient_type, floor,
       age, disability_degree, disability_type, stay_grade_id, room_insurance_amount,
       military_auth_from, military_auth_to, military_auth_amount,
       glasses_lens_type, glasses_start_date, glasses_price, glasses_discount_percent,
       updated_at
     ) VALUES ($1,$2,$3,$4,$5,$6,COALESCE($7,'internal'),$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,NOW())
     ON CONFLICT (file_number) DO UPDATE SET
       name = CASE WHEN EXCLUDED.name <> '' THEN EXCLUDED.name ELSE patients.name END,
       phone = CASE WHEN EXCLUDED.phone <> '' THEN EXCLUDED.phone ELSE patients.phone END,
       other_phone = CASE WHEN EXCLUDED.other_phone <> '' THEN EXCLUDED.other_phone ELSE patients.other_phone END,
       nationality = CASE WHEN EXCLUDED.nationality <> '' THEN EXCLUDED.nationality ELSE patients.nationality END,
       gender = CASE WHEN EXCLUDED.gender <> '' THEN EXCLUDED.gender ELSE patients.gender END,
       -- $7 (not EXCLUDED.patient_type, which already has the 'internal' fallback baked in
       -- via COALESCE above) so an unspecified patient_type on an update preserves the
       -- existing row's type instead of silently flipping an external patient to internal.
       patient_type = COALESCE($7, patients.patient_type),
       floor = CASE WHEN EXCLUDED.floor <> '' THEN EXCLUDED.floor ELSE patients.floor END,
       age = COALESCE(EXCLUDED.age, patients.age),
       disability_degree = CASE WHEN EXCLUDED.disability_degree <> '' THEN EXCLUDED.disability_degree ELSE patients.disability_degree END,
       disability_type = CASE WHEN EXCLUDED.disability_type <> '' THEN EXCLUDED.disability_type ELSE patients.disability_type END,
       stay_grade_id = COALESCE(EXCLUDED.stay_grade_id, patients.stay_grade_id),
       room_insurance_amount = CASE WHEN EXCLUDED.room_insurance_amount > 0 THEN EXCLUDED.room_insurance_amount ELSE patients.room_insurance_amount END,
       military_auth_from = COALESCE(EXCLUDED.military_auth_from, patients.military_auth_from),
       military_auth_to = COALESCE(EXCLUDED.military_auth_to, patients.military_auth_to),
       military_auth_amount = CASE WHEN EXCLUDED.military_auth_amount > 0 THEN EXCLUDED.military_auth_amount ELSE patients.military_auth_amount END,
       glasses_lens_type = CASE WHEN EXCLUDED.glasses_lens_type <> '' THEN EXCLUDED.glasses_lens_type ELSE patients.glasses_lens_type END,
       glasses_start_date = COALESCE(EXCLUDED.glasses_start_date, patients.glasses_start_date),
       glasses_price = CASE WHEN EXCLUDED.glasses_price > 0 THEN EXCLUDED.glasses_price ELSE patients.glasses_price END,
       glasses_discount_percent = CASE WHEN EXCLUDED.glasses_discount_percent > 0 THEN EXCLUDED.glasses_discount_percent ELSE patients.glasses_discount_percent END,
       updated_at = NOW()
     RETURNING *`,
    [
      data.file_number,
      data.name || '',
      data.phone || '',
      data.other_phone || '',
      data.nationality || '',
      data.gender || '',
      data.patient_type,
      data.floor || '',
      data.age,
      data.disability_degree || '',
      data.disability_type || '',
      data.stay_grade_id,
      data.room_insurance_amount,
      data.military_auth_from,
      data.military_auth_to,
      data.military_auth_amount,
      data.glasses_lens_type || '',
      data.glasses_start_date,
      data.glasses_price,
      data.glasses_discount_percent,
    ]
  );
  return rows[0];
}

async function setPatientBalance(fileNumber, balance, name = '', actor = null) {
  const patient = await upsertPatient(fileNumber, typeof name === 'string' ? name : name || {});
  if (!patient) throw new Error('رقم الملف مطلوب');

  const newBalance = Math.round((Number(balance) || 0) * 100) / 100;
  const previousBalance = Math.round((Number(patient.account_balance) || 0) * 100) / 100;
  const delta = Math.round((newBalance - previousBalance) * 100) / 100;

  return withTransaction(async (client) => {
    const { rows } = await client.query(
      `UPDATE patients SET account_balance = $2, account_balance_raw = $2, updated_at = NOW()
       WHERE id = $1 RETURNING *`,
      [patient.id, newBalance]
    );
    if (delta !== 0) {
      const actorName = actor?.full_name || actor?.username || 'مستخدم';
      await client.query(
        `INSERT INTO patient_transactions (patient_id, amount, balance_after, note, transaction_kind)
         VALUES ($1, $2, $3, $4, 'manual_adjustment')`,
        [
          patient.id,
          delta,
          newBalance,
          `تعديل يدوي للرصيد بواسطة ${actorName}: ${previousBalance} ← ${newBalance}`,
        ]
      );
    }
    return rows[0];
  }).then(async (updated) => {
    try {
      const { writeAuditLog } = require('./auditLogService');
      const { createAlert } = require('./alertService');
      await writeAuditLog({
        user: actor,
        action: 'patient.balance_adjust',
        entity_type: 'patient',
        entity_id: String(fileNumber),
        entity_label: `${updated.name || fileNumber} (${fileNumber})`,
        details: { previous_balance: previousBalance, new_balance: newBalance, delta },
      });
      if (newBalance < 0) {
        await createAlert({
          alert_type: 'patient_negative_balance',
          severity: 'warning',
          title: 'رصيد مريض سالب',
          message: `المريض ${updated.name || fileNumber} (${fileNumber}): رصيد ${newBalance}`,
          entity_type: 'patient',
          entity_id: String(fileNumber),
          details: { account_balance: newBalance },
        });
      }
    } catch (auditErr) {
      console.error('[audit] patient balance:', auditErr.message);
    }
    return updated;
  });
}

async function applyPatientCredit(client, invoice) {
  const credit = Number(invoice.patient_credit_applied) || 0;
  if (credit <= 0 || invoice.patient_credit_deducted) return;

  const fileNumber = String(invoice.file_number || '').trim();
  if (!fileNumber) throw new Error('رقم الملف مطلوب لخصم رصيد المريض');

  const { rows } = await client.query('SELECT * FROM patients WHERE file_number = $1 FOR UPDATE', [fileNumber]);
  let patient = rows[0];
  if (!patient) {
    const inserted = await client.query(
      `INSERT INTO patients (file_number, name) VALUES ($1, $2) RETURNING *`,
      [fileNumber, invoice.patient_name || '']
    );
    patient = inserted.rows[0];
  }

  const currentBalance = Number(patient.account_balance) || 0;

  const newBalance = Math.round((currentBalance - credit) * 100) / 100;
  await client.query(
    'UPDATE patients SET account_balance = $2, account_balance_raw = $2, updated_at = NOW() WHERE id = $1',
    [patient.id, newBalance]
  );
  await client.query(
    `INSERT INTO patient_transactions (patient_id, invoice_id, amount, balance_after, note, transaction_kind)
     VALUES ($1, $2, $3, $4, $5, 'prepaid_deduct')`,
    [patient.id, invoice.id, -credit, newBalance, 'خصم من فاتورة معتمدة']
  );
  await client.query('UPDATE invoices SET patient_credit_deducted = TRUE WHERE id = $1', [invoice.id]);
}

async function recordInvoiceCollections(client, invoice, totals) {
  const invoiceId = Number(invoice.id);
  if (!invoiceId) return;

  await client.query(
    `DELETE FROM patient_transactions WHERE invoice_id = $1 AND transaction_kind = 'collection'`,
    [invoiceId]
  );

  const fileNumber = String(invoice.file_number || '').trim();
  if (!fileNumber) return;

  const methods = totals?.method_payments || [];
  const hasCollection = methods.some(
    (m) => m.code && m.code !== 'patient_credit' && Number(m.amount) > 0
  );
  if (!hasCollection) return;

  const { rows } = await client.query('SELECT * FROM patients WHERE file_number = $1 FOR UPDATE', [fileNumber]);
  let patient = rows[0];
  if (!patient) {
    const inserted = await client.query(
      `INSERT INTO patients (file_number, name) VALUES ($1, $2) RETURNING *`,
      [fileNumber, invoice.patient_name || '']
    );
    patient = inserted.rows[0];
  }

  const prepaidBalance = Math.round((Number(patient.account_balance) || 0) * 100) / 100;

  for (const entry of methods) {
    const code = String(entry.code || '').trim();
    if (!code || code === 'patient_credit') continue;
    const amount = Math.round((Number(entry.amount) || 0) * 100) / 100;
    if (amount <= 0) continue;
    const label = entry.name || code;
    await client.query(
      `INSERT INTO patient_transactions (patient_id, invoice_id, amount, balance_after, note, transaction_kind)
       VALUES ($1, $2, $3, $4, $5, 'collection')`,
      [patient.id, invoiceId, amount, prepaidBalance, `تحصيل (${label}) — فاتورة #${invoiceId}`]
    );
  }
}

async function listPatients() {
  const { rows } = await query(
    `SELECT id, file_number, name, phone, nationality, gender, patient_type, age,
            disability_degree, disability_type, account_balance, updated_at
     FROM patients ORDER BY file_number`
  );
  return rows;
}

async function searchPatientsForDaily(search = '', limit = 50) {
  const lim = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 100);
  const term = buildSearchPattern(search);
  const openInvoiceSql = `
    EXISTS (
      SELECT 1 FROM invoices i
      WHERE TRIM(i.file_number) = TRIM(p.file_number)
        AND i.status IN ('draft', 'pending_review')
      LIMIT 1
    ) AS has_open_invoice`;
  if (!term) {
    const { rows } = await query(
      `SELECT p.file_number, p.name, p.patient_type, p.phone, p.account_balance, p.updated_at,
              ${openInvoiceSql}
       FROM patients p
       ORDER BY p.updated_at DESC NULLS LAST, p.file_number
       LIMIT $1`,
      [lim]
    );
    return rows;
  }
  const digitsOnly = /^[0-9]+$/.test(term);
  if (digitsOnly) {
    if (term.length < 10) {
      const { rows } = await query(
        `SELECT p.file_number, p.name, p.patient_type, p.phone, p.account_balance, p.updated_at,
                ${openInvoiceSql}
         FROM patients p
         WHERE TRIM(p.file_number) = TRIM($1)
         ORDER BY p.updated_at DESC NULLS LAST, p.file_number
         LIMIT $2`,
        [term, lim]
      );
      return rows;
    }
    const phonePattern = `%${term}%`;
    const { rows } = await query(
      `SELECT p.file_number, p.name, p.patient_type, p.phone, p.account_balance, p.updated_at,
              ${openInvoiceSql}
       FROM patients p
       WHERE TRIM(p.file_number) = TRIM($1)
         OR COALESCE(p.phone, '') ILIKE $2
         OR COALESCE(p.other_phone, '') ILIKE $2
       ORDER BY p.updated_at DESC NULLS LAST, p.file_number
       LIMIT $3`,
      [term, phonePattern, lim]
    );
    return rows;
  }

  const pattern = `%${term}%`;
  const normName = sqlNormalizeArabic('p.name');
  const { rows } = await query(
    `SELECT p.file_number, p.name, p.patient_type, p.phone, p.account_balance, p.updated_at,
            ${openInvoiceSql}
     FROM patients p
     WHERE p.name ILIKE $1
       OR ${normName} LIKE $2
     ORDER BY p.updated_at DESC NULLS LAST, p.file_number
     LIMIT $3`,
    [pattern, `%${term.toLowerCase()}%`, lim]
  );
  return rows;
}

async function checkFileNumberAvailability(fileNumber) {
  const fn = String(fileNumber || '').trim();
  if (!fn) return { available: false, reason: 'empty' };
  const { rows } = await query(
    `SELECT id, file_number, name, patient_type FROM patients WHERE TRIM(file_number) = TRIM($1) LIMIT 1`,
    [fn]
  );
  if (!rows.length) return { available: true, file_number: fn };
  return {
    available: false,
    duplicate: true,
    file_number: fn,
    existing: rows[0],
  };
}

async function peekNextPatientFileNumber(patientType = 'internal') {
  const scope = normalizePatientType(patientType);
  const { syncPatientFileCountersFromPatients } = require('./serialService');
  await syncPatientFileCountersFromPatients();

  const { rows } = await query(
    'SELECT last_number FROM patient_file_counter WHERE patient_type = $1',
    [scope]
  );
  let candidate = (rows[0]?.last_number || 0) + 1;

  for (let attempt = 0; attempt < 500; attempt += 1) {
    const check = await checkFileNumberAvailability(String(candidate));
    if (check.available) {
      return { file_number: String(candidate), next_number: candidate, patient_type: scope };
    }
    candidate += 1;
  }

  throw new Error('تعذّر توليد رقم ملف متاح — راجع أرقام الملفات المسجّلة');
}

async function allocateNextPatientFileNumber(patientType = 'internal', client = null) {
  const scope = normalizePatientType(patientType);
  const run = client ? client.query.bind(client) : query;
  await run(
    `INSERT INTO patient_file_counter (patient_type, last_number) VALUES ($1, 0)
     ON CONFLICT (patient_type) DO NOTHING`,
    [scope]
  );
  if (client) {
    const locked = await run(
      `SELECT last_number FROM patient_file_counter WHERE patient_type = $1 FOR UPDATE`,
      [scope]
    );
    const nextNumber = (locked.rows[0]?.last_number || 0) + 1;
    await run(`UPDATE patient_file_counter SET last_number = $1 WHERE patient_type = $2`, [nextNumber, scope]);
    return String(nextNumber);
  }
  const { rows } = await run(
    `UPDATE patient_file_counter SET last_number = last_number + 1
     WHERE patient_type = $1 RETURNING last_number`,
    [scope]
  );
  const nextNumber = rows[0]?.last_number || 1;
  return String(nextNumber);
}

/** Existing patient → keep file number; new patient → next atomic counter (safe for concurrent users). */
async function resolvePatientFileNumberForStay(patientType, requestedFileNumber, client = null) {
  const trimmed = String(requestedFileNumber || '').trim();
  const run = client ? client.query.bind(client) : query;
  if (trimmed) {
    const { rows } = await run(
      `SELECT id FROM patients WHERE TRIM(file_number) = TRIM($1) LIMIT 1`,
      [trimmed]
    );
    if (rows.length) return trimmed;
  }
  return allocateNextPatientFileNumber(patientType, client);
}

async function resolvePatientFileNumber(patientType, requestedFileNumber, client = null) {
  return resolvePatientFileNumberForStay(patientType, requestedFileNumber, client);
}

async function convertExternalPatientToInternal(fileNumber) {
  const fn = String(fileNumber || '').trim();
  if (!fn) throw new Error('رقم الملف مطلوب');
  const patient = await getPatientByFileNumber(fn);
  if (!patient) throw new Error('المريض غير موجود');
  if (normalizePatientType(patient.patient_type) !== 'external') {
    throw new Error('المريض مسجّل بالفعل كمريض داخلي');
  }
  const data = normalizeUpsertData(fn, patient);
  data.patient_type = 'internal';
  await upsertPatient(fn, data);
  return getPatientByFileNumber(fn);
}

function getPatientAccountBalanceAmount(patient = {}) {
  return Math.round((Number(patient?.account_balance) || 0) * 100) / 100;
}

function getPatientRoomInsuranceAmount(patient = {}) {
  return Math.round((Number(patient?.room_insurance_amount) || 0) * 100) / 100;
}

function getPatientPrepaidBalance(patient = {}) {
  return Math.round((getPatientAccountBalanceAmount(patient) + getPatientRoomInsuranceAmount(patient)) * 100) / 100;
}

function resolveRefundableAmount(totals = {}) {
  const explicit = Number(totals.refundable_amount ?? totals.refundable_amount_raw);
  if (explicit > 0) return Math.round(explicit * 100) / 100;
  const collected = Number(totals.total_collected_raw ?? totals.total_collected) || 0;
  const finalTotal = Number(totals.final_total_raw ?? totals.final_total) || 0;
  if (collected > finalTotal) return Math.round((collected - finalTotal) * 100) / 100;
  return 0;
}

function resolvePatientInvoiceBalanceDisplay(invoice, totals = {}) {
  const fileNumber = String(invoice?.file_number || '').trim();
  if (!fileNumber) return null;

  const patient = invoice?.patient_context?.patient || {};
  const account = getPatientAccountBalanceAmount(patient);
  const roomInsurance = getPatientRoomInsuranceAmount(patient);
  const prepaid = getPatientPrepaidBalance(patient);
  const outstanding =
    Math.round((Number(totals.outstanding_amount ?? totals.remaining) || 0) * 100) / 100;
  const refundable = resolveRefundableAmount(totals);
  const credit = Math.round((Number(totals.patient_credit_applied) || 0) * 100) / 100;
  const creditAlreadyDeducted =
    Boolean(invoice?.patient_credit_deducted) || invoice?.status === 'approved';
  const balance = creditAlreadyDeducted
    ? Math.round((prepaid - outstanding + refundable) * 100) / 100
    : Math.round((prepaid - credit - outstanding + refundable) * 100) / 100;

  return {
    balance,
    balance_raw: balance,
    account_balance: account,
    room_insurance_amount: roomInsurance,
    prepaid_balance: prepaid,
    refundable_amount: refundable,
  };
}

async function bumpPatientFileCounter(patientType, fileNumber, client = null) {
  const n = parseInt(String(fileNumber || '').trim(), 10);
  if (!Number.isFinite(n) || n <= 0) return;
  const scope = normalizePatientType(patientType);
  const run = client ? client.query.bind(client) : query;
  await run(
    `INSERT INTO patient_file_counter (patient_type, last_number) VALUES ($1, $2)
     ON CONFLICT (patient_type) DO UPDATE
       SET last_number = GREATEST(patient_file_counter.last_number, EXCLUDED.last_number)`,
    [scope, n]
  );
}

module.exports = {
  getPatientByFileNumber,
  upsertPatient,
  setPatientBalance,
  applyPatientCredit,
  recordInvoiceCollections,
  listPatients,
  searchPatientsForDaily,
  normalizePatientType,
  normalizeUpsertData,
  peekNextPatientFileNumber,
  allocateNextPatientFileNumber,
  resolvePatientFileNumber,
  resolvePatientFileNumberForStay,
  bumpPatientFileCounter,
  convertExternalPatientToInternal,
  checkFileNumberAvailability,
  resolvePatientInvoiceBalanceDisplay,
  getPatientAccountBalanceAmount,
  getPatientRoomInsuranceAmount,
  getPatientPrepaidBalance,
  resolveRefundableAmount,
};
