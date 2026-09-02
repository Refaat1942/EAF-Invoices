const { query, withTransaction } = require('../database/db');
const ExcelJS = require('exceljs');
const { getDefaultPriceList, getPriceListById } = require('./priceListService');

const HIDDEN_CATEGORY_NAMES = new Set([
  'نوع الخدمة',
  'البيان',
  'الخدمة',
  'م',
  'قسم',
  'قسم التقييم',
]);

async function listCategories(priceListId, activeOnly = true) {
  let sql = 'SELECT * FROM service_categories WHERE price_list_id = $1';
  const params = [priceListId];
  if (activeOnly) sql += ' AND is_active = TRUE';
  sql += ' ORDER BY sort_order, name';
  const { rows } = await query(sql, params);
  return rows.filter((row) => !HIDDEN_CATEGORY_NAMES.has(String(row.name || '').trim()));
}

async function createCategory(priceListId, data) {
  const { rows } = await query(
    `INSERT INTO service_categories (price_list_id, parent_id, name, code, sort_order, is_active, notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [
      priceListId,
      data.parent_id || null,
      data.name,
      data.code,
      data.sort_order || 0,
      data.is_active !== false,
      data.notes || '',
    ]
  );
  return rows[0];
}

async function updateCategory(id, data) {
  const fields = [];
  const params = [id];
  let i = 2;
  for (const key of ['name', 'code', 'sort_order', 'notes']) {
    if (data[key] !== undefined) {
      fields.push(`${key} = $${i++}`);
      params.push(data[key]);
    }
  }
  if (data.parent_id !== undefined) {
    fields.push(`parent_id = $${i++}`);
    params.push(data.parent_id || null);
  }
  if (data.is_active !== undefined) {
    fields.push(`is_active = $${i++}`);
    params.push(!!data.is_active);
  }
  if (!fields.length) throw new Error('لا توجد بيانات للتحديث');
  const { rows } = await query(`UPDATE service_categories SET ${fields.join(', ')} WHERE id = $1 RETURNING *`, params);
  if (!rows.length) throw new Error('القسم غير موجود');
  return rows[0];
}

async function listServices(filters = {}) {
  const priceListId = filters.price_list_id || (await getDefaultPriceList())?.id;
  if (!priceListId) return [];

  let sql = `
    SELECT s.*, c.name AS category_name, c.code AS category_code
    FROM services s
    LEFT JOIN service_categories c ON c.id = s.category_id
    WHERE s.price_list_id = $1`;
  const params = [priceListId];
  let i = 2;

  if (filters.category_id) {
    sql += ` AND s.category_id = $${i++}`;
    params.push(filters.category_id);
  }
  if (filters.active_only !== false) {
    sql += ' AND s.is_active = TRUE';
  }
  if (filters.search) {
    sql += ` AND (s.name ILIKE $${i} OR s.code ILIKE $${i} OR s.description ILIKE $${i})`;
    params.push(`%${filters.search}%`);
    i++;
  }
  if (filters.discountable === 'true') sql += ' AND s.discountable = TRUE';
  if (filters.discountable === 'false') sql += ' AND s.discountable = FALSE';

  sql += ' ORDER BY c.sort_order NULLS LAST, s.sort_order, s.name';
  if (filters.limit) {
    sql += ` LIMIT $${i++}`;
    params.push(Number(filters.limit));
  }

  const { rows } = await query(sql, params);
  return rows;
}

async function enrichServicesWithResolvedPrices(services = []) {
  const enriched = [];
  for (const svc of services) {
    const basePrice = Number(svc.price) || 0;
    const needsResolve = (svc.price_type && svc.price_type !== 'fixed') || basePrice <= 0;
    if (!needsResolve && basePrice > 0) {
      enriched.push({ ...svc, list_price: basePrice, price: basePrice });
      continue;
    }
    try {
      const resolved = await resolveServiceForInvoice(svc.id);
      const listPrice = Number(resolved.amount) || 0;
      enriched.push({
        ...svc,
        price: listPrice,
        list_price: listPrice,
        category_name: svc.category_name || resolved.category_name_snapshot || '',
      });
    } catch {
      enriched.push({ ...svc, list_price: basePrice, price: basePrice });
    }
  }
  return enriched;
}

async function getServiceById(id, client = null) {
  const run = client ? client.query.bind(client) : query;
  const { rows } = await run(
    `SELECT s.*, c.name AS category_name, c.code AS category_code, pl.name AS price_list_name
     FROM services s
     LEFT JOIN service_categories c ON c.id = s.category_id
     LEFT JOIN price_lists pl ON pl.id = s.price_list_id
     WHERE s.id = $1`,
    [id]
  );
  if (!rows.length) return null;
  const service = rows[0];
  const components = await run(
    'SELECT * FROM service_price_components WHERE service_id = $1 ORDER BY sort_order, id',
    [id]
  );
  const tiers = await run('SELECT * FROM service_price_tiers WHERE service_id = $1 ORDER BY sort_order, id', [id]);
  return { ...service, components: components.rows, tiers: tiers.rows };
}

async function recordServiceHistory(client, serviceId, payload, actor) {
  await client.query(
    `INSERT INTO service_price_history (
      service_id, price_list_id, field_name, old_value, new_value, old_price, new_price,
      effective_from, changed_by_user_id, changed_by_name, change_reason
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [
      serviceId,
      payload.price_list_id || null,
      payload.field_name || 'price',
      payload.old_value ?? null,
      payload.new_value ?? null,
      payload.old_price ?? null,
      payload.new_price ?? null,
      payload.effective_from || null,
      actor?.id || null,
      actor?.name || '',
      payload.change_reason || '',
    ]
  );
}

async function createService(data, actor = null) {
  return withTransaction(async (client) => {
    const inserted = await client.query(
      `INSERT INTO services (
        price_list_id, category_id, code, name, description, unit, price, price_type,
        variable_price_note, discountable, administrative_fee_applicable, is_active, sort_order, notes, metadata
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb) RETURNING *`,
      [
        data.price_list_id,
        data.category_id || null,
        data.code,
        data.name,
        data.description || '',
        data.unit || 'مرة',
        Number(data.price) || 0,
        data.price_type || 'fixed',
        data.variable_price_note || '',
        data.discountable !== false,
        data.administrative_fee_applicable !== false,
        data.is_active !== false,
        data.sort_order || 0,
        data.notes || '',
        JSON.stringify(data.metadata || {}),
      ]
    );
    const service = inserted.rows[0];
    await saveServiceChildren(client, service.id, data);
    await recordServiceHistory(
      client,
      service.id,
      {
        price_list_id: service.price_list_id,
        field_name: 'price',
        old_price: 0,
        new_price: service.price,
        change_reason: 'إنشاء خدمة جديدة',
      },
      actor
    );
    return getServiceById(service.id, client);
  });
}

async function saveServiceChildren(client, serviceId, data) {
  if (Array.isArray(data.components)) {
    await client.query('DELETE FROM service_price_components WHERE service_id = $1', [serviceId]);
    for (const [index, comp] of data.components.entries()) {
      await client.query(
        `INSERT INTO service_price_components (service_id, code, name, amount, discountable, administrative_fee_applicable, sort_order, is_total)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [
          serviceId,
          comp.code || '',
          comp.name,
          Number(comp.amount) || 0,
          comp.discountable ?? null,
          comp.administrative_fee_applicable ?? null,
          index,
          !!comp.is_total,
        ]
      );
    }
  }
  if (Array.isArray(data.tiers)) {
    await client.query('DELETE FROM service_price_tiers WHERE service_id = $1', [serviceId]);
    for (const [index, tier] of data.tiers.entries()) {
      await client.query(
        `INSERT INTO service_price_tiers (service_id, tier_key, tier_label, unit, price, sort_order)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [serviceId, tier.tier_key, tier.tier_label, tier.unit || 'مرة', Number(tier.price) || 0, index]
      );
    }
  }
}

async function updateService(id, data, actor = null) {
  return withTransaction(async (client) => {
    const existing = await getServiceById(id, client);
    if (!existing) throw new Error('الخدمة غير موجودة');

    const fields = [];
    const params = [id];
    let i = 2;
    const map = {
      category_id: (v) => v || null,
      code: (v) => v,
      name: (v) => v,
      description: (v) => v,
      unit: (v) => v,
      price: (v) => Number(v) || 0,
      price_type: (v) => v,
      variable_price_note: (v) => v,
      discountable: (v) => !!v,
      administrative_fee_applicable: (v) => !!v,
      is_active: (v) => !!v,
      sort_order: (v) => Number(v) || 0,
      notes: (v) => v,
    };

    for (const [key, transform] of Object.entries(map)) {
      if (data[key] !== undefined) {
        fields.push(`${key} = $${i++}`);
        params.push(transform(data[key]));
      }
    }
    if (data.metadata !== undefined) {
      fields.push(`metadata = $${i++}::jsonb`);
      params.push(JSON.stringify(data.metadata || {}));
    }
    fields.push('updated_at = NOW()');

    const { rows } = await client.query(`UPDATE services SET ${fields.join(', ')} WHERE id = $1 RETURNING *`, params);
    const updated = rows[0];

    if (data.price !== undefined && Number(data.price) !== Number(existing.price)) {
      await recordServiceHistory(
        client,
        id,
        {
          price_list_id: updated.price_list_id,
          field_name: 'price',
          old_price: existing.price,
          new_price: updated.price,
          effective_from: data.effective_from || null,
          change_reason: data.change_reason || 'تعديل السعر',
        },
        actor
      );
    }

    await saveServiceChildren(client, id, data);
    return getServiceById(id, client);
  });
}

async function bulkUpdatePrices(updates = [], actor = null) {
  const results = [];
  for (const entry of updates) {
    if (!entry.id) continue;
    results.push(
      await updateService(
        entry.id,
        {
          price: entry.price,
          change_reason: entry.change_reason || 'تعديل جماعي',
          effective_from: entry.effective_from || null,
        },
        actor
      )
    );
  }
  return results;
}

async function resolveServiceForInvoice(serviceId, options = {}) {
  const service = await getServiceById(serviceId);
  if (!service || !service.is_active) throw new Error('الخدمة غير متاحة');

  let unitPrice = Number(service.price) || 0;
  if (service.price_type === 'tiered' && options.tier_key) {
    const tier = service.tiers.find((t) => t.tier_key === options.tier_key);
    if (tier) unitPrice = Number(tier.price) || 0;
  }
  if (service.price_type === 'composite') {
    unitPrice = service.components
      .filter((c) => !c.is_total)
      .reduce((sum, c) => sum + (Number(c.amount) || 0), 0);
    const totalComp = service.components.find((c) => c.is_total);
    if (totalComp && Number(totalComp.amount) > 0) unitPrice = Number(totalComp.amount);
  }

  return {
    service_id: service.id,
    service_code_snapshot: service.code,
    service_name_snapshot: service.name,
    description: service.name,
    unit_snapshot: options.unit || service.unit,
    unit_price_snapshot: unitPrice,
    amount: unitPrice,
    price_type_snapshot: service.price_type,
    tier_key_snapshot: options.tier_key || '',
    discountable_snapshot: service.discountable,
    administrative_fee_applicable_snapshot: service.administrative_fee_applicable,
    price_list_id_snapshot: service.price_list_id,
    price_list_name_snapshot: service.price_list_name || '',
    category_name_snapshot: service.category_name || '',
    category_code_snapshot: service.category_code || '',
    composite_components_snapshot: service.components || [],
    discount_eligible_override: service.discountable,
  };
}

async function exportServicesExcel(priceListId) {
  const list = await getPriceListById(priceListId);
  const services = await listServices({ price_list_id: priceListId, active_only: false });
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('الأسعار', { views: [{ rightToLeft: true }] });
  sheet.addRow(['اللائحة', list?.name || '']);
  sheet.addRow([]);
  sheet.addRow([
    'الكود',
    'القسم',
    'اسم الخدمة',
    'الوحدة',
    'السعر',
    'نوع السعر',
    'يخضع للخصم',
    'مصروفات إدارية',
    'نشط',
    'ملاحظات',
  ]);
  services.forEach((svc) => {
    sheet.addRow([
      svc.code,
      svc.category_name,
      svc.name,
      svc.unit,
      Number(svc.price),
      svc.price_type,
      svc.discountable ? 'نعم' : 'لا',
      svc.administrative_fee_applicable ? 'نعم' : 'لا',
      svc.is_active ? 'نعم' : 'لا',
      svc.notes || '',
    ]);
  });
  sheet.getRow(3).font = { bold: true };
  return workbook.xlsx.writeBuffer();
}

async function exportServicesCsv(priceListId) {
  const services = await listServices({ price_list_id: priceListId, active_only: false });
  const header = ['الكود', 'القسم', 'اسم الخدمة', 'الوحدة', 'السعر', 'نوع السعر', 'يخضع للخصم', 'مصروفات إدارية', 'نشط', 'ملاحظات'];
  const lines = [header.join(',')];
  for (const svc of services) {
    const row = [
      svc.code,
      svc.category_name || '',
      `"${String(svc.name || '').replace(/"/g, '""')}"`,
      svc.unit || '',
      Number(svc.price) || 0,
      svc.price_type || 'fixed',
      svc.discountable ? 'نعم' : 'لا',
      svc.administrative_fee_applicable ? 'نعم' : 'لا',
      svc.is_active ? 'نعم' : 'لا',
      `"${String(svc.notes || '').replace(/"/g, '""')}"`,
    ];
    lines.push(row.join(','));
  }
  return `\uFEFF${lines.join('\n')}`;
}

function mapCsvRowToService(row) {
  return {
    code: row['الكود'] || row.code || '',
    name: row['اسم الخدمة'] || row.name || '',
    unit: row['الوحدة'] || row.unit || 'مرة',
    price: Number(String(row['السعر'] ?? row.price ?? '0').replace(/,/g, '')) || 0,
    price_type: row['نوع السعر'] || row.price_type || 'fixed',
    discountable: (row['يخضع للخصم'] || row.discountable) !== 'لا',
    administrative_fee_applicable: (row['مصروفات إدارية'] || row.administrative_fee_applicable) !== 'لا',
    is_active: (row['نشط'] || row.is_active) !== 'لا',
    notes: row['ملاحظات'] || row.notes || '',
  };
}

async function parseCsvServices(text) {
  const lines = String(text || '').replace(/^\uFEFF/, '').split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];
  const headers = lines[0].split(',').map((h) => h.trim().replace(/^"|"$/g, ''));
  return lines.slice(1).map((line) => {
    const cols = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        inQuotes = !inQuotes;
        continue;
      }
      if (ch === ',' && !inQuotes) {
        cols.push(current.trim());
        current = '';
        continue;
      }
      current += ch;
    }
    cols.push(current.trim());
    const row = {};
    headers.forEach((h, idx) => {
      row[h] = (cols[idx] || '').replace(/^"|"$/g, '').replace(/""/g, '"');
    });
    return mapCsvRowToService(row);
  });
}

async function importServicesCsv(priceListId, rows, actor = null) {
  let count = 0;
  for (const row of rows) {
    if (!row.name && !row.code) continue;
    const existing = await query('SELECT id FROM services WHERE price_list_id = $1 AND code = $2', [
      priceListId,
      row.code,
    ]);
    if (existing.rows.length) {
      await updateService(existing.rows[0].id, row, actor);
    } else {
      await createService({ ...row, price_list_id: priceListId }, actor);
    }
    count += 1;
  }
  return { imported: count };
}

module.exports = {
  listCategories,
  createCategory,
  updateCategory,
  listServices,
  getServiceById,
  enrichServicesWithResolvedPrices,
  createService,
  updateService,
  bulkUpdatePrices,
  resolveServiceForInvoice,
  exportServicesExcel,
  exportServicesCsv,
  importServicesCsv,
  parseCsvServices,
};
