#!/usr/bin/env node
/**
 * Remove leftover E2E-FIN-PL test price list from the database (one-time cleanup).
 * Run: node scripts/remove-legacy-e2e-price-list.js
 */

const { initDatabase, query } = require('../database/db');

const LEGACY_CODE = 'E2E-FIN-PL';

async function main() {
  await initDatabase();
  const { rows } = await query(`SELECT id, name FROM price_lists WHERE code = $1`, [LEGACY_CODE]);
  const row = rows[0];
  if (!row) {
    console.log(`No price list with code ${LEGACY_CODE} — nothing to remove.`);
    return;
  }

  const svcRes = await query(`SELECT id FROM services WHERE price_list_id = $1`, [row.id]);
  for (const svc of svcRes.rows) {
    await query(`DELETE FROM service_price_components WHERE service_id = $1`, [svc.id]);
    await query(`DELETE FROM service_price_tiers WHERE service_id = $1`, [svc.id]);
    await query(`DELETE FROM service_price_history WHERE service_id = $1`, [svc.id]);
  }
  await query(`DELETE FROM services WHERE price_list_id = $1`, [row.id]);
  await query(`DELETE FROM service_categories WHERE price_list_id = $1`, [row.id]);
  await query(`DELETE FROM price_lists WHERE id = $1`, [row.id]);
  console.log(`Removed legacy price list: ${row.name} (${LEGACY_CODE})`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err.message || err);
    process.exit(1);
  });
