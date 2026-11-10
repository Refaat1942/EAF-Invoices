/**
 * Arabic names for the laboratory tests (database/seeds/lab-tests-ar.json).
 *
 * Applied once at start-up after an update:
 *  - a test already on the server under its English name is RENAMED to Arabic (same id,
 *    price and history — old invoices keep the text they were issued with);
 *  - a test of the list that the server does not have yet is ADDED to the laboratory
 *    category of the default price list, at the list price;
 *  - an English-only test left in a laboratory section is switched OFF (hidden, kept).
 * Nothing is deleted. The result is kept in app_settings («lab_tests_ar_result»).
 */
const fs = require('fs');
const path = require('path');
const { query } = require('../database/db');

const DONE_KEY = 'lab_tests_ar_v1';
const RESULT_KEY = 'lab_tests_ar_result';

function nameKey(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

function loadList() {
  const file = path.join(__dirname, '..', 'database', 'seeds', 'lab-tests-ar.json');
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  return Array.isArray(data.tests) ? data.tests : [];
}

async function findLabCategory(priceListId) {
  const { rows } = await query(
    `SELECT id FROM service_categories
     WHERE (price_list_id = $1 OR price_list_id IS NULL)
       AND (name LIKE '%تحاليل%' OR name LIKE '%معمل%')
     ORDER BY (name LIKE '%المعمل والتحاليل%') DESC, id
     LIMIT 1`,
    [priceListId]
  ).catch(async () =>
    query(
      `SELECT id FROM service_categories WHERE name LIKE '%تحاليل%' OR name LIKE '%معمل%'
       ORDER BY (name LIKE '%المعمل والتحاليل%') DESC, id LIMIT 1`
    )
  );
  return rows[0]?.id || null;
}

async function applyLabArabicNames({ force = false } = {}) {
  const { rows: done } = await query(`SELECT value FROM app_settings WHERE key = $1`, [DONE_KEY]);
  if (done.length && !force) return null;

  const list = loadList();
  const byKey = new Map();
  for (const t of list) {
    const k = nameKey(t.en);
    if (k && !byKey.has(k)) byKey.set(k, t);
  }

  const { getDefaultPriceList } = require('./priceListService');
  const priceList = await getDefaultPriceList().catch(() => null);
  const priceListId = priceList?.id || null;

  // 1) rename the English tests already on the server
  const { rows: services } = await query(
    `SELECT id, name, price_list_id FROM services WHERE name ~ '[A-Za-z]' AND name !~ '[ء-ي]'`
  );
  const matchedKeys = new Set();
  let renamed = 0;
  for (const svc of services) {
    const t = byKey.get(nameKey(svc.name));
    if (!t) continue;
    await query(
      `UPDATE services SET name = $2,
         description = CASE WHEN COALESCE(description, '') = '' THEN $3 ELSE description END,
         updated_at = NOW()
       WHERE id = $1`,
      [svc.id, t.ar, t.en]
    );
    if (!priceListId || Number(svc.price_list_id) === Number(priceListId)) matchedKeys.add(nameKey(t.en));
    renamed += 1;
  }

  // 2) English-named tests left in the laboratory sections (not on the list) are switched
  //    off — hidden from the screens, kept for the invoices that already used them.
  const { rows: off } = await query(
    `UPDATE services SET is_active = FALSE, updated_at = NOW()
     WHERE is_active = TRUE
       AND name ~ '[A-Za-z]' AND name !~ '[ء-ي]'
       AND category_id IN (SELECT id FROM service_categories WHERE name LIKE '%تحاليل%' OR name LIKE '%معمل%')
     RETURNING id`
  );
  const deactivated = off.length;

  // 3) add the tests of the list the default price list does not have
  let added = 0;
  let addSkipped = '';
  if (priceListId) {
    const categoryId = await findLabCategory(priceListId);
    if (!categoryId) {
      addSkipped = 'لا يوجد قسم «المعمل والتحاليل» في لائحة الأسعار';
    } else {
      const { rows: existing } = await query(`SELECT name, description FROM services WHERE price_list_id = $1`, [priceListId]);
      const have = new Set();
      for (const s of existing) {
        have.add(String(s.name || '').trim());
        if (s.description) have.add(nameKey(s.description));
      }
      const { createService } = require('./serviceCatalogService');
      const seen = new Set();
      for (const t of list) {
        const k = nameKey(t.en);
        if (seen.has(k) || matchedKeys.has(k) || have.has(t.ar) || have.has(k)) continue;
        seen.add(k);
        try {
          await createService({
            price_list_id: priceListId,
            category_id: categoryId,
            name: t.ar,
            description: t.en,
            unit: 'مرة',
            price: Number(t.price) || 0,
            price_type: 'fixed',
            discountable: true,
            administrative_fee_applicable: true,
            is_active: true,
          });
          added += 1;
        } catch (err) {
          console.warn(`[lab-ar] could not add «${t.ar}»: ${err.message}`);
        }
      }
    }
  } else {
    addSkipped = 'لا توجد لائحة أسعار افتراضية';
  }

  const result = { renamed, added, deactivated, list: list.length, add_skipped: addSkipped, at: new Date().toISOString() };
  await query(
    `INSERT INTO app_settings (key, value, updated_at) VALUES ($1, $2, NOW())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
    [RESULT_KEY, JSON.stringify(result)]
  );
  await query(
    `INSERT INTO app_settings (key, value, updated_at) VALUES ($1, '1', NOW())
     ON CONFLICT (key) DO UPDATE SET value = '1', updated_at = NOW()`,
    [DONE_KEY]
  );
  console.log(
    `[lab-ar] Arabic lab names: ${renamed} renamed, ${added} added, ${deactivated} English-only switched off (list ${list.length})${addSkipped ? ` — ${addSkipped}` : ''}`
  );
  return result;
}

module.exports = { applyLabArabicNames, nameKey };
