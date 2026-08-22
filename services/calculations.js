function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function resolveAdminPercent(value, fallback = 12) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
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

function isItemAdminApplicable(item) {
  if (item.administrative_fee_applicable_snapshot === false) return false;
  if (item.administrative_fee_applicable_snapshot === true) return true;
  if (item.administrative_fee_applicable === false) return false;
  if (item.is_stay_entry) return true;
  return true;
}

function resolveItemEligibility(item, exclusions, discountActive) {
  if (!discountActive) {
    return {
      is_discount_eligible: false,
      item_discount_percent: 0,
      item_discount_amount: 0,
      item_discount_amount_raw: 0,
      discount_exclusion_id: null,
    };
  }

  if (item.discountable_snapshot === false) {
    return {
      is_discount_eligible: false,
      item_discount_percent: 0,
      item_discount_amount: 0,
      item_discount_amount_raw: 0,
      discount_exclusion_id: null,
    };
  }

  if (item.discountable_snapshot === true) {
    const pct = Number(item.entity_discount_percent || 0);
    const amountRaw = round2((Number(item.total_raw) || 0) * (pct / 100));
    return {
      is_discount_eligible: true,
      item_discount_percent: pct,
      item_discount_amount: roundNearest(amountRaw),
      item_discount_amount_raw: amountRaw,
      discount_exclusion_id: null,
    };
  }

  if (item.discount_eligible_override === true || item.discount_eligible_override === false) {
    const eligible = item.discount_eligible_override === true;
    const pct = eligible ? Number(item.entity_discount_percent || 0) : 0;
    const amountRaw = eligible ? round2((Number(item.total_raw) || 0) * (pct / 100)) : 0;
    return {
      is_discount_eligible: eligible,
      item_discount_percent: pct,
      item_discount_amount: roundNearest(amountRaw),
      item_discount_amount_raw: amountRaw,
      discount_exclusion_id: eligible ? null : item.discount_exclusion_id || null,
    };
  }

  for (const rule of exclusions) {
    if (matchesExclusion(item.description, rule)) {
      return {
        is_discount_eligible: false,
        item_discount_percent: 0,
        item_discount_amount: 0,
        item_discount_amount_raw: 0,
        discount_exclusion_id: rule.id,
        exclusion_name: rule.name,
      };
    }
  }

  const pct = Number(item.entity_discount_percent || 0);
  const amountRaw = round2((Number(item.total_raw) || 0) * (pct / 100));
  return {
    is_discount_eligible: true,
    item_discount_percent: pct,
    item_discount_amount: roundNearest(amountRaw),
    item_discount_amount_raw: amountRaw,
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
      patient_credit_applied: byCode.patient_credit || 0,
      total_collected: totalCollected,
      total_collected_raw: totalCollectedRaw,
      method_payments: data.method_payments.map((entry) => ({
        ...entry,
        amount: roundNearest(entry.amount),
        amount_raw: round2(entry.amount),
      })),
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

function calculateStayEntries(entries) {
  return (entries || [])
    .filter((entry) => entry.stay_type_id || entry.from_date || entry.to_date || entry.daily_rate)
    .map((entry) => {
      const days =
        entry.days !== undefined && entry.days !== ''
          ? Number(entry.days)
          : calculateStayDays(entry.from_date, entry.to_date);
      const dailyRate = Number(entry.daily_rate) || 0;
      const totalRaw = round2(days * dailyRate);
      return {
        ...entry,
        days,
        daily_rate: dailyRate,
        total_raw: totalRaw,
        total: roundNearest(totalRaw),
      };
    });
}

function sumItemPatientCredit(data) {
  return round2(
    (data.items || []).reduce((sum, item) => sum + round2(item.patient_credit_applied || 0), 0)
  );
}

function resolvePatientCreditAmount(data) {
  const fromItems = sumItemPatientCredit(data);
  const methodEntry = (data.method_payments || []).find((entry) => entry.code === 'patient_credit');
  const fromMethod = round2(methodEntry?.amount || 0);
  return round2(Math.max(fromItems, fromMethod));
}

function mergePatientCreditIntoMethodPayments(data, creditRaw) {
  const credit = roundNearest(creditRaw);
  const base = Array.isArray(data.method_payments) ? data.method_payments.map((entry) => ({ ...entry })) : [];
  const withoutCredit = base.filter((entry) => entry.code !== 'patient_credit');
  if (credit > 0) {
    const existing = base.find((entry) => entry.code === 'patient_credit');
    withoutCredit.push({
      ...existing,
      code: 'patient_credit',
      amount: credit,
      payment_method_id: existing?.payment_method_id || data.patient_credit_method_id || null,
    });
  }
  return withoutCredit;
}

function calculateInvoiceTotals(data) {
  const discountPercent = Number(data.discount_percent) || 0;
  const discountActive =
    data.invoice_type === 'contracted' && discountPercent > 0 && Number(data.contracted_entity_id);
  const exclusions = data.discount_exclusions || [];

  const stayEntries = calculateStayEntries(data.stay_entries);
  const staySubtotalRaw = round2(stayEntries.reduce((sum, entry) => sum + entry.total_raw, 0));
  const staySubtotal = roundNearest(staySubtotalRaw);

  const stayItems = stayEntries.map((entry) => ({
    description: `إقامة - ${entry.stay_type_name || ''}`.trim(),
    quantity: entry.days,
    amount: entry.daily_rate,
    is_stay_entry: true,
  }));

  const manualItems = (data.items || []).map((item) => {
    const calc = calculateItemTotal(item.quantity, item.amount);
    const creditRaw = round2(item.patient_credit_applied || 0);
    const eligibility = resolveItemEligibility(
      { ...item, total_raw: calc.raw, entity_discount_percent: discountPercent },
      exclusions,
      discountActive
    );
    return {
      ...item,
      total: calc.rounded,
      total_raw: calc.raw,
      total_rounded: calc.rounded,
      patient_credit_applied: roundNearest(creditRaw),
      patient_credit_applied_raw: creditRaw,
      ...eligibility,
    };
  });

  const items = [...manualItems, ...stayItems.map((item) => {
    const calc = calculateItemTotal(item.quantity, item.amount);
    const eligibility = resolveItemEligibility(
      { ...item, total_raw: calc.raw, entity_discount_percent: discountPercent },
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
  })];

  const manualItemsSubtotalRaw = round2(manualItems.reduce((sum, item) => sum + item.total_raw, 0));
  const manualItemsSubtotal = roundNearest(manualItemsSubtotalRaw);

  const itemsSubtotalRaw = round2(manualItemsSubtotalRaw + staySubtotalRaw);
  const itemsSubtotal = roundNearest(itemsSubtotalRaw);

  const discountEligibleSubtotalRaw = round2(
    items.filter((item) => item.is_discount_eligible).reduce((sum, item) => sum + item.total_raw, 0)
  );
  const discountEligibleSubtotal = roundNearest(discountEligibleSubtotalRaw);

  const payments = (data.payments || []).map((p) => ({
    ...p,
    amount: roundNearest(p.amount),
    amount_raw: round2(p.amount),
  }));

  const paymentsTotalRaw = round2(payments.reduce((sum, p) => sum + p.amount_raw, 0));
  const paymentsTotal = roundNearest(paymentsTotalRaw);

  const stampDutyD = dualValue(data.stamp_duty);
  const professionalFeesD = dualValue(data.professional_fees);
  const adminPercentResolved = resolveAdminPercent(
    data.admin_expenses_percent,
    resolveAdminPercent(data.administrative_fee_rate, 12)
  );

  const adminApplicableSubtotalRaw = round2(
    items.filter((item) => isItemAdminApplicable(item)).reduce((sum, item) => sum + (Number(item.total_raw) || 0), 0)
  );
  const adminApplicableSubtotal = roundNearest(adminApplicableSubtotalRaw);

  const subtotalBeforeAdminRaw = round2(
    itemsSubtotalRaw + stampDutyD.raw + professionalFeesD.raw
  );
  const subtotalBeforeAdmin = roundNearest(subtotalBeforeAdminRaw);

  const adminExpensesRaw = round2(subtotalBeforeAdminRaw * (adminPercentResolved / 100));
  const adminExpenses = roundNearest(adminExpensesRaw);

  const totalAfterAdminRaw = round2(subtotalBeforeAdminRaw + adminExpensesRaw);
  const totalAfterAdmin = roundNearest(totalAfterAdminRaw);

  // Entity discount applied after administrative expenses
  const discountAmountRaw = discountActive
    ? round2(discountEligibleSubtotalRaw * (discountPercent / 100))
    : 0;
  const discountAmount = roundNearest(discountAmountRaw);

  const netAfterDiscountRaw = round2(totalAfterAdminRaw - discountAmountRaw);
  const netAfterDiscount = roundNearest(netAfterDiscountRaw);

  const balanceD = dualValue(data.balance);
  const finalTotalRaw = round2(netAfterDiscountRaw + balanceD.raw);
  const finalTotal = roundNearest(finalTotalRaw);

  const patientCreditFromItemsRaw = resolvePatientCreditAmount(data);
  const patientCreditFromItems = roundNearest(patientCreditFromItemsRaw);
  const methodPaymentsMerged = mergePatientCreditIntoMethodPayments(data, patientCreditFromItemsRaw);
  const paymentTotals = resolvePaymentTotals({ ...data, method_payments: methodPaymentsMerged });
  const cashPrivateD = dualValue(paymentTotals.cash_private);
  const bankPrivateD = dualValue(paymentTotals.bank_private);
  const cashExternalD = dualValue(paymentTotals.cash_external);
  const bankExternalD = dualValue(paymentTotals.bank_external);

  const totalCollectedRaw = paymentTotals.total_collected_raw;
  const totalCollected = paymentTotals.total_collected;

  const remainingRaw = round2(finalTotalRaw - totalCollectedRaw);
  const remaining = roundNearest(remainingRaw);
  const paymentValidation = validatePaymentBalance({
    final_total_raw: finalTotalRaw,
    final_total: finalTotal,
    total_collected_raw: totalCollectedRaw,
    total_collected: totalCollected,
    remaining_raw: remainingRaw,
    remaining,
  });

  const itemDiscountTotalRaw = round2(
    items
      .filter((item) => item.is_discount_eligible)
      .reduce((sum, item) => sum + (item.item_discount_amount_raw || 0), 0)
  );
  const itemDiscountTotal = roundNearest(itemDiscountTotalRaw);

  const totalsPayload = {
    items,
    stay_entries: stayEntries,
    stay_subtotal: staySubtotal,
    stay_subtotal_raw: staySubtotalRaw,
    manual_items_subtotal: manualItemsSubtotal,
    manual_items_subtotal_raw: manualItemsSubtotalRaw,
    item_discount_total: itemDiscountTotal,
    item_discount_total_raw: itemDiscountTotalRaw,
    payments,
    items_subtotal: itemsSubtotal,
    items_subtotal_raw: itemsSubtotalRaw,
    discount_percent: discountActive ? discountPercent : 0,
    discount_eligible_subtotal: discountEligibleSubtotal,
    discount_eligible_subtotal_raw: discountEligibleSubtotalRaw,
    discount_amount: discountAmount,
    discount_amount_raw: discountAmountRaw,
    items_subtotal_after_discount: netAfterDiscount,
    items_subtotal_after_discount_raw: netAfterDiscountRaw,
    net_after_discount: netAfterDiscount,
    net_after_discount_raw: netAfterDiscountRaw,
    stamp_duty: stampDutyD.rounded,
    stamp_duty_raw: stampDutyD.raw,
    professional_fees: professionalFeesD.rounded,
    professional_fees_raw: professionalFeesD.raw,
    subtotal_before_admin: subtotalBeforeAdmin,
    subtotal_before_admin_raw: subtotalBeforeAdminRaw,
    admin_applicable_subtotal: adminApplicableSubtotal,
    admin_applicable_subtotal_raw: adminApplicableSubtotalRaw,
    admin_expenses_percent: adminPercentResolved,
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
    payment_validation: paymentValidation,
    payments_total: paymentsTotal,
    payments_total_raw: paymentsTotalRaw,
    patient_credit_applied: patientCreditFromItems,
    patient_credit_applied_raw: patientCreditFromItemsRaw,
    method_payments: paymentTotals.method_payments || methodPaymentsMerged,
  };

  totalsPayload.calculation_steps = buildCalculationSteps(totalsPayload);
  totalsPayload.calculation_validation = validateInvoiceCalculations(data, totalsPayload);

  return totalsPayload;
}

function approxEqual(a, b, tolerance = 0.02) {
  return Math.abs(round2(a) - round2(b)) <= tolerance;
}

function buildCalculationSteps(totals) {
  const steps = [
    {
      key: 'manual_items',
      label: 'قيمة البنود',
      raw: totals.manual_items_subtotal_raw,
      rounded: totals.manual_items_subtotal,
    },
  ];

  if (Number(totals.stay_subtotal_raw) > 0) {
    steps.push({
      key: 'stay',
      label: 'تكلفة الإقامة (أيام × سعر)',
      raw: totals.stay_subtotal_raw,
      rounded: totals.stay_subtotal,
    });
  }

  steps.push({
    key: 'items_subtotal',
    label: 'إجمالي البنود والإقامة',
    raw: totals.items_subtotal_raw,
    rounded: totals.items_subtotal,
  });

  if (Number(totals.discount_percent) > 0) {
    steps.push({
      key: 'item_discount_percent',
      label: `نسبة الخصم لكل بند (${totals.discount_percent}%)`,
      raw: totals.discount_percent,
      rounded: totals.discount_percent,
      is_percent: true,
    });
    steps.push({
      key: 'item_discount_total',
      label: 'قيمة الخصم على البنود',
      raw: totals.item_discount_total_raw,
      rounded: totals.item_discount_total,
    });
  }

  if (Number(totals.stamp_duty_raw) > 0 || Number(totals.professional_fees_raw) > 0) {
    steps.push(
      {
        key: 'stamp_duty',
        label: 'دمغة',
        raw: totals.stamp_duty_raw,
        rounded: totals.stamp_duty,
      },
      {
        key: 'professional_fees',
        label: 'مهن',
        raw: totals.professional_fees_raw,
        rounded: totals.professional_fees,
      }
    );
  }

  steps.push(
    {
      key: 'subtotal_before_admin',
      label: 'الإجمالي قبل المصروفات الإدارية',
      raw: totals.subtotal_before_admin_raw,
      rounded: totals.subtotal_before_admin,
    },
    {
      key: 'admin_expenses',
      label: `مصروفات إدارية (${totals.admin_expenses_percent}%)`,
      raw: totals.admin_expenses_raw,
      rounded: totals.admin_expenses,
    },
    {
      key: 'total_after_admin',
      label: 'الإجمالي بعد المصروفات الإدارية',
      raw: totals.total_after_admin_raw,
      rounded: totals.total_after_admin,
    }
  );

  if (Number(totals.discount_amount_raw) > 0) {
    steps.push(
      {
        key: 'entity_discount',
        label: `خصم الجهة المتعاقدة (${totals.discount_percent}%)`,
        raw: totals.discount_amount_raw,
        rounded: totals.discount_amount,
        is_deduction: true,
      },
      {
        key: 'net_after_discount',
        label: 'صافي بعد الخصم',
        raw: totals.net_after_discount_raw,
        rounded: totals.net_after_discount,
      }
    );
  }

  if (Number(totals.balance_raw) !== 0) {
    steps.push({
      key: 'balance',
      label: 'الرصيد',
      raw: totals.balance_raw,
      rounded: totals.balance,
    });
  }

  steps.push({
    key: 'final_total',
    label: 'إجمالي الفاتورة',
    raw: totals.final_total_raw,
    rounded: totals.final_total,
    is_total: true,
  });

  if (Number(totals.total_collected_raw) > 0) {
    steps.push(
      {
        key: 'total_collected',
        label: 'المبلغ المدفوع (طرق الدفع)',
        raw: totals.total_collected_raw,
        rounded: totals.total_collected,
      },
      {
        key: 'remaining',
        label: 'المتبقي',
        raw: totals.remaining_raw,
        rounded: totals.remaining,
        is_remaining: true,
      }
    );
  }

  return steps;
}

function validateInvoiceCalculations(data, totals) {
  const errors = [];
  const warnings = [];

  for (const item of totals.items || []) {
    if (item.is_stay_entry) continue;
    if (!item.description && !item.quantity && !item.amount) continue;
    const expected = round2((Number(item.quantity) || 0) * (Number(item.amount) || 0));
    if (!approxEqual(expected, item.total_raw)) {
      errors.push(
        `بند "${item.description || '—'}": ${item.quantity} × ${item.amount} = ${expected} ≠ ${item.total_raw}`
      );
    }
  }

  for (const entry of totals.stay_entries || []) {
    const expected = round2((Number(entry.days) || 0) * (Number(entry.daily_rate) || 0));
    if (!approxEqual(expected, entry.total_raw)) {
      errors.push(
        `إقامة "${entry.stay_type_name || '—'}": ${entry.days} يوم × ${entry.daily_rate} ≠ ${entry.total_raw}`
      );
    }
  }

  if (
    !approxEqual(
      (totals.manual_items_subtotal_raw || 0) + (totals.stay_subtotal_raw || 0),
      totals.items_subtotal_raw
    )
  ) {
    errors.push('خطأ: إجمالي البنود + الإقامة ≠ إجمالي البنود الكلي');
  }

  const expectedSubtotalBeforeAdmin = round2(
    (totals.items_subtotal_raw || 0) +
      (totals.stamp_duty_raw || 0) +
      (totals.professional_fees_raw || 0)
  );
  if (!approxEqual(expectedSubtotalBeforeAdmin, totals.subtotal_before_admin_raw)) {
    errors.push('خطأ: الإجمالي قبل المصروفات الإدارية غير صحيح');
  }

  const expectedAdmin = round2(
    (totals.subtotal_before_admin_raw || 0) * (resolveAdminPercent(totals.admin_expenses_percent, 12) / 100)
  );
  if (!approxEqual(expectedAdmin, totals.admin_expenses_raw)) {
    errors.push('خطأ: المصروفات الإدارية غير صحيحة');
  }

  const expectedAfterAdmin = round2(
    (totals.subtotal_before_admin_raw || 0) + (totals.admin_expenses_raw || 0)
  );
  if (!approxEqual(expectedAfterAdmin, totals.total_after_admin_raw)) {
    errors.push('خطأ: الإجمالي بعد المصروفات الإدارية غير صحيح');
  }

  if (Number(totals.discount_amount_raw) > 0) {
    const expectedDiscount = round2(
      (totals.discount_eligible_subtotal_raw || 0) * ((Number(totals.discount_percent) || 0) / 100)
    );
    if (!approxEqual(expectedDiscount, totals.discount_amount_raw)) {
      errors.push('خطأ: قيمة خصم الجهة المتعاقدة غير صحيحة');
    }

    const expectedNet = round2((totals.total_after_admin_raw || 0) - (totals.discount_amount_raw || 0));
    if (!approxEqual(expectedNet, totals.net_after_discount_raw)) {
      errors.push('خطأ: صافي بعد الخصم غير صحيح');
    }
  }

  const expectedFinal = round2((totals.net_after_discount_raw || 0) + (totals.balance_raw || 0));
  if (!approxEqual(expectedFinal, totals.final_total_raw)) {
    errors.push('خطأ: إجمالي الفاتورة النهائي غير صحيح');
  }

  const expectedRemaining = round2((totals.final_total_raw || 0) - (totals.total_collected_raw || 0));
  if (!approxEqual(expectedRemaining, totals.remaining_raw)) {
    errors.push('خطأ: المبلغ المتبقي غير صحيح');
  }

  if (Number(totals.discount_amount_raw) > 0 && Number(totals.item_discount_total_raw) > 0) {
    if (!approxEqual(totals.item_discount_total_raw, totals.discount_amount_raw, 0.05)) {
      warnings.push('تنبيه: مجموع خصم البنود التفصيلي يختلف قليلاً عن خصم الجهة (بسبب التقريب)');
    }
  }

  const paymentValidation = totals.payment_validation || validatePaymentBalance(totals);
  if (paymentValidation.has_payments && !paymentValidation.is_balanced) {
    warnings.push('تنبيه: مجموع طرق الدفع لا يساوي إجمالي الفاتورة');
  }

  return {
    is_valid: errors.length === 0,
    errors,
    warnings,
    checks_passed: errors.length === 0,
  };
}

function validatePaymentBalance(totals) {
  const finalRaw = round2(totals.final_total_raw ?? totals.final_total ?? 0);
  const collectedRaw = round2(totals.total_collected_raw ?? totals.total_collected ?? 0);
  const differenceRaw = round2(collectedRaw - finalRaw);
  const difference = roundNearest(differenceRaw);
  const hasPayments = collectedRaw > 0;

  let status = 'none';
  if (hasPayments) {
    if (Math.abs(differenceRaw) < 0.01) status = 'balanced';
    else if (differenceRaw > 0) status = 'overpaid';
    else status = 'underpaid';
  }

  return {
    status,
    is_balanced: status === 'balanced' || (!hasPayments && finalRaw === 0),
    has_payments: hasPayments,
    difference,
    difference_raw: differenceRaw,
    final_total: roundNearest(finalRaw),
    final_total_raw: finalRaw,
    total_collected: roundNearest(collectedRaw),
    total_collected_raw: collectedRaw,
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
  calculateStayEntries,
  calculateInvoiceTotals,
  calculateStayDays,
  validatePaymentBalance,
  validateInvoiceCalculations,
  buildCalculationSteps,
  formatDual,
  matchesExclusion,
};
