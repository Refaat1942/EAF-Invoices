const { userHasPermission } = require('./authService');

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

const HEADER_KEYS = [
  'patient_name',
  'file_number',
  'invoice_type',
  'admission_date',
  'discharge_date',
  'financial_treatment',
  'contracted_entity_id',
  'discount_percent',
  'stamp_duty',
  'professional_fees',
  'admin_expenses_percent',
  'notes',
  'letter_from_date',
  'letter_to_date',
];

const REGISTRATION_HEADER_KEYS = new Set([
  'patient_name',
  'file_number',
  'invoice_type',
  'admission_date',
  'discharge_date',
  'financial_treatment',
  'contracted_entity_id',
  'letter_from_date',
  'letter_to_date',
]);

function normalizeItemsForCompare(items = []) {
  return (items || [])
    .filter((i) => !i.is_stay_entry)
    .map((i) => ({
      description: String(i.description || '').trim(),
      amount: round2(i.amount),
      quantity: round2(i.quantity || 1),
      service_id: i.service_id || null,
      daily_entry_line_id: i.daily_entry_line_id || null,
    }))
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
}

function normalizeStayForCompare(entries = []) {
  return (entries || []).map((e) => ({
    stay_type_id: e.stay_type_id || null,
    from_date: e.from_date || '',
    to_date: e.to_date || '',
    days: round2(e.days),
    daily_rate: round2(e.daily_rate),
  }));
}

function filterManualItems(items = [], dailySync = false) {
  if (!dailySync) return items;
  return (items || []).filter((i) => !i.daily_entry_line_id);
}

const DATE_HEADER_KEYS = new Set(['admission_date', 'discharge_date', 'letter_from_date', 'letter_to_date']);
const NUMERIC_HEADER_KEYS = new Set([
  'discount_percent',
  'stamp_duty',
  'professional_fees',
  'admin_expenses_percent',
]);

function dateOnlyText(value) {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return '';
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, '0');
    const d = String(value.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  const text = String(value ?? '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  if (/^\d{4}-\d{2}-\d{2}T/.test(text)) return dateOnlyText(new Date(text));
  return text;
}

// DB rows carry Date objects and "12.00"-style numerics; the payload carries "YYYY-MM-DD" and numbers.
function normalizeHeaderValue(key, value) {
  if (DATE_HEADER_KEYS.has(key)) return dateOnlyText(value);
  if (NUMERIC_HEADER_KEYS.has(key)) return String(round2(value));
  if (key === 'contracted_entity_id') return value ? String(Number(value) || value) : '';
  return String(value ?? '').trim();
}

function hasHeaderChanges(existing, newData, allowedKeys = null) {
  for (const key of HEADER_KEYS) {
    if (allowedKeys && allowedKeys.has(key)) continue;
    if (normalizeHeaderValue(key, existing[key]) !== normalizeHeaderValue(key, newData[key])) return true;
  }
  return false;
}

function hasItemOrStayChanges(existing, newData, dailySync = false) {
  const oldItems = JSON.stringify(
    normalizeItemsForCompare(filterManualItems(existing.items, dailySync))
  );
  const newItems = JSON.stringify(
    normalizeItemsForCompare(filterManualItems(newData.items, dailySync))
  );
  if (oldItems !== newItems) return true;

  if (dailySync) return false;

  const oldStay = JSON.stringify(normalizeStayForCompare(existing.stay_entries));
  const newStay = JSON.stringify(
    normalizeStayForCompare(newData.stay_entries || newData.calcData?.stay_entries)
  );
  if (oldStay !== newStay) return true;

  return false;
}

function hasStructuralInvoiceChanges(existing, newData, options = {}) {
  const dailySync = options.dailySync === true;
  if (hasHeaderChanges(existing, newData)) return true;
  return hasItemOrStayChanges(existing, newData, dailySync);
}

function assertInvoiceStructuralEditAllowed(actor, existing, newPayload, totals) {
  if (!existing) return;
  if (userHasPermission(actor, 'invoices.edit_original')) return;

  const merged = {
    ...existing,
    ...newPayload,
    items: totals?.items || newPayload.items || existing.items,
    stay_entries: totals?.stay_entries || newPayload.stay_entries || existing.stay_entries,
  };

  const dailySync = newPayload.include_daily_charges === true;

  if (hasItemOrStayChanges(existing, merged, dailySync)) {
    throw new Error('تعديل بنود ومحتوى الفاتورة الأصلية متاح للمسؤول فقط');
  }

  const canRegister =
    dailySync && userHasPermission(actor, 'daily_charges.manage');
  if (canRegister) {
    if (hasHeaderChanges(existing, merged, REGISTRATION_HEADER_KEYS)) {
      throw new Error('تعديل بنود ومحتوى الفاتورة الأصلية متاح للمسؤول فقط');
    }
    return;
  }

  if (hasHeaderChanges(existing, merged)) {
    throw new Error('تعديل بنود ومحتوى الفاتورة الأصلية متاح للمسؤول فقط');
  }
}

module.exports = {
  assertInvoiceStructuralEditAllowed,
  hasStructuralInvoiceChanges,
};
