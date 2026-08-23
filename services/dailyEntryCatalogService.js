const ExcelJS = require('exceljs');
const { query, withTransaction } = require('../database/db');
const {
  readTabularFile,
  detectColumnMapping,
  applyColumnMapping,
  buildImportFieldList,
  validateMapping,
  CATALOG_IMPORT_SCHEMA,
  parseCsvRaw,
  parseExcelRaw,
} = require('./importService');

const CATALOG_CATEGORIES = ['Medicine', 'Supplies', 'Cosmetics'];

const CATEGORY_ALIASES = {
  medicine: 'Medicine',
  medicines: 'Medicine',
  drug: 'Medicine',
  drugs: 'Medicine',
  'أدوية': 'Medicine',
  'دواء': 'Medicine',
  supplies: 'Supplies',
  supply: 'Supplies',
  'مستلزمات': 'Supplies',
  cosmetics: 'Cosmetics',
  cosmetic: 'Cosmetics',
  'مستحضرات': 'Cosmetics',
  'مستحضرات تجميل': 'Cosmetics',
  'تجميل': 'Cosmetics',
};

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function computeSellingPrice(costPrice, markupPercent) {
  const cost = round2(costPrice);
  const markup = round2(markupPercent);
  return round2(cost + (cost * markup) / 100);
}

function computeMarginAmount(costPrice, sellingPrice, quantity = 1) {
  return round2((round2(sellingPrice) - round2(costPrice)) * (round2(quantity) || 1));
}

function normalizeCategory(value) {
  const text = String(value || '').trim();
  if (!text) return null;
  const key = text.toLowerCase();
  if (CATEGORY_ALIASES[key]) return CATEGORY_ALIASES[key];
  if (CATEGORY_ALIASES[text]) return CATEGORY_ALIASES[text];
  const exact = CATALOG_CATEGORIES.find((c) => c.toLowerCase() === key);
  return exact || null;
}

function mapCatalogRow(row) {
  const code = String(row.code || row.Code || row['الكود'] || row['كود'] || '').trim();
  const name = String(row.name || row.Name || row['الاسم'] || row['اسم'] || '').trim();
  const category = normalizeCategory(
    row.category || row.Category || row['الفئة'] || row['فئة'] || row['القسم'] || row['قسم']
  );
  const unit = String(row.unit || row.Unit || row['الوحدة'] || row['وحدة'] || 'مرة').trim() || 'مرة';
  const costRaw =
    row.cost_price ??
    row.costPrice ??
    row['Cost Price'] ??
    row['سعر التكلفة'] ??
    row['تكلفة'] ??
    null;
  const markupRaw =
    row.markup_percent ??
    row.markupPercent ??
    row['Markup %'] ??
    row['Markup'] ??
    row['نسبة الربح'] ??
    row['الربح %'] ??
    null;
  const price = round2(row.price ?? row.Price ?? row['السعر'] ?? row['سعر'] ?? row['Selling Price'] ?? 0);
  const cost_price = costRaw != null && costRaw !== '' ? round2(costRaw) : null;
  const markup_percent = markupRaw != null && markupRaw !== '' ? round2(markupRaw) : null;
  return { code, name, category, unit, price, cost_price, markup_percent };
}

async function listCatalogItems(filters = {}) {
  let sql = `SELECT * FROM daily_entry_catalog_items WHERE 1=1`;
  const params = [];
  let i = 1;

  if (filters.category) {
    sql += ` AND category = $${i++}`;
    params.push(filters.category);
  }
  if (filters.active_only !== false) {
    sql += ` AND is_active = TRUE`;
  }
  if (filters.search) {
    sql += ` AND (name ILIKE $${i} OR code ILIKE $${i})`;
    params.push(`%${filters.search}%`);
    i++;
  }

  sql += ` ORDER BY category, sort_order, name, id`;
  if (filters.limit) {
    sql += ` LIMIT $${i++}`;
    params.push(Number(filters.limit));
  }

  const { rows } = await query(sql, params);
  return rows;
}

async function getCatalogItemById(id) {
  const { rows } = await query(`SELECT * FROM daily_entry_catalog_items WHERE id = $1`, [Number(id)]);
  return rows[0] || null;
}

async function getCatalogStats() {
  const { rows } = await query(
    `SELECT category, COUNT(*)::int AS count
     FROM daily_entry_catalog_items
     WHERE is_active = TRUE
     GROUP BY category
     ORDER BY category`
  );
  const total = rows.reduce((sum, row) => sum + row.count, 0);
  return { total, by_category: rows };
}

function catalogItemToPicker(item) {
  const sellingPrice = round2(item.price);
  const base = {
    id: item.id,
    code: item.code,
    name: item.name,
    unit: item.unit || 'مرة',
    price: sellingPrice,
    list_price: sellingPrice,
    selling_price: sellingPrice,
    category_name: item.category,
    is_catalog: true,
  };
  if (item.category === 'Supplies') {
    return {
      ...base,
      cost_price: round2(item.cost_price),
      markup_percent: round2(item.markup_percent),
    };
  }
  return base;
}

async function getCatalogItemByCode(code, excludeId = null, client = null) {
  const normalized = String(code || '').trim();
  if (!normalized) return null;
  const run = client ? client.query.bind(client) : query;
  let sql = `SELECT * FROM daily_entry_catalog_items WHERE code = $1`;
  const params = [normalized];
  if (excludeId) {
    sql += ` AND id <> $2`;
    params.push(Number(excludeId));
  }
  const { rows } = await run(sql, params);
  return rows[0] || null;
}

function isSameCatalogItem(existing, payload) {
  return (
    String(existing.name || '').trim() === String(payload.name || '').trim() &&
    existing.category === payload.category &&
    String(existing.unit || '').trim() === String(payload.unit || '').trim() &&
    round2(existing.price) === round2(payload.price) &&
    round2(existing.cost_price || 0) === round2(payload.cost_price || 0) &&
    round2(existing.markup_percent || 0) === round2(payload.markup_percent || 0)
  );
}

function normalizeImportRow(raw = {}) {
  const row = {
    code: String(raw.code || '').trim(),
    name: String(raw.name || '').trim(),
    category: normalizeCategory(raw.category),
    unit: String(raw.unit || '').trim() || 'مرة',
    price: round2(raw.price),
    cost_price: raw.cost_price != null && raw.cost_price !== '' ? round2(raw.cost_price) : null,
    markup_percent:
      raw.markup_percent != null && raw.markup_percent !== '' ? round2(raw.markup_percent) : null,
    row_number: raw.row_number,
  };

  if (row.category === 'Supplies') {
    if (!row.cost_price && row.price > 0) {
      row.cost_price = row.price;
      row.markup_percent = row.markup_percent || 0;
    }
  }

  return row;
}

function toPreviewRow(raw) {
  const row = normalizeImportRow(raw);
  return {
    row_number: raw.row_number,
    code: row.code,
    name: row.name,
    category: row.category || raw.category || '',
    unit: row.unit,
    price: row.price,
    cost_price: row.cost_price,
    markup_percent: row.markup_percent,
  };
}

async function analyzeCatalogImportFile(buffer, originalName, mappingOverride = null) {
  const table = await readTabularFile(buffer, originalName);
  if (!table.headers.length) throw new Error('لم يُعثر على أعمدة في الملف');

  const detection = detectColumnMapping(table.headers, CATALOG_IMPORT_SCHEMA);
  const mapping = mappingOverride || detection.mapping;
  if (mappingOverride) {
    validateMapping(mapping, CATALOG_IMPORT_SCHEMA);
  }

  const mappedRows = applyColumnMapping(table.rows, table.headers, mapping, CATALOG_IMPORT_SCHEMA);
  const preview_rows = mappedRows.slice(0, 25).map((row) => toPreviewRow(row));

  return {
    headers: table.headers,
    fields: buildImportFieldList(CATALOG_IMPORT_SCHEMA),
    suggested_mapping: detection.mapping,
    mapping,
    confidence: detection.confidence,
    needs_manual_mapping: mappingOverride ? false : detection.needs_manual_mapping,
    missing_required: detection.missing_required,
    unmapped_headers: detection.unmapped_headers,
    preview_rows,
    total_rows: mappedRows.length,
  };
}

async function importCatalogRowsTransactional(rows = []) {
  const result = {
    inserted: 0,
    updated: 0,
    skipped: 0,
    errors: [],
  };

  await withTransaction(async (client) => {
    for (const raw of rows) {
      const rowNumber = raw.row_number;
      try {
        if (!String(raw.code || '').trim() && !String(raw.name || '').trim()) {
          result.skipped += 1;
          continue;
        }

        const normalized = normalizeImportRow(raw);
        const payload = validateCatalogPayload(normalized);
        const existing = await getCatalogItemByCode(payload.code, null, client);

        if (!existing) {
          await client.query(
            `INSERT INTO daily_entry_catalog_items (code, name, category, unit, cost_price, markup_percent, price, is_active, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, TRUE, NOW())`,
            [
              payload.code,
              payload.name,
              payload.category,
              payload.unit,
              payload.cost_price,
              payload.markup_percent,
              payload.price,
            ]
          );
          result.inserted += 1;
          continue;
        }

        if (isSameCatalogItem(existing, payload)) {
          result.skipped += 1;
          continue;
        }

        await client.query(
          `UPDATE daily_entry_catalog_items
           SET name = $1, category = $2, unit = $3, cost_price = $4, markup_percent = $5, price = $6, is_active = TRUE, updated_at = NOW()
           WHERE id = $7`,
          [
            payload.name,
            payload.category,
            payload.unit,
            payload.cost_price,
            payload.markup_percent,
            payload.price,
            existing.id,
          ]
        );
        result.updated += 1;
      } catch (err) {
        result.errors.push({
          row: rowNumber,
          code: String(raw.code || '').trim(),
          message: err.message || 'خطأ غير معروف',
        });
      }
    }
  });

  result.stats = await getCatalogStats();
  return result;
}

async function confirmCatalogImportFile(buffer, originalName, mapping = {}) {
  validateMapping(mapping, CATALOG_IMPORT_SCHEMA);
  const table = await readTabularFile(buffer, originalName);
  const mappedRows = applyColumnMapping(table.rows, table.headers, mapping, CATALOG_IMPORT_SCHEMA);
  if (!mappedRows.length) throw new Error('لم يُعثر على صفوف للاستيراد');
  return importCatalogRowsTransactional(mappedRows);
}

function validateCatalogPayload(data) {
  const code = String(data.code || '').trim();
  const name = String(data.name || '').trim();
  const category = normalizeCategory(data.category);
  const unit = String(data.unit || '').trim() || 'مرة';

  if (!code) throw new Error('الكود مطلوب');
  if (!name) throw new Error('الاسم مطلوب');
  if (!category) throw new Error('الفئة غير صالحة (Medicine / Supplies / Cosmetics)');

  if (category === 'Supplies') {
    const costPrice = round2(data.cost_price);
    const markupPercent = round2(data.markup_percent);
    if (costPrice <= 0) throw new Error('سعر التكلفة مطلوب للمستلزمات');
    const sellingPrice = computeSellingPrice(costPrice, markupPercent);
    if (sellingPrice <= 0) throw new Error('سعر البيع المحسوب غير صالح');
    return {
      code,
      name,
      category,
      unit,
      cost_price: costPrice,
      markup_percent: markupPercent,
      price: sellingPrice,
    };
  }

  const price = round2(data.price);
  if (price <= 0) throw new Error('السعر يجب أن يكون أكبر من صفر');
  return {
    code,
    name,
    category,
    unit,
    cost_price: null,
    markup_percent: null,
    price,
  };
}

async function createCatalogItem(data) {
  const row = validateCatalogPayload(data);
  const existing = await getCatalogItemByCode(row.code);
  if (existing) throw new Error(`الكود «${row.code}» مستخدم بالفعل`);

  const { rows } = await query(
    `INSERT INTO daily_entry_catalog_items (code, name, category, unit, cost_price, markup_percent, price, is_active, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, TRUE, NOW())
     RETURNING *`,
    [row.code, row.name, row.category, row.unit, row.cost_price, row.markup_percent, row.price]
  );
  return rows[0];
}

async function updateCatalogItem(id, data) {
  const item = await getCatalogItemById(id);
  if (!item) throw new Error('الصنف غير موجود');

  const row = validateCatalogPayload(data);
  const duplicate = await getCatalogItemByCode(row.code, id);
  if (duplicate) throw new Error(`الكود «${row.code}» مستخدم بالفعل`);

  const { rows } = await query(
    `UPDATE daily_entry_catalog_items
     SET code = $1, name = $2, category = $3, unit = $4, cost_price = $5, markup_percent = $6, price = $7, updated_at = NOW()
     WHERE id = $8
     RETURNING *`,
    [row.code, row.name, row.category, row.unit, row.cost_price, row.markup_percent, row.price, Number(id)]
  );
  return rows[0];
}

async function setCatalogItemActive(id, isActive) {
  const item = await getCatalogItemById(id);
  if (!item) throw new Error('الصنف غير موجود');

  const { rows } = await query(
    `UPDATE daily_entry_catalog_items
     SET is_active = $1, updated_at = NOW()
     WHERE id = $2
     RETURNING *`,
    [Boolean(isActive), Number(id)]
  );
  return rows[0];
}

async function upsertCatalogItem(raw) {
  const row = validateCatalogPayload(raw);

  const { rows } = await query(
    `INSERT INTO daily_entry_catalog_items (code, name, category, unit, cost_price, markup_percent, price, is_active, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, TRUE, NOW())
     ON CONFLICT (code) DO UPDATE SET
       name = EXCLUDED.name,
       category = EXCLUDED.category,
       unit = EXCLUDED.unit,
       cost_price = EXCLUDED.cost_price,
       markup_percent = EXCLUDED.markup_percent,
       price = EXCLUDED.price,
       is_active = TRUE,
       updated_at = NOW()
     RETURNING *`,
    [row.code, row.name, row.category, row.unit, row.cost_price, row.markup_percent, row.price]
  );
  return rows[0];
}

async function importCatalogRows(rows = []) {
  const result = await importCatalogRowsTransactional(
    rows.map((row, index) => ({ ...row, row_number: row.row_number || index + 2 }))
  );
  return {
    imported: result.inserted + result.updated,
    inserted: result.inserted,
    updated: result.updated,
    skipped: result.skipped,
    errors: result.errors.map((e) => e.message || String(e)),
    stats: result.stats,
  };
}

async function parseCsvCatalog(text) {
  const table = parseCsvRaw(text);
  const detection = detectColumnMapping(table.headers, CATALOG_IMPORT_SCHEMA);
  const mapped = applyColumnMapping(table.rows, table.headers, detection.mapping, CATALOG_IMPORT_SCHEMA);
  return mapped.map((row) => normalizeImportRow(row));
}

async function parseExcelCatalog(buffer) {
  const table = await parseExcelRaw(buffer);
  const detection = detectColumnMapping(table.headers, CATALOG_IMPORT_SCHEMA);
  const mapped = applyColumnMapping(table.rows, table.headers, detection.mapping, CATALOG_IMPORT_SCHEMA);
  return mapped
    .map((row) => normalizeImportRow(row))
    .filter((row) => row.code || row.name);
}

async function exportCatalogCsv() {
  const items = await listCatalogItems({ active_only: false });
  const header = ['Code', 'Name', 'Category', 'Unit', 'Cost Price', 'Markup %', 'Price'];
  const lines = [header.join(',')];
  for (const item of items) {
    lines.push(
      [
        item.code,
        `"${String(item.name).replace(/"/g, '""')}"`,
        item.category,
        item.unit || '',
        item.category === 'Supplies' ? Number(item.cost_price) || 0 : '',
        item.category === 'Supplies' ? Number(item.markup_percent) || 0 : '',
        Number(item.price) || 0,
      ].join(',')
    );
  }
  return lines.join('\n');
}

module.exports = {
  CATALOG_CATEGORIES,
  listCatalogItems,
  getCatalogItemById,
  getCatalogItemByCode,
  getCatalogStats,
  catalogItemToPicker,
  createCatalogItem,
  updateCatalogItem,
  setCatalogItemActive,
  validateCatalogPayload,
  importCatalogRows,
  importCatalogRowsTransactional,
  analyzeCatalogImportFile,
  confirmCatalogImportFile,
  parseCsvCatalog,
  parseExcelCatalog,
  exportCatalogCsv,
  normalizeCategory,
  computeSellingPrice,
  computeMarginAmount,
  CATALOG_IMPORT_SCHEMA,
};
