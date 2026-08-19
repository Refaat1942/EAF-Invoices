function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function roundNearest(n) {
  return Math.round(round2(n));
}

function dualValue(n) {
  const raw = round2(n);
  const rounded = roundNearest(raw);
  return { raw, rounded };
}

function calculateItemTotal(quantity, amount) {
  const raw = round2((Number(quantity) || 0) * (Number(amount) || 0));
  return { raw, rounded: roundNearest(raw), total: roundNearest(raw) };
}

function calculateInvoiceTotals(data) {
  const items = (data.items || []).map((item) => {
    const calc = calculateItemTotal(item.quantity, item.amount);
    return { ...item, total: calc.rounded, total_raw: calc.raw, total_rounded: calc.rounded };
  });

  const itemsSubtotalRaw = round2(items.reduce((sum, item) => sum + item.total_raw, 0));
  const itemsSubtotal = roundNearest(itemsSubtotalRaw);

  const payments = (data.payments || []).map((p) => ({
    ...p,
    amount: roundNearest(p.amount),
    amount_raw: round2(p.amount),
  }));

  const paymentsTotalRaw = round2(payments.reduce((sum, p) => sum + p.amount_raw, 0));
  const paymentsTotal = roundNearest(paymentsTotalRaw);

  const stampDutyD = dualValue(data.stamp_duty);
  const professionalFeesD = dualValue(data.professional_fees);
  const adminPercent = Number(data.admin_expenses_percent) || 12;

  const subtotalBeforeAdminRaw = round2(
    itemsSubtotalRaw + stampDutyD.raw + professionalFeesD.raw
  );
  const subtotalBeforeAdmin = roundNearest(subtotalBeforeAdminRaw);

  const adminExpensesRaw = round2(subtotalBeforeAdminRaw * (adminPercent / 100));
  const adminExpenses = roundNearest(adminExpensesRaw);

  const totalAfterAdminRaw = round2(subtotalBeforeAdminRaw + adminExpensesRaw);
  const totalAfterAdmin = roundNearest(totalAfterAdminRaw);

  const balanceD = dualValue(data.balance);
  const finalTotalRaw = round2(totalAfterAdminRaw + balanceD.raw);
  const finalTotal = roundNearest(finalTotalRaw);

  const cashPrivateD = dualValue(data.cash_private);
  const bankPrivateD = dualValue(data.bank_private);
  const cashExternalD = dualValue(data.cash_external);
  const bankExternalD = dualValue(data.bank_external);

  const totalCollectedRaw = round2(
    cashPrivateD.raw + bankPrivateD.raw + cashExternalD.raw + bankExternalD.raw
  );
  const totalCollected = roundNearest(totalCollectedRaw);

  const remainingRaw = round2(finalTotalRaw - totalCollectedRaw);
  const remaining = roundNearest(remainingRaw);

  return {
    items,
    payments,
    items_subtotal: itemsSubtotal,
    items_subtotal_raw: itemsSubtotalRaw,
    stamp_duty: stampDutyD.rounded,
    stamp_duty_raw: stampDutyD.raw,
    professional_fees: professionalFeesD.rounded,
    professional_fees_raw: professionalFeesD.raw,
    subtotal_before_admin: subtotalBeforeAdmin,
    subtotal_before_admin_raw: subtotalBeforeAdminRaw,
    admin_expenses_percent: adminPercent,
    admin_expenses: adminExpenses,
    admin_expenses_raw: adminExpensesRaw,
    total_after_admin: totalAfterAdmin,
    total_after_admin_raw: totalAfterAdminRaw,
    balance: balanceD.rounded,
    balance_raw: balanceD.raw,
    final_total: finalTotal,
    final_total_raw: finalTotalRaw,
    cash_private: cashPrivateD.rounded,
    cash_private_raw: cashPrivateD.raw,
    bank_private: bankPrivateD.rounded,
    bank_private_raw: bankPrivateD.raw,
    cash_external: cashExternalD.rounded,
    cash_external_raw: cashExternalD.raw,
    bank_external: bankExternalD.rounded,
    bank_external_raw: bankExternalD.raw,
    total_collected: totalCollected,
    total_collected_raw: totalCollectedRaw,
    remaining,
    remaining_raw: remainingRaw,
    payments_total: paymentsTotal,
    payments_total_raw: paymentsTotalRaw,
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

function formatDual(raw, rounded, formatter) {
  const fmt = formatter || ((n) => Number(n).toLocaleString('ar-EG'));
  if (round2(raw) === round2(rounded)) return fmt(rounded);
  return `${fmt(raw)} ← ${fmt(rounded)}`;
}

module.exports = {
  round2,
  roundNearest,
  dualValue,
  calculateItemTotal,
  calculateInvoiceTotals,
  calculateStayDays,
  formatDual,
};
