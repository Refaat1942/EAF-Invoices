const { round2 } = require('./calculations');

const CUSTOMER_AGGREGATE_SECTION_CODES = Object.freeze(['medicines', 'supplies', 'cosmetics']);

const DEFAULT_SECTION_LABELS = Object.freeze({
  medicines: 'الأدوية',
  supplies: 'المستلزمات',
  cosmetics: 'مستحضرات تجميل',
});

function isCustomerAggregateSection(sectionCode) {
  return CUSTOMER_AGGREGATE_SECTION_CODES.includes(String(sectionCode || '').trim());
}

function resolveSectionLabel(item, sectionCode, sectionLabels = {}) {
  const fromItem = String(item?.section_name || '').trim();
  if (fromItem) return fromItem;
  const fromOptions = String(sectionLabels[sectionCode] || '').trim();
  if (fromOptions) return fromOptions;
  return DEFAULT_SECTION_LABELS[sectionCode] || sectionCode;
}

/**
 * Collapse catalog consumable invoice lines into one customer-facing row per section.
 * Call only after calculateInvoiceTotals + enrichInvoice so line totals include returns.
 */
function aggregateCustomerFacingLines(items = [], options = {}) {
  const sectionLabels = options.sectionLabels || {};
  const buckets = new Map();
  const placedSections = new Set();
  const output = [];

  for (let index = 0; index < items.length; index++) {
    const item = items[index];
    const sectionCode = String(item.section_code || '').trim();

    if (!isCustomerAggregateSection(sectionCode)) {
      continue;
    }

    if (!buckets.has(sectionCode)) {
      buckets.set(sectionCode, {
        section_code: sectionCode,
        description: resolveSectionLabel(item, sectionCode, sectionLabels),
        section_sort_order: item.section_sort_order ?? 999,
        firstIndex: index,
        total: 0,
        total_raw: 0,
      });
    }

    const bucket = buckets.get(sectionCode);
    bucket.total = round2(bucket.total + (Number(item.total) || 0));
    bucket.total_raw = round2(bucket.total_raw + (Number(item.total_raw ?? item.total) || 0));
    if (item.section_name) {
      bucket.description = String(item.section_name).trim();
    }
    if (item.section_sort_order != null) {
      bucket.section_sort_order = item.section_sort_order;
    }
  }

  for (let index = 0; index < items.length; index++) {
    const item = items[index];
    const sectionCode = String(item.section_code || '').trim();

    if (isCustomerAggregateSection(sectionCode) && buckets.has(sectionCode)) {
      if (!placedSections.has(sectionCode)) {
        const bucket = buckets.get(sectionCode);
        output.push({
          description: bucket.description,
          section_code: bucket.section_code,
          section_sort_order: bucket.section_sort_order,
          total: bucket.total,
          total_raw: bucket.total_raw,
          quantity: '',
          amount: '',
          item_discount_percent: '',
          _customer_display_aggregate: true,
        });
        placedSections.add(sectionCode);
      }
      continue;
    }

    output.push(item);
  }

  return output;
}

module.exports = {
  aggregateCustomerFacingLines,
  isCustomerAggregateSection,
  CUSTOMER_AGGREGATE_SECTION_CODES,
  DEFAULT_SECTION_LABELS,
};
