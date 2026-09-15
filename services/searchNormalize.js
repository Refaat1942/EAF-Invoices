function normalizeSearchText(value) {
  return String(value || '')
    .trim()
    .replace(/\u0640/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/\s+/g, ' ');
}

function buildSearchPattern(search) {
  const raw = String(search || '').trim().replace(/%/g, '');
  if (!raw) return '';
  const normalized = normalizeSearchText(raw);
  return normalized || raw;
}

function sqlNormalizeArabic(columnExpr) {
  return `REPLACE(REPLACE(REPLACE(REPLACE(LOWER(${columnExpr}), 'أ', 'ا'), 'إ', 'ا'), 'آ', 'ا'), 'ى', 'ي')`;
}

module.exports = {
  normalizeSearchText,
  buildSearchPattern,
  sqlNormalizeArabic,
};
