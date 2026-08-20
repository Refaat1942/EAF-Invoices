const { query } = require('../database/db');

async function ensurePatientCreditMethod() {
  await query(
    `INSERT INTO payment_methods (code, name, accepts_amount, sort_order, is_active)
     VALUES ('patient_credit', 'خصم من رصيد المريض', TRUE, 4, TRUE)
     ON CONFLICT (code) DO UPDATE SET
       name = EXCLUDED.name,
       accepts_amount = TRUE,
       is_active = TRUE,
       sort_order = EXCLUDED.sort_order`
  );
}

async function getPaymentMethodIdByCode(code, client = null) {
  const run = client ? client.query.bind(client) : query;
  const { rows } = await run('SELECT id FROM payment_methods WHERE code = $1 LIMIT 1', [code]);
  return rows[0]?.id || null;
}

async function listPaymentMethods(activeOnly = true) {
  await ensurePatientCreditMethod();
  const sql = activeOnly
    ? 'SELECT * FROM payment_methods WHERE is_active = TRUE ORDER BY sort_order, name'
    : 'SELECT * FROM payment_methods ORDER BY sort_order, name';
  const { rows } = await query(sql);
  return rows;
}

async function createPaymentMethod(data) {
  const name = String(data.name || '').trim();
  if (!name) throw new Error('اسم طريقة الدفع مطلوب');

  let code = String(data.code || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_]/g, '');
  if (!code) code = `pay_${Date.now().toString(36)}`;

  const acceptsAmount = data.accepts_amount !== false;

  const { rows: orderRows } = await query('SELECT COALESCE(MAX(sort_order), 0) + 1 AS next FROM payment_methods');
  const sortOrder = orderRows[0].next;

  const { rows } = await query(
    'INSERT INTO payment_methods (code, name, accepts_amount, sort_order) VALUES ($1, $2, $3, $4) RETURNING *',
    [code, name, acceptsAmount, sortOrder]
  );
  return rows[0];
}

async function updatePaymentMethod(id, data) {
  const { rows } = await query(
    `UPDATE payment_methods SET
      name = COALESCE($2, name),
      is_active = COALESCE($3, is_active),
      accepts_amount = COALESCE($4, accepts_amount),
      sort_order = COALESCE($5, sort_order)
     WHERE id = $1 RETURNING *`,
    [id, data.name, data.is_active, data.accepts_amount, data.sort_order]
  );
  if (!rows.length) throw new Error('طريقة الدفع غير موجودة');
  return rows[0];
}

async function deletePaymentMethod(id) {
  const { rowCount } = await query('DELETE FROM payment_methods WHERE id = $1', [id]);
  return rowCount > 0;
}

module.exports = {
  listPaymentMethods,
  ensurePatientCreditMethod,
  getPaymentMethodIdByCode,
  createPaymentMethod,
  updatePaymentMethod,
  deletePaymentMethod,
};
