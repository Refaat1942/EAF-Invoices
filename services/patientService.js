const { query, withTransaction } = require('../database/db');

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
      nationality: '',
      gender: '',
      patient_type: 'internal',
      floor: '',
      age: null,
      disability_degree: '',
      disability_type: '',
      room_insurance_amount: 0,
      military_auth_from: null,
      military_auth_to: null,
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
    nationality: String(data.nationality || '').trim(),
    gender: String(data.gender || '').trim(),
    patient_type: normalizePatientType(data.patient_type || data.patientType),
    floor: String(data.floor || '').trim(),
    age: parseOptionalInt(data.age),
    disability_degree: String(data.disability_degree || '').trim(),
    disability_type: String(data.disability_type || '').trim(),
    room_insurance_amount: parseAmount(data.room_insurance_amount),
    military_auth_from: parseOptionalDate(data.military_auth_from),
    military_auth_to: parseOptionalDate(data.military_auth_to),
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
       file_number, name, phone, nationality, gender, patient_type, floor,
       age, disability_degree, disability_type, room_insurance_amount,
       military_auth_from, military_auth_to,
       glasses_lens_type, glasses_start_date, glasses_price, glasses_discount_percent,
       updated_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,NOW())
     ON CONFLICT (file_number) DO UPDATE SET
       name = CASE WHEN EXCLUDED.name <> '' THEN EXCLUDED.name ELSE patients.name END,
       phone = CASE WHEN EXCLUDED.phone <> '' THEN EXCLUDED.phone ELSE patients.phone END,
       nationality = CASE WHEN EXCLUDED.nationality <> '' THEN EXCLUDED.nationality ELSE patients.nationality END,
       gender = CASE WHEN EXCLUDED.gender <> '' THEN EXCLUDED.gender ELSE patients.gender END,
       patient_type = EXCLUDED.patient_type,
       floor = CASE WHEN EXCLUDED.floor <> '' THEN EXCLUDED.floor ELSE patients.floor END,
       age = COALESCE(EXCLUDED.age, patients.age),
       disability_degree = CASE WHEN EXCLUDED.disability_degree <> '' THEN EXCLUDED.disability_degree ELSE patients.disability_degree END,
       disability_type = CASE WHEN EXCLUDED.disability_type <> '' THEN EXCLUDED.disability_type ELSE patients.disability_type END,
       room_insurance_amount = CASE WHEN EXCLUDED.room_insurance_amount > 0 THEN EXCLUDED.room_insurance_amount ELSE patients.room_insurance_amount END,
       military_auth_from = COALESCE(EXCLUDED.military_auth_from, patients.military_auth_from),
       military_auth_to = COALESCE(EXCLUDED.military_auth_to, patients.military_auth_to),
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
      data.nationality || '',
      data.gender || '',
      data.patient_type,
      data.floor || '',
      data.age,
      data.disability_degree || '',
      data.disability_type || '',
      data.room_insurance_amount,
      data.military_auth_from,
      data.military_auth_to,
      data.glasses_lens_type || '',
      data.glasses_start_date,
      data.glasses_price,
      data.glasses_discount_percent,
    ]
  );
  return rows[0];
}

async function setPatientBalance(fileNumber, balance, name = '') {
  const patient = await upsertPatient(fileNumber, typeof name === 'string' ? name : name || {});
  if (!patient) throw new Error('رقم الملف مطلوب');

  const amount = Math.round((Number(balance) || 0) * 100) / 100;
  const { rows } = await query(
    `UPDATE patients SET account_balance = $2, account_balance_raw = $2, updated_at = NOW()
     WHERE id = $1 RETURNING *`,
    [patient.id, amount]
  );
  return rows[0];
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
  const term = String(search || '').trim();
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
  const pattern = `%${term.replace(/%/g, '')}%`;
  const { rows } = await query(
    `SELECT p.file_number, p.name, p.patient_type, p.phone, p.account_balance, p.updated_at,
            ${openInvoiceSql}
     FROM patients p
     WHERE p.file_number ILIKE $1 OR p.name ILIKE $1
     ORDER BY p.updated_at DESC NULLS LAST, p.file_number
     LIMIT $2`,
    [pattern, lim]
  );
  return rows;
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
};
