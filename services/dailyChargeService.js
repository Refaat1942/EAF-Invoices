const { query, withTransaction } = require('../database/db');
const { getDefaultPriceList } = require('./priceListService');
const { listServices, resolveServiceForInvoice, getServiceById, enrichServicesWithResolvedPrices } = require('./serviceCatalogService');
const { getStayTypeById } = require('./stayTypeService');
const { upsertPatient } = require('./patientService');

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
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
  const { listCatalogItems, catalogItemToPicker } = require('./dailyEntryCatalogService');
  const allCatalogItems = await listCatalogItems({ active_only: true });
  const priceList = await getDefaultPriceList();

  const categoryCodes = [...new Set(sections.map((s) => s.category_code).filter(Boolean))];
  let byCategory = {};
  if (priceList && categoryCodes.length) {
    const allServices = await listServices({ price_list_id: priceList.id, active_only: true });
    const relevantServices = allServices.filter((s) => categoryCodes.includes(s.category_code));
    const pricedServices = await enrichServicesWithResolvedPrices(relevantServices);
    for (const service of pricedServices) {
      const code = service.category_code || '_none';
      if (!byCategory[code]) byCategory[code] = [];
      byCategory[code].push(service);
    }
  }

  return sections.map((section) => {
    if (section.catalog_category) {
      const items = allCatalogItems.filter((item) => item.category === section.catalog_category);
      const services = items.map(catalogItemToPicker);
      return {
        ...section,
        uses_catalog: true,
        catalog_count: items.length,
        services,
        default_service: null,
        price_list_id: priceList?.id || null,
        price_list_name: priceList?.name || null,
      };
    }

    if (!priceList) {
      return { ...section, services: [], default_service: null, price_list_id: null, price_list_name: null };
    }

    const services = section.category_code ? byCategory[section.category_code] || [] : [];
    const default_service =
      services.find((s) => s.code === section.default_service_code) || services[0] || null;
    return {
      ...section,
      price_list_id: priceList.id,
      price_list_name: priceList.name,
      services,
      default_service,
    };
  });
}

async function resolvePatient(fileNumber, patientName = '') {
  if (!fileNumber?.trim()) throw new Error('رقم الملف مطلوب');
  return upsertPatient(fileNumber.trim(), patientName || '');
}

function normalizeLine(section, rawLine = {}) {
  const inputType = section.input_type || 'amount';
  if (inputType === 'date') {
    return {
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
  };
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

async function applyStayTypeToAccommodationLine(stayTypeId, section, rawLine, sectionsWithServices) {
  if (!stayTypeId || section.code !== 'accommodation') return rawLine;

  const stayType = await getStayTypeById(Number(stayTypeId));
  if (!stayType) throw new Error('نوع الإقامة غير موجود');

  const accSection = sectionsWithServices.find((s) => s.code === 'accommodation');
  const services = accSection?.services || [];
  const stayName = String(stayType.name || '').trim();
  const match =
    services.find((s) => String(s.name).trim() === stayName) ||
    services.find((s) => String(s.name).includes(stayName)) ||
    services.find((s) => stayName.includes(String(s.name)));

  if (rawLine.service_id) return rawLine;

  const hasAmount = round2(rawLine.amount) > 0;
  if (!match) {
    if (hasAmount) {
      throw new Error(`لا توجد خدمة إقامة في اللائحة لنوع «${stayType.name}» — اختر الخدمة من القائمة`);
    }
    return rawLine;
  }

  return {
    ...rawLine,
    service_id: match.id,
    amount: 0,
    manual_amount: false,
  };
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

  const { resolveCatalogUnitPrice } = require('./dailyEntryCatalogService');
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
      };
    }
  }

  const unitPrice = round2(selection.unitPrice);
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
  if (catalogItem.category === 'Supplies' || fullSection.catalog_category === 'Supplies') {
    normalized.cost_price = round2(catalogItem.cost_price);
    normalized.markup_percent = round2(catalogItem.markup_percent);
  }
  return normalized;
}

async function normalizeLineWithPrice(section, rawLine = {}, sectionsWithServices = null) {
  const fullSection = (sectionsWithServices || []).find((s) => s.code === section.code) || section;
  if (fullSection.catalog_category || rawLine.catalog_item_id) {
    return await normalizeCatalogLine(fullSection, rawLine, sectionsWithServices);
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

async function saveEntry(data, user = null, options = {}) {
  const patient = await resolvePatient(data.file_number, data.patient_name);
  const entryDate = resolveAllowedDailyEntryDate(data.entry_date);

  const sections = await listSections();
  const sectionsWithServices = await getSectionsWithServices();
  const rawLines = Array.isArray(data.lines) ? data.lines : [];
  const lines = [];

  for (const section of sections) {
    let raw = rawLines.find((line) => line.section_code === section.code) || {};
    if (section.code === 'accommodation' && data.stay_type_id) {
      raw = await applyStayTypeToAccommodationLine(
        data.stay_type_id,
        section,
        raw,
        sectionsWithServices
      );
    }
    const normalized = await normalizeLineWithPrice(section, raw, sectionsWithServices);
    const hasValue =
      section.input_type === 'date'
        ? Boolean(normalized.extra_date)
        : section.input_type === 'text'
          ? Boolean(normalized.extra_text)
          : Number(normalized.amount) > 0;
    if (hasValue) lines.push(normalized);
  }

  const dailyTotal = computeDailyTotal(lines, sections);
  const userId = user?.id || null;
  const userName = user?.full_name || user?.username || '';
  const isNewEntry = !Number(data.entry_id || data.id);

  return withTransaction(async (client) => {
    const entryIdInput = Number(data.entry_id || data.id) || null;
    let existing = null;
    if (entryIdInput) {
      const { rows } = await client.query(
        `SELECT * FROM patient_daily_entries WHERE id = $1 AND patient_id = $2`,
        [entryIdInput, patient.id]
      );
      existing = rows[0] || null;
      if (!existing) throw new Error(`الحركة #${entryIdInput} غير موجودة`);
      assertExistingEntryDateIsToday(existing.entry_date);
    }

    if (existing?.invoice_id && data.allow_invoiced_edit !== true) {
      const invRes = await client.query('SELECT status FROM invoices WHERE id = $1', [existing.invoice_id]);
      if (invRes.rows[0]?.status === 'approved') {
        throw new Error('لا يمكن تعديل حركة يوم مرتبطة بفاتورة معتمدة');
      }
    }

    let entryId = entryIdInput || existing?.id || null;
    let action = existing ? 'update' : 'create';

    if (existing) {
      await client.query(
        `UPDATE patient_daily_entries SET
          stay_type_id = $1, daily_total = $2, notes = $3,
          updated_by_user_id = $4, updated_by_name = $5, updated_at = NOW()
         WHERE id = $6`,
        [data.stay_type_id || null, dailyTotal, data.notes || '', userId, userName, existing.id]
      );

      const { rows: oldLines } = await client.query(
        `SELECT id, section_code FROM patient_daily_entry_lines WHERE entry_id = $1`,
        [existing.id]
      );
      const oldBySection = Object.fromEntries(oldLines.map((row) => [row.section_code, row.id]));
      const newSectionCodes = new Set(lines.map((line) => line.section_code));

      for (const oldLine of oldLines) {
        if (!newSectionCodes.has(oldLine.section_code)) {
          await client.query(`DELETE FROM patient_daily_entry_lines WHERE id = $1`, [oldLine.id]);
        }
      }

      for (let index = 0; index < lines.length; index++) {
        const line = lines[index];
        const existingLineId = oldBySection[line.section_code];
        if (existingLineId) {
          await client.query(
            `UPDATE patient_daily_entry_lines SET
              service_id = $1, catalog_item_id = $2, description = $3, quantity = $4,
              unit_price = $5, amount = $6, cost_price = $7, markup_percent = $8,
              catalog_unit = $9, catalog_unit_level = $10,
              extra_date = $11, extra_text = $12, sort_order = $13
             WHERE id = $14`,
            [
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
              index,
              existingLineId,
            ]
          );
        } else {
          await client.query(
            `INSERT INTO patient_daily_entry_lines (
              entry_id, section_code, service_id, catalog_item_id, description, quantity, unit_price, amount,
              cost_price, markup_percent, catalog_unit, catalog_unit_level, extra_date, extra_text, sort_order
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
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
          created_by_user_id, created_by_name, updated_by_user_id, updated_by_name
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$6,$7) RETURNING id`,
        [patient.id, entryDate, data.stay_type_id || null, dailyTotal, data.notes || '', userId, userName]
      );
      entryId = inserted.rows[0].id;

      for (let index = 0; index < lines.length; index++) {
        const line = lines[index];
        await client.query(
          `INSERT INTO patient_daily_entry_lines (
            entry_id, section_code, service_id, catalog_item_id, description, quantity, unit_price, amount,
            cost_price, markup_percent, catalog_unit, catalog_unit_level, extra_date, extra_text, sort_order
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
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
  }).then(async (saved) => {
    if (options.skip_invoice_sync) return saved;
    try {
      const { syncDailyEntryToInvoices } = require('./invoiceService');
      saved.invoice_sync = await syncDailyEntryToInvoices(saved, {
        file_number: data.file_number,
        patient_name: data.patient_name || patient.name,
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
  });
}

async function saveEntriesBatch(data, user = null) {
  const entries = Array.isArray(data.entries) ? data.entries : [];
  if (!entries.length) throw new Error('لا توجد أيام للحفظ');
  const savedMeta = [];
  for (const entryData of entries) {
    const wasNew = !Number(entryData.entry_id || entryData.id);
    const result = await saveEntry(
      {
        ...entryData,
        file_number: data.file_number,
        patient_name: data.patient_name,
      },
      user,
      { skip_invoice_sync: true }
    );
    savedMeta.push({ result, wasNew });
  }

  const fileNumber = data.file_number?.trim();
  if (!fileNumber) {
    return {
      saved: savedMeta.map((m) => m.result),
      count: savedMeta.length,
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
    return { saved: savedMeta.map((m) => m.result), count: savedMeta.length, invoice_sync };
  } catch (err) {
    await rollbackDailyEntriesOnInvoiceFailure(savedMeta, fileNumber);
    throw err;
  }
}

async function deleteEntry(entryId) {
  const id = Number(entryId);
  if (!id) throw new Error('معرف الحركة غير صالح');

  const { rows } = await query(
    `SELECT e.*, p.file_number
     FROM patient_daily_entries e
     JOIN patients p ON p.id = e.patient_id
     WHERE e.id = $1`,
    [id]
  );
  if (!rows.length) throw new Error('الحركة غير موجودة');
  const entry = rows[0];
  const fileNumber = entry.file_number?.trim();
  const linkedInvoiceId = entry.invoice_id;

  if (entry.invoice_id) {
    const invRes = await query(`SELECT status FROM invoices WHERE id = $1`, [entry.invoice_id]);
    if (invRes.rows[0]?.status === 'approved') {
      throw new Error('لا يمكن حذف حركة مرتبطة بفاتورة معتمدة');
    }
  }

  await query(`DELETE FROM patient_daily_entry_lines WHERE entry_id = $1`, [id]);
  await query(`DELETE FROM patient_daily_entry_history WHERE entry_id = $1`, [id]);
  await query(`DELETE FROM patient_daily_entries WHERE id = $1`, [id]);

  let invoice_sync = null;
  if (fileNumber) {
    try {
      const { syncInvoiceDailyCharges } = require('./invoiceService');
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
      if (invoiceId) {
        const { syncInvoiceAfterDailyChange } = require('./invoiceService');
        const updated = await syncInvoiceAfterDailyChange(invoiceId, fileNumber);
        const daily_summary = await getDailySummaryForPatient(fileNumber);
        invoice_sync = {
          synced: true,
          invoice_id: invoiceId,
          final_total: updated?.final_total,
          items_subtotal: updated?.items_subtotal,
          admission_date: updated?.admission_date,
          discharge_date: updated?.discharge_date,
          daily_summary,
        };
      }
    } catch (err) {
      invoice_sync = { synced: false, error: err.message };
    }
  }

  return { deleted: true, id, entry_date: entry.entry_date, invoice_sync };
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

async function rollbackDailyEntriesOnInvoiceFailure(savedMeta, fileNumber) {
  for (const { result, wasNew } of savedMeta) {
    if (wasNew && result?.id) {
      await deleteDailyEntryCascade(result.id);
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
  const items = entriesToInvoiceItems(entries, sections);
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

module.exports = {
  listSections,
  getSectionsWithServices,
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
};
