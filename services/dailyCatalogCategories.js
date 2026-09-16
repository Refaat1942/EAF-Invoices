/**
 * Daily charge screens read from uploaded per-tab sheets (daily_entry_catalog_items),
 * not from the bulk price list (services table).
 */

const CATALOG_CATEGORIES = Object.freeze([
  'Medicine',
  'Supplies',
  'Cosmetics',
  'MedicalExams',
  'Lab',
  'Radiology',
  'Physio',
  'Accommodation',
  'Companion',
  'Nursing',
  'General',
  'Prosthetics',
  'SpineOperations',
]);

const CATEGORY_ALIASES = Object.freeze({
  medicine: 'Medicine',
  medicines: 'Medicine',
  drug: 'Medicine',
  drugs: 'Medicine',
  'أدوية': 'Medicine',
  'ادويه': 'Medicine',
  'ادوية': 'Medicine',
  'دواء': 'Medicine',
  supplies: 'Supplies',
  supply: 'Supplies',
  'مستلزمات': 'Supplies',
  cosmetics: 'Cosmetics',
  cosmetic: 'Cosmetics',
  'مستحضرات': 'Cosmetics',
  'مستحضرات تجميل': 'Cosmetics',
  'تجميل': 'Cosmetics',
  medicalexams: 'MedicalExams',
  medical_exams: 'MedicalExams',
  'كشوفات': 'MedicalExams',
  'كشوف': 'MedicalExams',
  lab: 'Lab',
  'تحاليل': 'Lab',
  radiology: 'Radiology',
  'أشعة': 'Radiology',
  'اشعه': 'Radiology',
  physio: 'Physio',
  'علاج طبيعي': 'Physio',
  accommodation: 'Accommodation',
  'إقامة': 'Accommodation',
  'اقامه': 'Accommodation',
  companion: 'Companion',
  'مرافق': 'Companion',
  nursing: 'Nursing',
  'تمريض': 'Nursing',
  general: 'General',
  'خدمات': 'General',
  prosthetics: 'Prosthetics',
  'أجهزة تعويضية': 'Prosthetics',
  spineoperations: 'SpineOperations',
  'عمليات': 'SpineOperations',
});

/** Sections that search multiple uploaded catalog sheets in one picker. */
const SECTION_CATALOG_SEARCH_CATEGORIES = Object.freeze({
  other: ['General', 'Prosthetics'],
});

/** daily_charge_sections.code → catalog category for picker/search */
const SECTION_CATALOG_CATEGORY = Object.freeze({
  consultant_exam: 'MedicalExams',
  specialist_exam: 'MedicalExams',
  analyses: 'Lab',
  xray_total: 'Radiology',
  sessions: 'Physio',
  other: 'General',
  prosthetics: 'Prosthetics',
  operation_pick: 'SpineOperations',
  accommodation: 'Accommodation',
  companion: 'Companion',
  nursing_point: 'Nursing',
  patient_assistant: 'Nursing',
});

/** service_categories.code → catalog category */
const SERVICE_CATEGORY_TO_CATALOG = Object.freeze({
  MEDICAL_EXAMS: 'MedicalExams',
  LAB: 'Lab',
  RADIOLOGY: 'Radiology',
  PHYSIO: 'Physio',
  ACCOMMODATION: 'Accommodation',
  COMPANION: 'Companion',
  NURSING: 'Nursing',
  GENERAL: 'General',
  PROSTHETICS: 'Prosthetics',
  SPINE_CENTER: 'SpineOperations',
  SPINE_BUILDING: 'General',
  RF_INJECTION: 'General',
});

/** Daily tab → catalog import config (replaces price-list excel import). */
const TAB_CATALOG_IMPORT = Object.freeze({
  sessions: { category: 'Physio', template_key: 'physio', label: 'رفع العلاج الطبيعي' },
  exams: { category: 'MedicalExams', template_key: 'medical_exams', label: 'رفع الكشوفات' },
  lab: { category: 'Lab', template_key: 'lab', label: 'رفع التحاليل' },
  radiology: { category: 'Radiology', template_key: 'radiology', label: 'رفع الأشعة' },
  other: { category: 'General', template_key: null, detect_from_filename: true, label: 'رفع ملف خدمات' },
  stay: { category: 'Accommodation', template_key: 'accommodation', label: 'رفع الإقامات' },
  operations: { category: 'SpineOperations', template_key: 'spine_operations', label: 'رفع العمليات الجراحية' },
});

function normalizeCatalogCategory(value) {
  const text = String(value || '').trim();
  if (!text) return null;
  const key = text.toLowerCase();
  if (CATEGORY_ALIASES[key]) return CATEGORY_ALIASES[key];
  if (CATEGORY_ALIASES[text]) return CATEGORY_ALIASES[text];
  const exact = CATALOG_CATEGORIES.find((c) => c.toLowerCase() === key);
  return exact || null;
}

function catalogCategoryForSection(section) {
  if (!section) return null;
  if (section.catalog_category) return section.catalog_category;
  const code = String(section.code || '').trim();
  if (SECTION_CATALOG_CATEGORY[code]) return SECTION_CATALOG_CATEGORY[code];
  const svcCode = String(section.category_code || '').trim();
  if (svcCode && SERVICE_CATEGORY_TO_CATALOG[svcCode]) return SERVICE_CATEGORY_TO_CATALOG[svcCode];
  return null;
}

function catalogSearchCategoriesForSection(section) {
  const code = String(section?.code || '').trim();
  if (SECTION_CATALOG_SEARCH_CATEGORIES[code]) return [...SECTION_CATALOG_SEARCH_CATEGORIES[code]];
  const single = catalogCategoryForSection(section);
  return single ? [single] : [];
}

function catalogCategoryForServiceCode(categoryCode) {
  return SERVICE_CATEGORY_TO_CATALOG[String(categoryCode || '').trim()] || null;
}

module.exports = {
  CATALOG_CATEGORIES,
  CATEGORY_ALIASES,
  SECTION_CATALOG_CATEGORY,
  SERVICE_CATEGORY_TO_CATALOG,
  TAB_CATALOG_IMPORT,
  normalizeCatalogCategory,
  SECTION_CATALOG_SEARCH_CATEGORIES,
  catalogCategoryForSection,
  catalogSearchCategoriesForSection,
  catalogCategoryForServiceCode,
};
