const { query } = require('../database/db');
const { getAssignmentForDate } = require('./patientRoomService');
const { getPatientByFileNumber } = require('./patientService');
const { getOpenPatientStay } = require('./invoiceService');
const {
  saveEntriesBatch,
  listAccommodationStayGrades,
  getCurrentBusinessDateString,
  normalizeCalendarDate,
} = require('./dailyChargeService');

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function parseDateOnly(value) {
  return normalizeCalendarDate(value);
}

function addDays(dateStr, days) {
  const d = new Date(`${dateStr}T12:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function listInclusiveDates(fromStr, toStr) {
  const from = parseDateOnly(fromStr);
  const to = parseDateOnly(toStr);
  if (!from || !to || to < from) return [];
  const dates = [];
  let cur = from;
  while (cur <= to) {
    dates.push(cur);
    cur = addDays(cur, 1);
  }
  return dates;
}

async function resolveAccommodationRateForStayType(stayTypeId) {
  const id = Number(stayTypeId);
  if (!id) return 0;
  const grades = await listAccommodationStayGrades();
  const grade = grades.find((g) => Number(g.stay_type_id) === id);
  return round2(grade?.daily_rate) || 0;
}

async function hasStayChargeEntry(patientId, date) {
  const pid = Number(patientId);
  const d = parseDateOnly(date);
  if (!pid || !d) return false;
  const { rows } = await query(
    `SELECT 1
     FROM patient_daily_entries e
     INNER JOIN patient_daily_entry_lines l ON l.entry_id = e.id
     WHERE e.patient_id = $1
       AND e.entry_date = $2::date
       AND l.section_code IN ('accommodation', 'companion', 'nursing_point', 'patient_assistant')
       AND COALESCE(l.amount, 0) > 0
     LIMIT 1`,
    [pid, d]
  );
  return rows.length > 0;
}

async function buildStayEntryPayload(patient, invoice, date, assignment) {
  const entryDate = parseDateOnly(date);
  const accAmount = await resolveAccommodationRateForStayType(assignment.stay_type_id);
  const lines = [];

  if (accAmount > 0) {
    lines.push({
      section_code: 'accommodation',
      amount: accAmount,
      quantity: 1,
      unit_price: accAmount,
    });
  }

  let companion = round2(assignment.companion_amount);
  const admission = parseDateOnly(invoice?.admission_date);
  const roomIns = round2(patient?.room_insurance_amount);
  if (roomIns > 0 && admission && entryDate === admission) {
    companion = round2(companion + roomIns);
  }
  if (companion > 0) {
    lines.push({
      section_code: 'companion',
      amount: companion,
      quantity: 1,
      unit_price: companion,
    });
  }

  const nursing = round2(assignment.nursing_point_amount);
  if (nursing > 0) {
    lines.push({
      section_code: 'nursing_point',
      amount: nursing,
      quantity: 1,
      unit_price: nursing,
    });
  }

  const assistant = round2(assignment.patient_assistant_amount);
  if (assistant > 0) {
    lines.push({
      section_code: 'patient_assistant',
      amount: assistant,
      quantity: 1,
      unit_price: assistant,
    });
  }

  if (!lines.length) return null;

  return {
    entry_date: entryDate,
    stay_type_id: assignment.stay_type_id,
    lines,
    allow_backfill: true,
    file_number: patient.file_number,
    patient_name: patient.name,
  };
}

/**
 * Post daily stay charges for each day in range using room assignments + price list rates.
 */
async function batchPostStayCharges(fileNumber, options = {}, user = null) {
  const fn = String(fileNumber || '').trim();
  if (!fn) throw new Error('رقم الملف مطلوب');

  const stay = await getOpenPatientStay(fn);
  if (!stay?.invoice?.id) throw new Error('لا توجد فاتورة مفتوحة للمريض');

  const patient = stay.patient || (await getPatientByFileNumber(fn));
  if (!patient?.id) throw new Error('المريض غير موجود');

  const invoice = stay.invoice;
  const businessToday = getCurrentBusinessDateString();
  const admission = parseDateOnly(options.from_date || invoice.admission_date);
  if (!admission) throw new Error('تاريخ الدخول غير محدد على الفاتورة');

  let endDate = parseDateOnly(options.to_date);
  if (!endDate) {
    const discharge = parseDateOnly(invoice.discharge_date);
    if (discharge && discharge < businessToday) {
      endDate = discharge;
    } else if (options.include_today) {
      endDate = businessToday;
    } else {
      endDate = addDays(businessToday, -1);
    }
  }

  if (endDate < admission) {
    throw new Error('تاريخ النهاية قبل تاريخ الدخول');
  }

  const skipExisting = options.skip_existing !== false;
  const dates = listInclusiveDates(admission, endDate);
  const entries = [];
  const skipped = [];
  const missingAssignment = [];

  for (const date of dates) {
    const assignment = await getAssignmentForDate(patient.id, date);
    if (!assignment?.stay_type_id) {
      missingAssignment.push(date);
      continue;
    }
    if (skipExisting && (await hasStayChargeEntry(patient.id, date))) {
      skipped.push(date);
      continue;
    }
    const payload = await buildStayEntryPayload(patient, invoice, date, assignment);
    if (!payload) {
      missingAssignment.push(date);
      continue;
    }
    entries.push(payload);
  }

  if (!entries.length) {
    return {
      posted: 0,
      skipped_dates: skipped,
      missing_assignment_dates: missingAssignment,
      range: { from: admission, to: endDate },
      invoice_sync: { synced: false, reason: 'no_entries' },
    };
  }

  const batchResult = await saveEntriesBatch(
    {
      file_number: fn,
      patient_name: patient.name,
      entries,
    },
    user
  );

  return {
    posted: entries.length,
    skipped_dates: skipped,
    missing_assignment_dates: missingAssignment,
    range: { from: admission, to: endDate },
    dates_posted: entries.map((e) => e.entry_date),
    ...batchResult,
  };
}

module.exports = {
  batchPostStayCharges,
  resolveAccommodationRateForStayType,
  hasStayChargeEntry,
  listInclusiveDates,
};
