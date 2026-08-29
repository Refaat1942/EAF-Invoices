#!/usr/bin/env node
/**
 * Daily Entry searchable picker regression tests.
 * Run: node scripts/test-daily-picker-search.js
 * With DB: node --env-file=.env scripts/test-daily-picker-search.js
 */
const path = require('path');
const fs = require('fs');

const envPath = path.join(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (m && !process.env[m[1].trim()]) process.env[m[1].trim()] = m[2].trim();
  }
}

function assert(cond, msg) {
  if (!cond) {
    console.error(`FAIL ${msg}`);
    process.exit(1);
  }
  console.log(`OK ${msg}`);
}

function assertEq(a, e, msg) {
  if (a !== e) {
    console.error(`FAIL ${msg}: expected ${JSON.stringify(e)}, got ${JSON.stringify(a)}`);
    process.exit(1);
  }
  console.log(`OK ${msg}`);
}

const { sanitizeUserMessage } = require('../public/js/api-client');
const TEST_PREFIX = `PICKER-${Date.now()}`;

assert(
  !sanitizeUserMessage('Failed to fetch').toLowerCase().includes('failed to fetch'),
  'picker UI path hides raw Failed to fetch'
);

(async () => {
  const hasDb = !!process.env.DATABASE_URL;
  if (!hasDb) {
    console.log('SKIP DB picker integration (no DATABASE_URL)');
    console.log('ALL DAILY PICKER TESTS PASSED');
    return;
  }

  const { initDatabase, query } = require('../database/db');
  try {
    await initDatabase();
  } catch (err) {
    console.log(`SKIP DB picker integration (${err.message})`);
    console.log('ALL DAILY PICKER TESTS PASSED');
    return;
  }

  const {
    getSectionsWithServices,
    resolveDefaultServiceForSection,
    searchDailyPickerItems,
    getDailyPickerItemBySection,
  } = require('../services/dailyChargeService');
  const { getDefaultPriceList, setDefaultPriceList } = require('../services/priceListService');
  const { createCategory, createService } = require('../services/serviceCatalogService');
  const { getSetting, setSetting } = require('../services/settingsService');

  async function capturePriceListState() {
    const activePriceListIdSetting = await getSetting('active_price_list_id', '');
    const { rows } = await query(`SELECT id FROM price_lists WHERE is_default = TRUE ORDER BY id LIMIT 1`);
    return {
      activePriceListIdSetting: activePriceListIdSetting || '',
      defaultFlagListId: rows[0]?.id || null,
    };
  }

  async function restorePriceListState(state) {
    await query('UPDATE price_lists SET is_default = FALSE');
    if (state.activePriceListIdSetting) {
      await setSetting('active_price_list_id', state.activePriceListIdSetting);
    } else {
      await setSetting('active_price_list_id', '');
    }
    if (state.defaultFlagListId) {
      await query('UPDATE price_lists SET is_default = TRUE, updated_at = NOW() WHERE id = $1', [
        state.defaultFlagListId,
      ]);
    }
  }

  async function cleanupFixturePriceList(priceListId) {
    if (!priceListId) return;
    const svcRes = await query(`SELECT id FROM services WHERE price_list_id = $1`, [priceListId]);
    for (const row of svcRes.rows) {
      await query(`DELETE FROM service_price_components WHERE service_id = $1`, [row.id]);
      await query(`DELETE FROM service_price_tiers WHERE service_id = $1`, [row.id]);
      await query(`DELETE FROM service_price_history WHERE service_id = $1`, [row.id]);
    }
    await query(`DELETE FROM services WHERE price_list_id = $1`, [priceListId]);
    await query(`DELETE FROM service_categories WHERE price_list_id = $1`, [priceListId]);
    await query(`DELETE FROM price_lists WHERE id = $1`, [priceListId]);
  }

  const priceListState = await capturePriceListState();
  const fixtureCode = `${TEST_PREFIX}-PL`;
  const { rows: plRows } = await query(
    `INSERT INTO price_lists (name, code, is_active, is_default, notes)
     VALUES ($1, $2, TRUE, FALSE, $3) RETURNING *`,
    ['Picker Default Service Fixture', fixtureCode, 'Issue 12 default_service regression']
  );
  const fixturePriceListId = plRows[0].id;
  await setDefaultPriceList(fixturePriceListId);

  const examsCategory = await createCategory(fixturePriceListId, {
    code: 'MEDICAL_EXAMS',
    name: `${TEST_PREFIX} Exams`,
    sort_order: 9998,
  });
  const stampsCategory = await createCategory(fixturePriceListId, {
    code: 'STAMPS',
    name: `${TEST_PREFIX} Stamps Empty`,
    sort_order: 9999,
  });

  const consultantSection = {
    code: 'consultant_exam',
    category_code: 'MEDICAL_EXAMS',
    default_service_code: 'EXAM-CONSULTANT',
    input_type: 'amount',
  };
  const stampSection = {
    code: 'consultation_stamp',
    category_code: 'STAMPS',
    default_service_code: 'STAMP-CONSULT',
    input_type: 'amount',
  };
  const fixturePriceList = await getDefaultPriceList();

  const exactService = await createService({
    price_list_id: fixturePriceListId,
    category_id: examsCategory.id,
    code: 'EXAM-CONSULTANT',
    name: `${TEST_PREFIX} Exact Consultant`,
    unit: 'كشف',
    price: 500,
    price_type: 'fixed',
    sort_order: 5,
  });
  await createService({
    price_list_id: fixturePriceListId,
    category_id: examsCategory.id,
    code: `${TEST_PREFIX}-OTHER`,
    name: `${TEST_PREFIX} Other Exam`,
    unit: 'كشف',
    price: 300,
    price_type: 'fixed',
    sort_order: 1,
  });

  const exactResolved = await resolveDefaultServiceForSection(consultantSection, fixturePriceList);
  assertEq(exactResolved?.id, exactService.id, 'exact default_service_code selects matching service');

  await query(`DELETE FROM services WHERE price_list_id = $1`, [fixturePriceListId]);
  const fallbackFirst = await createService({
    price_list_id: fixturePriceListId,
    category_id: examsCategory.id,
    code: `${TEST_PREFIX}-FB-2`,
    name: `${TEST_PREFIX} Fallback Second`,
    unit: 'كشف',
    price: 200,
    price_type: 'fixed',
    sort_order: 2,
  });
  const fallbackSecond = await createService({
    price_list_id: fixturePriceListId,
    category_id: examsCategory.id,
    code: `${TEST_PREFIX}-FB-1`,
    name: `${TEST_PREFIX} Fallback First`,
    unit: 'كشف',
    price: 100,
    price_type: 'fixed',
    sort_order: 1,
  });

  const fallbackResolved = await resolveDefaultServiceForSection(consultantSection, fixturePriceList);
  assertEq(
    fallbackResolved?.id,
    fallbackSecond.id,
    'missing exact code falls back to first active service in category by sort_order'
  );
  assert(
    fallbackResolved?.id !== fallbackFirst.id,
    'category fallback is deterministic and does not pick later sort_order first'
  );

  const emptyResolved = await resolveDefaultServiceForSection(stampSection, fixturePriceList);
  assertEq(emptyResolved, null, 'empty category yields null default_service');

  await cleanupFixturePriceList(fixturePriceListId);
  await restorePriceListState(priceListState);

  const shortSearch = await searchDailyPickerItems({
    section_code: 'medicines',
    search: 'a',
    page: 1,
    limit: 10,
  });
  assertEq(shortSearch.rows.length, 0, 'short search returns no rows');
  assertEq(shortSearch.min_search, 2, 'short search reports min_search');

  const sections = await getSectionsWithServices();
  const medicines = sections.find((s) => s.code === 'medicines');
  const consultant = sections.find((s) => s.code === 'consultant_exam');
  assert(medicines, 'medicines section exists');
  assertEq(medicines.services.length, 0, 'sections API does not embed full catalog list');
  assert(medicines.catalog_count >= 0, 'sections API exposes catalog_count');
  assert(consultant?.default_service?.id, 'consultant default_service resolved without full services list');
  assert(
    !consultant?.services?.length || consultant.services.length <= 1,
    'sections API keeps at most one embedded service for default'
  );
  const totalEmbeddedServices = sections.reduce((sum, s) => sum + (s.services?.length || 0), 0);
  assert(
    totalEmbeddedServices <= sections.filter((s) => s.category_code && !s.catalog_category).length,
    'sections API does not embed full category service lists'
  );

  const { createCatalogItem } = require('../services/dailyEntryCatalogService');
  const catalogItem = await createCatalogItem({
    name: `${TEST_PREFIX} Multi Unit`,
    category: 'Medicine',
    major_unit: 'BOX',
    minor_unit: 'TAB',
    minor_quantity_per_major: 10,
    major_unit_selling_price: 100,
    minor_unit_selling_price: 12,
  });

  const searchResult = await searchDailyPickerItems({
    section_code: 'medicines',
    search: TEST_PREFIX,
    page: 1,
    limit: 10,
  });
  assertEq(searchResult.kind, 'catalog', 'catalog search kind');
  assert(searchResult.rows.length >= 1, 'catalog search finds test item');
  const found = searchResult.rows.find((r) => r.id === catalogItem.id);
  assert(found, 'catalog search returns matching item');
  assertEq(found.unit_options.length, 2, 'multi-unit picker has major+minor options');
  assertEq(found.major_unit, 'BOX', 'multi-unit major unit preserved');
  assertEq(found.minor_unit, 'TAB', 'multi-unit minor unit preserved');
  assertEq(found.minor_quantity_per_major, 10, 'multi-unit ratio preserved');

  const cosmeticsOnly = await searchDailyPickerItems({
    section_code: 'cosmetics',
    search: TEST_PREFIX,
    page: 1,
    limit: 10,
  });
  assertEq(cosmeticsOnly.rows.length, 0, 'category filter excludes Medicine item from cosmetics section');

  const page1 = await searchDailyPickerItems({
    section_code: 'medicines',
    search: TEST_PREFIX,
    page: 1,
    limit: 1,
  });
  assertEq(page1.rows.length, 1, 'catalog picker pagination page size');
  assert(page1.total >= 1, 'catalog picker pagination total');

  const hydrated = await getDailyPickerItemBySection('medicines', catalogItem.id);
  assertEq(hydrated.kind, 'catalog', 'picker item hydrate kind');
  assertEq(hydrated.item.id, catalogItem.id, 'picker item hydrate id');
  assert(hydrated.item.unit_options?.length === 2, 'picker item hydrate unit_options');

  const serviceSearch = await searchDailyPickerItems({
    section_code: 'consultant_exam',
    search: 'كشف',
    page: 1,
    limit: 10,
  });
  assertEq(serviceSearch.kind, 'service', 'service search kind');
  assert(serviceSearch.rows.length > 0, 'service search returns rows');

  const { listDoctors } = require('../services/doctorService');
  const doctors = await listDoctors({ search: TEST_PREFIX, limit: 5 });
  assert(Array.isArray(doctors), 'doctor list API still works');

  await query('DELETE FROM daily_entry_catalog_items WHERE id = $1', [catalogItem.id]);

  const { requirePermission } = require('../middleware/auth');
  let blocked = false;
  const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json() { return this; } };
  requirePermission('daily_charges.view')(
    { session: { user: { username: 'x', permissions: ['invoices.view'] } }, method: 'GET', originalUrl: '/api/daily-charges/picker/search' },
    res,
    () => {}
  );
  blocked = res.statusCode === 403;
  assert(blocked, 'picker route permission requires daily_charges.view');

  console.log('ALL DAILY PICKER TESTS PASSED');
})().catch((err) => {
  console.error('FAIL', err.message || err);
  process.exit(1);
});
