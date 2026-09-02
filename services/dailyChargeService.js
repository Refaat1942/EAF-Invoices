const { query, withTransaction } = require('../database/db');
const { getDefaultPriceList } = require('./priceListService');
const { listServices, resolveServiceForInvoice, getServiceById, enrichServicesWithResolvedPrices } = require('./serviceCatalogService');
const { upsertPatient } = require('./patientService');

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

/** إقامة / مرافق / نقطة تمريض — المبلغ يدوي فقط (لا سعر تلقائي من اللائحة). */
const MANUAL_AMOUNT_SECTION_CODES = Object.freeze([
  'accommodation',
  'companion',
  'nursing_point',
  'patient_assistant',
]);

function isManualAmountSection(sectionOrCode) {
  const code = typeof sectionOrCode === 'string' ? sectionOrCode : sectionOrCode?.code;
  return MANUAL_AMOUNT_SECTION_CODES.includes(String(code || '').trim());
}

function buildDailyLinesFingerprint(lines = []) {
  return (lines || [])
    .map((line) =>
      [
        line.section_code,
        line.service_id || '',
        line.catalog_item_id || '',
        round2(line.amount),
        line.catalog_unit_level || '',
        round2(line.quantity || 1),
        line.extra_date || '',
        String(line.extra_text || '').trim(),
      ].join('|')
    )
    .sort()
    .join(';');
}

const BUSINESS_TIMEZONE = process.env.BUSINESS_TIMEZONE || 'Africa/Cairo';

function getCurrentBusinessDateString() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: BUSINESS_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function normalizeCalendarDate(value) {
  if (value === undefined || value === null || value === '') return '';
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return '';
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, '0');
    const d = String(value.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  const text = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) return text.slice(0, 10);
  const parsed = new Date(text);
  if (!Number.isNaN(parsed.getTime())) {
    const y = parsed.getFullYear();
    const m = String(parsed.getMonth() + 1).padStart(2, '0');
    const d = String(parsed.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  return '';
}

function resolveAllowedDailyEntryDate(submittedDate) {
  const allowed = getCurrentBusinessDateString();
  const hasSubmitted =
    submittedDate !== undefined && submittedDate !== null && String(submittedDate).trim() !== '';
  if (hasSubmitted) {
    const submitted = normalizeCalendarDate(submittedDate);
    if (!submitted) {
      throw new Error('تاريخ اليوم غير صالح');
    }
    if (submitted !== allowed) {
      throw new Error(
        `لا يمكن تسجيل الحركة اليومية إلا لتاريخ اليوم (${allowed}) — التاريخ المُرسَل (${submitted}) غير مقبول`
      );
    }
  }
  return allowed;
}

function assertExistingEntryDateIsToday(existingEntryDate) {
  const allowed = getCurrentBusinessDateString();
  const existing = normalizeCalendarDate(existingEntryDate);
  if (!existing || existing !== allowed) {
    const shown = existing || '—';
    throw new Error(
      `لا يمكن تعديل حركة يوم سابق (${shown}) — التسجيل والتعديل متاح لليوم الحالي فقط (${allowed})`
    );
  }
}

function formatDailyEntryDateLabel(value) {
  if (value === undefined || value === null || value === '') return '';
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return '';
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, '0');
    const d = String(value.getDate()).padStart(2, '0');
    return `${d}-${m}-${y}`;
  }
  const text = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) {
    const [y, m, d] = text.slice(0, 10).split('-');
    return `${d}-${m}-${y}`;
  }
  if (/GMT|Coordinated Universal Time/i.test(text)) {
    const parsed = new Date(text);
    if (!Number.isNaN(parsed.getTime())) return formatDailyEntryDateLabel(parsed);
    return '';
  }
  if (/^\d{2}-\d{2}-\d{4}$/.test(text)) return text;
  const parsed = new Date(text);
  if (!Number.isNaN(parsed.getTime())) return formatDailyEntryDateLabel(parsed);
  return text.slice(0, 10);
}

function buildDailyItemDescription(entryDate, name, extraText = '') {
  const dateLabel = formatDailyEntryDateLabel(entryDate);
  let desc = String(name || '').trim();
  if (/GMT|Coordinated Universal Time/i.test(desc)) desc = '';
  if (extraText) desc = desc ? `${desc} (${extraText})` : String(extraText);
  return dateLabel ? `[${dateLabel}] ${desc}`.trim() : desc;
}

function isGmtDescription(text) {
  return /GMT|Coordinated Universal Time/i.test(String(text || ''));
}

function resolveDailyItemName(item, ctx, section, resolved) {
  const candidates = [
    ctx?.line_description,
    ctx?.description,
    resolved?.description,
    ctx?.catalog_item_name,
    ctx?.service_name,
    item?.service_name_snapshot,
    item?.description,
    section?.name,
  ];
  for (const candidate of candidates) {
    const text = String(candidate || '').trim();
    if (text && !isGmtDescription(text)) return text;
  }
  return 'بند يومي';
}

async function loadDailyLineContextMap(lineIds = []) {
  const ids = [...new Set(lineIds.map(Number).filter(Boolean))];
  if (!ids.length) return {};
  const { rows } = await query(
    `SELECT l.id AS line_id, l.section_code, l.extra_text, l.service_id, l.catalog_item_id,
            l.unit_price, l.amount, l.quantity, l.cost_price, l.markup_percent,
            l.catalog_unit, l.catalog_unit_level, l.description AS line_description,
            s.name AS service_name, c.name AS catalog_item_name,
            e.entry_date, e.id AS entry_id, dcs.sort_order AS section_sort_order
     FROM patient_daily_entry_lines l
     JOIN patient_daily_entries e ON e.id = l.entry_id
     LEFT JOIN services s ON s.id = l.service_id
     LEFT JOIN daily_entry_catalog_items c ON c.id = l.catalog_item_id
     LEFT JOIN daily_charge_sections dcs ON dcs.code = l.section_code
     WHERE l.id = ANY($1::int[])`,
    [ids]
  );
  return Object.fromEntries(rows.map((row) => [row.line_id, row]));
}

async function listSections() {
  const { rows } = await query(
    `SELECT * FROM daily_charge_sections WHERE is_active = TRUE ORDER BY sort_order, id`
  );
  return rows;
}

async function getSectionsWithServices() {
  const sections = await listSections();
  const { getCatalogStats, catalogItemToPicker } = require('./dailyEntryCatalogService');
  const stats = await getCatalogStats();
  const countByCategory = Object.fromEntries((stats.by_category || []).map((row) => [row.category, row.count]));
  const priceList = await getDefaultPriceList();

  return Promise.all(
    sections.map(async (section) => {
      if (section.catalog_category) {
        return {
          ...section,
          uses_catalog: true,
          catalog_count: countByCategory[section.catalog_category] || 0,
          services: [],
          picker_kind: 'catalog',
          default_service: null,
          price_list_id: priceList?.id || null,
          price_list_name: priceList?.name || null,
        };
      }

      if (!priceList) {
        return {
          ...section,
          services: [],
          service_count: 0,
          picker_kind: section.category_code ? 'service' : null,
          default_service: null,
          price_list_id: null,
          price_list_name: null,
        };
      }

      const countRes = await query(
        `SELECT COUNT(*)::int AS n
         FROM services s
         INNER JOIN service_categories c ON c.id = s.category_id
         WHERE s.price_list_id = $1 AND c.code = $2 AND s.is_active = TRUE`,
        [priceList.id, section.category_code]
      );
      const service_count = countRes.rows[0]?.n || 0;
      const default_service = await resolveDefaultServiceForSection(section, priceList);
      return {
        ...section,
        price_list_id: priceList.id,
        price_list_name: priceList.name,
        service_count,
        services: default_service ? [serviceToDailyPicker(default_service)] : [],
        picker_kind: section.category_code ? 'service' : null,
        default_service: default_service ? serviceToDailyPicker(default_service) : null,
      };
    })
  );
}

function serviceToDailyPicker(service) {
  if (!service) return null;
  const price = Number(service.list_price ?? service.price) || 0;
  return {
    id: service.id,
    code: service.code || '',
    name: service.name || '',
    price,
    list_price: price,
    unit: service.unit || '',
    category_name: service.category_name || '',
    category_code: service.category_code || '',
  };
}

async function resolveDefaultServiceForSection(section, priceList) {
  if (!priceList || !section.category_code) return null;

  const enrichFirst = async (rows) => {
    if (!rows.length) return null;
    const enriched = await enrichServicesWithResolvedPrices(rows);
    return enriched[0] || null;
  };

  if (section.default_service_code) {
    const exact = await query(
      `SELECT s.*, c.name AS category_name, c.code AS category_code
       FROM services s
       INNER JOIN service_categories c ON c.id = s.category_id
       WHERE s.price_list_id = $1 AND c.code = $2 AND s.code = $3 AND s.is_active = TRUE
       LIMIT 1`,
      [priceList.id, section.category_code, section.default_service_code]
    );
    if (exact.rows.length) return await enrichFirst(exact.rows);
  }

  const fallback = await query(
    `SELECT s.*, c.name AS category_name, c.code AS category_code
     FROM services s
     INNER JOIN service_categories c ON c.id = s.category_id
     WHERE s.price_list_id = $1 AND c.code = $2 AND s.is_active = TRUE
     ORDER BY s.sort_order, s.name, s.id
     LIMIT 1`,
    [priceList.id, section.category_code]
  );
  return await enrichFirst(fallback.rows);
}

async function getSectionByCode(sectionCode) {
  const sections = await listSections();
  const section = sections.find((s) => s.code === sectionCode);
  if (!section) {
    const err = new Error('القسم غير موجود');
    err.status = 404;
    throw err;
  }
  return section;
}

async function searchDailyPickerItems({ section_code, search, page = 1, limit = 20 }) {
  const section = await getSectionByCode(section_code);
  const pageNum = Math.max(1, Number(page) || 1);
  const maxLimit = Math.min(50, Math.max(1, Number(limit) || 20));
  const q = String(search || '').trim();

  if (section.catalog_category) {
    const { listCatalogItemsPaginated, catalogItemToPicker } = require('./dailyEntryCatalogService');
    if (q.length < 2) {
      return {
        rows: [],
        total: 0,
        page: pageNum,
        limit: maxLimit,
        totalPages: 1,
        kind: 'catalog',
        min_search: 2,
      };
    }
    const result = await listCatalogItemsPaginated({
      category: section.catalog_category,
      search: q,
      page: pageNum,
      limit: maxLimit,
      active_only: true,
      sort: 'name',
      order: 'asc',
    });
    return {
      rows: result.rows.map(catalogItemToPicker),
      total: result.total,
      page: result.page,
      limit: result.limit,
      totalPages: result.totalPages,
      kind: 'catalog',
    };
  }

  if (section.input_type !== 'amount' || !section.category_code) {
    return { rows: [], total: 0, page: pageNum, limit: maxLimit, totalPages: 1, kind: 'none' };
  }

  const priceList = await getDefaultPriceList();
  if (!priceList) {
    return { rows: [], total: 0, page: pageNum, limit: maxLimit, totalPages: 1, kind: 'service' };
  }

  if (q.length < 2) {
    return {
      rows: [],
      total: 0,
      page: pageNum,
      limit: maxLimit,
      totalPages: 1,
      kind: 'service',
      min_search: 2,
    };
  }

  const categoryRes = await query(`SELECT id FROM service_categories WHERE code = $1`, [section.category_code]);
  const categoryId = categoryRes.rows[0]?.id;
  if (!categoryId) {
    return { rows: [], total: 0, page: pageNum, limit: maxLimit, totalPages: 1, kind: 'service' };
  }

  const searchPat = `%${q}%`;
  const offset = (pageNum - 1) * maxLimit;
  const countRes = await query(
    `SELECT COUNT(*)::int AS total FROM services s
     WHERE s.price_list_id = $1 AND s.category_id = $2 AND s.is_active = TRUE
       AND (s.name ILIKE $3 OR s.code ILIKE $3 OR s.description ILIKE $3)`,
    [priceList.id, categoryId, searchPat]
  );
  const total = countRes.rows[0]?.total || 0;

  const { rows } = await query(
    `SELECT s.*, c.name AS category_name, c.code AS category_code
     FROM services s
     LEFT JOIN service_categories c ON c.id = s.category_id
     WHERE s.price_list_id = $1 AND s.category_id = $2 AND s.is_active = TRUE
       AND (s.name ILIKE $3 OR s.code ILIKE $3 OR s.description ILIKE $3)
     ORDER BY s.sort_order, s.name, s.id
     LIMIT $4 OFFSET $5`,
    [priceList.id, categoryId, searchPat, maxLimit, offset]
  );
  const enriched = await enrichServicesWithResolvedPrices(rows);

  return {
    rows: enriched.map(serviceToDailyPicker),
    total,
    page: pageNum,
    limit: maxLimit,
    totalPages: Math.max(1, Math.ceil(total / maxLimit)),
    kind: 'service',
  };
}

async function getDailyPickerItemBySection(section_code, id) {
  const section = await getSectionByCode(section_code);
  const itemId = Number(id);
  if (!itemId) {
    const err = new Error('معرّف الصنف/الخدمة غير صالح');
    err.status = 400;
    throw err;
  }

  if (section.catalog_category) {
    const { getCatalogItemById, catalogItemToPicker } = require('./dailyEntryCatalogService');
    const item = await getCatalogItemById(itemId);
    if (!item || !item.is_active) {
      const err = new Error('الصنف غير موجود');
      err.status = 404;
      throw err;
    }
    if (item.category !== section.catalog_category) {
      const err = new Error('الصنف لا يطابق فئة هذا القسم');
      err.status = 400;
      throw err;
    }
    return { kind: 'catalog', item: catalogItemToPicker(item) };
  }

  if (!section.category_code) {
    const err = new Error('هذا القسم لا يدعم اختيار خدمة');
    err.status = 400;
    throw err;
  }

  const service = await getServiceById(itemId);
  if (!service || !service.is_active) {
    const err = new Error('الخدمة غير موجودة');
    err.status = 404;
    throw err;
  }
  if (service.category_code !== section.category_code) {
    const err = new Error('الخدمة لا تطابق فئة هذا القسم');
    err.status = 400;
    throw err;
  }
  const enriched = await enrichServicesWithResolvedPrices([service]);
  return { kind: 'service', item: serviceToDailyPicker(enriched[0]) };
}

async function resolvePatient(fileNumber, patientName = '') {
  if (!fileNumber?.trim()) throw new Error('رقم الملف مطلوب');
  return upsertPatient(fileNumber.trim(), patientName || '');
}

function normalizeLine(section, rawLine = {}) {
  const inputType = section.input_type || 'amount';
  if (inputType === 'date') {
    return {
      id: Number(rawLine.id || rawLine.line_id) || null,
      section_code: section.code,
      service_id: null,
      description: section.name,
      quantity: 1,
      unit_price: 0,
      amount: 0,
      extra_date: rawLine.extra_date || rawLine.value || null,
      extra_text: '',
    };
  }
  if (inputType === 'text') {
    return {
      id: Number(rawLine.id || rawLine.line_id) || null,
      section_code: section.code,
      service_id: rawLine.service_id || null,
      description: section.name,
      quantity: 1,
      unit_price: 0,
      amount: 0,
      extra_date: null,
      extra_text: String(rawLine.extra_text || rawLine.value || '').trim(),
    };
  }

  const amount = round2(rawLine.amount ?? rawLine.value ?? 0);
  const serviceId = rawLine.service_id || null;
  const quantity = round2(rawLine.quantity || 1) || 1;
  let unitPrice = round2(rawLine.unit_price || 0);
  if (!unitPrice && amount && quantity) unitPrice = round2(amount / quantity);

  return {
    id: Number(rawLine.id || rawLine.line_id) || null,
    section_code: section.code,
    service_id: serviceId,
    catalog_item_id: rawLine.catalog_item_id || null,
    catalog_unit: rawLine.catalog_unit || null,
    catalog_unit_level: rawLine.catalog_unit_level || null,
    description: rawLine.description || section.name,
    quantity,
    unit_price: unitPrice,
    amount,
    extra_date: rawLine.extra_date || null,
    extra_text: rawLine.extra_text || '',
    weight: rawLine.weight != null && rawLine.weight !== '' ? Number(rawLine.weight) : null,
  };
}

const DAILY_STAMP_LINE_CODES = ['consultation_stamp', 'analyses_stamp', 'xray_stamp'];

async function computeDailyStampLinesTotal(fileNumber) {
  const fn = String(fileNumber || '').trim();
  if (!fn) return { raw: 0, rounded: 0 };
  const { rows } = await query(
    `SELECT COALESCE(SUM(l.amount), 0) AS total
     FROM patient_daily_entry_lines l
     JOIN patient_daily_entries e ON e.id = l.entry_id
     JOIN patients p ON p.id = e.patient_id
     WHERE TRIM(p.file_number) = TRIM($1)
       AND l.section_code = ANY($2::text[])`,
    [fn, DAILY_STAMP_LINE_CODES]
  );
  const raw = round2(rows[0]?.total);
  return { raw, rounded: round2(raw) };
}

function computeDailyTotal(lines, sections) {
  const amountSections = new Set(
    sections.filter((s) => s.input_type === 'amount').map((s) => s.code)
  );
  return round2(
    lines.filter((line) => amountSections.has(line.section_code)).reduce((sum, line) => sum + round2(line.amount), 0)
  );
}

async function getEntryById(entryId, client = null) {
  const id = Number(entryId);
  if (!id) return null;
  const run = client ? client.query.bind(client) : query;
  const { rows } = await run(
    `SELECT e.*, p.file_number, p.name AS patient_name, st.name AS stay_type_name
     FROM patient_daily_entries e
     JOIN patients p ON p.id = e.patient_id
     LEFT JOIN stay_types st ON st.id = e.stay_type_id
     WHERE e.id = $1`,
    [id]
  );
  if (!rows.length) return null;
  const entry = rows[0];
  const { rows: lineRows } = await run(
    `SELECT l.*, s.name AS service_name, s.code AS service_code,
            c.name AS catalog_item_name, c.code AS catalog_item_code, c.category AS catalog_item_category
     FROM patient_daily_entry_lines l
     LEFT JOIN services s ON s.id = l.service_id
     LEFT JOIN daily_entry_catalog_items c ON c.id = l.catalog_item_id
     WHERE l.entry_id = $1
     ORDER BY l.sort_order, l.id`,
    [entry.id]
  );
  entry.lines = lineRows;
  return entry;
}

async function getEntryByPatientDate(patientId, entryDate, client = null) {
  const run = client ? client.query.bind(client) : query;
  const { rows } = await run(
    `SELECT e.*, p.file_number, p.name AS patient_name, st.name AS stay_type_name
     FROM patient_daily_entries e
     JOIN patients p ON p.id = e.patient_id
     LEFT JOIN stay_types st ON st.id = e.stay_type_id
     WHERE e.patient_id = $1 AND e.entry_date = $2`,
    [patientId, entryDate]
  );
  if (!rows.length) return null;
  const entry = rows[0];
  const { rows: lineRows } = await run(
    `SELECT l.*, s.name AS service_name, s.code AS service_code,
            c.name AS catalog_item_name, c.code AS catalog_item_code, c.category AS catalog_item_category
     FROM patient_daily_entry_lines l
     LEFT JOIN services s ON s.id = l.service_id
     LEFT JOIN daily_entry_catalog_items c ON c.id = l.catalog_item_id
     WHERE l.entry_id = $1
     ORDER BY l.sort_order, l.id`,
    [entry.id]
  );
  entry.lines = lineRows;
  return entry;
}

async function listEntries(filters = {}) {
  let sql = `
    SELECT e.*, p.file_number, p.name AS patient_name, st.name AS stay_type_name
    FROM patient_daily_entries e
    JOIN patients p ON p.id = e.patient_id
    LEFT JOIN stay_types st ON st.id = e.stay_type_id
    WHERE 1=1`;
  const params = [];
  let i = 1;

  if (filters.patient_id) {
    sql += ` AND e.patient_id = $${i++}`;
    params.push(Number(filters.patient_id));
  }
  if (filters.file_number) {
    sql += ` AND p.file_number = $${i++}`;
    params.push(filters.file_number.trim());
  }
  if (filters.from_date) {
    sql += ` AND e.entry_date >= $${i++}`;
    params.push(filters.from_date);
  }
  if (filters.to_date) {
    sql += ` AND e.entry_date <= $${i++}`;
    params.push(filters.to_date);
  }
  if (filters.uninvoiced_only) {
    sql += ` AND e.invoice_id IS NULL`;
  }
  if (filters.invoice_id) {
    sql += ` AND e.invoice_id = $${i++}`;
    params.push(Number(filters.invoice_id));
  }

  sql += filters.include_lines ? ` ORDER BY e.entry_date ASC, e.id ASC` : ` ORDER BY e.entry_date DESC, e.id DESC`;
  if (filters.limit) {
    sql += ` LIMIT $${i++}`;
    params.push(Number(filters.limit));
  }

  const { rows } = await query(sql, params);

  if (filters.include_lines && rows.length) {
    const entryIds = rows.map((r) => r.id);
    const { rows: lineRows } = await query(
      `SELECT l.*, s.name AS service_name, s.code AS service_code,
              c.name AS catalog_item_name, c.code AS catalog_item_code, c.category AS catalog_item_category
       FROM patient_daily_entry_lines l
       LEFT JOIN services s ON s.id = l.service_id
       LEFT JOIN daily_entry_catalog_items c ON c.id = l.catalog_item_id
       WHERE l.entry_id = ANY($1::int[])
       ORDER BY l.entry_id, l.sort_order, l.id`,
      [entryIds]
    );
    const linesByEntry = {};
    for (const line of lineRows) {
      if (!linesByEntry[line.entry_id]) linesByEntry[line.entry_id] = [];
      linesByEntry[line.entry_id].push(line);
    }
    for (const row of rows) {
      row.lines = linesByEntry[row.id] || [];
    }
  }

  return rows;
}

async function listEntryHistory(entryId) {
  const { rows } = await query(
    `SELECT * FROM patient_daily_entry_history WHERE entry_id = $1 ORDER BY created_at DESC, id DESC`,
    [entryId]
  );
  return rows;
}

async function validateServiceForSection(section, serviceId, sectionsWithServices = null) {
  const catalog = sectionsWithServices || await getSectionsWithServices();
  const full = catalog.find((s) => s.code === section.code);
  const allowed = full?.services || [];

  if (allowed.length) {
    const found = allowed.find((s) => Number(s.id) === Number(serviceId));
    if (!found) {
      throw new Error(`قسم «${section.name}»: الخدمة المختارة ليست في اللائحة الحالية لهذا القسم`);
    }
    return found;
  }

  const service = await getServiceById(serviceId);
  if (!service || !service.is_active) {
    throw new Error(`قسم «${section.name}»: الخدمة غير موجودة في اللائحة`);
  }
  if (full?.category_code && service.category_code && service.category_code !== full.category_code) {
    throw new Error(`قسم «${section.name}»: الخدمة لا تنتمي لهذا القسم في اللائحة`);
  }
  return service;
}

async function normalizeManualAmountLine(section, rawLine = {}, sectionsWithServices = null) {
  const normalized = normalizeLine(section, rawLine);
  if (section.input_type !== 'amount') return normalized;

  const amount = round2(normalized.amount);
  if (amount <= 0) return normalized;

  normalized.unit_price = amount;
  normalized.quantity = 1;
  normalized.amount = amount;

  if (normalized.service_id) {
    await validateServiceForSection(section, normalized.service_id, sectionsWithServices);
    try {
      const resolved = await resolveServiceForInvoice(Number(normalized.service_id));
      normalized.description =
        resolved.service_name_snapshot || resolved.description || normalized.description || section.name;
    } catch {
      normalized.description = normalized.description || section.name;
    }
  } else {
    normalized.description = section.name;
  }

  return normalized;
}

async function normalizeCatalogLine(section, rawLine = {}, sectionsWithServices = null) {
  const normalized = normalizeLine(section, rawLine);
  if (section.input_type !== 'amount') return normalized;

  const catalogItemId = rawLine.catalog_item_id || normalized.catalog_item_id;
  const qty = round2(normalized.quantity || 1) || 1;
  const hasCatalog = Boolean(catalogItemId);
  const hasAmountInput = round2(normalized.amount) > 0;

  if (!hasCatalog) {
    if (hasAmountInput) {
      throw new Error(`قسم «${section.name}»: يجب اختيار صنف من الكتالوج — السعر يُؤخذ من الكتالوج فقط`);
    }
    return normalized;
  }

  const fullSection = (sectionsWithServices || []).find((s) => s.code === section.code) || section;
  const allowed = fullSection?.services || [];
  const found = allowed.find((s) => Number(s.id) === Number(catalogItemId));

  let catalogItem;
  if (found) {
    catalogItem = {
      id: found.id,
      name: found.name,
      price: found.price,
      unit: found.unit,
      code: found.code,
      category: found.category_name,
      cost_price: found.cost_price,
      markup_percent: found.markup_percent,
      major_unit: found.major_unit || found.unit,
      minor_unit: found.minor_unit || found.unit,
      minor_quantity_per_major: found.minor_quantity_per_major,
      major_unit_selling_price: found.major_unit_selling_price ?? found.price,
      minor_unit_selling_price: found.minor_unit_selling_price ?? found.price,
      unit_options: found.unit_options,
    };
  } else {
    const { getCatalogItemById } = require('./dailyEntryCatalogService');
    catalogItem = await getCatalogItemById(catalogItemId);
    if (!catalogItem || !catalogItem.is_active) {
      throw new Error(`قسم «${section.name}»: الصنف غير موجود في الكتالوج`);
    }
    if (fullSection.catalog_category && catalogItem.category !== fullSection.catalog_category) {
      throw new Error(`قسم «${section.name}»: الصنف لا ينتمي لهذه الفئة`);
    }
  }

  const { resolveCatalogUnitPrice, computeSellingPrice } = require('./dailyEntryCatalogService');
  const unitLevel = rawLine.catalog_unit_level || normalized.catalog_unit_level;
  const unitLabel = rawLine.catalog_unit || normalized.catalog_unit;
  let selection = resolveCatalogUnitPrice(catalogItem, unitLevel || 'major');
  if (unitLabel) {
    const options = catalogItem.unit_options || [];
    const byUnit = options.find((opt) => opt.unit === unitLabel);
    if (byUnit) {
      selection = {
        level: byUnit.level,
        unit: byUnit.unit,
        unitPrice: round2(byUnit.price),
        minorQuantityPerMajor: byUnit.minorQuantityPerMajor,
      };
    }
  }

  let unitPrice = round2(selection.unitPrice);
  const isSuppliesItem = catalogItem.category === 'Supplies' || fullSection.catalog_category === 'Supplies';
  const costPrice = round2(catalogItem.cost_price);
  let markupPercent = round2(catalogItem.markup_percent);

  // Supplies rows let staff override the markup % per line (e.g. a special discount/uplift
  // for a specific patient). The frontend recomputes the displayed price from cost*(1+markup/100)
  // — honor that same override here instead of silently reverting to the catalog default.
  if (isSuppliesItem && costPrice > 0 && rawLine.markup_percent != null && rawLine.markup_percent !== '') {
    const overrideMarkup = round2(rawLine.markup_percent);
    if (overrideMarkup < 0) {
      throw new Error(`قسم «${section.name}»: نسبة الربح يجب ألا تقل عن صفر`);
    }
    markupPercent = overrideMarkup;
    const minorQty = round2(selection.minorQuantityPerMajor) || 1;
    unitPrice =
      selection.level === 'minor' && minorQty > 1
        ? round2(computeSellingPrice(costPrice, overrideMarkup) / minorQty)
        : computeSellingPrice(costPrice, overrideMarkup);
  }

  if (unitPrice <= 0) {
    throw new Error(`قسم «${section.name}»: الصنف «${catalogItem.name}» ليس له سعر صالح في الكتالوج`);
  }

  normalized.catalog_item_id = catalogItem.id;
  normalized.service_id = null;
  normalized.catalog_unit = selection.unit;
  normalized.catalog_unit_level = selection.level;
  normalized.unit_price = unitPrice;
  normalized.quantity = qty;
  normalized.amount = round2(unitPrice * qty);
  normalized.description = catalogItem.name;
  if (isSuppliesItem) {
    normalized.cost_price = costPrice;
    normalized.markup_percent = markupPercent;
  }
  return normalized;
}

async function normalizeLineWithPrice(section, rawLine = {}, sectionsWithServices = null) {
  const fullSection = (sectionsWithServices || []).find((s) => s.code === section.code) || section;
  if (fullSection.catalog_category || rawLine.catalog_item_id) {
    return await normalizeCatalogLine(fullSection, rawLine, sectionsWithServices);
  }

  if (isManualAmountSection(section)) {
    return await normalizeManualAmountLine(section, rawLine, sectionsWithServices);
  }

  const normalized = normalizeLine(section, rawLine);
  if (section.input_type !== 'amount') return normalized;

  const qty = round2(normalized.quantity || 1) || 1;
  const hasService = Boolean(normalized.service_id);
  const hasAmountInput = round2(normalized.amount) > 0;

  if (!hasService) {
    if (hasAmountInput) {
      throw new Error(`قسم «${section.name}»: يجب اختيار خدمة من اللائحة — السعر يُؤخذ من اللائحة فقط`);
    }
    return normalized;
  }

  await validateServiceForSection(section, normalized.service_id, sectionsWithServices);

  let resolved;
  try {
    resolved = await resolveServiceForInvoice(Number(normalized.service_id));
  } catch (err) {
    throw new Error(`قسم «${section.name}»: ${err.message || 'الخدمة غير موجودة في اللائحة'}`);
  }

  const unitPrice = round2(resolved.amount);
  if (unitPrice <= 0) {
    const label = resolved.service_name_snapshot || resolved.description || normalized.service_id;
    throw new Error(`قسم «${section.name}»: الخدمة «${label}» ليس لها سعر صالح في اللائحة`);
  }

  normalized.service_id = resolved.service_id;
  normalized.unit_price = unitPrice;
  normalized.quantity = qty;
  normalized.amount = round2(unitPrice * qty);
  normalized.description = resolved.service_name_snapshot || resolved.description || section.name;
  return normalized;
}

async function prepareEntrySaveContext(data) {
  const patient = await resolvePatient(data.file_number, data.patient_name);
  const allowBackfill = data.allow_backfill === true;
  const entryDate = allowBackfill
    ? normalizeCalendarDate(data.entry_date) || getCurrentBusinessDateString()
    : resolveAllowedDailyEntryDate(data.entry_date);

  const sections = await listSections();
  const sectionsWithServices = await getSectionsWithServices();
  const rawLines = Array.isArray(data.lines) ? data.lines : [];
  const lines = [];

  // A line whose section_code doesn't match any known section would otherwise be
  // silently skipped below (never validated, never persisted, no error shown) —
  // fail loudly instead so a section rename/typo can never cause silent data loss.
  const knownSectionCodes = new Set(sections.map((s) => s.code));
  const badCodes = new Set(
    rawLines
      .map((line) => String(line?.section_code || '').trim())
      .filter((code) => !code || !knownSectionCodes.has(code))
  );
  if (badCodes.size) {
    const label = [...badCodes].map((c) => c || '(بدون قسم)').join(', ');
    throw new Error(`بند بقسم غير معروف: ${label} — أعد تحميل الصفحة وحاول مرة أخرى`);
  }

  for (const section of sections) {
    const matching = rawLines.filter((line) => line.section_code === section.code);
    if (!matching.length) continue;
    for (const raw of matching) {
      const normalized = await normalizeLineWithPrice(section, raw, sectionsWithServices);
      const hasValue =
        section.input_type === 'date'
          ? Boolean(normalized.extra_date)
          : section.input_type === 'text'
            ? Boolean(normalized.extra_text)
            : Number(normalized.amount) > 0;
      if (hasValue) lines.push(normalized);
    }
  }

  if (data.stay_type_id) {
    await enrichStayLinesFromStayType(lines, data.stay_type_id, sections);
  }

  const dailyTotal = computeDailyTotal(lines, sections);
  const isNewEntry = !Number(data.entry_id || data.id);

  return {
    patient,
    entryDate,
    lines,
    dailyTotal,
    isNewEntry,
    allowBackfill,
  };
}

async function enrichStayLinesFromStayType(lines, stayTypeId, sections) {
  const stayId = Number(stayTypeId);
  if (!stayId) return lines;
  const accSection = sections.find((s) => s.code === 'accommodation');
  if (!accSection) return lines;

  let accLine = lines.find((l) => l.section_code === 'accommodation');
  if (accLine && round2(accLine.amount) > 0) return lines;

  const grades = await listAccommodationStayGrades();
  const grade = grades.find((g) => Number(g.stay_type_id) === stayId);
  const rate = round2(grade?.daily_rate) || 0;
  if (rate <= 0) return lines;

  if (!accLine) {
    accLine = {
      section_code: 'accommodation',
      amount: rate,
      quantity: 1,
      unit_price: rate,
      description: accSection.name,
    };
    lines.push(accLine);
  } else {
    accLine.amount = rate;
    accLine.unit_price = rate;
    accLine.quantity = 1;
  }
  if (grade?.service_id) accLine.service_id = grade.service_id;
  return lines;
}

async function getSupplementalInvoiceItems(fileNumber, fromDate, toDate) {
  const fn = String(fileNumber || '').trim();
  if (!fn) return [];
  const patient = await resolvePatient(fn);
  const from = normalizeCalendarDate(fromDate);
  const to = normalizeCalendarDate(toDate);
  const items = [];

  const { listOperationsInRange } = require('./patientOperationService');
  const operations = await listOperationsInRange(patient.id, from, to);
  for (const op of operations) {
    const amount = round2(op.amount);
    if (amount <= 0) continue;
    const dateLabel = formatDailyEntryDateLabel(op.entry_date);
    const detailParts = [op.operation_name || 'عملية'];
    const startTime = String(op.operation_start_time || '').trim();
    const endTime = String(op.operation_end_time || '').trim();
    if (startTime && endTime) {
      detailParts.push(`من ${startTime} إلى ${endTime}`);
    } else if (Number(op.duration_hours) > 0) {
      detailParts.push(`مدة ${op.duration_hours} ساعة`);
    }
    if (op.surgeon_name) detailParts.push(`جراح: ${op.surgeon_name}`);
    if (op.anesthesia_doctor) detailParts.push(`تخدير: ${op.anesthesia_doctor}`);
    if (op.assistant_surgeon) detailParts.push(`مساعد جراح: ${op.assistant_surgeon}`);
    items.push({
      description: buildDailyItemDescription(dateLabel, `عملية — ${detailParts.join(' — ')}`, ''),
      quantity: 1,
      amount,
      section_code: 'operations',
      section_sort_order: 45,
      patient_operation_id: op.id,
    });
  }

  const glassesPrice = round2(patient.glasses_price);
  const glassesDisc = round2(patient.glasses_discount_percent);
  const glassesFinal = round2(glassesPrice * (1 - glassesDisc / 100));
  const glassesDate = normalizeCalendarDate(patient.glasses_start_date);
  if (glassesFinal > 0 && glassesDate && from && to && glassesDate >= from && glassesDate <= to) {
    const lens = String(patient.glasses_lens_type || '').trim() || 'نظارات / بصريات';
    items.push({
      description: buildDailyItemDescription(
        formatDailyEntryDateLabel(glassesDate),
        `بصريات — ${lens}`,
        glassesDisc > 0 ? `خصم ${glassesDisc}%` : ''
      ),
      quantity: 1,
      amount: glassesFinal,
      section_code: 'glasses',
      section_sort_order: 46,
    });
  }

  return items;
}

async function resolveEntryDoctorFields(data, existing = null, client = null) {
  const { getDoctorById, normalizeDoctorText } = require('./doctorService');
  const doctorId = Number(data.doctor_id) || null;
  const specialtyInput = normalizeDoctorText(data.doctor_specialty || data.specialty || '');

  if (!doctorId) {
    return {
      doctor_id: null,
      doctor_specialty: specialtyInput,
      doctor_name_snapshot: '',
      doctor_department_snapshot: '',
    };
  }

  const doctor = await getDoctorById(doctorId, client);
  if (!doctor) throw new Error('الطبيب غير موجود');
  const keepingSameInactive =
    existing && Number(existing.doctor_id) === doctor.id && !doctor.is_active;
  if (!doctor.is_active && !keepingSameInactive) {
    throw new Error('لا يمكن اختيار طبيب غير نشط');
  }
  if (
    specialtyInput &&
    normalizeDoctorText(doctor.specialty).toLowerCase() !== specialtyInput.toLowerCase()
  ) {
    throw new Error('التخصص المختار لا يطابق الطبيب');
  }

  return {
    doctor_id: doctor.id,
    doctor_specialty: doctor.specialty,
    doctor_name_snapshot: doctor.name,
    doctor_department_snapshot: doctor.department,
  };
}

async function findDuplicateEntryForLines(client, patientId, entryDate, lines, excludeId = null) {
  const fingerprint = buildDailyLinesFingerprint(lines);
  if (!fingerprint) return null;

  const params = [patientId, entryDate];
  let sql = `SELECT id FROM patient_daily_entries WHERE patient_id = $1 AND entry_date = $2::date`;
  if (excludeId) {
    sql += ` AND id <> $3`;
    params.push(excludeId);
  }
  sql += ` ORDER BY id`;

  const { rows } = await client.query(sql, params);
  for (const row of rows) {
    const entry = await getEntryById(row.id, client);
    if (!entry?.lines) continue;
    if (buildDailyLinesFingerprint(entry.lines) === fingerprint) return entry;
  }
  return null;
}

async function persistEntryInTransaction(client, data, user, context = null) {
  const ctx = context || await prepareEntrySaveContext(data);
  const { patient, entryDate, lines, dailyTotal } = ctx;
  const userId = user?.id || null;
  const userName = user?.full_name || user?.username || '';

  const entryIdInput = Number(data.entry_id || data.id) || null;
  let existing = null;
  if (entryIdInput) {
    const { rows } = await client.query(
      `SELECT * FROM patient_daily_entries WHERE id = $1 AND patient_id = $2`,
      [entryIdInput, patient.id]
    );
    existing = rows[0] || null;
    if (!existing) throw new Error(`الحركة #${entryIdInput} غير موجودة`);
    if (!data.allow_backfill) assertExistingEntryDateIsToday(existing.entry_date);
  } else if (!entryIdInput && lines.length) {
    const duplicate = await findDuplicateEntryForLines(client, patient.id, entryDate, lines);
    if (duplicate) {
      existing = duplicate;
    }
  }

  if (existing?.invoice_id && data.allow_invoiced_edit !== true) {
    const invRes = await client.query('SELECT status FROM invoices WHERE id = $1', [existing.invoice_id]);
    if (invRes.rows[0]?.status === 'approved') {
      throw new Error('لا يمكن تعديل حركة يوم مرتبطة بفاتورة معتمدة');
    }
  }

  let entryId = entryIdInput || existing?.id || null;
  const action = existing ? 'update' : 'create';
  const doctorFields = await resolveEntryDoctorFields(data, existing, client);

  if (existing) {
    await client.query(
      `UPDATE patient_daily_entries SET
        stay_type_id = $1, daily_total = $2, notes = $3,
        doctor_id = $4, doctor_specialty = $5, doctor_name_snapshot = $6, doctor_department_snapshot = $7,
        updated_by_user_id = $8, updated_by_name = $9, updated_at = NOW()
       WHERE id = $10`,
      [
        data.stay_type_id || null,
        dailyTotal,
        data.notes || '',
        doctorFields.doctor_id,
        doctorFields.doctor_specialty,
        doctorFields.doctor_name_snapshot,
        doctorFields.doctor_department_snapshot,
        userId,
        userName,
        existing.id,
      ]
    );

    const { rows: oldLines } = await client.query(
      `SELECT id, section_code FROM patient_daily_entry_lines WHERE entry_id = $1`,
      [existing.id]
    );
    const oldById = Object.fromEntries(oldLines.map((row) => [row.id, row]));
    const incomingIds = new Set(lines.map((line) => Number(line.id)).filter(Boolean));

    for (const oldLine of oldLines) {
      if (!incomingIds.has(oldLine.id)) {
        await client.query(`DELETE FROM patient_daily_entry_lines WHERE id = $1`, [oldLine.id]);
      }
    }

    for (let index = 0; index < lines.length; index++) {
      const line = lines[index];
      const existingLineId = Number(line.id) || 0;
      if (existingLineId && oldById[existingLineId]) {
        await client.query(
          `UPDATE patient_daily_entry_lines SET
            section_code = $1,
            service_id = $2, catalog_item_id = $3, description = $4, quantity = $5,
            unit_price = $6, amount = $7, cost_price = $8, markup_percent = $9,
            catalog_unit = $10, catalog_unit_level = $11,
            extra_date = $12, extra_text = $13, weight = $14, sort_order = $15
           WHERE id = $16`,
          [
            line.section_code,
            line.service_id,
            line.catalog_item_id || null,
            line.description,
            line.quantity,
            line.unit_price,
            line.amount,
            line.cost_price || null,
            line.markup_percent || null,
            line.catalog_unit || null,
            line.catalog_unit_level || null,
            line.extra_date,
            line.extra_text,
            line.weight != null ? line.weight : null,
            index,
            existingLineId,
          ]
        );
      } else {
        await client.query(
          `INSERT INTO patient_daily_entry_lines (
            entry_id, section_code, service_id, catalog_item_id, description, quantity, unit_price, amount,
            cost_price, markup_percent, catalog_unit, catalog_unit_level, extra_date, extra_text, weight, sort_order
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
          [
            existing.id,
            line.section_code,
            line.service_id,
            line.catalog_item_id || null,
            line.description,
            line.quantity,
            line.unit_price,
            line.amount,
            line.cost_price || null,
            line.markup_percent || null,
            line.catalog_unit || null,
            line.catalog_unit_level || null,
            line.extra_date,
            line.extra_text,
            line.weight != null ? line.weight : null,
            index,
          ]
        );
      }
    }
    entryId = existing.id;
  } else {
    const inserted = await client.query(
      `INSERT INTO patient_daily_entries (
        patient_id, entry_date, stay_type_id, daily_total, notes,
        doctor_id, doctor_specialty, doctor_name_snapshot, doctor_department_snapshot,
        created_by_user_id, created_by_name, updated_by_user_id, updated_by_name
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$10,$11) RETURNING id`,
      [
        patient.id,
        entryDate,
        data.stay_type_id || null,
        dailyTotal,
        data.notes || '',
        doctorFields.doctor_id,
        doctorFields.doctor_specialty,
        doctorFields.doctor_name_snapshot,
        doctorFields.doctor_department_snapshot,
        userId,
        userName,
      ]
    );
    entryId = inserted.rows[0].id;

    for (let index = 0; index < lines.length; index++) {
      const line = lines[index];
      await client.query(
        `INSERT INTO patient_daily_entry_lines (
          entry_id, section_code, service_id, catalog_item_id, description, quantity, unit_price, amount,
          cost_price, markup_percent, catalog_unit, catalog_unit_level, extra_date, extra_text, weight, sort_order
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
        [
          entryId,
          line.section_code,
          line.service_id,
          line.catalog_item_id || null,
          line.description,
          line.quantity,
          line.unit_price,
          line.amount,
          line.cost_price || null,
          line.markup_percent || null,
          line.catalog_unit || null,
          line.catalog_unit_level || null,
          line.extra_date,
          line.extra_text,
          line.weight != null ? line.weight : null,
          index,
        ]
      );
    }
  }

  const saved = await getEntryById(entryId, client);
  await client.query(
    `INSERT INTO patient_daily_entry_history (entry_id, action, snapshot, changed_by_user_id, changed_by_name)
     VALUES ($1, $2, $3::jsonb, $4, $5)`,
    [entryId, action, JSON.stringify(saved), userId, userName]
  );

  return saved;
}

async function saveEntry(data, user = null, options = {}) {
  const context = await prepareEntrySaveContext(data);
  const isNewEntry = context.isNewEntry;

  return withTransaction(async (client) => persistEntryInTransaction(client, data, user, context)).then(
    async (saved) => {
      if (options.skip_invoice_sync) return saved;
      try {
        const { syncDailyEntryToInvoices } = require('./invoiceService');
        saved.invoice_sync = await syncDailyEntryToInvoices(saved, {
          file_number: data.file_number,
          patient_name: data.patient_name || context.patient.name,
        });
        if (!saved.invoice_sync?.synced) {
          throw new Error(
            saved.invoice_sync?.error || saved.invoice_sync?.reason || 'فشل ربط الفاتورة بعد حفظ الحركة اليومية'
          );
        }
        return saved;
      } catch (err) {
        if (isNewEntry && saved?.id) {
          await deleteDailyEntryCascade(saved.id);
        }
        throw err;
      }
    }
  );
}

async function saveEntriesBatch(data, user = null) {
  const entries = Array.isArray(data.entries) ? data.entries : [];
  if (!entries.length) throw new Error('لا توجد أيام للحفظ');

  const fileNumber = data.file_number?.trim();
  const supplemental = { operations: 0, glasses: 0 };
  let primaryDate = normalizeCalendarDate(entries[0]?.entry_date) || getCurrentBusinessDateString();

  if (fileNumber) {
    const patient = await resolvePatient(fileNumber, data.patient_name);
    if (data.patient_fields && typeof data.patient_fields === 'object') {
      await upsertPatient(fileNumber, {
        name: data.patient_name || patient.name,
        ...data.patient_fields,
      });
    }
    if (Array.isArray(data.operations)) {
      const { saveOperationsForDate, getOperationsTotal } = require('./patientOperationService');
      await saveOperationsForDate(patient.id, primaryDate, data.operations);
      supplemental.operations = await getOperationsTotal(patient.id, primaryDate);
    }
    if (data.glasses_total != null && data.glasses_total !== '') {
      supplemental.glasses = round2(data.glasses_total);
    } else if (data.patient_fields) {
      const refreshed = await resolvePatient(fileNumber, data.patient_name);
      const price = round2(refreshed.glasses_price);
      const disc = round2(refreshed.glasses_discount_percent);
      supplemental.glasses = round2(price * (1 - disc / 100));
    }
  }

  const batchPlan = [];

  for (const entryData of entries) {
    const merged = {
      ...entryData,
      file_number: data.file_number,
      patient_name: data.patient_name,
    };
    const entryId = Number(entryData.entry_id || entryData.id) || 0;
    const snapshot = entryId ? await getEntryById(entryId) : null;
    const context = await prepareEntrySaveContext(merged);
    const entryDate = normalizeCalendarDate(context.entryDate);
    if (entryDate === primaryDate && supplemental.operations + supplemental.glasses > 0) {
      context.dailyTotal = round2(
        context.dailyTotal + supplemental.operations + supplemental.glasses
      );
    }
    batchPlan.push({
      entryData: merged,
      wasNew: !entryId,
      snapshot,
      context,
    });
  }

  const savedResults = await withTransaction(async (client) => {
    const results = [];
    for (const plan of batchPlan) {
      results.push(await persistEntryInTransaction(client, plan.entryData, user, plan.context));
    }
    return results;
  });

  const savedMeta = batchPlan.map((plan, index) => ({
    result: savedResults[index],
    wasNew: plan.wasNew,
    snapshot: plan.snapshot,
  }));

  if (!fileNumber) {
    return {
      saved: savedResults,
      count: savedResults.length,
      invoice_sync: { synced: false, reason: 'missing_file_number' },
    };
  }

  try {
    const { syncPatientDailyChargesToInvoice } = require('./invoiceService');
    const invoice_sync = await syncPatientDailyChargesToInvoice(fileNumber, data.patient_name || '');
    if (!invoice_sync.synced) {
      throw new Error(
        invoice_sync.error || invoice_sync.reason || 'فشل ربط الفاتورة بعد حفظ الحركة اليومية'
      );
    }
    return { saved: savedResults, count: savedResults.length, invoice_sync };
  } catch (err) {
    await rollbackDailyEntriesOnInvoiceFailure(savedMeta, fileNumber);
    throw err;
  }
}

async function deleteEntry(entryId) {
  const id = Number(entryId);
  if (!id) throw new Error('معرف الحركة غير صالح');

  const snapshot = await getEntryById(id);
  if (!snapshot) throw new Error('الحركة غير موجودة');

  const fileNumber = snapshot.file_number?.trim();
  const linkedInvoiceId = snapshot.invoice_id;

  if (snapshot.invoice_id) {
    const invRes = await query(`SELECT status FROM invoices WHERE id = $1`, [snapshot.invoice_id]);
    if (invRes.rows[0]?.status === 'approved') {
      throw new Error('لا يمكن حذف حركة مرتبطة بفاتورة معتمدة');
    }
  }

  await deleteDailyEntryCascade(id);

  if (!fileNumber) {
    return { deleted: true, id, entry_date: snapshot.entry_date, invoice_sync: null };
  }

  let invoiceId = linkedInvoiceId;
  if (!invoiceId) {
    const openRes = await query(
      `SELECT id FROM invoices
       WHERE TRIM(file_number) = TRIM($1)
         AND status IN ('draft', 'pending_review')
       ORDER BY updated_at DESC
       LIMIT 1`,
      [fileNumber]
    );
    invoiceId = openRes.rows[0]?.id || null;
  }

  if (!invoiceId) {
    return {
      deleted: true,
      id,
      entry_date: snapshot.entry_date,
      invoice_sync: { synced: false, reason: 'no_open_invoice' },
    };
  }

  try {
    const { syncInvoiceAfterDailyChange } = require('./invoiceService');
    const updated = await syncInvoiceAfterDailyChange(invoiceId, fileNumber);
    if (!updated) {
      throw new Error('تعذّر تحديث الفاتورة بعد حذف الحركة');
    }
    const daily_summary = await getDailySummaryForPatient(fileNumber);
    return {
      deleted: true,
      id,
      entry_date: snapshot.entry_date,
      invoice_sync: {
        synced: true,
        invoice_id: invoiceId,
        final_total: updated.final_total,
        items_subtotal: updated.items_subtotal,
        admission_date: updated.admission_date,
        discharge_date: updated.discharge_date,
        daily_summary,
      },
    };
  } catch (err) {
    await restoreDailyEntrySnapshot(snapshot);
    throw new Error(`فشل تحديث الفاتورة بعد حذف الحركة — تمت استعادة الحركة: ${err.message}`);
  }
}

function hasStoredSuppliesSnapshots(item) {
  return (
    item?.cost_price_snapshot != null ||
    item?.selling_price_snapshot != null ||
    item?.margin_amount_snapshot != null
  );
}

function applyInvoiceSuppliesSnapshots(item) {
  if (!hasStoredSuppliesSnapshots(item)) return item;
  const qty = round2(item.quantity) || 1;
  const cost = round2(item.cost_price_snapshot);
  const markup = round2(item.markup_percent_snapshot);
  const selling = round2(item.selling_price_snapshot ?? item.amount);
  const lineCost = round2(cost * qty);
  const lineSelling = round2(selling * qty);
  const lineMargin =
    item.margin_amount_snapshot != null
      ? round2(item.margin_amount_snapshot)
      : round2(lineSelling - lineCost);

  return {
    ...item,
    section_code: item.section_code || 'supplies',
    cost_price: cost,
    markup_percent: markup,
    amount: selling,
    supplies_cost_raw: lineCost,
    supplies_selling_raw: lineSelling,
    supplies_margin_raw: lineMargin,
  };
}

function attachSuppliesMarkupFields(item, lineCtx = null) {
  const sectionCode = item.section_code || lineCtx?.section_code;
  const isSupplies = sectionCode === 'supplies';
  const qty = round2(item.quantity || lineCtx?.quantity || 1) || 1;
  const unitPrice = round2(item.amount || lineCtx?.unit_price || 0);
  const costPrice = round2(lineCtx?.cost_price ?? item.cost_price ?? 0);
  const markupPercent = round2(lineCtx?.markup_percent ?? item.markup_percent ?? 0);
  if (!isSupplies && costPrice <= 0 && markupPercent <= 0) return item;
  const lineCost = round2(costPrice * qty);
  const lineSelling = round2(unitPrice * qty);
  const lineMargin = round2(lineSelling - lineCost);
  const result = {
    ...item,
    cost_price: costPrice > 0 ? costPrice : item.cost_price,
    markup_percent: markupPercent > 0 || costPrice > 0 ? markupPercent : item.markup_percent,
    supplies_cost_raw: lineCost,
    supplies_margin_raw: lineMargin,
    supplies_selling_raw: lineSelling,
  };
  if (!isSupplies) return result;
  return {
    ...result,
    cost_price_snapshot: costPrice,
    markup_percent_snapshot: markupPercent,
    selling_price_snapshot: unitPrice,
    margin_amount_snapshot: lineMargin,
  };
}

async function attachServiceSnapshotsForInvoice(item, serviceId) {
  if (!serviceId) return item;
  try {
    const resolved = await resolveServiceForInvoice(Number(serviceId));
    return {
      ...item,
      service_code_snapshot: resolved.service_code_snapshot,
      service_name_snapshot: resolved.service_name_snapshot,
      unit_snapshot: resolved.unit_snapshot,
      price_type_snapshot: resolved.price_type_snapshot,
      tier_key_snapshot: resolved.tier_key_snapshot,
      discountable_snapshot: resolved.discountable_snapshot,
      administrative_fee_applicable_snapshot: resolved.administrative_fee_applicable_snapshot,
      price_list_id_snapshot: resolved.price_list_id_snapshot,
      price_list_name_snapshot: resolved.price_list_name_snapshot,
      composite_components_snapshot: resolved.composite_components_snapshot,
    };
  } catch {
    return item;
  }
}

function lineToInvoiceItem(line, entry, sections = []) {
  const section = sections.find((s) => s.code === line.section_code);
  const entryDate = formatDailyEntryDateLabel(entry.entry_date);
  const serviceName = line.service_name || line.description || section?.name || line.section_code;
  // Doctor metadata on entry is internal only — never included in customer invoice descriptions.
  const description = buildDailyItemDescription(entryDate, serviceName, line.extra_text);

  const quantity = round2(line.quantity || 1) || 1;
  const unitPrice = round2(line.unit_price || 0);
  const total = round2(line.amount || unitPrice * quantity);
  if (total <= 0) return null;

  return attachSuppliesMarkupFields({
    description,
    quantity,
    amount: quantity ? round2(total / quantity) : total,
    service_id: line.service_id || null,
    daily_entry_id: entry.id,
    daily_entry_line_id: line.id,
    section_code: line.section_code,
    entry_date: entryDate,
    section_sort_order: section?.sort_order ?? 999,
    unit_snapshot: line.catalog_unit || '',
    cost_price: line.cost_price,
    markup_percent: line.markup_percent,
  }, line);
}

function entriesToInvoiceItems(entries, sections = []) {
  const sectionTypeMap = Object.fromEntries(sections.map((s) => [s.code, s.input_type]));
  const skipTypes = new Set(['date', 'text']);
  const items = [];
  const sortedEntries = [...entries].sort((a, b) => {
    const da = formatDailyEntryDateLabel(a.entry_date);
    const db = formatDailyEntryDateLabel(b.entry_date);
    return da.localeCompare(db) || (Number(a.id) || 0) - (Number(b.id) || 0);
  });

  for (const entry of sortedEntries) {
    const sortedLines = [...(entry.lines || [])].sort((a, b) => {
      const sa = sections.find((s) => s.code === a.section_code)?.sort_order ?? 999;
      const sb = sections.find((s) => s.code === b.section_code)?.sort_order ?? 999;
      return sa - sb || (Number(a.id) || 0) - (Number(b.id) || 0);
    });
    for (const line of sortedLines) {
      const inputType = sectionTypeMap[line.section_code];
      if (inputType && skipTypes.has(inputType)) continue;
      if (round2(line.amount) <= 0) continue;
      const item = lineToInvoiceItem(line, entry, sections);
      if (item) items.push(item);
    }
  }
  return items;
}

async function enrichDailyInvoiceItems(items = []) {
  if (!items.length) return items;
  const sections = await getSectionsWithServices();
  const sectionMap = Object.fromEntries(sections.map((s) => [s.code, s]));
  const lineContextMap = await loadDailyLineContextMap(
    items.map((item) => item.daily_entry_line_id).filter(Boolean)
  );
  const enriched = [];

  for (const item of items) {
    let next = { ...item };
    const ctx = item.daily_entry_line_id ? lineContextMap[Number(item.daily_entry_line_id)] : null;
    const section = item.section_code ? sectionMap[item.section_code] : null;
    const entryDate =
      ctx?.entry_date ||
      item.daily_entry_date ||
      item.entry_date ||
      (isGmtDescription(item.description) ? item.description : null) ||
      (String(item.description || '').match(/\[(\d{2}-\d{2}-\d{4})\]/) || [])[1] ||
      null;
    const formattedDate = formatDailyEntryDateLabel(entryDate);
    const extraText = ctx?.extra_text || item.daily_extra_text || '';
    const serviceId = next.service_id || ctx?.service_id || section?.default_service?.id || null;

    if (item.daily_entry_line_id) {
      if (hasStoredSuppliesSnapshots(item)) {
        let next = applyInvoiceSuppliesSnapshots(item);
        if (ctx) {
          const name = resolveDailyItemName(next, ctx, section, null);
          next.description =
            item.description || buildDailyItemDescription(formattedDate, name, extraText);
          next.entry_date = formattedDate;
          next.section_sort_order =
            ctx.section_sort_order ?? section?.sort_order ?? next.section_sort_order ?? 999;
          next.section_code = ctx.section_code || next.section_code;
        }
        enriched.push(next);
        continue;
      }
      if (!ctx) {
        throw new Error(`بند الحركة اليومية #${item.daily_entry_line_id} غير موجود — أعد حفظ الحركة`);
      }
      const storedPrice = round2(ctx.unit_price || item.amount || 0);
      const qty = round2(ctx.quantity || next.quantity || 1) || 1;
      if (storedPrice <= 0) {
        const name = resolveDailyItemName(next, ctx, section, null);
        throw new Error(`بند الحركة اليومية «${name}» ليس له سعر محفوظ صالح`);
      }
      const name = resolveDailyItemName(next, ctx, section, null);
      next = attachSuppliesMarkupFields({
        ...next,
        service_id: ctx.service_id || next.service_id || null,
        description: buildDailyItemDescription(formattedDate, name, extraText),
        amount: storedPrice,
        quantity: qty,
        entry_date: formattedDate,
        section_sort_order: ctx.section_sort_order ?? section?.sort_order ?? next.section_sort_order ?? 999,
        section_code: ctx.section_code || next.section_code,
        unit_snapshot: ctx.catalog_unit || next.unit_snapshot || '',
        cost_price: ctx.cost_price,
        markup_percent: ctx.markup_percent,
      }, ctx);
      next = await attachServiceSnapshotsForInvoice(next, ctx.service_id || next.service_id);
      enriched.push(next);
      continue;
    }

    if (serviceId) {
      next.service_id = Number(serviceId);
      try {
        const resolved = await resolveServiceForInvoice(Number(serviceId));
        const name = resolved.service_name_snapshot || resolved.description;
        const unitPrice = round2(resolved.amount);
        if (unitPrice <= 0) {
          throw new Error(`الخدمة «${name}» ليس لها سعر صالح في اللائحة`);
        }
        next = {
          ...next,
          ...resolved,
          description: buildDailyItemDescription(formattedDate, name, extraText),
          amount: unitPrice,
          quantity: Number(next.quantity) || 1,
          entry_date: formattedDate,
          section_sort_order: ctx?.section_sort_order ?? section?.sort_order ?? next.section_sort_order ?? 999,
        };
      } catch (err) {
        const storedPrice = round2(ctx?.unit_price || 0);
        const name = resolveDailyItemName(next, ctx, section, null);
        if (storedPrice > 0 && next.service_id) {
          next = {
            ...next,
            description: buildDailyItemDescription(formattedDate, name, extraText),
            amount: storedPrice,
            quantity: Number(next.quantity) || 1,
            entry_date: formattedDate,
            section_sort_order: ctx?.section_sort_order ?? section?.sort_order ?? next.section_sort_order ?? 999,
          };
        } else {
          throw new Error(
            `تعذّر تحميل سعر الخدمة من اللائحة لبند «${name}»: ${err.message || 'غير موجودة'}`
          );
        }
      }
    } else if (item.daily_entry_id) {
      const name = resolveDailyItemName(next, ctx, section, null);
      next.description = buildDailyItemDescription(formattedDate, name, extraText);
      next.entry_date = formattedDate;
      next.section_sort_order = ctx?.section_sort_order ?? section?.sort_order ?? 999;
    } else if (isGmtDescription(next.description)) {
      const parsedDate = formatDailyEntryDateLabel(next.description);
      const name = resolveDailyItemName(next, ctx, section, null);
      next.description = buildDailyItemDescription(parsedDate, name, extraText);
      next.entry_date = parsedDate;
    }

    enriched.push(next);
  }

  return sortDailyInvoiceItems(enriched);
}

function dedupeDailyInvoiceItemsByLineId(items = []) {
  const seenLineIds = new Set();
  const result = [];
  for (const item of items) {
    const lineId = Number(item.daily_entry_line_id);
    if (lineId) {
      if (seenLineIds.has(lineId)) continue;
      seenLineIds.add(lineId);
    }
    result.push(item);
  }
  return result;
}

async function deleteDailyEntryCascade(entryId) {
  const id = Number(entryId);
  if (!id) return;
  await query(`DELETE FROM patient_daily_entry_lines WHERE entry_id = $1`, [id]);
  await query(`DELETE FROM patient_daily_entry_history WHERE entry_id = $1`, [id]);
  await query(`DELETE FROM patient_daily_entries WHERE id = $1`, [id]);
}

async function restoreDailyEntrySnapshot(snapshot) {
  if (!snapshot?.id) return null;
  const entryId = Number(snapshot.id);

  return withTransaction(async (client) => {
    const { rows: existing } = await client.query(`SELECT id FROM patient_daily_entries WHERE id = $1`, [entryId]);

    if (existing.length) {
      await client.query(`DELETE FROM patient_daily_entry_lines WHERE entry_id = $1`, [entryId]);
      await client.query(
        `UPDATE patient_daily_entries SET
          patient_id = $2, entry_date = $3, stay_type_id = $4, daily_total = $5, notes = $6,
          invoice_id = $7, updated_by_user_id = $8, updated_by_name = $9, updated_at = NOW()
         WHERE id = $1`,
        [
          entryId,
          snapshot.patient_id,
          snapshot.entry_date,
          snapshot.stay_type_id || null,
          snapshot.daily_total || 0,
          snapshot.notes || '',
          snapshot.invoice_id || null,
          snapshot.updated_by_user_id || snapshot.created_by_user_id || null,
          snapshot.updated_by_name || snapshot.created_by_name || '',
        ]
      );
    } else {
      await client.query(
        `INSERT INTO patient_daily_entries (
          id, patient_id, entry_date, stay_type_id, daily_total, notes, invoice_id,
          created_by_user_id, created_by_name, updated_by_user_id, updated_by_name
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [
          entryId,
          snapshot.patient_id,
          snapshot.entry_date,
          snapshot.stay_type_id || null,
          snapshot.daily_total || 0,
          snapshot.notes || '',
          snapshot.invoice_id || null,
          snapshot.created_by_user_id || null,
          snapshot.created_by_name || '',
          snapshot.updated_by_user_id || snapshot.created_by_user_id || null,
          snapshot.updated_by_name || snapshot.created_by_name || '',
        ]
      );
    }

    for (const line of snapshot.lines || []) {
      await client.query(
        `INSERT INTO patient_daily_entry_lines (
          id, entry_id, section_code, service_id, catalog_item_id, description, quantity, unit_price, amount,
          cost_price, markup_percent, catalog_unit, catalog_unit_level, extra_date, extra_text, sort_order
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
        [
          line.id,
          entryId,
          line.section_code,
          line.service_id || null,
          line.catalog_item_id || null,
          line.description || '',
          line.quantity || 0,
          line.unit_price || 0,
          line.amount || 0,
          line.cost_price != null ? line.cost_price : null,
          line.markup_percent != null ? line.markup_percent : null,
          line.catalog_unit || null,
          line.catalog_unit_level || null,
          line.extra_date || null,
          line.extra_text || '',
          line.sort_order || 0,
        ]
      );
    }

    await client.query(
      `SELECT setval(pg_get_serial_sequence('patient_daily_entries', 'id'), COALESCE((SELECT MAX(id) FROM patient_daily_entries), 1))`
    );
    await client.query(
      `SELECT setval(pg_get_serial_sequence('patient_daily_entry_lines', 'id'), COALESCE((SELECT MAX(id) FROM patient_daily_entry_lines), 1))`
    );
  }).then(() => getEntryById(entryId));
}

async function rollbackDailyEntriesOnInvoiceFailure(savedMeta, fileNumber) {
  for (const { result, wasNew, snapshot } of savedMeta) {
    if (wasNew && result?.id) {
      await deleteDailyEntryCascade(result.id);
    } else if (snapshot?.id) {
      await restoreDailyEntrySnapshot(snapshot);
    }
  }
  const fn = fileNumber?.trim();
  if (!fn) return;
  try {
    const { syncPatientDailyChargesToInvoice } = require('./invoiceService');
    await syncPatientDailyChargesToInvoice(fn);
  } catch (err) {
    console.error('Invoice recovery after daily entry rollback failed:', err);
  }
}

function sortDailyInvoiceItems(items = []) {
  return [...items].sort((a, b) => {
    const dailyA = Boolean(a.daily_entry_line_id);
    const dailyB = Boolean(b.daily_entry_line_id);
    if (dailyA && !dailyB) return -1;
    if (!dailyA && dailyB) return 1;

    const dateA = formatDailyEntryDateLabel(a.entry_date || a.daily_entry_date || '');
    const dateB = formatDailyEntryDateLabel(b.entry_date || b.daily_entry_date || '');
    if (dateA !== dateB) return dateA.localeCompare(dateB);
    const orderA = Number(a.section_sort_order) || 999;
    const orderB = Number(b.section_sort_order) || 999;
    if (orderA !== orderB) return orderA - orderB;
    return (Number(a.daily_entry_line_id) || 0) - (Number(b.daily_entry_line_id) || 0);
  });
}

async function getEntriesForInvoice(fileNumber, fromDate, toDate, invoiceId = null) {
  if (!fileNumber?.trim()) return [];
  const patient = await resolvePatient(fileNumber);
  let sql = `
    SELECT e.*, p.file_number, p.name AS patient_name
    FROM patient_daily_entries e
    JOIN patients p ON p.id = e.patient_id
    WHERE e.patient_id = $1`;
  const params = [patient.id];
  let i = 2;

  if (fromDate) {
    sql += ` AND e.entry_date >= $${i++}`;
    params.push(fromDate);
  }
  if (toDate) {
    sql += ` AND e.entry_date <= $${i++}`;
    params.push(toDate);
  }
  sql += ` AND (e.invoice_id IS NULL`;
  if (invoiceId) {
    sql += ` OR e.invoice_id = $${i++}`;
    params.push(Number(invoiceId));
  }
  sql += `) ORDER BY e.entry_date, e.id`;

  const { rows } = await query(sql, params);
  const entries = [];
  for (const row of rows) {
    const entry = await getEntryById(row.id);
    if (entry) entries.push(entry);
  }
  return entries;
}

async function getInvoiceItemsFromDailyCharges(fileNumber, fromDate, toDate, invoiceId = null) {
  const sections = await listSections();
  const entries = await getEntriesForInvoice(fileNumber, fromDate, toDate, invoiceId);
  const lineItems = entriesToInvoiceItems(entries, sections);
  const supplemental = await getSupplementalInvoiceItems(fileNumber, fromDate, toDate);
  const items = [...lineItems, ...supplemental];
  return dedupeDailyInvoiceItemsByLineId(await enrichDailyInvoiceItems(items));
}

async function cleanOrphanDailyInvoiceItems(invoiceId, client = null) {
  if (!invoiceId) return 0;
  const run = client ? client.query.bind(client) : query;
  let removed = 0;
  const dupRes = await run(
    `DELETE FROM invoice_items ii
     WHERE ii.invoice_id = $1
       AND ii.daily_entry_line_id IS NOT NULL
       AND ii.id > (
         SELECT MIN(id) FROM invoice_items
         WHERE invoice_id = $1 AND daily_entry_line_id = ii.daily_entry_line_id
       )`,
    [invoiceId]
  );
  removed += dupRes.rowCount || 0;
  const lineRes = await run(
    `DELETE FROM invoice_items
     WHERE invoice_id = $1
       AND daily_entry_line_id IS NOT NULL
       AND daily_entry_line_id NOT IN (SELECT id FROM patient_daily_entry_lines)`,
    [invoiceId]
  );
  removed += lineRes.rowCount || 0;
  const entryRes = await run(
    `DELETE FROM invoice_items
     WHERE invoice_id = $1
       AND daily_entry_id IS NOT NULL
       AND daily_entry_id NOT IN (SELECT id FROM patient_daily_entries)`,
    [invoiceId]
  );
  removed += entryRes.rowCount || 0;
  const staleRes = await run(
    `DELETE FROM invoice_items
     WHERE invoice_id = $1
       AND daily_entry_line_id IS NULL
       AND daily_entry_id IS NULL
       AND (description ~ '^\\[\\d{2}-\\d{2}-\\d{4}\\]' OR description LIKE '%GMT%')`,
    [invoiceId]
  );
  removed += staleRes.rowCount || 0;
  return removed;
}

async function getDailySummaryForPatient(fileNumber) {
  const fn = String(fileNumber || '').trim();
  if (!fn) return { entry_count: 0, daily_total_sum: 0 };
  const { rows } = await query(
    `SELECT COUNT(*)::int AS entry_count, COALESCE(SUM(e.daily_total), 0) AS daily_total_sum
     FROM patient_daily_entries e
     JOIN patients p ON p.id = e.patient_id
     WHERE TRIM(p.file_number) = TRIM($1)`,
    [fn]
  );
  return rows[0] || { entry_count: 0, daily_total_sum: 0 };
}

async function linkEntryToInvoice(entryId, invoiceId, client = null) {
  if (!entryId || !invoiceId) return 0;
  const run = client ? client.query.bind(client) : query;
  const result = await run(
    `UPDATE patient_daily_entries
     SET invoice_id = $1, updated_at = NOW()
     WHERE id = $2 AND (invoice_id IS NULL OR invoice_id = $1)`,
    [Number(invoiceId), Number(entryId)]
  );
  return result.rowCount || 0;
}

async function linkEntriesToInvoice(invoiceId, fileNumber, fromDate, toDate, client = null) {
  if (!invoiceId || !fileNumber?.trim()) return 0;
  const run = client ? client.query.bind(client) : query;
  const patient = await resolvePatient(fileNumber);
  const linkTo = toDate || fromDate;
  let sql = `
    UPDATE patient_daily_entries SET invoice_id = $1, updated_at = NOW()
    WHERE patient_id = $2 AND invoice_id IS NULL`;
  const params = [invoiceId, patient.id];
  let i = 3;
  if (fromDate) {
    sql += ` AND entry_date >= $${i++}`;
    params.push(fromDate);
  }
  if (linkTo) {
    sql += ` AND entry_date <= $${i++}`;
    params.push(linkTo);
  }
  const result = await run(sql, params);
  return result.rowCount || 0;
}

async function unlinkEntriesFromInvoice(invoiceId, client = null) {
  const run = client ? client.query.bind(client) : query;
  const result = await run(
    `UPDATE patient_daily_entries SET invoice_id = NULL, updated_at = NOW() WHERE invoice_id = $1`,
    [invoiceId]
  );
  return result.rowCount || 0;
}

function normalizeStayGradeName(name) {
  return String(name || '')
    .replace(/\u0640/g, '')
    .replace(/[\u064B-\u065F]/g, '')
    .replace(/\s+/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .trim()
    .toLowerCase();
}

async function listAccommodationStayGrades() {
  const { listStayTypes } = require('./stayTypeService');
  const stayTypes = await listStayTypes(true);
  const priceList = await getDefaultPriceList();
  if (!priceList) {
    return stayTypes.map((st) => ({
      stay_type_id: st.id,
      service_id: null,
      name: st.name,
      daily_rate: Number(st.daily_rate) || 0,
      price_list_name: null,
    }));
  }

  const { rows } = await query(
    `SELECT s.id AS service_id, s.name, s.price, s.sort_order
     FROM services s
     INNER JOIN service_categories c ON c.id = s.category_id
     WHERE s.price_list_id = $1 AND c.code = 'ACCOMMODATION' AND s.is_active = TRUE
     ORDER BY s.sort_order, s.name, s.id`,
    [priceList.id]
  );
  const enriched = await enrichServicesWithResolvedPrices(rows);
  const stayByName = new Map();
  for (const st of stayTypes) {
    const key = normalizeStayGradeName(st.name);
    if (key) stayByName.set(key, st);
  }

  const grades = [];
  const seen = new Set();
  for (const svc of enriched) {
    const key = normalizeStayGradeName(svc.name);
    const st =
      stayByName.get(key) ||
      stayTypes.find(
        (t) =>
          normalizeStayGradeName(t.name) === key ||
          normalizeStayGradeName(t.name).includes(key) ||
          key.includes(normalizeStayGradeName(t.name))
      );
    if (!st?.id) continue;
    if (seen.has(st.id)) continue;
    seen.add(st.id);
    const daily_rate = round2(svc.list_price ?? svc.price) || Number(st.daily_rate) || 0;
    grades.push({
      stay_type_id: st.id,
      service_id: svc.id,
      name: svc.name || st.name,
      daily_rate,
      price_list_name: priceList.name,
    });
  }

  for (const st of stayTypes) {
    if (seen.has(st.id)) continue;
    grades.push({
      stay_type_id: st.id,
      service_id: null,
      name: st.name,
      daily_rate: Number(st.daily_rate) || 0,
      price_list_name: priceList.name,
    });
  }

  return grades.sort((a, b) => {
    const ao = stayTypes.find((t) => t.id === a.stay_type_id)?.sort_order || 0;
    const bo = stayTypes.find((t) => t.id === b.stay_type_id)?.sort_order || 0;
    return ao - bo || String(a.name).localeCompare(String(b.name), 'ar');
  });
}

module.exports = {
  listSections,
  getSectionsWithServices,
  listAccommodationStayGrades,
  resolveDefaultServiceForSection,
  searchDailyPickerItems,
  getDailyPickerItemBySection,
  getEntryById,
  getEntryByPatientDate,
  listEntries,
  listEntryHistory,
  saveEntry,
  saveEntriesBatch,
  deleteEntry,
  getEntriesForInvoice,
  getInvoiceItemsFromDailyCharges,
  entriesToInvoiceItems,
  enrichDailyInvoiceItems,
  dedupeDailyInvoiceItemsByLineId,
  sortDailyInvoiceItems,
  formatDailyEntryDateLabel,
  buildDailyItemDescription,
  isGmtDescription,
  resolveDailyItemName,
  getDailySummaryForPatient,
  cleanOrphanDailyInvoiceItems,
  linkEntryToInvoice,
  linkEntriesToInvoice,
  unlinkEntriesFromInvoice,
  computeDailyTotal,
  getCurrentBusinessDateString,
  normalizeCalendarDate,
  resolveAllowedDailyEntryDate,
  isManualAmountSection,
  MANUAL_AMOUNT_SECTION_CODES,
  buildDailyLinesFingerprint,
  computeDailyStampLinesTotal,
  DAILY_STAMP_LINE_CODES,
};
