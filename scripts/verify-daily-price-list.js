#!/usr/bin/env node
/**
 * Verify Daily Entry loads real price-list services from the database.
 * Run: node scripts/verify-daily-price-list.js
 */

const { initDatabase } = require('../database/db');
const { getDefaultPriceList } = require('../services/priceListService');
const { getSectionsWithServices } = require('../services/dailyChargeService');
const { getServiceById } = require('../services/serviceCatalogService');

async function main() {
  await initDatabase();
  const list = await getDefaultPriceList();
  if (!list) {
    console.error('FAIL: no active price list in database');
    process.exit(1);
  }

  const sections = await getSectionsWithServices();
  const acc = sections.find((s) => s.code === 'accommodation');
  const companion = sections.find((s) => s.code === 'companion');
  const totalServices = sections.reduce((sum, s) => sum + (s.services?.length || 0), 0);

  console.log('Price list:', list.name, `(id=${list.id}, services_count=${list.services_count ?? '—'})`);
  console.log('Daily sections loaded:', sections.length, 'total section services:', totalServices);

  if (!acc?.services?.length) {
    console.error('FAIL: accommodation section has no services from price list');
    process.exit(1);
  }

  const sample = acc.services.find((s) => String(s.name).includes('جناح صغير')) || acc.services[0];
  const dbService = await getServiceById(sample.id);
  const uiPrice = Number(sample.list_price ?? sample.price) || 0;
  const dbPrice = Number(dbService?.price) || 0;

  console.log('Sample service:', sample.name, '| UI price:', uiPrice, '| DB base price:', dbPrice);

  if (sample.price_type === 'fixed' && dbPrice > 0 && uiPrice !== dbPrice) {
    console.error('FAIL: displayed price does not match database price');
    process.exit(1);
  }

  if (uiPrice <= 0 && sample.price_type === 'fixed') {
    console.error('FAIL: fixed-price service shows zero in daily sections');
    process.exit(1);
  }

  if (companion?.services?.length) {
    const comp = companion.services[0];
    console.log('Companion sample:', comp.name, '| price:', comp.list_price ?? comp.price);
  }

  console.log('OK daily price-list verification passed');
  process.exit(0);
}

main().catch((err) => {
  console.error('FAIL:', err.message);
  process.exit(1);
});
