const { query, withTransaction } = require('../database/db');

async function getPatientByFileNumber(fileNumber) {
  if (!fileNumber?.trim()) return null;
  const { rows } = await query(
    'SELECT * FROM patients WHERE file_number = $1',
    [fileNumber.trim()]
  );
  return rows[0] || null;
}

async function upsertPatient(fileNumber, name = '') {
  const fn = String(fileNumber || '').trim();
  if (!fn) return null;

  const { rows } = await query(
    `INSERT INTO patients (file_number, name, updated_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (file_number) DO UPDATE SET
       name = CASE WHEN EXCLUDED.name <> '' THEN EXCLUDED.name ELSE patients.name END,
       updated_at = NOW()
     RETURNING *`,
    [fn, name || '']
  );
  return rows[0];
}

async function setPatientBalance(fileNumber, balance, name = '') {
  const patient = await upsertPatient(fileNumber, name);
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
    `INSERT INTO patient_transactions (patient_id, invoice_id, amount, balance_after, note)
     VALUES ($1, $2, $3, $4, $5)`,
    [patient.id, invoice.id, -credit, newBalance, 'خصم من فاتورة معتمدة']
  );
  await client.query(
    'UPDATE invoices SET patient_credit_deducted = TRUE WHERE id = $1',
    [invoice.id]
  );
}

async function listPatients() {
  const { rows } = await query(
    'SELECT id, file_number, name, account_balance, updated_at FROM patients ORDER BY file_number'
  );
  return rows;
}

module.exports = {
  getPatientByFileNumber,
  upsertPatient,
  setPatientBalance,
  applyPatientCredit,
  listPatients,
};
