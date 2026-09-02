/**
 * Maps daily entry section codes to invoice UI bundles (one line per input screen).
 * Each bundle aligns with a daily-charges tab and the corresponding price-list area.
 */

const SECTION_TO_BUNDLE = Object.freeze({
  accommodation: 'stay',
  companion: 'stay',
  nursing_point: 'stay',
  patient_assistant: 'stay',
  sessions_date: 'sessions',
  sessions_detail: 'sessions',
  sessions: 'sessions',
  medicines: 'medicines',
  supplies: 'supplies',
  cosmetics: 'supplies',
  consultant_exam: 'exams',
  specialist_exam: 'exams',
  consultation_stamp: 'exams',
  analyses: 'lab',
  analyses_stamp: 'lab',
  xray_type: 'radiology',
  xray_total: 'radiology',
  xray_stamp: 'radiology',
  other: 'other',
  prosthetics: 'other',
  operations: 'operations',
  glasses: 'glasses',
});

const BUNDLE_LABELS = Object.freeze({
  stay: 'إقامة ورعاية',
  sessions: 'جلسات',
  medicines: 'الأدوية',
  supplies: 'المستلزمات',
  exams: 'الكشوفات',
  lab: 'التحاليل',
  radiology: 'الأشعة',
  other: 'خدمات متنوعة',
  operations: 'العمليات',
  glasses: 'النظارات',
  __manual__: 'بنود أخرى',
});

/** Price-list category codes (or catalog) tied to each input screen bundle. */
const BUNDLE_SOURCES = Object.freeze({
  stay: { categories: ['ACCOMMODATION', 'COMPANION', 'NURSING'], catalog: [] },
  sessions: { categories: ['PHYSIO'], catalog: [] },
  medicines: { categories: [], catalog: ['Medicine'] },
  supplies: { categories: [], catalog: ['Supplies', 'Cosmetics'] },
  exams: { categories: ['MEDICAL_EXAMS', 'STAMPS'], catalog: [] },
  lab: { categories: ['LAB', 'STAMPS'], catalog: [] },
  radiology: { categories: ['RADIOLOGY', 'STAMPS'], catalog: [] },
  other: { categories: ['GENERAL', 'PROSTHETICS'], catalog: [] },
  operations: { categories: [], catalog: [] },
  glasses: { categories: [], catalog: [] },
});

const BUNDLE_SORT_ORDER = Object.freeze({
  stay: 1,
  sessions: 2,
  medicines: 3,
  supplies: 4,
  exams: 5,
  lab: 6,
  radiology: 7,
  other: 8,
  operations: 9,
  glasses: 10,
  __manual__: 99,
});

function inferBundleKey(sectionCode) {
  const code = String(sectionCode || '').trim();
  if (!code) return '__manual__';
  return SECTION_TO_BUNDLE[code] || code;
}

function inferBundleKeyFromItem(item = {}) {
  const code = String(item.section_code || item.bundle_code || '').trim();
  if (code && BUNDLE_LABELS[code]) return code;
  if (code) return inferBundleKey(code);
  const desc = String(item.description || '');
  if (desc.includes('عملية')) return 'operations';
  if (desc.includes('بصريات') || desc.includes('نظارات')) return 'glasses';
  return '__manual__';
}

function getBundleLabel(bundleKey, fallbackItem = null) {
  const key = String(bundleKey || '').trim();
  if (key && BUNDLE_LABELS[key]) return BUNDLE_LABELS[key];
  const fromItem = String(fallbackItem?.section_name || '').trim();
  if (fromItem) return fromItem;
  return key || 'بنود أخرى';
}

function getBundleSortOrder(bundleKey) {
  return BUNDLE_SORT_ORDER[bundleKey] ?? 50;
}

module.exports = {
  SECTION_TO_BUNDLE,
  BUNDLE_LABELS,
  BUNDLE_SOURCES,
  inferBundleKey,
  inferBundleKeyFromItem,
  getBundleLabel,
  getBundleSortOrder,
};
