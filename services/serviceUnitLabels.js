/** Human-readable unit labels when catalog/service unit is generic (مرة). */
const GENERIC_UNIT_VALUES = new Set(['', 'مرة', 'وحدة', 'unit']);

const CATEGORY_DEFAULT_UNITS = Object.freeze({
  LAB: 'تحليل',
  RADIOLOGY: 'أشعة',
  MEDICAL_EXAMS: 'كشف',
  PHYSIO: 'جلسة',
  PHYSIO_VIP: 'جلسة',
  PHYSIO_DEVICES: 'جلسة',
  ACCOMMODATION: 'يوم',
  COMPANION: 'يوم',
  NURSING: 'يوم',
  STAMPS: 'دمغة',
  RF_INJECTION: 'إجراء',
  SPINE_CENTER: 'عملية',
  GENERAL: 'خدمة',
  PROSTHETICS: 'قطعة',
  DENTAL: 'خدمة',
  ORTHOPEDICS: 'جبيرة',
});

function formatServiceUnitLabel(unit, categoryCode) {
  const trimmed = String(unit || '').trim();
  if (!GENERIC_UNIT_VALUES.has(trimmed)) return trimmed;
  const code = String(categoryCode || '').trim();
  return CATEGORY_DEFAULT_UNITS[code] || 'خدمة';
}

module.exports = {
  GENERIC_UNIT_VALUES,
  CATEGORY_DEFAULT_UNITS,
  formatServiceUnitLabel,
};
