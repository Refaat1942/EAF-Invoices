/**
 * تفقيط: an amount in Egyptian pounds written in Arabic words, as printed under the total
 * of an invoice — «فقط اثنا عشر ألفًا وثلاثمائة وخمسة وثمانون جنيهًا وواحد وعشرون قرشًا لا غير».
 */
const ONES = ['', 'واحد', 'اثنان', 'ثلاثة', 'أربعة', 'خمسة', 'ستة', 'سبعة', 'ثمانية', 'تسعة'];
const TEENS = [
  'عشرة',
  'أحد عشر',
  'اثنا عشر',
  'ثلاثة عشر',
  'أربعة عشر',
  'خمسة عشر',
  'ستة عشر',
  'سبعة عشر',
  'ثمانية عشر',
  'تسعة عشر',
];
const TENS = ['', '', 'عشرون', 'ثلاثون', 'أربعون', 'خمسون', 'ستون', 'سبعون', 'ثمانون', 'تسعون'];
const HUNDREDS = ['', 'مائة', 'مائتان', 'ثلاثمائة', 'أربعمائة', 'خمسمائة', 'ستمائة', 'سبعمائة', 'ثمانمائة', 'تسعمائة'];

// [singular, dual, plural (3–10), accusative (11–99)]
const SCALES = [
  null,
  ['ألف', 'ألفان', 'آلاف', 'ألفًا'],
  ['مليون', 'مليونان', 'ملايين', 'مليونًا'],
  ['مليار', 'ملياران', 'مليارات', 'مليارًا'],
];

/** 1–999 in words. `beforeNoun`: «مائتان» becomes «مائتا» before a counted word. */
function belowThousand(n, beforeNoun = false) {
  const h = Math.floor(n / 100);
  const rest = n % 100;
  const parts = [];
  if (h) parts.push(h === 2 && !rest && beforeNoun ? 'مائتا' : HUNDREDS[h]);
  if (rest) {
    if (rest < 10) parts.push(ONES[rest]);
    else if (rest < 20) parts.push(TEENS[rest - 10]);
    else {
      const o = rest % 10;
      const t = Math.floor(rest / 10);
      parts.push(o ? `${ONES[o]} و${TENS[t]}` : TENS[t]);
    }
  }
  return parts.join(' و');
}

/** A counted noun after a number: «جنيه واحد / جنيهان / ثلاثة جنيهات / أحد عشر جنيهًا / مائة جنيه». */
function countedNoun(n, [singular, dual, plural, accusative]) {
  const r = n % 100;
  if (n === 1) return `${singular} واحد`;
  if (n === 2) return dual;
  if (r >= 3 && r <= 10) return `${integerWords(n, true)} ${plural}`;
  if (r >= 11) return `${integerWords(n, true)} ${accusative}`;
  return `${integerWords(n, true)} ${singular}`;
}

/** A whole number in words (0 → «صفر»). */
function integerWords(value, beforeNoun = false) {
  let n = Math.floor(Math.abs(Number(value) || 0));
  if (!n) return 'صفر';
  const groups = [];
  while (n > 0) {
    groups.push(n % 1000);
    n = Math.floor(n / 1000);
  }
  const lowest = groups.findIndex((g) => g > 0);
  const parts = [];
  for (let i = groups.length - 1; i >= 0; i -= 1) {
    const g = groups[i];
    if (!g) continue;
    // Directly before the counted noun: «ألفا جنيه», «أحد عشر ألف جنيه».
    const construct = beforeNoun && i === lowest;
    if (i === 0) {
      parts.push(belowThousand(g, beforeNoun));
      continue;
    }
    const [singular, dual, plural, accusative] = SCALES[i] || SCALES[SCALES.length - 1];
    const r = g % 100;
    if (g === 1) parts.push(singular);
    else if (g === 2) parts.push(construct ? `${singular}ا` : dual);
    else if (r >= 3 && r <= 10) parts.push(`${belowThousand(g, true)} ${plural}`);
    else if (r >= 11) parts.push(`${belowThousand(g, true)} ${construct ? singular : accusative}`);
    else parts.push(`${belowThousand(g, true)} ${singular}`);
  }
  return parts.join(' و');
}

const POUND = ['جنيه', 'جنيهان', 'جنيهات', 'جنيهًا'];
const PIASTRE = ['قرش', 'قرشان', 'قروش', 'قرشًا'];

/** «فقط ... جنيهًا و... قرشًا لا غير» for an amount in pounds (two decimals). */
function amountInArabicWords(amount) {
  const value = Math.round(Math.abs(Number(amount) || 0) * 100);
  const pounds = Math.floor(value / 100);
  const piastres = value % 100;
  const parts = [];
  if (pounds) parts.push(countedNoun(pounds, POUND));
  if (piastres) parts.push(countedNoun(piastres, PIASTRE));
  if (!parts.length) parts.push('صفر جنيه');
  return `فقط ${parts.join(' و')} لا غير`;
}

module.exports = { amountInArabicWords, integerWords };
