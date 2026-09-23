const { parseExcelBuffer, importParsedExcel } = require('./priceListExcelImportService');
const { importCatalogRowsTransactional } = require('./dailyEntryCatalogService');
const {
  normalizeCatalogCategory,
  TAB_CATALOG_IMPORT,
  CATALOG_TO_PRICE_LIST_CATEGORY_CODES,
  dailyChargesUsePriceListOnly,
} = require('./dailyCatalogCategories');

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

function priceListCategoryCodeForCatalogCategory(catalogCategory) {
  const codes = CATALOG_TO_PRICE_LIST_CATEGORY_CODES[catalogCategory];
  return codes?.[0] || null;
}

/**
 * Import a per-tab Excel sheet into the default price list (services table).
 * This is the path daily charge pickers and saves use when price-list mode is on.
 */
async function importSectionExcelToPriceList(buffer, options = {}) {
  const { getDefaultPriceList } = require('./priceListService');
  const list = await getDefaultPriceList();
  if (!list) {
    throw new Error('لا توجد لائحة أسعار — أنشئ لائحة من إدارة الأسعار أولاً');
  }

  const catalogCategory =
    normalizeCatalogCategory(options.catalog_category) ||
    normalizeCatalogCategory(options.default_category);
  const forcedCategoryCode =
    options.category_code || priceListCategoryCodeForCatalogCategory(catalogCategory);

  const parsed = await parseExcelBuffer(buffer, {
    template_key: options.template_key,
    filename: options.filename || '',
    category_name: options.category_name,
  });

  if (forcedCategoryCode) {
    parsed.category_code = forcedCategoryCode;
    for (const svc of parsed.services || []) {
      svc.category_code = forcedCategoryCode;
    }
  }

  if (!parsed.services?.length) {
    throw new Error('لم يُعثر على بنود صالحة في الملف — تأكد من صيغة الشيت (البيان / السعر)');
  }

  const result = await importParsedExcel(list.id, parsed, options.actor || null, {
    replaceExisting: options.replace_existing === true || options.replace_existing === 'true',
  });

  const inserted = Number(result.imported) || 0;
  const updated = Number(result.updated) || 0;
  const total = inserted + updated;
  if (total <= 0) {
    throw new Error('لم يُستورد أي بند — راجع أعمدة الشيت (البيان والسعر) أو ارفع من إدارة الأسعار');
  }

  return {
    ...result,
    inserted,
    updated,
    imported: total,
    price_list_id: list.id,
    price_list_name: list.name,
    category_code: parsed.category_code || forcedCategoryCode || null,
    template_label: parsed.template_label || options.template_label || catalogCategory,
    source: 'price_list',
    parsed_rows: parsed.services.length,
  };
}

async function importSectionExcelForDailyTab(buffer, options = {}) {
  if (dailyChargesUsePriceListOnly()) {
    return importSectionExcelToPriceList(buffer, options);
  }
  return importSectionExcelToCatalog(buffer, options);
}

function resolveTabCatalogImport(tabKey, filename = '') {
  const cfg = TAB_CATALOG_IMPORT[String(tabKey || '').trim()];
  if (!cfg) return null;

  const withPriceListCode = (entry) => ({
    ...entry,
    category_code: priceListCategoryCodeForCatalogCategory(entry.category),
  });

  if (!cfg.detect_from_filename) return withPriceListCode(cfg);

  const { detectTemplateFromFilename, EXCEL_TEMPLATES } = require('./priceListExcelImportService');
  const { catalogCategoryForServiceCode } = require('./dailyCatalogCategories');
  const detected = detectTemplateFromFilename(filename);
  if (!detected) return withPriceListCode(cfg);
  const template = EXCEL_TEMPLATES[detected];
  const category =
    catalogCategoryForServiceCode(template?.category_code) || cfg.category;
  return withPriceListCode({ ...cfg, template_key: detected, category });
}

module.exports = {
  importSectionExcelToCatalog,
  importSectionExcelToPriceList,
  importSectionExcelForDailyTab,
  resolveTabCatalogImport,
  excelServiceToCatalogRow,
  priceListCategoryCodeForCatalogCategory,
};
