const { query } = require('../database/db');

async function listContractedEntities(activeOnly = true) {
  const sql = activeOnly
    ? 'SELECT * FROM contracted_entities WHERE is_active = TRUE ORDER BY sort_order, name'
    : 'SELECT * FROM contracted_entities ORDER BY sort_order, name';
  const { rows } = await query(sql);
  return rows;
}

function buildTree(flatList) {
  const byId = new Map(flatList.map((r) => [r.id, { ...r, children: [] }]));
  const roots = [];
  for (const node of byId.values()) {
    if (node.parent_id && byId.has(node.parent_id)) {
      byId.get(node.parent_id).children.push(node);
    } else {
      roots.push(node);
    }
  }
  return roots;
}

function flattenTree(nodes, depth = 0, result = []) {
  for (const node of nodes) {
    result.push({ ...node, depth, children: undefined });
    if (node.children?.length) flattenTree(node.children, depth + 1, result);
  }
  return result;
}

async function listContractedEntitiesTree(activeOnly = true) {
  const flat = await listContractedEntities(activeOnly);
  return flattenTree(buildTree(flat));
}

async function getContractedEntityById(id) {
  const { rows } = await query('SELECT * FROM contracted_entities WHERE id = $1', [id]);
  return rows[0] || null;
}

async function getEffectiveDiscountPercent(id) {
  let current = await getContractedEntityById(id);
  while (current) {
    const rate = Number(current.discount_percent) || 0;
    if (rate > 0) return rate;
    if (!current.parent_id) break;
    current = await getContractedEntityById(current.parent_id);
  }
  return 0;
}

async function createContractedEntity(data) {
  const name = String(data.name || '').trim();
  if (!name) throw new Error('اسم الجهة مطلوب');

  const parentId = data.parent_id ? Number(data.parent_id) : null;
  const discountPercent = Number(data.discount_percent) || 0;

  const { rows: orderRows } = await query(
    'SELECT COALESCE(MAX(sort_order), 0) + 1 AS next FROM contracted_entities'
  );

  const { rows } = await query(
    `INSERT INTO contracted_entities (name, parent_id, discount_percent, sort_order)
     VALUES ($1, $2, $3, $4) RETURNING *`,
    [name, parentId, discountPercent, orderRows[0].next]
  );
  return rows[0];
}

async function updateContractedEntity(id, data) {
  const { rows } = await query(
    `UPDATE contracted_entities SET
      name = COALESCE($2, name),
      parent_id = COALESCE($3, parent_id),
      discount_percent = COALESCE($4, discount_percent),
      is_active = COALESCE($5, is_active),
      sort_order = COALESCE($6, sort_order)
     WHERE id = $1 RETURNING *`,
    [
      id,
      data.name,
      data.parent_id !== undefined ? data.parent_id || null : undefined,
      data.discount_percent,
      data.is_active,
      data.sort_order,
    ]
  );
  if (!rows.length) throw new Error('الجهة غير موجودة');
  return rows[0];
}

async function deleteContractedEntity(id) {
  const children = await query(
    'SELECT COUNT(*)::int AS c FROM contracted_entities WHERE parent_id = $1',
    [id]
  );
  if (children.rows[0].c > 0) {
    throw new Error('لا يمكن حذف جهة لها جهات فرعية');
  }
  const { rowCount } = await query('DELETE FROM contracted_entities WHERE id = $1', [id]);
  return rowCount > 0;
}

module.exports = {
  listContractedEntities,
  listContractedEntitiesTree,
  getContractedEntityById,
  getEffectiveDiscountPercent,
  createContractedEntity,
  updateContractedEntity,
  deleteContractedEntity,
};
