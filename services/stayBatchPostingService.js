const { query } = require('../database/db');
const { getAssignmentForDate } = require('./patientRoomService');
const { getPatientByFileNumber } = require('./patientService');
const { getOpenPatientStay } = require('./invoiceService');
const {
  saveEntriesBatch,
  saveEntry,
  getEntryById,
  resolveAccommodationGradeForStayType,
  getCurrentBusinessDateString,
  normalizeCalendarDate,
  isStayDateExcluded,
} = require('./dailyChargeService');
const { syncPatientDailyChargesToInvoice } = require('./invoiceService');

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
  const grade = await resolveAccommodationGradeForStayType(stayTypeId);
  return round2(grade?.daily_rate) || 0;
}

async function hasStaySectionLine(patientId, date, sectionCode) {
  const pid = Number(patientId);
  const d = parseDateOnly(date);
  const section = String(sectionCode || '').trim();
  if (!pid || !d || !section) return false;
  const { rows } = await query(
    `SELECT 1
     FROM patient_daily_entries e
     INNER JOIN patient_daily_entry_lines l ON l.entry_id = e.id
     WHERE e.patient_id = $1
       AND e.entry_date = $2::date
       AND l.section_code = $3
       AND COALESCE(l.amount, 0) > 0
     LIMIT 1`,
    [pid, d, section]
  );
  return rows.length > 0;
}

async function buildStayEntryPayload(patient, invoice, date, assignment, options = {}) {
  const skipExisting = options.skip_existing !== false;
  const entryDate = parseDateOnly(date);
  const accAmount = await resolveAccommodationRateForStayType(assignment.stay_type_id);
  const lines = [];

  if (accAmount > 0 && !(skipExisting && (await hasStaySectionLine(patient.id, entryDate, 'accommodation')))) {
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
  if (
    companion > 0 &&
    !(skipExisting && (await hasStaySectionLine(patient.id, entryDate, 'companion')))
  ) {
    lines.push({
      section_code: 'companion',
      amount: companion,
      quantity: 1,
      unit_price: companion,
    });
  }

  const nursing = round2(assignment.nursing_point_amount);
  if (
    nursing > 0 &&
    !(skipExisting && (await hasStaySectionLine(patient.id, entryDate, 'nursing_point')))
  ) {
    lines.push({
      section_code: 'nursing_point',
      amount: nursing,
      quantity: 1,
      unit_price: nursing,
    });
  }

  const assistant = round2(assignment.patient_assistant_amount);
  if (
    assistant > 0 &&
    !(skipExisting && (await hasStaySectionLine(patient.id, entryDate, 'patient_assistant')))
  ) {
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
  const letterFrom = parseDateOnly(invoice.letter_from_date);
  const letterTo = parseDateOnly(invoice.letter_to_date);

  let admission = parseDateOnly(options.from_date || invoice.admission_date);
  if (!admission) throw new Error('تاريخ الدخول غير محدد على الفاتورة');
  // A جواب (authorization letter) that starts after admission means charges aren't
  // authorized before the letter's start date — don't post those days by default.
  if (!options.from_date && letterFrom && letterFrom > admission) {
    admission = letterFrom;
  }

  let endDate = parseDateOnly(options.to_date);
  if (!endDate) {
    const discharge = parseDateOnly(invoice.discharge_date);
    if (discharge && discharge < businessToday) {
      endDate = discharge;
    } else if (letterTo && letterTo < businessToday) {
      // No discharge yet, but the authorized جواب window has already fully elapsed —
      // post the whole authorized period instead of stopping at "yesterday" and
      // silently leaving the tail end of the letter unbilled.
      endDate = letterTo;
    } else if (options.include_today) {
      endDate = businessToday;
    } else {
      endDate = addDays(businessToday, -1);
    }
  }
  // Never bill beyond the authorized جواب window, however the end date was derived.
  if (letterTo && endDate > letterTo) endDate = letterTo;

  if (endDate < admission) {
    throw new Error('تاريخ النهاية قبل تاريخ الدخول');
  }

  const skipExisting = options.skip_existing !== false;
  const dates = listInclusiveDates(admission, endDate);
  const entries = [];
  const skipped = [];
  const missingAssignment = [];

  for (const date of dates) {
    if (await isStayDateExcluded(patient.id, date)) {
      skipped.push(date);
      continue;
    }
    const assignment = await getAssignmentForDate(patient.id, date);
    if (!assignment?.stay_type_id) {
      missingAssignment.push(date);
      continue;
    }
    const payload = await buildStayEntryPayload(patient, invoice, date, assignment, {
      skip_existing: skipExisting,
    });
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

function admissionCompanionWithInsurance(assignment, roomInsuranceAmount) {
  const base = round2(assignment?.companion_amount);
  const ins = round2(roomInsuranceAmount);
  if (ins <= 0) return base;
  return round2(base + ins);
}

/**
 * يوم الدخول: إنشاء حركة إقامة (إقامة + مرافق + …) إن لم تكن موجودة — يظهر أول سطر في تبويب الإقامة.
 */
async function ensureAdmissionDayStayPosted(fileNumber, user = null) {
  const fn = String(fileNumber || '').trim();
  if (!fn) return { posted: false, reason: 'missing_file_number' };

  const stay = await getOpenPatientStay(fn);
  const patient = stay?.patient || (await getPatientByFileNumber(fn));
  if (!patient?.id || !stay?.invoice?.admission_date) {
    return { posted: false, reason: 'no_open_stay' };
  }
  if (String(patient.patient_type || '').toLowerCase() === 'external') {
    return { posted: false, reason: 'external_patient' };
  }

  const admission = parseDateOnly(stay.invoice.admission_date);
  if (!admission) return { posted: false, reason: 'no_admission_date' };

  const assignment = await getAssignmentForDate(patient.id, admission);
  if (!assignment?.stay_type_id) {
    return { posted: false, reason: 'no_room_assignment' };
  }

  const hasAccommodation = await hasStaySectionLine(patient.id, admission, 'accommodation');
  if (hasAccommodation) {
    return { posted: false, reason: 'already_posted', entry_date: admission };
  }

  const result = await batchPostStayCharges(
    fn,
    {
      from_date: admission,
      to_date: admission,
      skip_existing: true,
      include_today: true,
    },
    user
  );
  return { posted: (result.posted || 0) > 0, entry_date: admission, ...result };
}

/**
 * After the admission date moves, the old admission day must lose the room insurance.
 */
async function stripRoomInsuranceFromNonAdmissionDays(patient, invoiceId, admission, roomIns, user = null) {
  if (!(roomIns > 0) || !admission) return 0;
  const { rows } = await query(
    `SELECT DISTINCT e.id, e.entry_date
     FROM patient_daily_entries e
     INNER JOIN patient_daily_entry_lines l ON l.entry_id = e.id
     WHERE e.patient_id = $1
       AND e.entry_date <> $2::date
       AND (e.invoice_id IS NULL OR e.invoice_id = $3)
       AND l.section_code = 'companion'
       AND COALESCE(l.amount, 0) >= $4`,
    [patient.id, admission, invoiceId || null, roomIns]
  );
  let fixed = 0;
  for (const row of rows) {
    const entryDate = parseDateOnly(row.entry_date);
    const assignment = await getAssignmentForDate(patient.id, entryDate);
    const base = round2(assignment?.companion_amount);
    const entry = await getEntryById(row.id);
    if (!entry) continue;
    let changed = false;
    const lines = (entry.lines || []).map((line) => {
      if (line.section_code !== 'companion') return { ...line };
      const amount = round2(line.amount ?? line.unit_price);
      // Only undo an exact "base + insurance" amount; anything else was typed by hand.
      if (Math.abs(amount - (base + roomIns)) >= 0.005) return { ...line };
      changed = true;
      return { ...line, amount: base, unit_price: base, quantity: 1 };
    });
    if (!changed) continue;
    await saveEntry(
      {
        entry_id: entry.id,
        file_number: patient.file_number,
        patient_name: patient.name,
        entry_date: entryDate,
        stay_type_id: entry.stay_type_id,
        notes: entry.notes || '',
        doctor_id: entry.doctor_id,
        doctor_specialty: entry.doctor_specialty || '',
        lines: lines.filter((line) => line.section_code !== 'companion' || round2(line.amount) > 0),
        allow_backfill: true,
      },
      user
    );
    fixed += 1;
  }
  return fixed;
}

/**
 * تأمين الغرفة يُحمَّل على بند المرافق في يوم الدخول (يظهر في إجمالي الفاتورة).
 */
async function syncAdmissionDayRoomInsurance(fileNumber, user = null) {
  const fn = String(fileNumber || '').trim();
  if (!fn) return { updated: false, reason: 'missing_file_number' };

  const stay = await getOpenPatientStay(fn);
  const patient = stay?.patient || (await getPatientByFileNumber(fn));
  if (!patient?.id || !stay?.invoice?.admission_date) {
    return { updated: false, reason: 'no_open_stay' };
  }

  const admission = parseDateOnly(stay.invoice.admission_date);
  const roomIns = round2(patient.room_insurance_amount);
  if (!admission) return { updated: false, reason: 'no_admission_date' };

  const strippedDays = await stripRoomInsuranceFromNonAdmissionDays(
    patient,
    stay.invoice.id,
    admission,
    roomIns,
    user
  );
  if (strippedDays > 0) await syncPatientDailyChargesToInvoice(fn, patient.name);

  const assignment = await getAssignmentForDate(patient.id, admission);
  const targetCompanion = admissionCompanionWithInsurance(assignment, roomIns);

  const { rows } = await query(
    `SELECT id FROM patient_daily_entries
     WHERE patient_id = $1 AND entry_date = $2::date
     ORDER BY id DESC LIMIT 1`,
    [patient.id, admission]
  );
  let entryId = Number(rows[0]?.id) || 0;

  if (!entryId) {
    const stayPost = await ensureAdmissionDayStayPosted(fn, user);
    const { rows: afterRows } = await query(
      `SELECT id FROM patient_daily_entries
       WHERE patient_id = $1 AND entry_date = $2::date
       ORDER BY id DESC LIMIT 1`,
      [patient.id, admission]
    );
    entryId = Number(afterRows[0]?.id) || 0;
    if (!entryId) {
      return { updated: false, reason: 'no_admission_entry', stay_post: stayPost };
    }
    await syncPatientDailyChargesToInvoice(fn, patient.name);
    return {
      updated: Boolean(stayPost.posted),
      posted: Boolean(stayPost.posted),
      reason: 'admission_stay_created',
      entry_date: admission,
    };
  }

  const entry = await getEntryById(entryId);
  if (!entry) return { updated: false, reason: 'entry_not_found' };

  const lines = (entry.lines || []).map((line) => ({ ...line }));
  const companionIdx = lines.findIndex((line) => line.section_code === 'companion');
  const currentCompanion =
    companionIdx >= 0 ? round2(lines[companionIdx].amount ?? lines[companionIdx].unit_price) : 0;

  if (Math.abs(currentCompanion - targetCompanion) < 0.005) {
    return { updated: false, reason: 'already_synced', companion: targetCompanion };
  }

  if (targetCompanion > 0) {
    if (companionIdx >= 0) {
      lines[companionIdx] = {
        ...lines[companionIdx],
        amount: targetCompanion,
        unit_price: targetCompanion,
        quantity: 1,
      };
    } else {
      lines.push({
        section_code: 'companion',
        amount: targetCompanion,
        unit_price: targetCompanion,
        quantity: 1,
      });
    }
  } else if (companionIdx >= 0 && roomIns <= 0) {
    const baseOnly = round2(assignment?.companion_amount);
    if (baseOnly > 0) {
      lines[companionIdx] = {
        ...lines[companionIdx],
        amount: baseOnly,
        unit_price: baseOnly,
        quantity: 1,
      };
    } else {
      lines.splice(companionIdx, 1);
    }
  }

  await saveEntry(
    {
      entry_id: entryId,
      file_number: fn,
      patient_name: patient.name,
      entry_date: admission,
      stay_type_id: entry.stay_type_id,
      notes: entry.notes || '',
      doctor_id: entry.doctor_id,
      doctor_specialty: entry.doctor_specialty || '',
      lines,
      allow_backfill: true,
    },
    user
  );
  await syncPatientDailyChargesToInvoice(fn, patient.name);
  return { updated: true, companion: targetCompanion };
}

module.exports = {
  batchPostStayCharges,
  ensureAdmissionDayStayPosted,
  syncAdmissionDayRoomInsurance,
  admissionCompanionWithInsurance,
  resolveAccommodationRateForStayType,
  hasStaySectionLine,
  listInclusiveDates,
};
