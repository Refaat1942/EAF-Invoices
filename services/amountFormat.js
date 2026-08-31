/**
 * Arabic (ar-EG) accounting display: grouped digits, no trailing fractional zeros.
 */
function formatAmountAr(n, maxDecimals = 2) {
  const num = Number(n) || 0;
  const grouping = { useGrouping: true };
  if (maxDecimals === 0) {
    return Math.round(num).toLocaleString('ar-EG', { ...grouping, maximumFractionDigits: 0 });
  }
  return num.toLocaleString('ar-EG', {
    ...grouping,
    minimumFractionDigits: 0,
    maximumFractionDigits: maxDecimals,
  });
}

module.exports = { formatAmountAr };
