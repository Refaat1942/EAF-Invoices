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

function formatServiceDisplayName(service) {
  if (!service) return '';
  const raw = service.name;
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (trimmed && trimmed !== '[object Object]') return trimmed;
  } else if (raw && typeof raw === 'object') {
    if (raw.text) return String(raw.text).trim();
    if (raw.ar || raw.en) return String(raw.ar || raw.en).trim();
  }
  const description = String(service.description || '').trim();
  if (description) return description;
  const notes = String(service.notes || '').trim();
  if (notes) return notes;
  if (service.code) return String(service.code);
  return '';
}

module.exports = {
  GENERIC_UNIT_VALUES,
  CATEGORY_DEFAULT_UNITS,
  formatServiceUnitLabel,
  formatServiceDisplayName,
};
