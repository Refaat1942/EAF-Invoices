const { query, withTransaction } = require('../database/db');
const { getSetting, setSetting } = require('./settingsService');

async function listPriceLists(activeOnly = false) {
  let sql = 'SELECT * FROM price_lists';
  if (activeOnly) sql += ' WHERE is_active = TRUE';
  sql += ' ORDER BY is_default DESC, effective_from DESC NULLS LAST, id DESC';
  const { rows } = await query(sql);
  return rows;
}

async function getDefaultPriceList() {
  const settingId = await getSetting('active_price_list_id', '');
  if (settingId) {
    const fromSetting = await getPriceListById(Number(settingId));
    if (fromSetting?.is_active) return fromSetting;
  }

  const { rows } = await query(
    `SELECT pl.*, COUNT(s.id)::int AS services_count
     FROM price_lists pl
     LEFT JOIN services s ON s.price_list_id = pl.id AND s.is_active = TRUE
     WHERE pl.is_active = TRUE
     GROUP BY pl.id
     ORDER BY services_count DESC, pl.is_default DESC, pl.effective_from DESC NULLS LAST, pl.id DESC`
  );
  return rows[0] || null;
}

async function getPriceListById(id) {
  const { rows } = await query('SELECT * FROM price_lists WHERE id = $1', [id]);
  return rows[0] || null;
}

async function clonePriceList(sourceId, data, actor = null) {
  const source = await getPriceListById(sourceId);
  if (!source) throw new Error('اللائحة المصدر غير موجودة');

  return withTransaction(async (client) => {
    const code = data.code || `${source.code}-COPY-${Date.now()}`;
    const inserted = await client.query(
      `INSERT INTO price_lists (
        name, code, fiscal_year_start, fiscal_year_end, effective_from, effective_to,
        is_active, is_default, cloned_from_id, created_by_user_id, created_by_name, notes
      ) VALUES ($1,$2,$3,$4,$5,$6,TRUE,FALSE,$7,$8,$9,$10) RETURNING *`,
      [
        data.name || `${source.name} (نسخة)`,
        code,
        data.fiscal_year_start ?? source.fiscal_year_start,
        data.fiscal_year_end ?? source.fiscal_year_end,
        data.effective_from || source.effective_from,
        data.effective_to || source.effective_to,
        source.id,
        actor?.id || null,
        actor?.name || '',
        data.notes || `نسخة من ${source.name}`,
      ]
    );
    const newList = inserted.rows[0];

    const categories = await client.query(
      'SELECT * FROM service_categories WHERE price_list_id = $1 ORDER BY sort_order, id',
      [sourceId]
    );
    const categoryMap = {};
    for (const cat of categories.rows) {
      const copy = await client.query(
        `INSERT INTO service_categories (price_list_id, parent_id, name, code, sort_order, is_active, notes)
         VALUES ($1, NULL, $2, $3, $4, $5, $6) RETURNING id`,
        [newList.id, cat.name, cat.code, cat.sort_order, cat.is_active, cat.notes]
      );
      categoryMap[cat.id] = copy.rows[0].id;
    }

    const services = await client.query(
      'SELECT * FROM services WHERE price_list_id = $1 ORDER BY sort_order, id',
      [sourceId]
    );
    for (const svc of services.rows) {
      const newSvc = await client.query(
        `INSERT INTO services (
          price_list_id, category_id, code, name, description, unit, price, price_type,
          variable_price_note, discountable, administrative_fee_applicable, is_active, sort_order, notes, metadata
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb) RETURNING id`,
        [
          newList.id,
          categoryMap[svc.category_id] || null,
          svc.code,
          svc.name,
          svc.description,
          svc.unit,
          svc.price,
          svc.price_type,
          svc.variable_price_note,
          svc.discountable,
          svc.administrative_fee_applicable,
          svc.is_active,
          svc.sort_order,
          svc.notes,
          JSON.stringify(svc.metadata || {}),
        ]
      );
      const oldId = svc.id;
      const newId = newSvc.rows[0].id;
      const components = await client.query('SELECT * FROM service_price_components WHERE service_id = $1 ORDER BY sort_order', [oldId]);
      for (const comp of components.rows) {
        await client.query(
          `INSERT INTO service_price_components (service_id, code, name, amount, discountable, administrative_fee_applicable, sort_order, is_total)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [newId, comp.code, comp.name, comp.amount, comp.discountable, comp.administrative_fee_applicable, comp.sort_order, comp.is_total]
        );
      }
      const tiers = await client.query('SELECT * FROM service_price_tiers WHERE service_id = $1 ORDER BY sort_order', [oldId]);
      for (const tier of tiers.rows) {
        await client.query(
          `INSERT INTO service_price_tiers (service_id, tier_key, tier_label, unit, price, sort_order)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [newId, tier.tier_key, tier.tier_label, tier.unit, tier.price, tier.sort_order]
        );
      }
    }

    return newList;
  });
}

async function setDefaultPriceList(id) {
  await query('UPDATE price_lists SET is_default = FALSE');
  const { rows } = await query(
    'UPDATE price_lists SET is_default = TRUE, updated_at = NOW() WHERE id = $1 RETURNING *',
    [id]
  );
  if (!rows.length) throw new Error('اللائحة غير موجودة');
  await setSetting('active_price_list_id', String(id));
  return rows[0];
}

async function getPricingSettings() {
  const keys = [
    'administrative_fee_rate',
    'default_supplies_markup_percent',
    'file_opening_fee',
    'ambulance_rental_cairo',
    'foreign_resident_multiplier',
    'foreign_non_resident_multiplier',
    'foreign_currency_discount_percent',
  ];
  const settings = {};
  for (const key of keys) {
    settings[key] = await getSetting(key, '');
  }
  return settings;
}

async function savePricingSettings(data) {
  const allowed = [
    'administrative_fee_rate',
    'default_supplies_markup_percent',
    'file_opening_fee',
    'ambulance_rental_cairo',
    'foreign_resident_multiplier',
    'foreign_non_resident_multiplier',
    'foreign_currency_discount_percent',
  ];
  for (const key of allowed) {
    if (data[key] !== undefined) await setSetting(key, String(data[key]));
  }
  return getPricingSettings();
}

async function getDefaultSuppliesMarkupPercent() {
  const { getSetting } = require('./settingsService');
  const n = Number(await getSetting('default_supplies_markup_percent', '20'));
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : 20;
}

module.exports = {
  listPriceLists,
  getDefaultPriceList,
  getPriceListById,
  clonePriceList,
  setDefaultPriceList,
  getPricingSettings,
  savePricingSettings,
  getDefaultSuppliesMarkupPercent,
};
