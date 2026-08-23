const { query } = require('../database/db');

async function listFinancialTreatments(activeOnly = true) {
  const sql = activeOnly
    ? 'SELECT * FROM financial_treatments WHERE is_active = TRUE ORDER BY sort_order, name'
    : 'SELECT * FROM financial_treatments ORDER BY sort_order, name';
  const { rows } = await query(sql);
  return rows;
}

async function createFinancialTreatment(name) {
  const trimmed = String(name || '').trim();
  if (!trimmed) throw new Error('اسم المعاملة المالية مطلوب');

  const { rows: orderRows } = await query(
    'SELECT COALESCE(MAX(sort_order), 0) + 1 AS next FROM financial_treatments'
  );
  const sortOrder = orderRows[0].next;

  const { rows } = await query(
    'INSERT INTO financial_treatments (name, sort_order) VALUES ($1, $2) RETURNING *',
    [trimmed, sortOrder]
  );
  return rows[0];
}

async function updateFinancialTreatment(id, data) {
  const { rows } = await query(
    `UPDATE financial_treatments SET
      name = COALESCE($2, name),
      is_active = COALESCE($3, is_active),
      sort_order = COALESCE($4, sort_order)
     WHERE id = $1 RETURNING *`,
    [id, data.name, data.is_active, data.sort_order]
  );
  if (!rows.length) throw new Error('المعاملة المالية غير موجودة');
  return rows[0];
}

async function deleteFinancialTreatment(id) {
  const { rowCount } = await query('DELETE FROM financial_treatments WHERE id = $1', [id]);
  return rowCount > 0;
}

module.exports = {
  listFinancialTreatments,
  createFinancialTreatment,
  updateFinancialTreatment,
  deleteFinancialTreatment,
};
