const FOREIGN_PRICE_MULTIPLIER = 2;

function normalizeNationalityText(nationality) {
  return String(nationality || '')
    .trim()
    .toLowerCase()
    .replace(/[أإآ]/g, 'ا')
    .replace(/ى/g, 'ي');
}

function isEgyptianNationality(nationality) {
  const n = normalizeNationalityText(nationality);
  if (!n) return true;
  const foreignHints = ['اجنبي', 'أجنبي', 'foreign', 'foreigner'];
  if (foreignHints.some((hint) => n.includes(hint))) return false;
  const egyptianHints = [
    'مصر',
    'مصري',
    'مصرى',
    'egypt',
    'egyptian',
    'eg',
    'جمهورية مصر',
  ];
  return egyptianHints.some((hint) => n.includes(hint));
}

function getNationalityPriceMultiplier(nationality) {
  return isEgyptianNationality(nationality) ? 1 : FOREIGN_PRICE_MULTIPLIER;
}

function getNationalityLabel(nationality) {
  const raw = String(nationality || '').trim();
  if (!raw) return 'مصري (افتراضي)';
  if (isEgyptianNationality(raw)) return raw || 'مصري';
  return raw;
}

function getPricePathLabel(nationality) {
  return isEgyptianNationality(nationality)
    ? 'أسعار اللائحة'
    : `أجنبي (×${FOREIGN_PRICE_MULTIPLIER})`;
}

function applyNationalityToAmount(amount, nationality) {
  const base = Number(amount) || 0;
  const mult = getNationalityPriceMultiplier(nationality);
  return Math.round(base * mult * 100) / 100;
}

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

module.exports = {
  FOREIGN_PRICE_MULTIPLIER,
  isEgyptianNationality,
  getNationalityPriceMultiplier,
  getNationalityLabel,
  getPricePathLabel,
  applyNationalityToAmount,
  round2,
};
