const { query } = require('../database/db');

async function listInvoiceTypes(activeOnly = true) {
  const sql = activeOnly
    ? 'SELECT * FROM invoice_types WHERE is_active = TRUE ORDER BY sort_order, name'
    : 'SELECT * FROM invoice_types ORDER BY sort_order, name';
  const { rows } = await query(sql);
  return rows;
}

async function getInvoiceTypesMap() {
  const types = await listInvoiceTypes(false);
  const map = {};
  types.forEach((t) => {
    map[t.code] = t.name;
  });
  return map;
}

async function createInvoiceType(data) {
  const name = String(data.name || '').trim();
  if (!name) throw new Error('اسم نوع الفاتورة مطلوب');

  let code = String(data.code || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_]/g, '');
  if (!code) code = `inv_${Date.now().toString(36)}`;

  const { rows: orderRows } = await query('SELECT COALESCE(MAX(sort_order), 0) + 1 AS next FROM invoice_types');
  const sortOrder = orderRows[0].next;

  const { rows } = await query(
    'INSERT INTO invoice_types (code, name, sort_order) VALUES ($1, $2, $3) RETURNING *',
    [code, name, sortOrder]
  );
  return rows[0];
}

async function updateInvoiceType(id, data) {
  const { rows } = await query(
    `UPDATE invoice_types SET
      name = COALESCE($2, name),
      is_active = COALESCE($3, is_active),
      sort_order = COALESCE($4, sort_order)
     WHERE id = $1 RETURNING *`,
    [id, data.name, data.is_active, data.sort_order]
  );
  if (!rows.length) throw new Error('نوع الفاتورة غير موجود');
  return rows[0];
}

async function deleteInvoiceType(id) {
  const { rowCount } = await query('DELETE FROM invoice_types WHERE id = $1', [id]);
  return rowCount > 0;
}

module.exports = {
  listInvoiceTypes,
  getInvoiceTypesMap,
  createInvoiceType,
  updateInvoiceType,
  deleteInvoiceType,
};
