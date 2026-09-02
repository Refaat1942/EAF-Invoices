const { round2 } = require('./calculations');
const {
  inferBundleKeyFromItem,
  getBundleLabel,
  getBundleSortOrder,
} = require('./dailySectionBundles');

const CUSTOMER_AGGREGATE_SECTION_CODES = Object.freeze(['medicines', 'supplies', 'cosmetics']);

const DEFAULT_SECTION_LABELS = Object.freeze({
  medicines: 'الأدوية',
  supplies: 'المستلزمات',
  cosmetics: 'مستحضرات تجميل',
});

function isCustomerAggregateSection(sectionCode) {
  return CUSTOMER_AGGREGATE_SECTION_CODES.includes(String(sectionCode || '').trim());
}

function resolveSectionLabel(item, bundleKey, sectionLabels = {}) {
  const fromBundle = getBundleLabel(bundleKey, item);
  if (fromBundle && fromBundle !== bundleKey) return fromBundle;
  const fromOptions = String(sectionLabels[bundleKey] || '').trim();
  if (fromOptions) return fromOptions;
  return DEFAULT_SECTION_LABELS[bundleKey] || bundleKey;
}

function normalizePresentationText(text) {
  return String(text || '')
    .trim()
    .replace(/\s+/g, ' ');
}

function buildServiceGroupKey(item) {
  if (item.daily_entry_line_id || item.daily_entry_id) return null;
  if (isCustomerAggregateSection(item.section_code)) return null;
  if (item.catalog_item_id) return null;
  if (item._customer_display_aggregate) return null;

  const name = normalizePresentationText(item.service_name_snapshot || item.description);
  if (!name) return null;

  const unitPrice = round2(item.amount ?? item.unit_price_snapshot ?? item.unit_price ?? 0);
  const serviceId = item.service_id ? String(item.service_id) : '';
  const serviceCode = normalizePresentationText(item.service_code_snapshot || item.service_code || '');

  return `${serviceId}|${serviceCode}|${name}|${unitPrice}`;
}

function inferSectionCode(item) {
  return inferBundleKeyFromItem(item);
}

/**
 * One summary row per daily input screen (bundle) for customer-facing display.
 */
function aggregateInvoiceSectionTotals(items = [], options = {}) {
  const sectionLabels = options.sectionLabels || {};
  const buckets = new Map();
  const order = [];

  const sorted = [...items].sort((a, b) => {
    const sa = a.section_sort_order ?? getBundleSortOrder(inferBundleKeyFromItem(a));
    const sb = b.section_sort_order ?? getBundleSortOrder(inferBundleKeyFromItem(b));
    if (sa !== sb) return sa - sb;
    return (Number(a.id) || 0) - (Number(b.id) || 0);
  });

  for (let index = 0; index < sorted.length; index++) {
    const item = sorted[index];
    const bundleKey = inferBundleKeyFromItem(item);
    if (!buckets.has(bundleKey)) {
      const label =
        bundleKey === '__manual__'
          ? 'بنود أخرى'
          : resolveSectionLabel(item, bundleKey, sectionLabels);
      buckets.set(bundleKey, {
        bundle_code: bundleKey === '__manual__' ? '' : bundleKey,
        section_code: bundleKey === '__manual__' ? '' : bundleKey,
        description: label,
        section_sort_order: getBundleSortOrder(bundleKey),
        firstIndex: index,
        total: 0,
        total_raw: 0,
      });
      order.push(bundleKey);
    }
    const bucket = buckets.get(bundleKey);
    bucket.total = round2(bucket.total + (Number(item.total) || 0));
    bucket.total_raw = round2(bucket.total_raw + (Number(item.total_raw ?? item.total) || 0));
    if (item.section_name && bundleKey !== '__manual__') {
      bucket.description = String(item.section_name).trim();
    }
  }

  return order.map((code) => {
    const bucket = buckets.get(code);
    return {
      description: bucket.description,
      section_code: bucket.section_code,
      bundle_code: bucket.bundle_code,
      section_sort_order: bucket.section_sort_order,
      total: bucket.total,
      total_raw: bucket.total_raw,
      quantity: '',
      amount: '',
      item_discount_percent: '',
      _customer_display_aggregate: true,
      _section_aggregate: true,
    };
  });
}

/**
 * Customer PDF: one total per input screen; free manual lines stay detailed.
 */
function aggregateCustomerFacingLines(items = [], options = {}) {
  const dailyLinked = [];
  const passthrough = [];

  for (const item of items) {
    if (item.daily_entry_line_id || item.daily_entry_id) {
      dailyLinked.push(item);
      continue;
    }
    const bundleKey = inferBundleKeyFromItem(item);
    if (bundleKey !== '__manual__') {
      dailyLinked.push(item);
      continue;
    }
    passthrough.push(item);
  }

  const bundled = aggregateInvoiceSectionTotals(dailyLinked, options);
  return [...bundled, ...passthrough];
}

module.exports = {
  aggregateCustomerFacingLines,
  aggregateInvoiceSectionTotals,
  inferSectionCode,
  isCustomerAggregateSection,
  buildServiceGroupKey,
  CUSTOMER_AGGREGATE_SECTION_CODES,
  DEFAULT_SECTION_LABELS,
};
