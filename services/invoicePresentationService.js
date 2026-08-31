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

function normalizePresentationText(text) {
  return String(text || '')
    .trim()
    .replace(/\s+/g, ' ');
}

function buildServiceGroupKey(item) {
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
  const code = String(item?.section_code || '').trim();
  if (code) return code;
  const desc = String(item?.description || '');
  if (desc.includes('عملية')) return 'operations';
  if (desc.includes('بصريات') || desc.includes('نظارات')) return 'glasses';
  return '__manual__';
}

/**
 * One summary row per invoice section (medicines, lab, stay, etc.) for customer-facing display.
 */
function aggregateInvoiceSectionTotals(items = [], options = {}) {
  const sectionLabels = options.sectionLabels || {};
  const buckets = new Map();
  const order = [];

  const sorted = [...items].sort((a, b) => {
    const sa = a.section_sort_order ?? 999;
    const sb = b.section_sort_order ?? 999;
    if (sa !== sb) return sa - sb;
    return (Number(a.id) || 0) - (Number(b.id) || 0);
  });

  for (let index = 0; index < sorted.length; index++) {
    const item = sorted[index];
    const sectionCode = inferSectionCode(item);
    if (!buckets.has(sectionCode)) {
      const label =
        sectionCode === '__manual__'
          ? 'بنود أخرى'
          : resolveSectionLabel(item, sectionCode, sectionLabels);
      buckets.set(sectionCode, {
        section_code: sectionCode === '__manual__' ? '' : sectionCode,
        description: label,
        section_sort_order: item.section_sort_order ?? 999,
        firstIndex: index,
        total: 0,
        total_raw: 0,
      });
      order.push(sectionCode);
    }
    const bucket = buckets.get(sectionCode);
    bucket.total = round2(bucket.total + (Number(item.total) || 0));
    bucket.total_raw = round2(bucket.total_raw + (Number(item.total_raw ?? item.total) || 0));
    if (item.section_name && sectionCode !== '__manual__') {
      bucket.description = String(item.section_name).trim();
    }
    if (item.section_sort_order != null) {
      bucket.section_sort_order = item.section_sort_order;
    }
  }

  return order.map((code) => {
    const bucket = buckets.get(code);
    return {
      description: bucket.description,
      section_code: bucket.section_code,
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
 * Collapse catalog consumable lines and identical clinical service lines for customer PDF.
 * Call only after calculateInvoiceTotals + enrichInvoice so line totals include returns.
 */
function aggregateCustomerFacingLines(items = [], options = {}) {
  const sectionLabels = options.sectionLabels || {};
  const catalogBuckets = new Map();
  const serviceBuckets = new Map();
  const placedCatalogSections = new Set();
  const placedServiceKeys = new Set();
  const output = [];

  for (let index = 0; index < items.length; index++) {
    const item = items[index];
    const sectionCode = String(item.section_code || '').trim();

    if (isCustomerAggregateSection(sectionCode)) {
      if (!catalogBuckets.has(sectionCode)) {
        catalogBuckets.set(sectionCode, {
          section_code: sectionCode,
          description: resolveSectionLabel(item, sectionCode, sectionLabels),
          section_sort_order: item.section_sort_order ?? 999,
          firstIndex: index,
          total: 0,
          total_raw: 0,
        });
      }

      const bucket = catalogBuckets.get(sectionCode);
      bucket.total = round2(bucket.total + (Number(item.total) || 0));
      bucket.total_raw = round2(bucket.total_raw + (Number(item.total_raw ?? item.total) || 0));
      if (item.section_name) {
        bucket.description = String(item.section_name).trim();
      }
      if (item.section_sort_order != null) {
        bucket.section_sort_order = item.section_sort_order;
      }
      continue;
    }

    const serviceKey = buildServiceGroupKey(item);
    if (serviceKey) {
      if (!serviceBuckets.has(serviceKey)) {
        serviceBuckets.set(serviceKey, {
          key: serviceKey,
          description: normalizePresentationText(item.service_name_snapshot || item.description),
          section_code: sectionCode,
          section_sort_order: item.section_sort_order ?? 999,
          firstIndex: index,
          total: 0,
          total_raw: 0,
        });
      }
      const bucket = serviceBuckets.get(serviceKey);
      bucket.total = round2(bucket.total + (Number(item.total) || 0));
      bucket.total_raw = round2(bucket.total_raw + (Number(item.total_raw ?? item.total) || 0));
      if (item.section_sort_order != null) {
        bucket.section_sort_order = item.section_sort_order;
      }
    }
  }

  for (let index = 0; index < items.length; index++) {
    const item = items[index];
    const sectionCode = String(item.section_code || '').trim();

    if (isCustomerAggregateSection(sectionCode) && catalogBuckets.has(sectionCode)) {
      if (!placedCatalogSections.has(sectionCode)) {
        const bucket = catalogBuckets.get(sectionCode);
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
        placedCatalogSections.add(sectionCode);
      }
      continue;
    }

    const serviceKey = buildServiceGroupKey(item);
    if (serviceKey && serviceBuckets.has(serviceKey)) {
      if (!placedServiceKeys.has(serviceKey)) {
        const bucket = serviceBuckets.get(serviceKey);
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
        placedServiceKeys.add(serviceKey);
      }
      continue;
    }

    output.push(item);
  }

  return output;
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
