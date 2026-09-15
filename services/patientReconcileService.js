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
    const admission = fmtDateOnly(options.from_date || stay.invoice.admission_date);
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

  const invoice_sync = await syncPatientDailyChargesToInvoice(
    fn,
    patient?.name || stay?.patient?.name || ''
  );

  return {
    file_number: fn,
    patient_type: patientType,
    stay_post,
    invoice_sync,
  };
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
