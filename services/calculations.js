function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function calculateItemTotal(quantity, amount) {
  return round2((Number(quantity) || 0) * (Number(amount) || 0));
}

function calculateInvoiceTotals(data) {
  const items = (data.items || []).map((item) => ({
    ...item,
    total: calculateItemTotal(item.quantity, item.amount),
  }));

  const itemsSubtotal = round2(items.reduce((sum, item) => sum + item.total, 0));

  const payments = (data.payments || []).map((p) => ({
    ...p,
    amount: round2(p.amount),
  }));

  const paymentsTotal = round2(payments.reduce((sum, p) => sum + p.amount, 0));

  const stampDuty = round2(data.stamp_duty);
  const professionalFees = round2(data.professional_fees);
  const adminPercent = Number(data.admin_expenses_percent) || 12;

  const subtotalBeforeAdmin = round2(itemsSubtotal + stampDuty + professionalFees);
  const adminExpenses = round2(subtotalBeforeAdmin * (adminPercent / 100));
  const totalAfterAdmin = round2(subtotalBeforeAdmin + adminExpenses);
  const balance = round2(data.balance);
  const finalTotal = round2(totalAfterAdmin + balance);

  const cashPrivate = round2(data.cash_private);
  const bankPrivate = round2(data.bank_private);
  const cashExternal = round2(data.cash_external);
  const bankExternal = round2(data.bank_external);
  const totalCollected = round2(cashPrivate + bankPrivate + cashExternal + bankExternal);
  const remaining = round2(finalTotal - totalCollected);

  return {
    items,
    payments,
    items_subtotal: itemsSubtotal,
    stamp_duty: stampDuty,
    professional_fees: professionalFees,
    admin_expenses_percent: adminPercent,
    admin_expenses: adminExpenses,
    total_after_admin: totalAfterAdmin,
    balance,
    final_total: finalTotal,
    cash_private: cashPrivate,
    bank_private: bankPrivate,
    cash_external: cashExternal,
    bank_external: bankExternal,
    total_collected: totalCollected,
    remaining,
    payments_total: paymentsTotal,
  };
}

function calculateStayDays(admissionDate, dischargeDate) {
  if (!admissionDate || !dischargeDate) return 0;
  const start = new Date(admissionDate);
  const end = new Date(dischargeDate);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return 0;
  const diff = Math.ceil((end - start) / (1000 * 60 * 60 * 24));
  return Math.max(diff, 0);
}

module.exports = {
  round2,
  calculateItemTotal,
  calculateInvoiceTotals,
  calculateStayDays,
};
