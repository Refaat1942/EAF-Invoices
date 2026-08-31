/**
 * Accounting display: Western digits (0-9), thousands comma, no trailing fractional zeros.
 */
const AMOUNT_LOCALE = 'ar-EG-u-nu-latn';

function formatAmountAr(n, maxDecimals = 2) {
  const num = Number(n) || 0;
  const grouping = { useGrouping: true };
  if (maxDecimals === 0) {
    return Math.round(num).toLocaleString(AMOUNT_LOCALE, { ...grouping, maximumFractionDigits: 0 });
  }
  return num.toLocaleString(AMOUNT_LOCALE, {
    ...grouping,
    minimumFractionDigits: 0,
    maximumFractionDigits: maxDecimals,
  });
}

module.exports = { formatAmountAr, AMOUNT_LOCALE };
