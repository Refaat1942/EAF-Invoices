/**
 * Foreign nationality pricing: list prices × 2 on operational screens.
 * Mirrors services/nationalityPricing.js
 */
(function () {
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
    return n.includes('مصر') || /\begypt/.test(n) || n === 'eg';
  }

  function getNationalityPriceMultiplier(nationality) {
    return isEgyptianNationality(nationality) ? 1 : FOREIGN_PRICE_MULTIPLIER;
  }

  function getPatientNationality() {
    const fromDaily = document.getElementById('daily-stay-nationality')?.value;
    const fromReg = document.getElementById('patient-reg-nationality')?.value;
    const fromInvoice = document.getElementById('invoice-patient-nationality')?.value;
    const fromContext =
      typeof dailyStayContext !== 'undefined' && dailyStayContext?.patient?.nationality
        ? dailyStayContext.patient.nationality
        : '';
    const raw = fromDaily || fromContext || fromReg || fromInvoice || '';
    if (typeof normalizeNationalitySelectValue === 'function') {
      return normalizeNationalitySelectValue(raw);
    }
    return raw || 'مصري';
  }

  function round2(n) {
    return Math.round((Number(n) || 0) * 100) / 100;
  }

  function toDisplayPrice(listAmount, nationality) {
    const base = Number(listAmount) || 0;
    if (base <= 0) return 0;
    return round2(base * getNationalityPriceMultiplier(nationality ?? getPatientNationality()));
  }

  function toListPrice(displayAmount, nationality) {
    const shown = Number(displayAmount) || 0;
    if (shown <= 0) return 0;
    const mult = getNationalityPriceMultiplier(nationality ?? getPatientNationality());
    if (mult <= 1) return round2(shown);
    return round2(shown / mult);
  }

  function getPricePathLabel(nationality) {
    return isEgyptianNationality(nationality ?? getPatientNationality())
      ? 'أسعار اللائحة'
      : `أجنبي (×${FOREIGN_PRICE_MULTIPLIER})`;
  }

  window.NationalityPricing = {
    FOREIGN_PRICE_MULTIPLIER,
    normalizeNationalityText,
    isEgyptianNationality,
    getNationalityPriceMultiplier,
    getPatientNationality,
    toDisplayPrice,
    toListPrice,
    getPricePathLabel,
  };
})();
