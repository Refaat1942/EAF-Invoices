const { query, withTransaction } = require('../database/db');
const { getDefaultPriceList } = require('./priceListService');
const { listServices, resolveServiceForInvoice } = require('./serviceCatalogService');
const { upsertPatient } = require('./patientService');

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

async function listSections() {
  const { rows } = await query(
    `SELECT * FROM daily_charge_sections WHERE is_active = TRUE ORDER BY sort_order, id`
  );
  return rows;
}

async function getSectionsWithServices() {
  const sections = await listSections();
  const priceList = await getDefaultPriceList();
  if (!priceList) return sections.map((s) => ({ ...s, services: [], default_service: null }));

  const allServices = await listServices({ price_list_id: priceList.id, active_only: true });
  const byCategory = {};
  for (const service of allServices) {
    const code = service.category_code || '_none';
    if (!byCategory[code]) byCategory[code] = [];
    byCategory[code].push(service);
  }

  return sections.map((section) => {
    const services = section.category_code ? byCategory[section.category_code] || [] : [];
    const default_service =
      services.find((s) => s.code === section.default_service_code) || services[0] || null;
    return { ...section, services, default_service };
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
    `SELECT l.*, s.name AS service_name, s.code AS service_code
     FROM patient_daily_entry_lines l
     LEFT JOIN services s ON s.id = l.service_id
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
      `SELECT l.*, s.name AS service_name, s.code AS service_code
       FROM patient_daily_entry_lines l
       LEFT JOIN services s ON s.id = l.service_id
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

async function normalizeLineWithPrice(section, rawLine = {}) {
  const normalized = normalizeLine(section, rawLine);
  if (section.input_type !== 'amount' || !normalized.service_id) return normalized;

  const manualAmount = rawLine.manual_amount === true;
  if (manualAmount && Number(normalized.amount) > 0) return normalized;

  try {
    const resolved = await resolveServiceForInvoice(Number(normalized.service_id));
    const qty = normalized.quantity || 1;
    normalized.unit_price = round2(resolved.amount);
    normalized.amount = round2(normalized.unit_price * qty);
    normalized.description = resolved.description || normalized.description;
  } catch {
    /* keep entered values */
  }
  return normalized;
}

async function saveEntry(data, user = null) {
  const patient = await resolvePatient(data.file_number, data.patient_name);
  const entryDate = data.entry_date;
  if (!entryDate) throw new Error('تاريخ اليوم مطلوب');

  const sections = await listSections();
  const rawLines = Array.isArray(data.lines) ? data.lines : [];
  const lines = [];

  for (const section of sections) {
    const raw = rawLines.find((line) => line.section_code === section.code) || {};
    const normalized = await normalizeLineWithPrice(section, raw);
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

  return withTransaction(async (client) => {
    const existing = await getEntryByPatientDate(patient.id, entryDate, client);
    if (existing?.invoice_id && data.allow_invoiced_edit !== true) {
      const invRes = await client.query('SELECT status FROM invoices WHERE id = $1', [existing.invoice_id]);
      if (invRes.rows[0]?.status === 'approved') {
        throw new Error('لا يمكن تعديل حركة يوم مرتبطة بفاتورة معتمدة');
      }
    }

    let entryId = existing?.id || null;
    let action = existing ? 'update' : 'create';

    if (existing) {
      await client.query(
        `UPDATE patient_daily_entries SET
          stay_type_id = $1, daily_total = $2, notes = $3,
          updated_by_user_id = $4, updated_by_name = $5, updated_at = NOW()
         WHERE id = $6`,
        [data.stay_type_id || null, dailyTotal, data.notes || '', userId, userName, existing.id]
      );
      await client.query(`DELETE FROM patient_daily_entry_lines WHERE entry_id = $1`, [existing.id]);
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
    }

    for (let index = 0; index < lines.length; index++) {
      const line = lines[index];
      await client.query(
        `INSERT INTO patient_daily_entry_lines (
          entry_id, section_code, service_id, description, quantity, unit_price, amount,
          extra_date, extra_text, sort_order
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [
          entryId,
          line.section_code,
          line.service_id,
          line.description,
          line.quantity,
          line.unit_price,
          line.amount,
          line.extra_date,
          line.extra_text,
          index,
        ]
      );
    }

    const saved = await getEntryByPatientDate(patient.id, entryDate, client);
    await client.query(
      `INSERT INTO patient_daily_entry_history (entry_id, action, snapshot, changed_by_user_id, changed_by_name)
       VALUES ($1, $2, $3::jsonb, $4, $5)`,
      [entryId, action, JSON.stringify(saved), userId, userName]
    );

    return saved;
  }).then(async (saved) => {
    try {
      const { syncDailyEntryToInvoices } = require('./invoiceService');
      saved.invoice_sync = await syncDailyEntryToInvoices(saved, {
        file_number: data.file_number,
        patient_name: data.patient_name || patient.name,
      });
    } catch (err) {
      saved.invoice_sync = { synced: false, error: err.message };
      console.error('Daily entry invoice sync failed:', err);
    }
    return saved;
  });
}

async function saveEntriesBatch(data, user = null) {
  const entries = Array.isArray(data.entries) ? data.entries : [];
  if (!entries.length) throw new Error('لا توجد أيام للحفظ');
  const saved = [];
  let lastSync = null;
  for (const entryData of entries) {
    const result = await saveEntry(
      {
        ...entryData,
        file_number: data.file_number,
        patient_name: data.patient_name,
      },
      user
    );
    saved.push(result);
    if (result.invoice_sync?.synced) lastSync = result.invoice_sync;
  }
  return { saved, count: saved.length, invoice_sync: lastSync };
}

async function deleteEntry(entryId) {
  const id = Number(entryId);
  if (!id) throw new Error('معرف الحركة غير صالح');

  const { rows } = await query(`SELECT * FROM patient_daily_entries WHERE id = $1`, [id]);
  if (!rows.length) throw new Error('الحركة غير موجودة');
  const entry = rows[0];

  if (entry.invoice_id) {
    const invRes = await query(`SELECT status FROM invoices WHERE id = $1`, [entry.invoice_id]);
    if (invRes.rows[0]?.status === 'approved') {
      throw new Error('لا يمكن حذف حركة مرتبطة بفاتورة معتمدة');
    }
  }

  await query(`DELETE FROM patient_daily_entry_lines WHERE entry_id = $1`, [id]);
  await query(`DELETE FROM patient_daily_entry_history WHERE entry_id = $1`, [id]);
  await query(`DELETE FROM patient_daily_entries WHERE id = $1`, [id]);
  return { deleted: true, id };
}

function lineToInvoiceItem(line, entry) {
  const dateLabel = entry.entry_date;
  let description = line.description || line.section_code;
  if (line.service_name) description = line.service_name;
  if (line.extra_text) description = `${description} (${line.extra_text})`;
  description = `[${dateLabel}] ${description}`;

  const quantity = round2(line.quantity || 1) || 1;
  const amount = round2(line.unit_price || line.amount || 0);
  const total = round2(line.amount || quantity * amount);

  return {
    description,
    quantity,
    amount: quantity ? round2(total / quantity) : total,
    service_id: line.service_id || null,
    daily_entry_id: entry.id,
    daily_entry_line_id: line.id,
    section_code: line.section_code,
  };
}

function entriesToInvoiceItems(entries, sections = []) {
  const sectionTypeMap = Object.fromEntries(sections.map((s) => [s.code, s.input_type]));
  const skipTypes = new Set(['date', 'text']);
  const items = [];
  for (const entry of entries) {
    for (const line of entry.lines || []) {
      const inputType = sectionTypeMap[line.section_code];
      if (inputType && skipTypes.has(inputType)) continue;
      if (round2(line.amount) <= 0) continue;
      items.push(lineToInvoiceItem(line, entry));
    }
  }
  return items;
}

async function enrichDailyInvoiceItems(items = []) {
  if (!items.length) return items;
  const sections = await getSectionsWithServices();
  const sectionMap = Object.fromEntries(sections.map((s) => [s.code, s]));
  const { resolveServiceForInvoice } = require('./serviceCatalogService');
  const enriched = [];

  for (const item of items) {
    let next = { ...item };
    const section = item.section_code ? sectionMap[item.section_code] : null;
    const serviceId = next.service_id || section?.default_service?.id || null;
    if (serviceId) {
      next.service_id = Number(serviceId);
      try {
        const resolved = await resolveServiceForInvoice(Number(serviceId));
        next = {
          ...next,
          ...resolved,
          description: next.description || resolved.description,
          amount: next.amount ?? resolved.amount,
        };
      } catch {
        /* keep item as-is */
      }
    }
    enriched.push(next);
  }
  return enriched;
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
    const entry = await getEntryByPatientDate(row.patient_id, row.entry_date);
    if (entry) entries.push(entry);
  }
  return entries;
}

async function getInvoiceItemsFromDailyCharges(fileNumber, fromDate, toDate, invoiceId = null) {
  const sections = await listSections();
  const entries = await getEntriesForInvoice(fileNumber, fromDate, toDate, invoiceId);
  const items = entriesToInvoiceItems(entries, sections);
  return enrichDailyInvoiceItems(items);
}

async function linkEntriesToInvoice(invoiceId, fileNumber, fromDate, toDate, client = null) {
  if (!invoiceId || !fileNumber?.trim()) return 0;
  const run = client ? client.query.bind(client) : query;
  const patient = await resolvePatient(fileNumber);
  let sql = `
    UPDATE patient_daily_entries SET invoice_id = $1, updated_at = NOW()
    WHERE patient_id = $2 AND invoice_id IS NULL`;
  const params = [invoiceId, patient.id];
  let i = 3;
  if (fromDate) {
    sql += ` AND entry_date >= $${i++}`;
    params.push(fromDate);
  }
  if (toDate) {
    sql += ` AND entry_date <= $${i++}`;
    params.push(toDate);
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
  linkEntriesToInvoice,
  unlinkEntriesFromInvoice,
  computeDailyTotal,
};
