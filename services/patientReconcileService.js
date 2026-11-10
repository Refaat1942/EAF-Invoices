const { query } = require('../database/db');
const { getPatientByFileNumber } = require('./patientService');
const { getOpenPatientStay, syncPatientDailyChargesToInvoice } = require('./invoiceService');
const { batchPostStayCharges } = require('./stayBatchPostingService');
const { getCurrentBusinessDateString, normalizeCalendarDate } = require('./dailyChargeService');

function addDays(dateStr, days) {
  const d = new Date(`${dateStr}T12:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function fmtDateOnly(value) {
  return normalizeCalendarDate(value);
}

async function listOpenPatientFileNumbers() {
  const { rows } = await query(
    `SELECT DISTINCT TRIM(i.file_number) AS file_number,
            COALESCE(p.patient_type, 'internal') AS patient_type,
            COALESCE(p.name, i.patient_name, '') AS patient_name
     FROM invoices i
     LEFT JOIN patients p ON TRIM(p.file_number) = TRIM(i.file_number)
     WHERE i.status IN ('draft', 'pending_review')
       AND TRIM(COALESCE(i.file_number, '')) <> ''
     ORDER BY TRIM(i.file_number)`
  );
  return rows;
}

/**
 * Apply stay backfill + invoice sync for one patient (existing or new).
 */
async function reconcilePatientDailyData(fileNumber, options = {}, user = null) {
  const fn = String(fileNumber || '').trim();
  if (!fn) throw new Error('رقم الملف مطلوب');

  const patient = await getPatientByFileNumber(fn);
  const stay = await getOpenPatientStay(fn);
  const patientType = String(patient?.patient_type || stay?.patient?.patient_type || 'internal')
    .trim()
    .toLowerCase();

  let stay_post = null;
  const postStay = options.post_stay !== false;
  if (postStay && patientType !== 'external' && stay?.invoice?.admission_date) {
    const businessToday = getCurrentBusinessDateString();
    const letterFrom = fmtDateOnly(stay.invoice.letter_from_date);
    const letterTo = fmtDateOnly(stay.invoice.letter_to_date);

    let admission = fmtDateOnly(options.from_date || stay.invoice.admission_date);
    // Mirrors batchPostStayCharges: a جواب (authorization letter) starting after admission
    // means days before it aren't authorized — don't reconcile/post those by default.
    if (!options.from_date && letterFrom && admission && letterFrom > admission) {
      admission = letterFrom;
    }

    let toDate = fmtDateOnly(options.to_date);
    if (!toDate) {
      const discharge = fmtDateOnly(stay.invoice.discharge_date);
      if (discharge && discharge < businessToday) {
        toDate = discharge;
      } else if (options.include_today) {
        toDate = businessToday;
      } else {
        toDate = addDays(businessToday, -1);
      }
    }
    // Never reconcile/post beyond the authorized جواب window.
    if (letterTo && toDate && toDate > letterTo) toDate = letterTo;

    if (admission && toDate && toDate >= admission) {
      stay_post = await batchPostStayCharges(
        fn,
        {
          from_date: admission,
          to_date: toDate,
          skip_existing: options.skip_existing !== false,
          include_today: options.include_today === true,
        },
        user
      );
    } else {
      stay_post = {
        posted: 0,
        skipped_dates: [],
        missing_assignment_dates: [],
        reason: 'invalid_date_range',
      };
    }
  } else if (postStay && patientType === 'external') {
    stay_post = { posted: 0, skipped: true, reason: 'external_patient' };
  } else if (postStay && !stay?.invoice?.admission_date) {
    stay_post = { posted: 0, skipped: true, reason: 'no_open_invoice' };
  }

  // Re-saving the whole invoice is the slow part of opening a patient. Skip it when the
  // invoice is already newer than everything it is computed from: the patient's daily
  // entries, operations and the prices / settings / balances («calc_inputs_changed_at»).
  const postedNow = Number(stay_post?.posted) || 0;
  const upToDate = postedNow === 0 && options.force_sync !== true && (await isInvoiceUpToDate(fn, stay?.invoice?.id));
  const invoice_sync = upToDate
    ? { synced: true, skipped: true, reason: 'up_to_date', invoice_id: stay.invoice.id }
    : await syncPatientDailyChargesToInvoice(fn, patient?.name || stay?.patient?.name || '');

  return {
    file_number: fn,
    patient_type: patientType,
    stay_post,
    invoice_sync,
  };
}

async function isInvoiceUpToDate(fileNumber, invoiceId) {
  if (!invoiceId) return false;
  try {
    const { rows } = await query(
      `SELECT i.updated_at AS inv_at,
              (SELECT MAX(e.updated_at) FROM patient_daily_entries e
                 JOIN patients p ON p.id = e.patient_id
                WHERE TRIM(p.file_number) = TRIM($1)) AS entries_at,
              (SELECT updated_at FROM app_settings WHERE key = 'calc_inputs_changed_at') AS inputs_at,
              (SELECT MAX(o.updated_at) FROM patient_operations o
                 JOIN patients p ON p.id = o.patient_id
                WHERE TRIM(p.file_number) = TRIM($1)) AS ops_at
       FROM invoices i WHERE i.id = $2`,
      [fileNumber, invoiceId]
    );
    const r = rows[0];
    if (!r?.inv_at) return false;
    const inv = new Date(r.inv_at).getTime();
    return [r.entries_at, r.inputs_at, r.ops_at]
      .filter(Boolean)
      .every((t) => new Date(t).getTime() <= inv);
  } catch {
    return false;
  }
}

async function reconcileAllOpenPatients(options = {}, user = null) {
  const patients = await listOpenPatientFileNumbers();
  const results = [];
  const errors = [];

  for (const row of patients) {
    try {
      results.push(await reconcilePatientDailyData(row.file_number, options, user));
    } catch (err) {
      errors.push({
        file_number: row.file_number,
        patient_name: row.patient_name,
        error: err.message,
      });
    }
  }

  const stayPosted = results.reduce((sum, r) => sum + (Number(r.stay_post?.posted) || 0), 0);
  const synced = results.filter((r) => r.invoice_sync?.synced).length;

  return {
    total: patients.length,
    processed: results.length,
    failed: errors.length,
    stay_days_posted: stayPosted,
    invoices_synced: synced,
    results,
    errors,
  };
}

module.exports = {
  listOpenPatientFileNumbers,
  reconcilePatientDailyData,
  reconcileAllOpenPatients,
};
