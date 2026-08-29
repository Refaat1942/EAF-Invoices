const { userHasPermission } = require('./authService');

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

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

function hasStructuralInvoiceChanges(existing, newData) {
  const headerKeys = [
    'patient_name',
    'file_number',
    'invoice_type',
    'admission_date',
    'discharge_date',
    'contracted_entity_id',
    'discount_percent',
    'stamp_duty',
    'professional_fees',
    'admin_expenses_percent',
    'notes',
    'letter_from_date',
    'letter_to_date',
  ];
  for (const key of headerKeys) {
    const a = existing[key] ?? '';
    const b = newData[key] ?? '';
    if (String(a).trim() !== String(b).trim()) return true;
  }

  const oldItems = JSON.stringify(normalizeItemsForCompare(existing.items));
  const newItems = JSON.stringify(normalizeItemsForCompare(newData.items));
  if (oldItems !== newItems) return true;

  const oldStay = JSON.stringify(normalizeStayForCompare(existing.stay_entries));
  const newStay = JSON.stringify(
    normalizeStayForCompare(newData.stay_entries || newData.calcData?.stay_entries)
  );
  if (oldStay !== newStay) return true;

  return false;
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

  if (hasStructuralInvoiceChanges(existing, merged)) {
    throw new Error('تعديل بنود ومحتوى الفاتورة الأصلية متاح للمسؤول فقط');
  }
}

module.exports = {
  assertInvoiceStructuralEditAllowed,
  hasStructuralInvoiceChanges,
};
