/**
 * When the admin changes a price (price-list service, catalog item, or a room's daily
 * rate), every patient who is still in — invoice not yet approved — is re-priced: their
 * daily lines that use that service / item / room are saved again at the new price and
 * their invoice is re-synced. Approved invoices keep the prices they were approved with.
 */
const { query } = require('../database/db');

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

async function findOpenEntries(whereSql, params) {
  const { rows } = await query(
    `SELECT DISTINCT e.id, e.entry_date::text AS entry_date, p.file_number, p.name AS patient_name
     FROM patient_daily_entry_lines l
     JOIN patient_daily_entries e ON e.id = l.entry_id
     JOIN patients p ON p.id = e.patient_id
     LEFT JOIN invoices i ON i.id = e.invoice_id
     WHERE (e.invoice_id IS NULL OR i.status <> 'approved')
       AND (${whereSql})`,
    params
  );
  return rows;
}

async function resaveEntries(entries, user, mapLines = (lines) => lines) {
  const { getEntryById, saveEntry } = require('./dailyChargeService');
  const files = new Map();
  let saved = 0;
  for (const row of entries) {
    const entry = await getEntryById(row.id);
    if (!entry) continue;
    const lines = mapLines((entry.lines || []).map((line) => ({ ...line })), entry);
    if (!lines) continue;
    try {
      await saveEntry(
        {
          entry_id: entry.id,
          file_number: row.file_number,
          patient_name: row.patient_name,
          entry_date: row.entry_date,
          stay_type_id: entry.stay_type_id,
          notes: entry.notes || '',
          doctor_id: entry.doctor_id,
          doctor_specialty: entry.doctor_specialty || '',
          lines,
          allow_backfill: true,
        },
        user
      );
      saved += 1;
      files.set(String(row.file_number).trim(), row.patient_name);
    } catch (err) {
      console.error(`[price-sync] entry ${entry.id} (file ${row.file_number}):`, err.message);
    }
  }
  const { syncPatientDailyChargesToInvoice } = require('./invoiceService');
  for (const [fileNumber, name] of files) {
    try {
      await syncPatientDailyChargesToInvoice(fileNumber, name);
    } catch (err) {
      console.error(`[price-sync] invoice sync for file ${fileNumber}:`, err.message);
    }
  }
  return { entries: saved, patients: files.size };
}

/** Service / catalog price changed: saving again re-reads the price from the price list. */
async function repriceOpenPatients({ serviceIds = [], catalogItemIds = [] } = {}, user = null) {
  const sIds = [...new Set(serviceIds.map(Number).filter(Boolean))];
  const cIds = [...new Set(catalogItemIds.map(Number).filter(Boolean))];
  if (!sIds.length && !cIds.length) return { entries: 0, patients: 0 };
  const entries = await findOpenEntries(
    'l.service_id = ANY($1::int[]) OR l.catalog_item_id = ANY($2::int[])',
    [sIds, cIds]
  );
  return resaveEntries(entries, user);
}

/** Room daily rate changed: accommodation lines still at the old rate move to the new one. */
async function repriceOpenStayType(stayTypeId, oldRate, newRate, user = null) {
  const id = Number(stayTypeId);
  const from = round2(oldRate);
  const to = round2(newRate);
  if (!id || from === to || to <= 0) return { entries: 0, patients: 0 };
  const entries = await findOpenEntries(
    `l.section_code = 'accommodation' AND ROUND(l.amount::numeric, 2) = $2
     AND (e.stay_type_id = $1 OR EXISTS (
       SELECT 1 FROM patient_room_assignments a
       WHERE a.patient_id = e.patient_id AND a.stay_type_id = $1
         AND e.entry_date >= a.effective_from
         AND (a.effective_to IS NULL OR e.entry_date <= a.effective_to)))`,
    [id, from]
  );
  return resaveEntries(entries, user, (lines, entry) =>
    lines.map((line) =>
      line.section_code === 'accommodation' && round2(line.amount) === from
        ? { ...line, amount: to, unit_price: to, quantity: 1 }
        : line
    )
  );
}

/** Run after the response is sent, one job at a time; log the outcome. */
let queue = Promise.resolve();
function runInBackground(label, fn) {
  queue = queue.then(async () => {
    try {
      const result = await fn();
      if (result?.entries) {
        console.log(`[price-sync] ${label}: re-priced ${result.entries} day(s) for ${result.patients} open patient(s)`);
      }
    } catch (err) {
      console.error(`[price-sync] ${label} failed:`, err.message);
    }
  });
  return queue;
}

module.exports = { repriceOpenPatients, repriceOpenStayType, runInBackground };
