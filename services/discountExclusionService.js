const { query } = require('../database/db');

async function listDiscountExclusions(activeOnly = true) {
  const sql = activeOnly
    ? 'SELECT * FROM discount_exclusion_items WHERE is_active = TRUE ORDER BY sort_order, name'
    : 'SELECT * FROM discount_exclusion_items ORDER BY sort_order, name';
  const { rows } = await query(sql);
  return rows;
}

function normalizeArabic(text) {
  return String(text || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function matchesExclusion(description, exclusion) {
  const desc = normalizeArabic(description);
  const pattern = normalizeArabic(exclusion.name);
  if (!desc || !pattern) return false;

  if (exclusion.match_type === 'exact') return desc === pattern;
  if (exclusion.match_type === 'starts_with') return desc.startsWith(pattern);
  return desc.includes(pattern);
}

function resolveItemDiscountEligibility(description, exclusions = []) {
  for (const rule of exclusions) {
    if (matchesExclusion(description, rule)) {
      return { is_discount_eligible: false, discount_exclusion_id: rule.id, exclusion_name: rule.name };
    }
  }
  return { is_discount_eligible: true, discount_exclusion_id: null, exclusion_name: null };
}

async function createDiscountExclusion(data) {
  const name = String(data.name || '').trim();
  if (!name) throw new Error('اسم البند المستثنى مطلوب');

  const matchType = data.match_type || 'contains';
  const { rows: orderRows } = await query(
    'SELECT COALESCE(MAX(sort_order), 0) + 1 AS next FROM discount_exclusion_items'
  );

  const { rows } = await query(
    `INSERT INTO discount_exclusion_items (name, match_type, sort_order)
     VALUES ($1, $2, $3) RETURNING *`,
    [name, matchType, orderRows[0].next]
  );
  return rows[0];
}

async function updateDiscountExclusion(id, data) {
  const { rows } = await query(
    `UPDATE discount_exclusion_items SET
      name = COALESCE($2, name),
      match_type = COALESCE($3, match_type),
      is_active = COALESCE($4, is_active),
      sort_order = COALESCE($5, sort_order)
     WHERE id = $1 RETURNING *`,
    [id, data.name, data.match_type, data.is_active, data.sort_order]
  );
  if (!rows.length) throw new Error('البند غير موجود');
  return rows[0];
}

async function deleteDiscountExclusion(id) {
  const { rowCount } = await query('DELETE FROM discount_exclusion_items WHERE id = $1', [id]);
  return rowCount > 0;
}

module.exports = {
  listDiscountExclusions,
  resolveItemDiscountEligibility,
  createDiscountExclusion,
  updateDiscountExclusion,
  deleteDiscountExclusion,
};
