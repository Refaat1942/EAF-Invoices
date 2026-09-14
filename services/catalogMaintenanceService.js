const { query, withTransaction } = require('../database/db');
const { resolveCanonicalCategoryByName } = require('./priceListImportNormalizer');
const { listCategories, createCategory } = require('./serviceCatalogService');
const { removeGenericCategories, IMPORT_CATEGORY_DEFINITIONS } = require('./priceListExcelImportService');

const CANONICAL_CODES = new Set(Object.keys(IMPORT_CATEGORY_DEFINITIONS));

function isSlugCategoryCode(code) {
  const c = String(code || '').trim();
  return c.startsWith('CAT-') || c.startsWith('SRV-');
}

async function getCategoryIdByCode(priceListId, code, client = null) {
  const runner = client ? client.query.bind(client) : query;
  const { rows } = await runner(
    `SELECT id FROM service_categories WHERE price_list_id = $1 AND code = $2 LIMIT 1`,
    [priceListId, code]
  );
  return rows[0]?.id || null;
}

async function ensureCanonicalCategory(priceListId, canonicalCode, client = null) {
  const runner = client ? client.query.bind(client) : query;
  let id = await getCategoryIdByCode(priceListId, canonicalCode, client);
  if (id) return id;
  const def = IMPORT_CATEGORY_DEFINITIONS[canonicalCode] || { name: canonicalCode, sort_order: 99 };
  const { rows } = await runner(
    `INSERT INTO service_categories (price_list_id, name, code, sort_order, is_active, notes)
     VALUES ($1,$2,$3,$4,TRUE,$5) RETURNING id`,
    [priceListId, def.name, canonicalCode, def.sort_order || 99, 'أُنشئ أثناء تنظيم اللائحة']
  );
  return rows[0].id;
}

async function mergeDuplicateCategories(priceListId) {
  const categories = await listCategories(priceListId, false);
  let merged = 0;
  let removed = 0;

  await withTransaction(async (client) => {
    for (const cat of categories) {
      if (CANONICAL_CODES.has(cat.code)) continue;

      const target = resolveCanonicalCategoryByName(cat.name);
      if (!target?.code || target.code === cat.code) continue;

      const targetId = await ensureCanonicalCategory(priceListId, target.code, client);
      const { rowCount } = await client.query(
        `UPDATE services SET category_id = $1 WHERE price_list_id = $2 AND category_id = $3`,
        [targetId, priceListId, cat.id]
      );
      merged += rowCount || 0;

      const left = await client.query(`SELECT COUNT(*)::int AS n FROM services WHERE category_id = $1`, [cat.id]);
      if ((left.rows[0]?.n || 0) === 0) {
        await client.query(`DELETE FROM service_categories WHERE id = $1`, [cat.id]);
        removed += 1;
      }
    }
  });

  return { merged, removed };
}

async function renumberServiceCodes(priceListId, categoryId = null) {
  let sql = `
    SELECT s.id, s.category_id, s.code, s.sort_order, s.name
    FROM services s
    WHERE s.price_list_id = $1`;
  const params = [priceListId];
  if (categoryId) {
    sql += ' AND s.category_id = $2';
    params.push(categoryId);
  }
  sql += ' ORDER BY s.category_id NULLS LAST, s.sort_order, s.id';

  const { rows } = await query(sql, params);
  const byCategory = new Map();
  for (const row of rows) {
    const key = row.category_id || 0;
    if (!byCategory.has(key)) byCategory.set(key, []);
    byCategory.get(key).push(row);
  }

  let renumbered = 0;
  await withTransaction(async (client) => {
    for (const [, list] of byCategory) {
      for (const svc of list) {
        await client.query(`UPDATE services SET code = $1 WHERE id = $2`, [`__rn_${svc.id}`, svc.id]);
      }
    }
    for (const [, list] of byCategory) {
      let serial = 1;
      for (const svc of list) {
        const nextCode = String(serial);
        if (String(svc.code) !== nextCode) renumbered += 1;
        await client.query(`UPDATE services SET code = $1 WHERE id = $2`, [nextCode, svc.id]);
        serial += 1;
      }
    }
  });

  return { renumbered, total: rows.length };
}

async function normalizePriceListCatalog(priceListId) {
  const genericRemoved = await removeGenericCategories(priceListId);
  const { merged, removed } = await mergeDuplicateCategories(priceListId);
  const { renumbered, total } = await renumberServiceCodes(priceListId);
  return { genericRemoved, merged, removed, renumbered, total };
}

module.exports = {
  mergeDuplicateCategories,
  renumberServiceCodes,
  normalizePriceListCatalog,
  CANONICAL_CODES,
};
