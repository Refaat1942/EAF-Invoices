const { query, withTransaction } = require('../database/db');
const {
  readTabularFile,
  detectColumnMapping,
  applyColumnMapping,
  buildImportFieldList,
  validateMapping,
  CATALOG_IMPORT_SCHEMA,
  parseCsvRaw,
  parseExcelRaw,
} = require('./importService');
const {
  isValidSevenDigitCode,
  resolveCatalogItemCode,
  reserveCatalogCode,
  linkCatalogItemCode,
} = require('./catalogCodeService');

const CATALOG_CATEGORIES = ['Medicine', 'Supplies', 'Cosmetics'];

const CATEGORY_ALIASES = {
  medicine: 'Medicine',
  medicines: 'Medicine',
  drug: 'Medicine',
  drugs: 'Medicine',
  'أدوية': 'Medicine',
  'دواء': 'Medicine',
  supplies: 'Supplies',
  supply: 'Supplies',
  'مستلزمات': 'Supplies',
  cosmetics: 'Cosmetics',
  cosmetic: 'Cosmetics',
  'مستحضرات': 'Cosmetics',
  'مستحضرات تجميل': 'Cosmetics',
  'تجميل': 'Cosmetics',
};

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function computeSellingPrice(costPrice, markupPercent) {
  const cost = round2(costPrice);
  const markup = round2(markupPercent);
  return round2(cost + (cost * markup) / 100);
}

function computeMarginAmount(costPrice, sellingPrice, quantity = 1) {
  return round2((round2(sellingPrice) - round2(costPrice)) * (round2(quantity) || 1));
}

function normalizeCategory(value) {
  const text = String(value || '').trim();
  if (!text) return null;
  const key = text.toLowerCase();
  if (CATEGORY_ALIASES[key]) return CATEGORY_ALIASES[key];
  if (CATEGORY_ALIASES[text]) return CATEGORY_ALIASES[text];
  const exact = CATALOG_CATEGORIES.find((c) => c.toLowerCase() === key);
  return exact || null;
}

function minorPriceExplicitlySupplied(data) {
  return data.minor_unit_selling_price != null && data.minor_unit_selling_price !== '';
}

function majorPriceExplicitlySupplied(data) {
  return (
    (data.major_unit_selling_price != null && data.major_unit_selling_price !== '') ||
    (data.price != null && data.price !== '')
  );
}

function normalizeUnitFields(data) {
  const majorUnit = String(data.major_unit || data.unit || '').trim() || 'مرة';
  let minorUnit = String(data.minor_unit || '').trim();
  let minorQty = round2(data.minor_quantity_per_major);
  let majorPrice = round2(data.major_unit_selling_price ?? data.price);
  const minorPriceSupplied = minorPriceExplicitlySupplied(data);
  let minorPrice = minorPriceSupplied ? round2(data.minor_unit_selling_price) : null;

  if (!minorUnit || minorUnit === majorUnit) {
    minorUnit = majorUnit;
    minorQty = 1;
    minorPrice = majorPrice;
  } else {
    if (!minorQty || minorQty <= 0) minorQty = 1;
    if (!minorPriceSupplied && majorPrice > 0) {
      minorPrice = round2(majorPrice / minorQty);
    }
    if (!minorPrice || minorPrice <= 0) minorPrice = majorPrice;
  }

  return {
    major_unit: majorUnit,
    minor_unit: minorUnit,
    minor_quantity_per_major: minorQty,
    major_unit_selling_price: majorPrice,
    minor_unit_selling_price: minorPrice,
    unit: majorUnit,
    price: majorPrice,
  };
}

function validateMinorMajorPriceConsistency(data, units) {
  const majorUnit = units.major_unit;
  const minorUnit = units.minor_unit;
  const minorQty = units.minor_quantity_per_major;
  if (minorUnit === majorUnit || minorQty <= 1) return;

  if (!majorPriceExplicitlySupplied(data) || !minorPriceExplicitlySupplied(data)) return;

  const expectedMinor = round2(units.major_unit_selling_price / minorQty);
  const actualMinor = round2(units.minor_unit_selling_price);
  if (Math.abs(expectedMinor - actualMinor) > 0.01) {
    throw new Error(
      `سعر الوحدة الصغرى (${actualMinor}) لا يتوافق مع سعر الوحدة الكبرى (${units.major_unit_selling_price}) ÷ ${minorQty} = ${expectedMinor}`
    );
  }
}

function catalogItemConfigKey(payload) {
  return [
    String(payload.name || '').trim().toLowerCase(),
    payload.category,
    payload.major_unit,
    payload.minor_unit,
    String(payload.minor_quantity_per_major),
    String(payload.major_unit_selling_price),
    String(payload.minor_unit_selling_price),
    String(payload.cost_price || ''),
    String(payload.markup_percent || ''),
  ].join('|');
}

/** One catalog product = name + category (not separate rows per unit/price). */
function catalogItemProductKey(normalized) {
  const name = String(normalized.name || '').trim().toLowerCase();
  const category = normalized.category || '';
  if (!name || !category) return null;
  return `${category}|${name}`;
}

function mergeCatalogImportRow(base, incoming) {
  const next = { ...base };

  if (incoming.code) {
    if (next.code && next.code !== incoming.code) {
      next._code_conflict = true;
    } else if (!next.code) {
      next.code = incoming.code;
    }
  }

  if (incoming.major_unit) next.major_unit = incoming.major_unit;
  if (incoming.minor_unit) next.minor_unit = incoming.minor_unit;
  if (incoming.minor_quantity_per_major != null && incoming.minor_quantity_per_major !== '') {
    next.minor_quantity_per_major = round2(incoming.minor_quantity_per_major);
  }
  if (incoming.major_unit_selling_price > 0) {
    next.major_unit_selling_price = round2(incoming.major_unit_selling_price);
    if (incoming.major_unit) next.major_unit = incoming.major_unit;
  }
  if (incoming.minor_unit_selling_price != null && incoming.minor_unit_selling_price > 0) {
    next.minor_unit_selling_price = round2(incoming.minor_unit_selling_price);
    if (incoming.minor_unit) next.minor_unit = incoming.minor_unit;
  }

  const inUnits = normalizeUnitFields(incoming);
  const rowUnit = inUnits.major_unit;
  const rowPrice = inUnits.major_unit_selling_price;
  if (rowPrice > 0 && rowUnit) {
    const currentMajor = String(next.major_unit || '').trim();
    const currentMinor = String(next.minor_unit || '').trim();
    if (!currentMajor || currentMajor === rowUnit) {
      next.major_unit = rowUnit;
      next.major_unit_selling_price = rowPrice;
    } else if (!currentMinor || currentMinor === rowUnit) {
      next.minor_unit = rowUnit;
      next.minor_unit_selling_price = rowPrice;
    } else if (currentMajor !== rowUnit && currentMinor !== rowUnit) {
      next._unit_conflict = true;
    }
  }

  if (incoming.cost_price != null && incoming.cost_price !== '') {
    next.cost_price = round2(incoming.cost_price);
  }
  if (incoming.markup_percent != null && incoming.markup_percent !== '') {
    next.markup_percent = round2(incoming.markup_percent);
  }
  if (incoming.unit) next.unit = String(incoming.unit).trim();
  if (incoming.price > 0 && !next.major_unit_selling_price) {
    next.price = round2(incoming.price);
  }

  return next;
}

/**
 * Merge spreadsheet rows that describe the same product (e.g. ANTINAL PAC/52 + STR/26)
 * into a single catalog item with major/minor units on one record.
 */
function mergeImportRowsByProduct(mappedRows = []) {
  const groups = new Map();
  const order = [];

  for (const raw of mappedRows) {
    const normalized = normalizeImportRow(raw);
    const key = catalogItemProductKey(normalized);
    if (!key) continue;

    if (!groups.has(key)) {
      groups.set(key, { ...normalized, source_row_numbers: [raw.row_number] });
      order.push(key);
      continue;
    }

    const base = groups.get(key);
    base.source_row_numbers.push(raw.row_number);
    groups.set(key, mergeCatalogImportRow(base, normalized));
  }

  return order.map((key) => {
    const row = groups.get(key);
    return {
      ...row,
      row_number: row.source_row_numbers[0],
      merged_from_rows:
        row.source_row_numbers.length > 1 ? [...row.source_row_numbers] : undefined,
    };
  });
}

function resolveCatalogUnitPrice(catalogItem, unitLevel = 'major') {
  const units = normalizeUnitFields(catalogItem);
  const majorUnit = units.major_unit;
  const minorUnit = units.minor_unit;
  const minorQty = units.minor_quantity_per_major;
  const majorPrice = units.major_unit_selling_price;
  const minorPrice = units.minor_unit_selling_price;
  const hasMinorTier = minorUnit !== majorUnit && minorQty > 1;

  if (String(unitLevel).toLowerCase() === 'minor' && hasMinorTier) {
    return {
      level: 'minor',
      unit: minorUnit,
      unitPrice: minorPrice,
      minorQuantityPerMajor: minorQty,
    };
  }
  return {
    level: 'major',
    unit: majorUnit,
    unitPrice: majorPrice,
    minorQuantityPerMajor: minorQty,
  };
}

function convertMinorToMajorQuantity(minorQuantity, catalogItem) {
  const ratio = round2(catalogItem.minor_quantity_per_major) || 1;
  return round2(minorQuantity / ratio);
}

function catalogItemInsertParams(payload) {
  return [
    payload.code,
    payload.name,
    payload.category,
    payload.unit,
    payload.cost_price,
    payload.markup_percent,
    payload.price,
    payload.major_unit,
    payload.minor_unit,
    payload.minor_quantity_per_major,
    payload.major_unit_selling_price,
    payload.minor_unit_selling_price,
  ];
}

async function listCatalogItems(filters = {}) {
  let sql = `SELECT * FROM daily_entry_catalog_items WHERE 1=1`;
  const params = [];
  let i = 1;

  if (filters.category) {
    sql += ` AND category = $${i++}`;
    params.push(filters.category);
  }
  if (filters.active_only !== false) {
    sql += ` AND is_active = TRUE`;
  }
  if (filters.search) {
    sql += ` AND (name ILIKE $${i} OR code ILIKE $${i})`;
    params.push(`%${filters.search}%`);
    i++;
  }

  sql += ` ORDER BY category, sort_order, name, id`;
  if (filters.limit) {
    sql += ` LIMIT $${i++}`;
    params.push(Number(filters.limit));
  }

  const { rows } = await query(sql, params);
  return rows;
}

async function getCatalogItemById(id) {
  const { rows } = await query(`SELECT * FROM daily_entry_catalog_items WHERE id = $1`, [Number(id)]);
  return rows[0] || null;
}

async function getCatalogStats() {
  const { rows } = await query(
    `SELECT category, COUNT(*)::int AS count
     FROM daily_entry_catalog_items
     WHERE is_active = TRUE
     GROUP BY category
     ORDER BY category`
  );
  const total = rows.reduce((sum, row) => sum + row.count, 0);
  return { total, by_category: rows };
}

function catalogItemToPicker(item) {
  const units = normalizeUnitFields(item);
  const majorUnit = units.major_unit;
  const minorUnit = units.minor_unit;
  const minorQty = units.minor_quantity_per_major;
  const majorPrice = units.major_unit_selling_price;
  const minorPrice = units.minor_unit_selling_price;
  const hasMinorTier = minorUnit !== majorUnit && minorQty > 1;

  const unit_options = hasMinorTier
    ? [
        { level: 'major', unit: majorUnit, price: majorPrice },
        { level: 'minor', unit: minorUnit, price: minorPrice },
      ]
    : [{ level: 'major', unit: majorUnit, price: majorPrice }];

  const base = {
    id: item.id,
    code: item.code,
    name: item.name,
    unit: majorUnit,
    major_unit: majorUnit,
    minor_unit: minorUnit,
    minor_quantity_per_major: minorQty,
    major_unit_selling_price: majorPrice,
    minor_unit_selling_price: minorPrice,
    price: majorPrice,
    list_price: majorPrice,
    selling_price: majorPrice,
    unit_options,
    category_name: item.category,
    is_catalog: true,
  };

  if (item.category === 'Supplies') {
    return {
      ...base,
      cost_price: round2(item.cost_price),
      markup_percent: round2(item.markup_percent),
    };
  }
  return base;
}

async function getCatalogItemByCode(code, excludeId = null, client = null) {
  const normalized = String(code || '').trim();
  if (!normalized) return null;
  const run = client ? client.query.bind(client) : query;
  let sql = `SELECT * FROM daily_entry_catalog_items WHERE code = $1`;
  const params = [normalized];
  if (excludeId) {
    sql += ` AND id <> $2`;
    params.push(Number(excludeId));
  }
  const { rows } = await run(sql, params);
  return rows[0] || null;
}

async function findCatalogItemByProduct(payload, client = null) {
  const run = client ? client.query.bind(client) : query;
  const { rows } = await run(
    `SELECT * FROM daily_entry_catalog_items
     WHERE LOWER(TRIM(name)) = LOWER(TRIM($1)) AND category = $2
     ORDER BY id
     LIMIT 1`,
    [payload.name, payload.category]
  );
  return rows[0] || null;
}

function isSameCatalogItem(existing, payload) {
  const existingUnits = normalizeUnitFields(existing);
  const payloadUnits = normalizeUnitFields(payload);
  return (
    String(existing.name || '').trim() === String(payload.name || '').trim() &&
    existing.category === payload.category &&
    existingUnits.major_unit === payloadUnits.major_unit &&
    existingUnits.minor_unit === payloadUnits.minor_unit &&
    round2(existingUnits.minor_quantity_per_major) === round2(payloadUnits.minor_quantity_per_major) &&
    round2(existingUnits.major_unit_selling_price) === round2(payloadUnits.major_unit_selling_price) &&
    round2(existingUnits.minor_unit_selling_price) === round2(payloadUnits.minor_unit_selling_price) &&
    round2(existing.cost_price || 0) === round2(payload.cost_price || 0) &&
    round2(existing.markup_percent || 0) === round2(payload.markup_percent || 0)
  );
}

function normalizeImportRow(raw = {}) {
  const majorPriceRaw =
    raw.major_unit_selling_price != null && raw.major_unit_selling_price !== ''
      ? raw.major_unit_selling_price
      : raw.price;
  const row = {
    code: String(raw.code || '').trim(),
    name: String(raw.name || '').trim(),
    category: normalizeCategory(raw.category),
    major_unit: String(raw.major_unit || raw.unit || '').trim(),
    minor_unit: String(raw.minor_unit || '').trim(),
    minor_quantity_per_major:
      raw.minor_quantity_per_major != null && raw.minor_quantity_per_major !== ''
        ? round2(raw.minor_quantity_per_major)
        : null,
    major_unit_selling_price:
      majorPriceRaw != null && majorPriceRaw !== '' ? round2(majorPriceRaw) : 0,
    minor_unit_selling_price:
      raw.minor_unit_selling_price != null && raw.minor_unit_selling_price !== ''
        ? round2(raw.minor_unit_selling_price)
        : null,
    unit: String(raw.unit || raw.major_unit || '').trim(),
    price: majorPriceRaw != null && majorPriceRaw !== '' ? round2(majorPriceRaw) : 0,
    cost_price: raw.cost_price != null && raw.cost_price !== '' ? round2(raw.cost_price) : null,
    markup_percent:
      raw.markup_percent != null && raw.markup_percent !== '' ? round2(raw.markup_percent) : null,
    row_number: raw.row_number,
  };

  if (row.category === 'Supplies') {
    if (!row.cost_price && row.price > 0) {
      row.cost_price = row.price;
      row.markup_percent = row.markup_percent || 0;
    }
  }

  return row;
}

function analyzeImportRows(mappedRows = []) {
  const mergedInput = mergeImportRowsByProduct(mappedRows);
  const productSeen = new Map();
  const codeSeen = new Map();
  const preview_rows = [];
  const duplicate_rows = [];
  const conflict_rows = [];

  for (const raw of mergedInput) {
    const normalized = { ...raw };
    const base = {
      row_number: raw.row_number,
      code: normalized.code,
      name: normalized.name,
      category: normalized.category || '',
      merged_from_rows: raw.merged_from_rows,
    };

    if (!normalized.name && !normalized.code) {
      preview_rows.push({
        ...base,
        import_status: 'skip',
        import_message: 'صف فارغ',
      });
      continue;
    }

    let row = { ...base, import_status: 'insert', import_message: '' };
    if (raw.merged_from_rows?.length > 1) {
      row.import_message = `صنف واحد — دُمج من الصفوف ${raw.merged_from_rows.join(', ')}`;
    }

    try {
      if (normalized._code_conflict) {
        row.import_status = 'conflict';
        row.import_message = 'تعارض كود لنفس اسم الصنف في الملف';
        conflict_rows.push(row);
        preview_rows.push(row);
        continue;
      }
      if (normalized._unit_conflict) {
        row.import_status = 'conflict';
        row.import_message = 'تعارض وحدات لنفس الصنف في الملف';
        conflict_rows.push(row);
        preview_rows.push(row);
        continue;
      }

      const payload = validateCatalogPayload(normalized, { allowMissingCode: true });
      Object.assign(row, {
        major_unit: payload.major_unit,
        minor_unit: payload.minor_unit,
        minor_quantity_per_major: payload.minor_quantity_per_major,
        major_unit_selling_price: payload.major_unit_selling_price,
        minor_unit_selling_price: payload.minor_unit_selling_price,
        unit: payload.unit,
        price: payload.price,
        cost_price: payload.cost_price,
        markup_percent: payload.markup_percent,
      });

      const productKey = catalogItemProductKey(payload);
      if (productKey && productSeen.has(productKey)) {
        row.import_status = 'duplicate';
        row.import_message = `مكرر مع الصف ${productSeen.get(productKey)}`;
        duplicate_rows.push(row);
      } else if (productKey) {
        productSeen.set(productKey, raw.row_number);
      }

      const code = String(normalized.code || '').trim();
      if (code) {
        if (!isValidSevenDigitCode(code)) {
          row.import_status = 'conflict';
          row.import_message = 'كود غير صالح (يجب 7 أرقام)';
          conflict_rows.push(row);
        } else if (codeSeen.has(code)) {
          row.import_status = 'conflict';
          row.import_message = `تعارض كود مع الصف ${codeSeen.get(code)}`;
          conflict_rows.push(row);
        } else {
          codeSeen.set(code, raw.row_number);
        }
      }
    } catch (err) {
      row.import_status = 'error';
      row.import_message = err.message || 'خطأ';
    }

    preview_rows.push(row);
  }

  return { preview_rows, duplicate_rows, conflict_rows, merged_count: mergedInput.length };
}

async function enrichImportAnalysisWithDb(previewRows, client = null) {
  const run = client ? client.query.bind(client) : query;

  function applyDbMatch(row, existing, payload) {
    if (isSameCatalogItem(existing, payload)) {
      if (row.import_status === 'insert') {
        row.import_status = 'skip';
        row.import_message = 'موجود مسبقًا بنفس الإعدادات';
      }
      return;
    }
    if (row.import_status !== 'conflict') {
      row.import_status = 'conflict';
      const code = String(row.code || existing.code || '').trim();
      row.import_message = code
        ? `تعارض مع صنف موجود (كود ${code})`
        : 'تعارض مع صنف موجود بنفس الاسم والفئة';
    }
  }

  for (const row of previewRows) {
    if (row.import_status === 'skip' || row.import_status === 'error' || row.import_status === 'duplicate') {
      continue;
    }

    try {
      const payload = validateCatalogPayload(
        {
          code: row.code,
          name: row.name,
          category: row.category,
          major_unit: row.major_unit,
          minor_unit: row.minor_unit,
          minor_quantity_per_major: row.minor_quantity_per_major,
          major_unit_selling_price: row.major_unit_selling_price,
          minor_unit_selling_price: row.minor_unit_selling_price,
          cost_price: row.cost_price,
          markup_percent: row.markup_percent,
        },
        { allowMissingCode: true }
      );

      let existing = null;
      if (row.code) {
        const { rows } = await run(`SELECT * FROM daily_entry_catalog_items WHERE code = $1`, [row.code]);
        existing = rows[0] || null;
        if (existing && !isSameCatalogItem(existing, payload)) {
          applyDbMatch(row, existing, payload);
          continue;
        }
      }

      if (!existing && payload.name && payload.category) {
        existing = await findCatalogItemByProduct(payload, client);
        if (existing) {
          applyDbMatch(row, existing, payload);
        }
      }
    } catch (err) {
      row.import_status = 'error';
      row.import_message = err.message;
    }
  }
}

function toPreviewRow(raw) {
  const row = normalizeImportRow(raw);
  const units = normalizeUnitFields(row);
  return {
    row_number: raw.row_number,
    code: row.code,
    name: row.name,
    category: row.category || raw.category || '',
    major_unit: units.major_unit,
    minor_unit: units.minor_unit,
    minor_quantity_per_major: units.minor_quantity_per_major,
    major_unit_selling_price: units.major_unit_selling_price,
    minor_unit_selling_price: units.minor_unit_selling_price,
    unit: units.unit,
    price: units.price,
    cost_price: row.cost_price,
    markup_percent: row.markup_percent,
    import_status: 'insert',
    import_message: '',
  };
}

async function analyzeCatalogImportFile(buffer, originalName, mappingOverride = null) {
  const table = await readTabularFile(buffer, originalName);
  if (!table.headers.length) throw new Error('لم يُعثر على أعمدة في الملف');

  const detection = detectColumnMapping(table.headers, CATALOG_IMPORT_SCHEMA);
  const mapping = mappingOverride || detection.mapping;
  if (mappingOverride) {
    validateMapping(mapping, CATALOG_IMPORT_SCHEMA);
  }

  const mappedRows = applyColumnMapping(table.rows, table.headers, mapping, CATALOG_IMPORT_SCHEMA);
  const analysis = analyzeImportRows(mappedRows);
  await enrichImportAnalysisWithDb(analysis.preview_rows);

  return {
    headers: table.headers,
    fields: buildImportFieldList(CATALOG_IMPORT_SCHEMA),
    suggested_mapping: detection.mapping,
    mapping,
    confidence: detection.confidence,
    needs_manual_mapping: mappingOverride ? false : detection.needs_manual_mapping,
    missing_required: detection.missing_required,
    unmapped_headers: detection.unmapped_headers,
    preview_rows: analysis.preview_rows.slice(0, 50),
    duplicate_rows: analysis.duplicate_rows,
    conflict_rows: analysis.conflict_rows,
    total_rows: mappedRows.length,
  };
}

async function importCatalogRowsTransactional(rows = []) {
  const result = {
    inserted: 0,
    updated: 0,
    skipped: 0,
    duplicates: 0,
    conflicts: 0,
    merged: 0,
    errors: [],
  };

  const mergedRows = mergeImportRowsByProduct(rows);
  result.merged = rows.length - mergedRows.length;

  const productSeen = new Map();
  const codeSeen = new Map();
  const toProcess = [];

  for (const raw of mergedRows) {
    const rowNumber = raw.row_number;
    if (!String(raw.code || '').trim() && !String(raw.name || '').trim()) {
      result.skipped += 1;
      continue;
    }

    try {
      if (raw._code_conflict || raw._unit_conflict) {
        result.conflicts += 1;
        result.errors.push({
          row: rowNumber,
          code: String(raw.code || '').trim(),
          message: raw._code_conflict ? 'تعارض كود لنفس الصنف' : 'تعارض وحدات لنفس الصنف',
        });
        continue;
      }

      const payload = validateCatalogPayload(raw, { allowMissingCode: true });
      const productKey = catalogItemProductKey(payload);

      if (productKey && productSeen.has(productKey)) {
        result.duplicates += 1;
        result.skipped += 1;
        continue;
      }
      if (productKey) productSeen.set(productKey, rowNumber);

      const code = String(raw.code || '').trim();
      if (code) {
        if (!isValidSevenDigitCode(code)) {
          result.conflicts += 1;
          result.errors.push({ row: rowNumber, code, message: 'كود غير صالح (يجب 7 أرقام)' });
          continue;
        }
        if (codeSeen.has(code)) {
          result.duplicates += 1;
          result.skipped += 1;
          continue;
        }
        codeSeen.set(code, rowNumber);
      }

      toProcess.push({ raw, payload, rowNumber });
    } catch (err) {
      result.errors.push({
        row: rowNumber,
        code: String(raw.code || '').trim(),
        message: err.message || 'خطأ غير معروف',
      });
    }
  }

  await withTransaction(async (client) => {
    for (const { raw, payload, rowNumber } of toProcess) {
      try {
        let existing = null;
        if (payload.code) {
          existing = await getCatalogItemByCode(payload.code, null, client);
          if (existing && !isSameCatalogItem(existing, payload)) {
            result.conflicts += 1;
            result.errors.push({
              row: rowNumber,
              code: payload.code,
              message: 'الكود مستخدم لصنف مختلف',
            });
            continue;
          }
        }
        if (!existing) {
          existing = await findCatalogItemByProduct(payload, client);
        }

        if (!existing) {
          const code = await resolveCatalogItemCode(payload.code || '', null, client);
          payload.code = code;
          const { rows: inserted } = await client.query(
            `INSERT INTO daily_entry_catalog_items (
              code, name, category, unit, cost_price, markup_percent, price,
              major_unit, minor_unit, minor_quantity_per_major,
              major_unit_selling_price, minor_unit_selling_price,
              is_active, updated_at
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,TRUE,NOW())
            RETURNING id`,
            catalogItemInsertParams(payload)
          );
          await linkCatalogItemCode(code, inserted[0].id, client);
          result.inserted += 1;
          continue;
        }

        if (isSameCatalogItem(existing, payload)) {
          result.skipped += 1;
          continue;
        }

        await client.query(
          `UPDATE daily_entry_catalog_items
           SET name = $1, category = $2, unit = $3, cost_price = $4, markup_percent = $5, price = $6,
               major_unit = $7, minor_unit = $8, minor_quantity_per_major = $9,
               major_unit_selling_price = $10, minor_unit_selling_price = $11,
               is_active = TRUE, updated_at = NOW()
           WHERE id = $12`,
          [...catalogItemInsertParams(payload).slice(1), existing.id]
        );
        result.updated += 1;
      } catch (err) {
        result.errors.push({
          row: rowNumber,
          code: String(raw.code || '').trim(),
          message: err.message || 'خطأ غير معروف',
        });
      }
    }
  });

  result.stats = await getCatalogStats();
  return result;
}

async function confirmCatalogImportFile(buffer, originalName, mapping = {}) {
  validateMapping(mapping, CATALOG_IMPORT_SCHEMA);
  const table = await readTabularFile(buffer, originalName);
  const mappedRows = applyColumnMapping(table.rows, table.headers, mapping, CATALOG_IMPORT_SCHEMA);
  if (!mappedRows.length) throw new Error('لم يُعثر على صفوف للاستيراد');
  return importCatalogRowsTransactional(mappedRows);
}

function validateCatalogPayload(data, options = {}) {
  const { allowMissingCode = false, allowLegacyCode = false } = options;
  let code = String(data.code || '').trim();
  const name = String(data.name || '').trim();
  const category = normalizeCategory(data.category);

  if (!allowMissingCode && !code) throw new Error('الكود مطلوب');
  if (code && !isValidSevenDigitCode(code) && !allowLegacyCode) {
    throw new Error('الكود يجب أن يكون 7 أرقام');
  }
  if (!name) throw new Error('الاسم مطلوب');
  if (!category) throw new Error('الفئة غير صالحة (Medicine / Supplies / Cosmetics)');

  const units = normalizeUnitFields(data);

  if (category === 'Supplies') {
    const costPrice = round2(data.cost_price);
    const markupPercent = round2(data.markup_percent);
    if (costPrice <= 0) throw new Error('سعر التكلفة مطلوب للمستلزمات');
    const sellingPrice = computeSellingPrice(costPrice, markupPercent);
    if (sellingPrice <= 0) throw new Error('سعر البيع المحسوب غير صالح');
    units.major_unit_selling_price = sellingPrice;
    units.minor_unit_selling_price =
      units.minor_unit !== units.major_unit && units.minor_quantity_per_major > 1
        ? round2(sellingPrice / units.minor_quantity_per_major)
        : sellingPrice;
    units.price = sellingPrice;
    return {
      code,
      name,
      category,
      unit: units.unit,
      cost_price: costPrice,
      markup_percent: markupPercent,
      price: sellingPrice,
      ...units,
    };
  }

  if (units.major_unit_selling_price <= 0) {
    throw new Error('سعر الوحدة الكبرى يجب أن يكون أكبر من صفر');
  }
  if (units.minor_unit_selling_price <= 0) {
    throw new Error('سعر الوحدة الصغرى يجب أن يكون أكبر من صفر');
  }
  validateMinorMajorPriceConsistency(data, units);

  return {
    code,
    name,
    category,
    unit: units.unit,
    cost_price: null,
    markup_percent: null,
    price: units.price,
    ...units,
  };
}

async function createCatalogItem(data) {
  return withTransaction(async (client) => {
    const row = validateCatalogPayload(data, { allowMissingCode: true });
    if (row.code) {
      const existing = await getCatalogItemByCode(row.code, null, client);
      if (existing) throw new Error(`الكود «${row.code}» مستخدم بالفعل`);
    }

    const duplicateProduct = await findCatalogItemByProduct(row, client);
    if (duplicateProduct) {
      throw new Error(`الصنف «${row.name}» موجود بالفعل في فئة ${row.category}`);
    }

    const code = await resolveCatalogItemCode(row.code || '', null, client);
    row.code = code;

    const { rows } = await client.query(
      `INSERT INTO daily_entry_catalog_items (
        code, name, category, unit, cost_price, markup_percent, price,
        major_unit, minor_unit, minor_quantity_per_major,
        major_unit_selling_price, minor_unit_selling_price,
        is_active, updated_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,TRUE,NOW())
      RETURNING *`,
      catalogItemInsertParams(row)
    );
    await linkCatalogItemCode(code, rows[0].id, client);
    return rows[0];
  });
}

async function updateCatalogItem(id, data) {
  const item = await getCatalogItemById(id);
  if (!item) throw new Error('الصنف غير موجود');

  return withTransaction(async (client) => {
    const unchangedLegacyCode =
      String(data.code || '').trim() === String(item.code || '').trim() &&
      !isValidSevenDigitCode(item.code);
    const row = validateCatalogPayload(data, { allowLegacyCode: unchangedLegacyCode });
    const duplicate = await getCatalogItemByCode(row.code, id, client);
    if (duplicate) throw new Error(`الكود «${row.code}» مستخدم بالفعل`);

    const duplicateProduct = await findCatalogItemByProduct(row, client);
    if (duplicateProduct && Number(duplicateProduct.id) !== Number(id)) {
      throw new Error(`الصنف «${row.name}» موجود بالفعل في فئة ${row.category}`);
    }

    if (row.code !== item.code && isValidSevenDigitCode(row.code)) {
      await reserveCatalogCode(row.code, id, client);
    }

    const { rows } = await client.query(
      `UPDATE daily_entry_catalog_items
       SET code = $1, name = $2, category = $3, unit = $4, cost_price = $5, markup_percent = $6, price = $7,
           major_unit = $8, minor_unit = $9, minor_quantity_per_major = $10,
           major_unit_selling_price = $11, minor_unit_selling_price = $12, updated_at = NOW()
       WHERE id = $13
       RETURNING *`,
      [...catalogItemInsertParams(row), Number(id)]
    );
    await linkCatalogItemCodeIfValid(row.code, id, client);
    return rows[0];
  });
}

async function linkCatalogItemCodeIfValid(code, catalogItemId, client) {
  if (!isValidSevenDigitCode(code)) return;
  await linkCatalogItemCode(code, catalogItemId, client);
}

async function setCatalogItemActive(id, isActive) {
  const item = await getCatalogItemById(id);
  if (!item) throw new Error('الصنف غير موجود');

  const { rows } = await query(
    `UPDATE daily_entry_catalog_items
     SET is_active = $1, updated_at = NOW()
     WHERE id = $2
     RETURNING *`,
    [Boolean(isActive), Number(id)]
  );
  return rows[0];
}

async function upsertCatalogItem(raw) {
  const row = validateCatalogPayload(raw, { allowMissingCode: true });

  return withTransaction(async (client) => {
    let existing = null;
    if (row.code) {
      existing = await getCatalogItemByCode(row.code, null, client);
    }
    if (!existing) {
      existing = await findCatalogItemByProduct(row, client);
    }

    if (!existing) {
      const code = await resolveCatalogItemCode(row.code || '', null, client);
      row.code = code;
      const { rows } = await client.query(
        `INSERT INTO daily_entry_catalog_items (
          code, name, category, unit, cost_price, markup_percent, price,
          major_unit, minor_unit, minor_quantity_per_major,
          major_unit_selling_price, minor_unit_selling_price,
          is_active, updated_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,TRUE,NOW())
        RETURNING *`,
        catalogItemInsertParams(row)
      );
      await linkCatalogItemCode(code, rows[0].id, client);
      return rows[0];
    }

    const { rows } = await client.query(
      `UPDATE daily_entry_catalog_items
       SET name = $1, category = $2, unit = $3, cost_price = $4, markup_percent = $5, price = $6,
           major_unit = $7, minor_unit = $8, minor_quantity_per_major = $9,
           major_unit_selling_price = $10, minor_unit_selling_price = $11,
           is_active = TRUE, updated_at = NOW()
       WHERE id = $12
       RETURNING *`,
      [...catalogItemInsertParams(row).slice(1), existing.id]
    );
    return rows[0];
  });
}

async function importCatalogRows(rows = []) {
  const result = await importCatalogRowsTransactional(
    rows.map((row, index) => ({ ...row, row_number: row.row_number || index + 2 }))
  );
  return {
    imported: result.inserted + result.updated,
    inserted: result.inserted,
    updated: result.updated,
    skipped: result.skipped,
    duplicates: result.duplicates,
    conflicts: result.conflicts,
    errors: result.errors.map((e) => e.message || String(e)),
    stats: result.stats,
  };
}

async function parseCsvCatalog(text) {
  const table = parseCsvRaw(text);
  const detection = detectColumnMapping(table.headers, CATALOG_IMPORT_SCHEMA);
  const mapped = applyColumnMapping(table.rows, table.headers, detection.mapping, CATALOG_IMPORT_SCHEMA);
  return mapped.map((row) => normalizeImportRow(row));
}

async function parseExcelCatalog(buffer) {
  const table = await parseExcelRaw(buffer);
  const detection = detectColumnMapping(table.headers, CATALOG_IMPORT_SCHEMA);
  const mapped = applyColumnMapping(table.rows, table.headers, detection.mapping, CATALOG_IMPORT_SCHEMA);
  return mapped.map((row) => normalizeImportRow(row)).filter((row) => row.code || row.name);
}

async function exportCatalogCsv() {
  const items = await listCatalogItems({ active_only: false });
  const header = [
    'Code',
    'Item Name',
    'Category',
    'Major Unit',
    'Minor Unit',
    'Minor Quantity Per Major Unit',
    'Major Unit Selling Price',
    'Minor Unit Selling Price',
    'Cost Price',
    'Markup %',
  ];
  const lines = [header.join(',')];
  for (const item of items) {
    const units = normalizeUnitFields(item);
    lines.push(
      [
        item.code,
        `"${String(item.name).replace(/"/g, '""')}"`,
        item.category,
        units.major_unit,
        units.minor_unit,
        units.minor_quantity_per_major,
        units.major_unit_selling_price,
        units.minor_unit_selling_price,
        item.category === 'Supplies' ? Number(item.cost_price) || 0 : '',
        item.category === 'Supplies' ? Number(item.markup_percent) || 0 : '',
      ].join(',')
    );
  }
  return lines.join('\n');
}

module.exports = {
  CATALOG_CATEGORIES,
  listCatalogItems,
  getCatalogItemById,
  getCatalogItemByCode,
  findCatalogItemByProduct,
  getCatalogStats,
  catalogItemToPicker,
  createCatalogItem,
  updateCatalogItem,
  setCatalogItemActive,
  validateCatalogPayload,
  importCatalogRows,
  importCatalogRowsTransactional,
  analyzeCatalogImportFile,
  analyzeImportRows,
  mergeImportRowsByProduct,
  confirmCatalogImportFile,
  parseCsvCatalog,
  parseExcelCatalog,
  exportCatalogCsv,
  normalizeCategory,
  normalizeUnitFields,
  catalogItemConfigKey,
  catalogItemProductKey,
  resolveCatalogUnitPrice,
  convertMinorToMajorQuantity,
  computeSellingPrice,
  computeMarginAmount,
  CATALOG_IMPORT_SCHEMA,
};
