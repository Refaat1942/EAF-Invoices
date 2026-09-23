const { query } = require('../database/db');
const { TAB_CATALOG_IMPORT, CATALOG_TO_PRICE_LIST_CATEGORY_CODES } = require('./dailyCatalogCategories');

/** One row per daily entry screen → the single source it reads from. */
const DAILY_DATA_SOURCES = Object.freeze([
  { key: 'sessions', screen: 'الجلسات', kind: 'price_list', tab: 'sessions' },
  { key: 'exams', screen: 'الكشوفات', kind: 'price_list', tab: 'exams' },
  { key: 'lab', screen: 'التحاليل', kind: 'price_list', tab: 'lab' },
  { key: 'radiology', screen: 'الأشعة', kind: 'price_list', tab: 'radiology' },
  { key: 'other', screen: 'أخرى', kind: 'price_list', tab: 'other' },
  { key: 'operations', screen: 'العمليات', kind: 'price_list', tab: 'operations' },
  { key: 'medicines', screen: 'الأدوية', kind: 'catalog', category: 'Medicine' },
  { key: 'supplies', screen: 'المستلزمات', kind: 'catalog', category: 'Supplies' },
  { key: 'cosmetics', screen: 'مستحضرات التجميل', kind: 'catalog', category: 'Cosmetics' },
  { key: 'stay', screen: 'الإقامة', kind: 'settings', settings_section: 'stay-types', source: 'أنواع الإقامة' },
  { key: 'doctors', screen: 'أطباء الكشوفات', kind: 'settings', settings_section: 'doctors', source: 'الأطباء' },
]);

async function getDailyDataSources() {
  const { getDefaultPriceList } = require('./priceListService');
  const priceList = await getDefaultPriceList();

  const priceCounts = new Map();
  const categoryIds = new Map();
  if (priceList) {
    const { rows } = await query(
      `SELECT c.id, c.code, COUNT(s.id) FILTER (WHERE s.is_active)::int AS n
       FROM service_categories c
       LEFT JOIN services s ON s.category_id = c.id
       WHERE c.price_list_id = $1
       GROUP BY c.id, c.code`,
      [priceList.id]
    );
    for (const row of rows) {
      priceCounts.set(row.code, row.n);
      categoryIds.set(row.code, row.id);
    }
  }

  const { rows: catalogRows } = await query(
    `SELECT category, COUNT(*)::int AS n FROM daily_entry_catalog_items WHERE is_active = TRUE GROUP BY category`
  );
  const catalogCounts = new Map(catalogRows.map((row) => [row.category, row.n]));

  const [{ rows: stayRows }, { rows: doctorRows }] = await Promise.all([
    query('SELECT COUNT(*)::int AS n FROM stay_types WHERE is_active = TRUE'),
    query('SELECT COUNT(*)::int AS n FROM doctors WHERE is_active = TRUE'),
  ]);
  const settingsCounts = { 'stay-types': stayRows[0]?.n || 0, doctors: doctorRows[0]?.n || 0 };

  return {
    price_list: priceList ? { id: priceList.id, name: priceList.name } : null,
    sources: DAILY_DATA_SOURCES.map((src) => {
      if (src.kind === 'price_list') {
        const cfg = TAB_CATALOG_IMPORT[src.tab];
        const code = CATALOG_TO_PRICE_LIST_CATEGORY_CODES[cfg.category]?.[0] || null;
        return {
          ...src,
          source: `اللائحة — ${code}`,
          upload_label: cfg.label,
          category_code: code,
          category_id: categoryIds.get(code) || null,
          count: priceCounts.get(code) || 0,
        };
      }
      if (src.kind === 'catalog') {
        return {
          ...src,
          source: `كتالوج الأصناف — ${src.category}`,
          upload_label: 'رفع شيت الأصناف',
          count: catalogCounts.get(src.category) || 0,
        };
      }
      return { ...src, count: settingsCounts[src.settings_section] || 0 };
    }),
  };
}

module.exports = { DAILY_DATA_SOURCES, getDailyDataSources };
