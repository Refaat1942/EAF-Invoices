const JSZip = require('jszip');
const fs = require('fs');
const { XMLParser } = require('fast-xml-parser');

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  removeNSPrefix: true,
  trimValues: true,
});

function collectText(node) {
  if (node == null) return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(collectText).join(' ').trim();
  if (node.t) {
    if (Array.isArray(node.t)) return node.t.map(collectText).join(' ').trim();
    return collectText(node.t);
  }
  if (node.r) {
    if (Array.isArray(node.r)) return node.r.map(collectText).join(' ').trim();
    return collectText(node.r);
  }
  return '';
}

function extractTables(documentXml) {
  const doc = parser.parse(documentXml);
  const body = doc?.document?.body;
  if (!body) return [];

  const tables = [];
  const rawTables = body.tbl ? (Array.isArray(body.tbl) ? body.tbl : [body.tbl]) : [];
  for (const tbl of rawTables) {
    const rows = [];
    const rawRows = tbl.tr ? (Array.isArray(tbl.tr) ? tbl.tr : [tbl.tr]) : [];
    for (const tr of rawRows) {
      const cells = [];
      const rawCells = tr.tc ? (Array.isArray(tr.tc) ? tr.tc : [tr.tc]) : [];
      for (const tc of rawCells) {
        cells.push(collectText(tc).replace(/\s+/g, ' ').trim());
      }
      if (cells.some(Boolean)) rows.push(cells);
    }
    if (rows.length) tables.push(rows);
  }
  return tables;
}

function slugCode(text, prefix = 'SRV') {
  const base = String(text || '')
    .trim()
    .replace(/[^\u0600-\u06FFa-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .toUpperCase();
  return `${prefix}-${base || 'ITEM'}`;
}

function parsePrice(value) {
  const cleaned = String(value || '')
    .replace(/[^\d.,]/g, '')
    .replace(/,/g, '');
  const num = Number(cleaned);
  return Number.isFinite(num) ? num : null;
}

function detectUnit(text) {
  const value = String(text || '');
  const rules = [
    ['24 ساعة', '24 ساعة'],
    ['18 ساعة', '18 ساعة'],
    ['12 ساعة', '12 ساعة'],
    ['6 ساعات', '6 ساعات'],
    ['6 ساعة', '6 ساعات'],
    ['نصف ساعة', 'نصف ساعة'],
    ['15 دقيقة', '15 دقيقة'],
    ['/j', 'يوم'],
    ['/يوم', 'يوم'],
    ['/س', 'ساعة'],
    ['/ساعة', 'ساعة'],
    ['/ج', 'جلسة'],
    ['/جلسة', 'جلسة'],
    ['/ك', 'كشف'],
    ['/كشف', 'كشف'],
    ['/م', 'مرة'],
    ['/مرة', 'مرة'],
    ['يوم', 'يوم'],
    ['ساعة', 'ساعة'],
    ['جلسة', 'جلسة'],
    ['كشف', 'كشف'],
    ['جزئين', 'جزئين'],
    ['جزء', 'جزء'],
    ['مستوى', 'مستوى'],
  ];
  for (const [needle, unit] of rules) {
    if (value.includes(needle)) return unit;
  }
  return 'مرة';
}

function isNonDiscountable(name) {
  const text = String(name || '');
  const patterns = [
    'أتعاب',
    'أجر الطبيب',
    'أجر التخدير',
    'الأدوية',
    'المستلزمات',
    'الدمغ',
    'بنك الدم',
    'مكافحة العدوى',
    'التغذية العلاجية',
    'فصل البلازما',
    'اتفاقيات شاملة',
    'مرافق',
    'فرق الدرجة',
  ];
  return patterns.some((p) => text.includes(p));
}

function isNonAdminApplicable(name) {
  const text = String(name || '');
  const patterns = ['الأدوية', 'المستلزمات', 'الدمغ', 'أتعاب', 'أجر الطبيب', 'أجر التخدير', 'بنك الدم'];
  return patterns.some((p) => text.includes(p));
}

function mapTablesToPayload(tables, meta = {}) {
  const categories = [];
  const services = [];
  let currentCategory = null;
  let sortCategory = 0;
  let sortService = 0;
  const usedCodes = new Set();

  const ensureCategory = (name) => {
    const trimmed = String(name || '').trim();
    if (!trimmed) return currentCategory;
    if (currentCategory && currentCategory.name === trimmed) return currentCategory;
    sortCategory += 1;
    const code = slugCode(trimmed, 'CAT');
    currentCategory = {
      code,
      name: trimmed,
      sort_order: sortCategory,
    };
    categories.push(currentCategory);
    return currentCategory;
  };

  for (const table of tables) {
    for (const row of table) {
      if (!row.length) continue;
      const joined = row.join(' ').trim();
      if (!joined) continue;

      const lower = joined.toLowerCase();
      if (row.length === 1 || (row.length <= 2 && !parsePrice(row[row.length - 1]))) {
        if (joined.length >= 4 && joined.length <= 120) {
          ensureCategory(joined);
        }
        continue;
      }

      let name = '';
      let priceCell = '';
      if (row.length >= 2) {
        name = row[0];
        priceCell = row[row.length - 1];
        if (!parsePrice(priceCell) && row.length >= 3) {
          name = row.slice(0, -1).join(' - ');
          priceCell = row[row.length - 1];
        }
      } else {
        continue;
      }

      name = String(name || '').trim();
      const price = parsePrice(priceCell);
      if (!name || price == null) {
        if (name.length >= 4 && name.length <= 120 && !/\d/.test(name)) ensureCategory(name);
        continue;
      }

      if (!currentCategory) {
        ensureCategory(meta.default_category || 'خدمات اللائحة');
      }

      let code = slugCode(`${currentCategory.code}-${name}`);
      let suffix = 1;
      while (usedCodes.has(code)) {
        suffix += 1;
        code = `${slugCode(`${currentCategory.code}-${name}`)}-${suffix}`;
      }
      usedCodes.add(code);
      sortService += 1;

      const variable = /متغير\s*السعر/i.test(joined);
      services.push({
        category_code: currentCategory.code,
        code,
        name,
        unit: detectUnit(joined),
        price,
        price_type: variable ? 'variable' : 'fixed',
        variable_price_note: variable ? 'متغير السعر' : '',
        discountable: !isNonDiscountable(name),
        administrative_fee_applicable: !isNonAdminApplicable(name),
        sort_order: sortService,
      });
    }
  }

  return {
    price_list: {
      name: meta.name || 'لائحة 2026-2027',
      code: meta.code || 'PL-2026-2027',
      fiscal_year_start: 2026,
      fiscal_year_end: 2027,
      effective_from: '2026-07-01',
      effective_to: '2027-06-30',
      notes: meta.notes || 'مستوردة من ملف DOCX',
    },
    categories,
    services,
  };
}

async function parseDocxPriceList(filePath, meta = {}) {
  const buffer = fs.readFileSync(filePath);
  const zip = await JSZip.loadAsync(buffer);
  const docFile = zip.file('word/document.xml');
  if (!docFile) throw new Error('ملف DOCX غير صالح');
  const documentXml = await docFile.async('string');
  const tables = extractTables(documentXml);
  if (!tables.length) throw new Error('لم يتم العثور على جداول في ملف DOCX');
  return mapTablesToPayload(tables, meta);
}

module.exports = {
  parseDocxPriceList,
  mapTablesToPayload,
  extractTables,
};
