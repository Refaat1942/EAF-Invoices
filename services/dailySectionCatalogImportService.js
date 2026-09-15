const { parseExcelBuffer } = require('./priceListExcelImportService');
const { importCatalogRowsTransactional } = require('./dailyEntryCatalogService');
const { normalizeCatalogCategory, TAB_CATALOG_IMPORT } = require('./dailyCatalogCategories');

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function excelServiceToCatalogRow(service, category, rowIndex) {
  const name = String(service.name || '').trim();
  if (!name) return null;
  const price = round2(service.price ?? service.total_price ?? service.amount);
  const unit = String(service.unit || 'وحدة').trim() || 'وحدة';
  return {
    name,
    category,
    major_unit: unit,
    minor_unit: unit,
    minor_quantity_per_major: 1,
    major_unit_selling_price: price,
    minor_unit_selling_price: price,
    price,
    row_number: rowIndex,
  };
}

/**
 * Import a per-tab Excel sheet into daily_entry_catalog_items (not services / price list).
 */
async function importSectionExcelToCatalog(buffer, options = {}) {
  const catalogCategory =
    normalizeCatalogCategory(options.catalog_category) ||
    normalizeCatalogCategory(options.default_category);
  if (!catalogCategory) {
    throw new Error('فئة الكتالوج غير محددة — ارفع الشيت من التبويب المناسب');
  }

  const parsed = await parseExcelBuffer(buffer, {
    template_key: options.template_key,
    filename: options.filename || '',
    category_name: options.category_name,
  });

  const rows = [];
  let rowIndex = 2;
  for (const svc of parsed.services || []) {
    const row = excelServiceToCatalogRow(svc, catalogCategory, rowIndex);
    if (row) rows.push(row);
    rowIndex += 1;
  }

  if (!rows.length) {
    throw new Error('لم يُعثر على بنود صالحة في الملف');
  }

  const result = await importCatalogRowsTransactional(rows, {
    defaultCategory: catalogCategory,
    allowCategories: options.allow_categories,
  });

  return {
    ...result,
    imported: (result.inserted || 0) + (result.updated || 0),
    catalog_category: catalogCategory,
    template_label: parsed.template_label || options.template_label || catalogCategory,
    parsed_rows: rows.length,
  };
}

function resolveTabCatalogImport(tabKey, filename = '') {
  const cfg = TAB_CATALOG_IMPORT[String(tabKey || '').trim()];
  if (!cfg) return null;
  if (!cfg.detect_from_filename) return cfg;

  const { detectTemplateFromFilename, EXCEL_TEMPLATES } = require('./priceListExcelImportService');
  const { catalogCategoryForServiceCode } = require('./dailyCatalogCategories');
  const detected = detectTemplateFromFilename(filename);
  if (!detected) return cfg;
  const template = EXCEL_TEMPLATES[detected];
  const category =
    catalogCategoryForServiceCode(template?.category_code) || cfg.category;
  return { ...cfg, template_key: detected, category };
}

module.exports = {
  importSectionExcelToCatalog,
  resolveTabCatalogImport,
  excelServiceToCatalogRow,
};
