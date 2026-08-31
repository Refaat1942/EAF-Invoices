const { query, withTransaction } = require('../database/db');

function normalizePatientType(type) {
  const t = String(type || '').trim().toLowerCase();
  return t === 'external' || t === 'خارجي' ? 'external' : 'internal';
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
    };
}

async function getPatientByFileNumber(fileNumber) {
  if (!fileNumber?.trim()) return null;
  const { rows } = await query(
    'SELECT * FROM patients WHERE file_number = $1',
    [fileNumber.trim()]
  );
  return rows[0] || null;
}

async function upsertPatient(fileNumber, dataOrName = '') {
  const data = normalizeUpsertData(fileNumber, dataOrName);
  if (!data.file_number) return null;

  const { rows } = await query(
    `INSERT INTO patients (file_number, name, phone, nationality, gender, patient_type, floor, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
     ON CONFLICT (file_number) DO UPDATE SET
       name = CASE WHEN EXCLUDED.name <> '' THEN EXCLUDED.name ELSE patients.name END,
       phone = CASE WHEN EXCLUDED.phone <> '' THEN EXCLUDED.phone ELSE patients.phone END,
       nationality = CASE WHEN EXCLUDED.nationality <> '' THEN EXCLUDED.nationality ELSE patients.nationality END,
       gender = CASE WHEN EXCLUDED.gender <> '' THEN EXCLUDED.gender ELSE patients.gender END,
       patient_type = EXCLUDED.patient_type,
       floor = CASE WHEN EXCLUDED.floor <> '' THEN EXCLUDED.floor ELSE patients.floor END,
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

  const { rows } = await client.query(
    'SELECT * FROM patients WHERE file_number = $1 FOR UPDATE',
    [fileNumber]
  );
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
  await client.query(
    'UPDATE invoices SET patient_credit_deducted = TRUE WHERE id = $1',
    [invoice.id]
  );
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
    `SELECT id, file_number, name, phone, nationality, gender, patient_type, account_balance, updated_at
     FROM patients ORDER BY file_number`
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
  normalizePatientType,
};
