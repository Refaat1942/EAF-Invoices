const ExcelJS = require('exceljs');

function normalizeHeaderText(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\uFEFF/g, '')
    .replace(/[_\-./\\]+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));
}

function scoreHeaderMatch(header, aliases = []) {
  const norm = normalizeHeaderText(header);
  if (!norm) return 0;
  let best = 0;
  for (const alias of aliases) {
    const a = normalizeHeaderText(alias);
    if (!a) continue;
    if (norm === a) return 1;
    if (norm.includes(a) || a.includes(norm)) best = Math.max(best, 0.75);
    if (norm.startsWith(a) || a.startsWith(norm)) best = Math.max(best, 0.85);
  }
  return best;
}

function detectColumnMapping(headers = [], fieldSchema = {}) {
  const mapping = {};
  const confidence = {};
  const usedHeaders = new Set();

  const fieldKeys = Object.keys(fieldSchema);
  for (const fieldKey of fieldKeys) {
    const def = fieldSchema[fieldKey];
    let bestHeader = null;
    let bestScore = 0;
    for (const header of headers) {
      if (!header || usedHeaders.has(header)) continue;
      const score = scoreHeaderMatch(header, def.aliases || []);
      if (score > bestScore) {
        bestScore = score;
        bestHeader = header;
      }
    }
    if (bestHeader && bestScore >= 0.75) {
      mapping[fieldKey] = bestHeader;
      confidence[fieldKey] = bestScore;
      usedHeaders.add(bestHeader);
    }
  }

  const missingRequired = fieldKeys.filter((key) => fieldSchema[key].required && !mapping[key]);
  const lowConfidence = fieldKeys.some((key) => mapping[key] && (confidence[key] || 0) < 0.85);
  const needs_manual_mapping = missingRequired.length > 0 || lowConfidence;

  return {
    mapping,
    confidence,
    needs_manual_mapping,
    missing_required: missingRequired,
    unmapped_headers: headers.filter((h) => h && !Object.values(mapping).includes(h)),
  };
}

function applyColumnMapping(rawRows = [], headers = [], mapping = {}, fieldSchema = {}) {
  return rawRows.map((raw, index) => {
    const mapped = { row_number: index + 2 };
    for (const fieldKey of Object.keys(fieldSchema)) {
      const header = mapping[fieldKey];
      let value = '';
      if (header && raw[header] != null) {
        value = raw[header];
      }
      if (value != null && typeof value === 'object' && value.text) {
        value = value.text;
      }
      mapped[fieldKey] = String(value ?? '').trim();
    }
    if (!mapped.unit && fieldSchema.unit?.default) {
      mapped.unit = fieldSchema.unit.default;
    }
    return mapped;
  });
}

function detectCsvDelimiter(line) {
  const comma = (line.match(/,/g) || []).length;
  const semi = (line.match(/;/g) || []).length;
  const tab = (line.match(/\t/g) || []).length;
  if (tab > comma && tab > semi) return '\t';
  if (semi > comma) return ';';
  return ',';
}

function parseCsvLine(line, delimiter) {
  const cols = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (ch === delimiter && !inQuotes) {
      cols.push(current.trim());
      current = '';
      continue;
    }
    current += ch;
  }
  cols.push(current.trim());
  return cols.map((c) => c.replace(/^"|"$/g, '').replace(/""/g, '"').trim());
}

function parseCsvRaw(text) {
  const lines = String(text || '')
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .filter((line) => line.trim());
  if (lines.length < 1) return { headers: [], rows: [] };

  const delimiter = detectCsvDelimiter(lines[0]);
  const headers = parseCsvLine(lines[0], delimiter).map((h) => h.trim()).filter(Boolean);
  const rows = [];

  for (let i = 1; i < lines.length; i++) {
    const cols = parseCsvLine(lines[i], delimiter);
    if (!cols.some((c) => String(c).trim())) continue;
    const row = {};
    headers.forEach((header, idx) => {
      row[header] = cols[idx] ?? '';
    });
    rows.push(row);
  }

  return { headers, rows };
}

async function parseExcelRaw(buffer) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const sheet = workbook.worksheets[0];
  if (!sheet) return { headers: [], rows: [] };

  const headerRow = sheet.getRow(1);
  const headers = [];
  headerRow.eachCell((cell, col) => {
    headers[col] = String(cell.value ?? '').trim();
  });

  const normalizedHeaders = [];
  const colIndexes = [];
  headers.forEach((header, colIndex) => {
    if (!header) return;
    normalizedHeaders.push(header);
    colIndexes.push(colIndex);
  });

  const rows = [];
  for (let r = 2; r <= sheet.rowCount; r++) {
    const row = sheet.getRow(r);
    const obj = {};
    let hasValue = false;
    colIndexes.forEach((colIndex, i) => {
      const header = normalizedHeaders[i];
      const cell = row.getCell(colIndex);
      let val = cell?.value;
      if (val != null && typeof val === 'object') {
        if (val.text) val = val.text;
        else if (val.result != null) val = val.result;
      }
      const text = val != null ? String(val).trim() : '';
      if (text) hasValue = true;
      obj[header] = text;
    });
    if (hasValue) rows.push(obj);
  }

  return { headers: normalizedHeaders, rows };
}

async function readTabularFile(buffer, originalName = '') {
  const name = String(originalName || '').toLowerCase();
  if (name.endsWith('.csv') || name.endsWith('.txt')) {
    return parseCsvRaw(buffer.toString('utf8'));
  }
  if (name.endsWith('.xlsx') || name.endsWith('.xls')) {
    return parseExcelRaw(buffer);
  }
  throw new Error('صيغة غير مدعومة — استخدم CSV أو Excel (.xlsx)');
}

function buildImportFieldList(fieldSchema = {}) {
  return Object.entries(fieldSchema).map(([key, def]) => ({
    key,
    label: def.label || key,
    required: Boolean(def.required),
    default: def.default || null,
  }));
}

function validateMapping(mapping = {}, fieldSchema = {}) {
  const missing = Object.entries(fieldSchema)
    .filter(([key, def]) => def.required && !mapping[key])
    .map(([key, def]) => def.label || key);
  if (missing.length) {
    throw new Error(`يجب تعيين الأعمدة: ${missing.join('، ')}`);
  }
}

const CATALOG_IMPORT_SCHEMA = {
  code: {
    required: true,
    label: 'الكود',
    aliases: ['code', 'item code', 'sku', 'product code', 'الكود', 'كود', 'رمز', 'الرمز'],
  },
  name: {
    required: true,
    label: 'الاسم',
    aliases: ['name', 'item name', 'product name', 'description', 'الاسم', 'اسم', 'اسم الصنف', 'الصنف'],
  },
  category: {
    required: true,
    label: 'الفئة',
    aliases: ['category', 'type', 'group', 'الفئة', 'فئة', 'القسم', 'قسم', 'التصنيف', 'تصنيف'],
  },
  unit: {
    required: false,
    label: 'الوحدة',
    default: 'مرة',
    aliases: ['unit', 'uom', 'unit of measure', 'الوحدة', 'وحدة'],
  },
  price: {
    required: true,
    label: 'السعر',
    aliases: [
      'price',
      'unit price',
      'selling price',
      'sale price',
      'list price',
      'السعر',
      'سعر',
      'سعر الوحدة',
      'سعر البيع',
    ],
  },
  cost_price: {
    required: false,
    label: 'سعر التكلفة',
    aliases: ['cost price', 'cost', 'سعر التكلفة', 'تكلفة', 'التكلفة'],
  },
  markup_percent: {
    required: false,
    label: 'نسبة الربح %',
    aliases: ['markup', 'markup %', 'markup percent', 'margin %', 'نسبة الربح', 'الربح %', 'هامش'],
  },
};

module.exports = {
  normalizeHeaderText,
  scoreHeaderMatch,
  detectColumnMapping,
  applyColumnMapping,
  readTabularFile,
  parseCsvRaw,
  parseExcelRaw,
  buildImportFieldList,
  validateMapping,
  CATALOG_IMPORT_SCHEMA,
};
