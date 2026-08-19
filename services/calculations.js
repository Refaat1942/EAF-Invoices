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

function normalizeArabic(text) {
  return String(text || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function matchesExclusion(description, exclusion) {
  const desc = normalizeArabic(description);
  const pattern = normalizeArabic(exclusion.name);
  if (!desc || !pattern) return false;
  if (exclusion.match_type === 'exact') return desc === pattern;
  if (exclusion.match_type === 'starts_with') return desc.startsWith(pattern);
  return desc.includes(pattern);
}

function resolveItemEligibility(item, exclusions, discountActive) {
  if (!discountActive) {
    return {
      is_discount_eligible: false,
      item_discount_percent: 0,
      discount_exclusion_id: null,
    };
  }

  if (item.discount_eligible_override === true || item.discount_eligible_override === false) {
    const eligible = item.discount_eligible_override === true;
    return {
      is_discount_eligible: eligible,
      item_discount_percent: eligible ? Number(item.entity_discount_percent || item.item_discount_percent || 0) : 0,
      discount_exclusion_id: eligible ? null : item.discount_exclusion_id || null,
    };
  }

  for (const rule of exclusions) {
    if (matchesExclusion(item.description, rule)) {
      return {
        is_discount_eligible: false,
        item_discount_percent: 0,
        discount_exclusion_id: rule.id,
        exclusion_name: rule.name,
      };
    }
  }

  return {
    is_discount_eligible: true,
    item_discount_percent: Number(item.entity_discount_percent || item.item_discount_percent || 0),
    discount_exclusion_id: null,
  };
}

function resolvePaymentTotals(data) {
  if (Array.isArray(data.method_payments) && data.method_payments.length) {
    const totalCollectedRaw = round2(
      data.method_payments.reduce((sum, entry) => sum + round2(entry.amount), 0)
    );
    const totalCollected = roundNearest(totalCollectedRaw);

    const byCode = {};
    data.method_payments.forEach((entry) => {
      if (entry.code) byCode[entry.code] = roundNearest(entry.amount);
    });

    return {
      cash_private: byCode.cash || 0,
      bank_private: byCode.bank_transfer || 0,
      cash_external: byCode.check || 0,
      bank_external: 0,
      total_collected: totalCollected,
      total_collected_raw: totalCollectedRaw,
    };
  }

  const cashPrivateD = dualValue(data.cash_private);
  const bankPrivateD = dualValue(data.bank_private);
  const cashExternalD = dualValue(data.cash_external);
  const bankExternalD = dualValue(data.bank_external);

  const totalCollectedRaw = round2(
    cashPrivateD.raw + bankPrivateD.raw + cashExternalD.raw + bankExternalD.raw
  );

  return {
    cash_private: cashPrivateD.rounded,
    bank_private: bankPrivateD.rounded,
    cash_external: cashExternalD.rounded,
    bank_external: bankExternalD.rounded,
    total_collected: roundNearest(totalCollectedRaw),
    total_collected_raw: totalCollectedRaw,
    cash_private_raw: cashPrivateD.raw,
    bank_private_raw: bankPrivateD.raw,
    cash_external_raw: cashExternalD.raw,
    bank_external_raw: bankExternalD.raw,
  };
}

function calculateInvoiceTotals(data) {
  const discountPercent = Number(data.discount_percent) || 0;
  const discountActive =
    data.invoice_type === 'contracted' && discountPercent > 0 && Number(data.contracted_entity_id);
  const exclusions = data.discount_exclusions || [];

  const items = (data.items || []).map((item) => {
    const calc = calculateItemTotal(item.quantity, item.amount);
    const eligibility = resolveItemEligibility(
      { ...item, entity_discount_percent: discountPercent },
      exclusions,
      discountActive
    );
    return {
      ...item,
      total: calc.rounded,
      total_raw: calc.raw,
      total_rounded: calc.rounded,
      ...eligibility,
    };
  });

  const itemsSubtotalRaw = round2(items.reduce((sum, item) => sum + item.total_raw, 0));
  const itemsSubtotal = roundNearest(itemsSubtotalRaw);

  const discountEligibleSubtotalRaw = round2(
    items.filter((item) => item.is_discount_eligible).reduce((sum, item) => sum + item.total_raw, 0)
  );
  const discountEligibleSubtotal = roundNearest(discountEligibleSubtotalRaw);

  const discountAmountRaw = discountActive
    ? round2(discountEligibleSubtotalRaw * (discountPercent / 100))
    : 0;
  const discountAmount = roundNearest(discountAmountRaw);

  const itemsSubtotalAfterDiscountRaw = round2(itemsSubtotalRaw - discountAmountRaw);
  const itemsSubtotalAfterDiscount = roundNearest(itemsSubtotalAfterDiscountRaw);

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
    itemsSubtotalAfterDiscountRaw + stampDutyD.raw + professionalFeesD.raw
  );
  const subtotalBeforeAdmin = roundNearest(subtotalBeforeAdminRaw);

  const adminExpensesRaw = round2(subtotalBeforeAdminRaw * (adminPercent / 100));
  const adminExpenses = roundNearest(adminExpensesRaw);

  const totalAfterAdminRaw = round2(subtotalBeforeAdminRaw + adminExpensesRaw);
  const totalAfterAdmin = roundNearest(totalAfterAdminRaw);

  const balanceD = dualValue(data.balance);
  const finalTotalRaw = round2(totalAfterAdminRaw + balanceD.raw);
  const finalTotal = roundNearest(finalTotalRaw);

  const paymentTotals = resolvePaymentTotals(data);
  const cashPrivateD = dualValue(paymentTotals.cash_private);
  const bankPrivateD = dualValue(paymentTotals.bank_private);
  const cashExternalD = dualValue(paymentTotals.cash_external);
  const bankExternalD = dualValue(paymentTotals.bank_external);

  const totalCollectedRaw = paymentTotals.total_collected_raw;
  const totalCollected = paymentTotals.total_collected;

  const remainingRaw = round2(finalTotalRaw - totalCollectedRaw);
  const remaining = roundNearest(remainingRaw);

  return {
    items,
    payments,
    items_subtotal: itemsSubtotal,
    items_subtotal_raw: itemsSubtotalRaw,
    discount_percent: discountActive ? discountPercent : 0,
    discount_eligible_subtotal: discountEligibleSubtotal,
    discount_eligible_subtotal_raw: discountEligibleSubtotalRaw,
    discount_amount: discountAmount,
    discount_amount_raw: discountAmountRaw,
    items_subtotal_after_discount: itemsSubtotalAfterDiscount,
    items_subtotal_after_discount_raw: itemsSubtotalAfterDiscountRaw,
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
  matchesExclusion,
};
