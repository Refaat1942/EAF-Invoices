const fs = require('fs');
const path = require('path');
const { query, withTransaction } = require('../db');

const SEED_PATH = path.join(__dirname, 'price-list-2026-2027.json');

async function seedDefaultPriceList(force = false) {
  const { rows } = await query('SELECT COUNT(*)::int AS c FROM services');
  if (!force && rows[0].c > 0) return { skipped: true };

  const payload = JSON.parse(fs.readFileSync(SEED_PATH, 'utf8'));
  return importPriceListPayload(payload, null, { replaceExisting: force });
}

async function importPriceListPayload(payload, actor = null, options = {}) {
  return withTransaction(async (client) => {
    const run = (text, params) => client.query(text, params);
    const list = payload.price_list || payload;
    const categories = payload.categories || [];
    const services = payload.services || [];
    const settings = payload.settings || {};

    if (options.replaceExisting && list.code) {
      await run('DELETE FROM price_lists WHERE code = $1', [list.code]);
    }

    const existing = await run('SELECT id FROM price_lists WHERE code = $1', [list.code]);
    let priceListId;
    if (existing.rows.length) {
      priceListId = existing.rows[0].id;
    } else {
      if (list.is_default !== false) {
        await run('UPDATE price_lists SET is_default = FALSE');
      }
      const inserted = await run(
        `INSERT INTO price_lists (
        name, code, fiscal_year_start, fiscal_year_end, effective_from, effective_to,
        is_active, is_default, created_by_user_id, created_by_name, notes
      ) VALUES ($1,$2,$3,$4,$5,$6,TRUE,$7,$8,$9,$10) RETURNING id`,
        [
          list.name,
          list.code,
          list.fiscal_year_start || null,
          list.fiscal_year_end || null,
          list.effective_from || null,
          list.effective_to || null,
          list.is_default !== false,
          actor?.id || null,
          actor?.name || '',
          list.notes || '',
        ]
      );
      priceListId = inserted.rows[0].id;
    }

    const categoryMap = {};
    for (const cat of categories) {
      const result = await run(
        `INSERT INTO service_categories (price_list_id, parent_id, name, code, sort_order, is_active, notes)
       VALUES ($1, $2, $3, $4, $5, TRUE, $6)
       ON CONFLICT (price_list_id, code) DO UPDATE SET
         name = EXCLUDED.name,
         sort_order = EXCLUDED.sort_order,
         notes = EXCLUDED.notes,
         is_active = TRUE
       RETURNING id`,
        [priceListId, cat.parent_id || null, cat.name, cat.code, cat.sort_order || 0, cat.notes || '']
      );
      categoryMap[cat.code] = result.rows[0].id;
    }

    let serviceCount = 0;
    const staySyncJobs = [];
    for (const svc of services) {
      const categoryId = categoryMap[svc.category_code] || null;
      const inserted = await run(
        `INSERT INTO services (
        price_list_id, category_id, code, name, description, unit, price, price_type,
        variable_price_note, discountable, administrative_fee_applicable, is_active, sort_order, notes, metadata
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,TRUE,$12,$13,$14::jsonb)
      ON CONFLICT (price_list_id, code) DO UPDATE SET
        category_id = EXCLUDED.category_id,
        name = EXCLUDED.name,
        description = EXCLUDED.description,
        unit = EXCLUDED.unit,
        price = EXCLUDED.price,
        price_type = EXCLUDED.price_type,
        variable_price_note = EXCLUDED.variable_price_note,
        discountable = EXCLUDED.discountable,
        administrative_fee_applicable = EXCLUDED.administrative_fee_applicable,
        sort_order = EXCLUDED.sort_order,
        notes = EXCLUDED.notes,
        metadata = EXCLUDED.metadata,
        updated_at = NOW()
      RETURNING id`,
        [
          priceListId,
          categoryId,
          svc.code,
          svc.name,
          svc.description || '',
          svc.unit || 'مرة',
          Number(svc.price) || 0,
          svc.price_type || 'fixed',
          svc.variable_price_note || '',
          svc.discountable !== false,
          svc.administrative_fee_applicable !== false,
          svc.sort_order || 0,
          svc.notes || '',
          JSON.stringify(svc.metadata || {}),
        ]
      );
      const serviceId = inserted.rows[0].id;
      serviceCount += 1;

      await run('DELETE FROM service_price_components WHERE service_id = $1', [serviceId]);
      await run('DELETE FROM service_price_tiers WHERE service_id = $1', [serviceId]);

      for (const [index, comp] of (svc.components || []).entries()) {
        await run(
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
            !!comp.is_total || comp.code === 'TOTAL',
          ]
        );
      }

      for (const [index, tier] of (svc.tiers || []).entries()) {
        await run(
          `INSERT INTO service_price_tiers (service_id, tier_key, tier_label, unit, price, sort_order)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (service_id, tier_key) DO UPDATE SET
           tier_label = EXCLUDED.tier_label,
           unit = EXCLUDED.unit,
           price = EXCLUDED.price,
           sort_order = EXCLUDED.sort_order`,
          [serviceId, tier.tier_key, tier.tier_label, tier.unit || svc.unit || 'مرة', Number(tier.price) || 0, index]
        );
      }

      if (svc.unit === 'يوم') {
        staySyncJobs.push({ svc, price: Number(svc.price) || 0 });
      }
    }

    for (const job of staySyncJobs) {
      await syncStayTypeFromService(job.svc, job.price, run);
    }

    for (const [key, value] of Object.entries(settings)) {
      await run(
        `INSERT INTO app_settings (key, value, updated_at) VALUES ($1, $2, NOW())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
        [key, String(value)]
      );
    }

    await run('UPDATE price_lists SET is_default = FALSE');
    await run('UPDATE price_lists SET is_default = TRUE, updated_at = NOW() WHERE id = $1', [priceListId]);
    await run(
      `INSERT INTO app_settings (key, value, updated_at) VALUES ('active_price_list_id', $1, NOW())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
      [String(priceListId)]
    );

    const stats = await getPriceListStats(priceListId, run);
    return { price_list_id: priceListId, ...stats, imported: serviceCount };
  });
}

async function syncStayTypeFromService(service, price, run = query) {
  const stayNames = [
    'رعاية مركزة',
    'رعاية تلطيفية',
    'VIP',
    'جناح VIP',
    'جناح كبير مميز',
    'غرفة مميزة',
    'جناح كبير',
    'جناح صغير',
    'غرفة فردية',
    'غرفة مزدوجة',
  ];
  const normalized = String(service.name || '').trim();
  const match = stayNames.find((name) => normalized.includes(name) || name.includes(normalized));
  if (!match || service.unit !== 'يوم') return;
  await run(`UPDATE stay_types SET daily_rate = $2 WHERE name = $1`, [match, price]);
}

async function getPriceListStats(priceListId, run = query) {
  const categories = await run(
    'SELECT COUNT(*)::int AS c FROM service_categories WHERE price_list_id = $1',
    [priceListId]
  );
  const services = await run(
    `SELECT COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE discountable = TRUE)::int AS discountable,
            COUNT(*) FILTER (WHERE discountable = FALSE)::int AS non_discountable
     FROM services WHERE price_list_id = $1`,
    [priceListId]
  );
  return {
    categories_count: categories.rows[0].c,
    services_count: services.rows[0].total,
    discountable_count: services.rows[0].discountable,
    non_discountable_count: services.rows[0].non_discountable,
  };
}

module.exports = {
  seedDefaultPriceList,
  importPriceListPayload,
  getPriceListStats,
};
