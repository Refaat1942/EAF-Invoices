const JSZip = require('jszip');
const fs = require('fs');
const { XMLParser } = require('fast-xml-parser');

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  removeNSPrefix: true,
  trimValues: true,
  processEntities: true,
});

function collectText(node) {
  if (node == null) return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(collectText).filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();

  if (node.t) {
    if (Array.isArray(node.t)) return node.t.map(collectText).join('').trim();
    return collectText(node.t);
  }
  if (node.r) {
    if (Array.isArray(node.r)) return node.r.map(collectText).filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
    return collectText(node.r);
  }
  if (node.p) {
    const ps = Array.isArray(node.p) ? node.p : [node.p];
    return ps.map(collectText).filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
  }

  if (typeof node === 'object') {
    return Object.keys(node)
      .filter((k) => !k.startsWith('@_'))
      .map((k) => collectText(node[k]))
      .filter(Boolean)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
  }
  return '';
}

function collectNodesByTag(node, tag, found = []) {
  if (node == null) return found;
  if (Array.isArray(node)) {
    node.forEach((item) => collectNodesByTag(item, tag, found));
    return found;
  }
  if (typeof node !== 'object') return found;
  if (node[tag]) {
    const items = Array.isArray(node[tag]) ? node[tag] : [node[tag]];
    found.push(...items);
  }
  for (const key of Object.keys(node)) {
    if (key.startsWith('@_') || key === tag) continue;
    collectNodesByTag(node[key], tag, found);
  }
  return found;
}

function extractTables(documentXml) {
  const doc = parser.parse(documentXml);
  const rawTables = collectNodesByTag(doc, 'tbl');
  const tables = [];

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

function extractParagraphLines(documentXml) {
  const doc = parser.parse(documentXml);
  const paragraphs = collectNodesByTag(doc, 'p');
  return paragraphs.map((p) => collectText(p).replace(/\s+/g, ' ').trim()).filter(Boolean);
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

function isRowNumber(value) {
  return /^\d+$/.test(String(value || '').trim());
}

function parsePrice(value) {
  const str = String(value || '').trim();
  if (!str) return null;
  const match = str.match(/(\d[\d\s,.]*)/);
  if (!match) return null;
  const cleaned = match[1].replace(/\s/g, '').replace(/,/g, '');
  const num = Number(cleaned);
  return Number.isFinite(num) && num > 0 ? num : null;
}

function parsePriceFromLine(line) {
  const direct = parsePrice(line);
  if (direct != null && /^\d/.test(String(line).trim())) return direct;

  const patterns = [
    /(\d[\d,.]*)\s*(?:جنيه|ج\.?\s*m?|EGP)?\s*$/i,
    /(\d[\d,.]*)\s*$/,
  ];
  for (const pattern of patterns) {
    const match = String(line).match(pattern);
    if (match) {
      const price = parsePrice(match[1]);
      if (price != null) return price;
    }
  }
  return null;
}

function extractNameFromLine(line, price) {
  let name = String(line || '').trim();
  if (price != null) {
    name = name.replace(new RegExp(`\\s*${price}[\\s\\d,.]*(?:جنيه|ج\\.?m?|EGP)?\\s*$`, 'i'), '').trim();
    name = name.replace(/\s*[-–—:]\s*$/, '').trim();
  }
  return name;
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
    ['/يوم', 'يوم'],
    ['للساعة', 'ساعة'],
    ['/ساعة', 'ساعة'],
    ['/جلسة', 'جلسة'],
    ['/كشف', 'كشف'],
    ['يوم', 'يوم'],
    ['ساعة', 'ساعة'],
    ['جلسة', 'جلسة'],
    ['كشف', 'كشف'],
    ['جزئين', 'جزئين'],
    ['جزء', 'جزء'],
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
    'أجر الجراح',
    'أجر المساعد',
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
    'لا يخضع للخصم',
  ];
  return patterns.some((p) => text.includes(p));
}

function isNonAdminApplicable(name) {
  const text = String(name || '');
  const patterns = ['الأدوية', 'المستلزمات', 'الدمغ', 'أتعاب', 'أجر الطبيب', 'أجر التخدير', 'بنك الدم'];
  return patterns.some((p) => text.includes(p));
}

function isTableOfContents(table) {
  if (!table || table.length < 8) return false;
  let matches = 0;
  let maxThirdCol = 0;
  for (const row of table.slice(0, 15)) {
    if (row.length === 3 && isRowNumber(row[0]) && isRowNumber(row[2]) && row[1].length > 8) {
      matches += 1;
      maxThirdCol = Math.max(maxThirdCol, Number(row[2]));
    }
  }
  // فهرس المحتويات يستخدم أرقام صفحات صغيرة (≤100) وليس أسعاراً بالجنيه
  if (matches < 6 || maxThirdCol > 100) return false;
  const firstTopic = table[0] && table[0][1] ? String(table[0][1]) : '';
  return /القواعد العامة|مصنع|الكشوفات|الإقامات|قسم/i.test(firstTopic);
}

function isRulesTable(table) {
  if (!table || !table.length) return true;
  if (table.length === 1 && table[0].length === 1) return true;
  if (isTableOfContents(table)) return true;

  let ruleRows = 0;
  for (const row of table) {
    if (row.length === 2 && isRowNumber(row[0]) && row[1].length > 80) {
      ruleRows += 1;
    }
  }
  if (ruleRows >= Math.max(3, table.length * 0.6)) return true;

  const first = table[0] || [];
  if (first.length === 2 && isRowNumber(first[0]) && first[1].length > 120) return true;
  return false;
}

function isHeaderRow(row) {
  if (!row || !row.length) return false;
  const joined = row.join(' ');
  if (row[0] === 'م') return true;
  if (row.includes('البيان') && /أجر|إجمال|فتح العمليات|مستهلكات/i.test(joined)) return true;
  if (/السعر\s*بال/i.test(joined)) return true;
  return false;
}

function findHeaderRow(table) {
  for (let i = 0; i < Math.min(table.length, 3); i += 1) {
    if (isHeaderRow(table[i])) return { index: i, row: table[i] };
  }
  return null;
}

function getPriceColumnIndex(headerRow, row) {
  if (headerRow) {
    const totalIdx = headerRow.findIndex((cell) => /إجمال/i.test(cell));
    if (totalIdx >= 0) return totalIdx;
    const priceIdx = headerRow.findIndex((cell) => /السعر/i.test(cell));
    if (priceIdx >= 0) return priceIdx;
  }
  return row.length - 1;
}

function getNameStartIndex(row, headerRow) {
  if (headerRow) {
    const statementIdx = headerRow.findIndex((cell) => cell === 'البيان' || /البيان/.test(cell));
    if (statementIdx >= 0) return statementIdx;
  }
  if (isRowNumber(row[0]) || row[0] === '') return 1;
  return 0;
}

function normalizeCategoryName(name) {
  let value = String(name || '').trim();
  if (!value) return null;
  value = value.replace(/^\d+\s*[-–:.]\s*/, '');
  value = value.replace(/\s*[:-]\s*الاسم\s*$/i, '').trim();
  value = value.replace(/\s+نوع\s*الخدمة\s*$/i, '').trim();
  if (/^(البيان|نوع الخدمة|الخدمة|م)$/i.test(value)) return null;
  return value || null;
}

function getCategoryFromHeader(headerRow) {
  if (!headerRow) return null;
  const preferred = [
    'البيان',
    'قيمة الكشف',
    'درجة الإقامة',
    'نوع الخدمة',
    'نوع الجلسة',
    'الجلسة',
    'قسم التقييم',
    'قسم',
  ];
  for (const label of preferred) {
    const cell = headerRow.find((c) => c && c.includes(label));
    if (cell && cell !== 'م') return normalizeCategoryName(cell.replace(/\s*\/\s*.*$/, '').trim()) || cell.replace(/\s*\/\s*.*$/, '').trim();
  }
  for (const cell of headerRow) {
    if (!cell || cell === 'م' || /السعر|إجمال|أجر|فتح|مستهلكات|أدوية/i.test(cell)) continue;
    if (cell.length > 2) return normalizeCategoryName(cell) || cell;
  }
  return null;
}

function buildServiceName(row, headerRow, priceColIdx) {
  const start = getNameStartIndex(row, headerRow);
  const parts = [];
  for (let i = start; i < priceColIdx; i += 1) {
    const cell = String(row[i] || '').trim();
    if (!cell || cell === 'م') continue;
    if (isRowNumber(cell) && i === 0) continue;
    parts.push(cell);
  }
  return parts.join(' - ').replace(/\s+/g, ' ').trim();
}

function isLikelyPercentageTable(table, headerRow) {
  const headerText = (headerRow || []).join(' ');
  if (!/درجة\s*الإقامة/i.test(headerText)) return false;
  const prices = [];
  for (const row of table.slice(1)) {
    const price = parsePrice(row[row.length - 1]);
    if (price != null) prices.push(price);
  }
  if (!prices.length) return false;
  return prices.every((p) => p <= 20);
}

function isContinuationPriceTable(table) {
  if (!table.length) return false;
  const row = table[0];
  if (row.length === 3 && isRowNumber(row[0]) && row[1].length > 4 && parsePrice(row[2]) != null) {
    return true;
  }
  if (row.length >= 4 && isRowNumber(row[0]) && row[1].length > 4) {
    const lastPrice = parsePrice(row[row.length - 1]);
    if (lastPrice != null && lastPrice >= 50) return true;
  }
  return false;
}

function isPriceTable(table) {
  if (!table || !table.length || isRulesTable(table)) return false;
  const header = findHeaderRow(table);
  if (header) {
    if (isLikelyPercentageTable(table, header.row)) return false;
    return true;
  }
  return isContinuationPriceTable(table);
}

function extractTocCategories(table) {
  const map = new Map();
  if (!isTableOfContents(table)) return map;
  for (const row of table) {
    if (row.length >= 2 && isRowNumber(row[0])) {
      map.set(Number(row[0]), row[1].trim());
    }
  }
  return map;
}

function isSectionHeadingTable(table) {
  if (!table || table.length !== 1) return false;
  const row = table[0];
  if (!row || row.length !== 1) return false;
  const text = String(row[0] || '').trim();
  if (text.length < 4) return false;
  if (parsePrice(text) != null) return false;
  if (/^\d+$/.test(text)) return false;
  return true;
}

function extractSectionHeading(table) {
  if (!isSectionHeadingTable(table)) return null;
  return normalizeCategoryName(table[0][0]) || String(table[0][0] || '').trim();
}

function addServiceFromRow({ name, price, joined, currentCategory, services, usedCodes, sortServiceRef }) {
  const trimmedName = String(name || '').trim();
  if (!trimmedName || price == null || trimmedName.length < 3) return sortServiceRef.value;
  if (/^\d+$/.test(trimmedName)) return sortServiceRef.value;

  if (!currentCategory.current) {
    currentCategory.current = {
      code: slugCode('خدمات اللائحة', 'CAT'),
      name: 'خدمات اللائحة',
      sort_order: 1,
    };
  }

  let code = slugCode(`${currentCategory.current.code}-${trimmedName}`);
  let suffix = 1;
  while (usedCodes.has(code)) {
    suffix += 1;
    code = `${slugCode(`${currentCategory.current.code}-${trimmedName}`)}-${suffix}`;
  }
  usedCodes.add(code);
  sortServiceRef.value += 1;

  const variable = /متغير\s*السعر/i.test(joined || trimmedName);
  services.push({
    category_code: currentCategory.current.code,
    code,
    name: trimmedName,
    unit: detectUnit(joined || trimmedName),
    price,
    price_type: variable ? 'variable' : 'fixed',
    variable_price_note: variable ? 'متغير السعر' : '',
    discountable: !isNonDiscountable(trimmedName),
    administrative_fee_applicable: !isNonAdminApplicable(trimmedName),
    sort_order: sortServiceRef.value,
    import_chapter: currentCategory.current.import_chapter || null,
  });
  return sortServiceRef.value;
}

function ensureCategory(name, categories, usedCategoryCodes, sortCategoryRef, currentCategoryRef) {
  const categoryName = String(name || 'خدمات اللائحة').trim() || 'خدمات اللائحة';
  if (currentCategoryRef.current && currentCategoryRef.current.name === categoryName) {
    return currentCategoryRef.current;
  }

  sortCategoryRef.value += 1;
  let code = slugCode(categoryName, 'CAT');
  let suffix = 1;
  while (usedCategoryCodes.has(code)) {
    suffix += 1;
    code = `${slugCode(categoryName, 'CAT')}-${suffix}`;
  }
  usedCategoryCodes.add(code);

  currentCategoryRef.current = {
    code,
    name: categoryName,
    sort_order: sortCategoryRef.value,
    import_chapter: currentCategoryRef.current?.import_chapter || null,
  };
  categories.push(currentCategoryRef.current);
  return currentCategoryRef.current;
}

function parsePriceTableRows(table, context, categories, services, usedCodes, usedCategoryCodes, sortCategoryRef, sortServiceRef, currentCategoryRef) {
  const headerInfo = findHeaderRow(table);
  const headerRow = headerInfo ? headerInfo.row : context.lastHeaderRow;
  const dataStart = headerInfo ? headerInfo.index + 1 : 0;

  let categoryName = headerInfo ? getCategoryFromHeader(headerRow) : null;
  if (!categoryName) categoryName = context.lastNamedCategory || context.lastCategoryName;
  if (!categoryName) categoryName = 'خدمات اللائحة';
  if (categoryName && !/^(البيان|نوع الخدمة|الخدمة)$/i.test(categoryName)) {
    context.lastNamedCategory = categoryName;
  }

  ensureCategory(categoryName, categories, usedCategoryCodes, sortCategoryRef, currentCategoryRef);
  if (currentCategoryRef.current) {
    currentCategoryRef.current.import_chapter = context.activeChapterName || currentCategoryRef.current.import_chapter;
  }
  context.lastCategoryName = categoryName;
  context.lastHeaderRow = headerRow;

  for (let i = dataStart; i < table.length; i += 1) {
    const row = table[i];
    if (!row || !row.length || isHeaderRow(row)) continue;

    const priceColIdx = getPriceColumnIndex(headerRow, row);
    const price = parsePrice(row[priceColIdx]);
    if (price == null) continue;

    const name = buildServiceName(row, headerRow, priceColIdx);
    if (!name || name.length < 3) continue;

    addServiceFromRow({
      name,
      price,
      joined: row.join(' '),
      currentCategory: currentCategoryRef,
      services,
      usedCodes,
      sortServiceRef,
    });
  }
}

function mapTablesToPayload(tables, meta = {}) {
  const categories = [];
  const services = [];
  const usedCodes = new Set();
  const usedCategoryCodes = new Set();
  const sortCategoryRef = { value: 0 };
  const sortServiceRef = { value: 0 };
  const currentCategoryRef = { current: null };
  const context = {
    lastCategoryName: null,
    lastNamedCategory: null,
    lastHeaderRow: null,
    tocCategories: new Map(),
    activeChapterName: null,
  };

  for (const table of tables) {
    const toc = extractTocCategories(table);
    if (toc.size) {
      context.tocCategories = toc;
      continue;
    }
    const sectionHeading = extractSectionHeading(table);
    if (sectionHeading) {
      context.activeChapterName = sectionHeading;
      continue;
    }
    if (!isPriceTable(table)) continue;
    parsePriceTableRows(
      table,
      context,
      categories,
      services,
      usedCodes,
      usedCategoryCodes,
      sortCategoryRef,
      sortServiceRef,
      currentCategoryRef
    );
  }

  return buildPayload(categories, services, meta, tables.length, 0, {
    toc_sections: Array.from(context.tocCategories.values()),
    activeChapterName: context.activeChapterName,
  });
}

function mapParagraphsToPayload(lines, meta = {}) {
  const categories = [];
  const services = [];
  const usedCodes = new Set();
  const usedCategoryCodes = new Set();
  const sortCategoryRef = { value: 0 };
  const sortServiceRef = { value: 0 };
  const currentCategoryRef = { current: null };

  for (const line of lines) {
    const price = parsePriceFromLine(line);
    if (price == null) continue;
    const name = extractNameFromLine(line, price);
    if (!name || name.length < 3) continue;

    ensureCategory('خدمات مستخرجة من النص', categories, usedCategoryCodes, sortCategoryRef, currentCategoryRef);
    addServiceFromRow({
      name,
      price,
      joined: line,
      currentCategory: currentCategoryRef,
      services,
      usedCodes,
      sortServiceRef,
    });
  }

  return buildPayload(categories, services, meta, 0, lines.length, {});
}

function buildPayload(categories, services, meta, tableCount = 0, paragraphCount = 0, importContext = {}) {
  const normalizedCategories = categories.map((cat) => ({
    code: cat.code,
    name: cat.name,
    sort_order: cat.sort_order,
    notes: cat.notes || '',
    import_chapter: cat.import_chapter || null,
  }));

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
    categories: normalizedCategories,
    services,
    import_meta: {
      source: 'docx',
      toc_sections: importContext.toc_sections || [],
      active_chapter: importContext.activeChapterName || null,
    },
    parse_stats: {
      tables_found: tableCount,
      paragraphs_found: paragraphCount,
      categories_parsed: normalizedCategories.length,
      services_parsed: services.length,
    },
  };
}

async function parseDocxPriceList(filePath, meta = {}) {
  const buffer = fs.readFileSync(filePath);
  const zip = await JSZip.loadAsync(buffer);

  const xmlParts = Object.keys(zip.files).filter((name) => /^word\/(document|header\d*|footer\d*)\.xml$/i.test(name));
  const allTables = [];
  const allParagraphs = [];

  for (const partName of xmlParts) {
    const file = zip.file(partName);
    if (!file) continue;
    const documentXml = await file.async('string');
    allTables.push(...extractTables(documentXml));
    allParagraphs.push(...extractParagraphLines(documentXml));
  }

  let payload = mapTablesToPayload(allTables, meta);
  if (!payload.services.length && allParagraphs.length) {
    payload = mapParagraphsToPayload(allParagraphs, meta);
  }

  if (!payload.services.length) {
    throw new Error(
      `لم يتم استخراج خدمات من ملف DOCX (جداول: ${allTables.length}, فقرات: ${allParagraphs.length}). تأكد أن الملف نصي وليس صورة فقط.`
    );
  }

  return payload;
}

module.exports = {
  parseDocxPriceList,
  mapTablesToPayload,
  extractTables,
  extractParagraphLines,
  collectText,
  isSectionHeadingTable,
  extractSectionHeading,
};
