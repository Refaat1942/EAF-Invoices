const TRANSACTION_KIND_LABELS = Object.freeze({
  collection: 'تحصيل',
  prepaid_deduct: 'خصم من الرصيد',
  legacy: 'حركة سابقة',
  manual_adjustment: 'تعديل رصيد',
});

function labelTransactionKind(kind) {
  const code = String(kind || '').trim();
  if (!code) return '—';
  return TRANSACTION_KIND_LABELS[code] || code;
}

module.exports = {
  TRANSACTION_KIND_LABELS,
  labelTransactionKind,
};
