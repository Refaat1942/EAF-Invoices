const { query } = require('../database/db');

async function listStayTypes(activeOnly = true) {
  const sql = activeOnly
    ? 'SELECT * FROM stay_types WHERE is_active = TRUE ORDER BY sort_order, name'
    : 'SELECT * FROM stay_types ORDER BY sort_order, name';
  const { rows } = await query(sql);
  return rows;
}

async function createStayType(name) {
  const trimmed = String(name || '').trim();
  if (!trimmed) throw new Error('اسم نوع الإقامة مطلوب');

  const { rows: orderRows } = await query('SELECT COALESCE(MAX(sort_order), 0) + 1 AS next FROM stay_types');
  const sortOrder = orderRows[0].next;

  const { rows } = await query(
    'INSERT INTO stay_types (name, sort_order) VALUES ($1, $2) RETURNING *',
    [trimmed, sortOrder]
  );
  return rows[0];
}

async function updateStayType(id, data) {
  const { rows } = await query(
    'UPDATE stay_types SET name = COALESCE($2, name), is_active = COALESCE($3, is_active), sort_order = COALESCE($4, sort_order) WHERE id = $1 RETURNING *',
    [id, data.name, data.is_active, data.sort_order]
  );
  if (!rows.length) throw new Error('نوع الإقامة غير موجود');
  return rows[0];
}

async function deleteStayType(id) {
  const { rowCount } = await query('DELETE FROM stay_types WHERE id = $1', [id]);
  return rowCount > 0;
}

module.exports = { listStayTypes, createStayType, updateStayType, deleteStayType };
