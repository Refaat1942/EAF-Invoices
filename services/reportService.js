const ExcelJS = require('exceljs');
const { query } = require('../database/db');
const { getInvoiceTypesMap } = require('./invoiceTypeService');
const { getPatientByFileNumber } = require('./patientService');

const STATUS_LABELS = {
  draft: 'مسودة',
  pending_review: 'قيد المراجعة',
  approved: 'معتمدة',
};

function daysBetween(fromDate, toDate) {
  if (!fromDate || !toDate) return 0;
  const start = new Date(fromDate);
  const end = new Date(toDate);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return 0;
  return Math.max(Math.ceil((end - start) / 86400000), 0);
}

function formatDateLabel(value) {
  if (!value) return '—';
  return new Date(value).toLocaleDateString('ar-EG');
}

async function fetchInvoicesForReport(filters = {}) {
  let sql = `SELECT * FROM invoices WHERE 1=1`;
  const params = [];
  let i = 1;

  if (filters.from_date) {
    sql += ` AND COALESCE(issue_date, created_at::date) >= $${i++}::date`;
    params.push(filters.from_date);
  }
  if (filters.to_date) {
    sql += ` AND COALESCE(issue_date, created_at::date) <= $${i++}::date`;
    params.push(filters.to_date);
  }
  if (filters.invoice_type) {
    sql += ` AND invoice_type = $${i++}`;
    params.push(filters.invoice_type);
  }
  if (filters.status) {
    sql += ` AND status = $${i++}`;
    params.push(filters.status);
  } else if (filters.approved_only !== false) {
    sql += ` AND status = 'approved'`;
  }
  if (filters.search) {
    sql += ` AND (patient_name ILIKE $${i} OR serial_number ILIKE $${i} OR file_number ILIKE $${i})`;
    params.push(`%${filters.search}%`);
    i++;
  }

  sql += ' ORDER BY COALESCE(issue_date, created_at::date) DESC, id DESC';
  const { rows } = await query(sql, params);
  return rows;
}

async function getSummaryReport(filters = {}) {
  const invoices = await fetchInvoicesForReport(filters);
  const typeMap = await getInvoiceTypesMap();

  const byType = {};
  Object.entries(typeMap).forEach(([key, label]) => {
    byType[key] = { count: 0, total: 0, collected: 0, remaining: 0, label };
  });

  let grandTotal = 0;
  let grandCollected = 0;
  let grandRemaining = 0;
  let patientCreditTotal = 0;

  invoices.forEach((inv) => {
    if (!byType[inv.invoice_type]) {
      byType[inv.invoice_type] = {
        count: 0,
        total: 0,
        collected: 0,
        remaining: 0,
        label: typeMap[inv.invoice_type] || inv.invoice_type,
      };
    }
    byType[inv.invoice_type].count += 1;
    byType[inv.invoice_type].total += Number(inv.final_total) || 0;
    byType[inv.invoice_type].collected += Number(inv.total_collected) || 0;
    byType[inv.invoice_type].remaining += Number(inv.remaining) || 0;

    grandTotal += Number(inv.final_total) || 0;
    grandCollected += Number(inv.total_collected) || 0;
    grandRemaining += Number(inv.remaining) || 0;
    patientCreditTotal += Number(inv.patient_credit_applied) || 0;
  });

  const monthlyParams = [];
  let monthlySql = `
    SELECT to_char(COALESCE(issue_date, created_at::date), 'YYYY-MM') AS month,
           COUNT(*)::int AS count,
           COALESCE(SUM(final_total), 0) AS total,
           COALESCE(SUM(total_collected), 0) AS collected,
           COALESCE(SUM(remaining), 0) AS remaining
    FROM invoices WHERE status = 'approved'`;
  if (filters.from_date) {
    monthlySql += ` AND COALESCE(issue_date, created_at::date) >= $${monthlyParams.length + 1}::date`;
    monthlyParams.push(filters.from_date);
  }
  if (filters.to_date) {
    monthlySql += ` AND COALESCE(issue_date, created_at::date) <= $${monthlyParams.length + 1}::date`;
    monthlyParams.push(filters.to_date);
  }
  monthlySql += ` GROUP BY 1 ORDER BY month DESC LIMIT 24`;
  const monthlyResult = await query(monthlySql, monthlyParams);

  const pendingResult = await query(
    `SELECT status, COUNT(*)::int AS count FROM invoices
     WHERE status IN ('draft', 'pending_review')
     GROUP BY status`
  );

  return {
    total_invoices: invoices.length,
    grand_total: Math.round(grandTotal * 100) / 100,
    grand_collected: Math.round(grandCollected * 100) / 100,
    grand_remaining: Math.round(grandRemaining * 100) / 100,
    patient_credit_total: Math.round(patientCreditTotal * 100) / 100,
    by_type: byType,
    monthly: monthlyResult.rows,
    recent: invoices.slice(0, 15).map((inv) => ({
      ...inv,
      invoice_type_label: typeMap[inv.invoice_type] || inv.invoice_type,
      status_label: STATUS_LABELS[inv.status] || inv.status,
    })),
    pending_counts: pendingResult.rows,
    filters,
  };
}

async function getPaymentsReport(filters = {}) {
  const invoices = await fetchInvoicesForReport(filters);
  return invoices.map((inv) => ({
    serial_number: inv.serial_number || '—',
    file_number: inv.file_number,
    patient_name: inv.patient_name,
    issue_date: inv.issue_date,
    final_total: inv.final_total,
    cash_private: inv.cash_private,
    bank_private: inv.bank_private,
    cash_external: inv.cash_external,
    bank_external: inv.bank_external,
    patient_credit_applied: inv.patient_credit_applied,
    total_collected: inv.total_collected,
    remaining: inv.remaining,
  }));
}

async function getRemainingReport(filters = {}) {
  const invoices = await fetchInvoicesForReport(filters);
  return invoices
    .filter((inv) => Number(inv.remaining) > 0)
    .map((inv) => ({
      serial_number: inv.serial_number || '—',
      file_number: inv.file_number,
      patient_name: inv.patient_name,
      issue_date: inv.issue_date,
      final_total: inv.final_total,
      total_collected: inv.total_collected,
      remaining: inv.remaining,
    }));
}

async function findPatientMatches(search) {
  const term = String(search || '').trim();
  if (!term) return [];

  const { rows } = await query(
    `SELECT file_number,
            MAX(patient_name) AS patient_name,
            COUNT(*)::int AS invoice_count,
            MIN(COALESCE(admission_date, issue_date, created_at::date)) AS first_admission,
            MAX(COALESCE(discharge_date, issue_date, created_at::date)) AS last_activity
     FROM invoices
     WHERE COALESCE(file_number, '') <> ''
       AND (file_number ILIKE $1 OR patient_name ILIKE $1)
     GROUP BY file_number
     ORDER BY last_activity DESC NULLS LAST, file_number
     LIMIT 20`,
    [`%${term}%`]
  );
  return rows;
}

async function getPatientStatusReport(filters = {}) {
  const fileNumber = String(filters.file_number || '').trim();
  const search = String(filters.patient_search || filters.search || '').trim();

  if (!fileNumber && !search) {
    throw new Error('أدخل رقم الملف أو اسم المريض');
  }

  let targetFileNumber = fileNumber;
  if (!targetFileNumber) {
    const matches = await findPatientMatches(search);
    if (!matches.length) throw new Error('لم يتم العثور على مريض بهذه البيانات');
    if (matches.length > 1 && !filters.pick_file_number) {
      return {
        multiple_matches: true,
        search,
        matches: matches.map((row) => ({
          file_number: row.file_number,
          patient_name: row.patient_name,
          invoice_count: row.invoice_count,
          first_admission: row.first_admission,
          last_activity: row.last_activity,
        })),
      };
    }
    targetFileNumber = filters.pick_file_number || matches[0].file_number;
  }

  const patient = await getPatientByFileNumber(targetFileNumber);
  const typeMap = await getInvoiceTypesMap();

  let sql = `SELECT * FROM invoices WHERE file_number = $1`;
  const params = [targetFileNumber];
  let i = 2;

  if (filters.from_date) {
    sql += ` AND COALESCE(issue_date, created_at::date) >= $${i++}::date`;
    params.push(filters.from_date);
  }
  if (filters.to_date) {
    sql += ` AND COALESCE(issue_date, created_at::date) <= $${i++}::date`;
    params.push(filters.to_date);
  }
  if (filters.invoice_type) {
    sql += ` AND invoice_type = $${i++}`;
    params.push(filters.invoice_type);
  }

  sql += ' ORDER BY COALESCE(admission_date, issue_date, created_at::date) ASC, id ASC';
  const { rows: invoices } = await query(sql, params);

  if (!invoices.length && !patient) {
    throw new Error('لا توجد بيانات لهذا المريض');
  }

  const patientName = patient?.name || invoices[0]?.patient_name || '';
  const admissionDates = invoices.map((inv) => inv.admission_date).filter(Boolean);
  const dischargeDates = invoices.map((inv) => inv.discharge_date).filter(Boolean);
  const earliestAdmission = admissionDates.length ? [...admissionDates].sort()[0] : null;
  const latestDischarge = dischargeDates.length ? [...dischargeDates].sort().reverse()[0] : null;
  const today = new Date().toISOString().slice(0, 10);
  const endDate = latestDischarge || today;
  const durationDays = earliestAdmission ? daysBetween(earliestAdmission, endDate) : 0;

  const totals = {
    invoices_count: 0,
    approved_count: 0,
    draft_count: 0,
    pending_count: 0,
    total_billed: 0,
    total_collected: 0,
    total_remaining: 0,
    total_credit_applied: 0,
    total_stay_days: 0,
  };

  const invoiceDetails = [];
  for (const inv of invoices) {
    totals.invoices_count += 1;
    if (inv.status === 'approved') totals.approved_count += 1;
    if (inv.status === 'draft') totals.draft_count += 1;
    if (inv.status === 'pending_review') totals.pending_count += 1;
    totals.total_billed += Number(inv.final_total) || 0;
    totals.total_collected += Number(inv.total_collected) || 0;
    totals.total_remaining += Number(inv.remaining) || 0;
    totals.total_credit_applied += Number(inv.patient_credit_applied) || 0;
    totals.total_stay_days += Number(inv.stay_days) || 0;

    const { rows: payments } = await query(
      `SELECT receipt_date, receipt_number, amount
       FROM invoice_payments
       WHERE invoice_id = $1 AND COALESCE(amount, 0) <> 0
       ORDER BY receipt_date NULLS LAST, sort_order, id`,
      [inv.id]
    );

    invoiceDetails.push({
      id: inv.id,
      serial_number: inv.serial_number,
      status: inv.status,
      status_label: STATUS_LABELS[inv.status] || inv.status,
      invoice_type: inv.invoice_type,
      invoice_type_label: typeMap[inv.invoice_type] || inv.invoice_type,
      issue_date: inv.issue_date,
      admission_date: inv.admission_date,
      discharge_date: inv.discharge_date,
      stay_days: inv.stay_days,
      stay_type: inv.stay_type,
      financial_treatment: inv.financial_treatment,
      notes: inv.notes,
      final_total: Number(inv.final_total) || 0,
      total_collected: Number(inv.total_collected) || 0,
      remaining: Number(inv.remaining) || 0,
      patient_credit_applied: Number(inv.patient_credit_applied) || 0,
      cash_private: Number(inv.cash_private) || 0,
      bank_private: Number(inv.bank_private) || 0,
      cash_external: Number(inv.cash_external) || 0,
      payments,
    });
  }

  let transactions = [];
  if (patient?.id) {
    const { rows } = await query(
      `SELECT pt.*, i.serial_number
       FROM patient_transactions pt
       LEFT JOIN invoices i ON i.id = pt.invoice_id
       WHERE pt.patient_id = $1
       ORDER BY pt.created_at DESC`,
      [patient.id]
    );
    transactions = rows;
  }

  const accountBalance = Number(patient?.account_balance) || 0;

  return {
    patient: {
      file_number: targetFileNumber,
      name: patientName,
      account_balance: accountBalance,
    },
    stay: {
      earliest_admission: earliestAdmission,
      latest_discharge: latestDischarge,
      duration_days: durationDays,
      duration_label: durationDays ? `${durationDays} يوم` : '—',
      is_still_admitted: !!earliestAdmission && !latestDischarge,
      admission_status: earliestAdmission
        ? latestDischarge
          ? 'خرج'
          : 'لا يزال بالمركز'
        : 'غير محدد',
      total_stay_days: totals.total_stay_days,
    },
    totals: {
      ...totals,
      total_billed: Math.round(totals.total_billed * 100) / 100,
      total_collected: Math.round(totals.total_collected * 100) / 100,
      total_remaining: Math.round(totals.total_remaining * 100) / 100,
      total_credit_applied: Math.round(totals.total_credit_applied * 100) / 100,
      account_balance: accountBalance,
      net_after_balance: Math.round((totals.total_remaining - accountBalance) * 100) / 100,
    },
    invoices: invoiceDetails,
    transactions,
    filters: { ...filters, file_number: targetFileNumber },
  };
}

async function buildExcelWorkbook(reportType, filters = {}) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'EAF Invoices';
  workbook.created = new Date();

  const typeMap = await getInvoiceTypesMap();
  const sheet = workbook.addWorksheet('التقرير', { views: [{ rightToLeft: true }] });

  if (reportType === 'summary') {
    const data = await getSummaryReport(filters);
    sheet.addRow(['تقرير ملخص الفواتير']);
    sheet.addRow(['من', filters.from_date || '—', 'إلى', filters.to_date || '—']);
    sheet.addRow([]);
    sheet.addRow(['إجمالي الفواتير', data.total_invoices]);
    sheet.addRow(['إجمالي المبالغ', data.grand_total]);
    sheet.addRow(['إجمالي المحصل', data.grand_collected]);
    sheet.addRow(['إجمالي المتبقي', data.grand_remaining]);
    sheet.addRow(['خصم من أرصدة المرضى', data.patient_credit_total]);
    sheet.addRow([]);
    sheet.addRow(['نوع الفاتورة', 'العدد', 'الإجمالي', 'المحصل', 'المتبقي']);
    Object.values(data.by_type).forEach((row) => {
      if (row.count > 0) {
        sheet.addRow([row.label, row.count, row.total, row.collected, row.remaining]);
      }
    });
    sheet.addRow([]);
    sheet.addRow(['الشهر', 'العدد', 'الإجمالي', 'المحصل', 'المتبقي']);
    (data.monthly || []).forEach((m) => {
      sheet.addRow([m.month, m.count, Number(m.total), Number(m.collected), Number(m.remaining)]);
    });
  } else if (reportType === 'invoices') {
    const invoices = await fetchInvoicesForReport(filters);
    sheet.addRow([
      'الرقم التسلسلي',
      'رقم الملف',
      'المريض',
      'نوع الفاتورة',
      'الحالة',
      'تاريخ الإصدار',
      'الإجمالي',
      'المحصل',
      'خصم الرصيد',
      'المتبقي',
    ]);
    invoices.forEach((inv) => {
      sheet.addRow([
        inv.serial_number || 'مسودة',
        inv.file_number,
        inv.patient_name,
        typeMap[inv.invoice_type] || inv.invoice_type,
        STATUS_LABELS[inv.status] || inv.status,
        inv.issue_date,
        Number(inv.final_total),
        Number(inv.total_collected),
        Number(inv.patient_credit_applied),
        Number(inv.remaining),
      ]);
    });
  } else if (reportType === 'payments') {
    const rows = await getPaymentsReport(filters);
    sheet.addRow([
      'الرقم',
      'رقم الملف',
      'المريض',
      'التاريخ',
      'الإجمالي',
      'نقدي',
      'تحويل',
      'شيك',
      'خصم الرصيد',
      'المحصل',
      'المتبقي',
    ]);
    rows.forEach((r) => {
      sheet.addRow([
        r.serial_number,
        r.file_number,
        r.patient_name,
        r.issue_date,
        Number(r.final_total),
        Number(r.cash_private),
        Number(r.bank_private),
        Number(r.cash_external),
        Number(r.patient_credit_applied),
        Number(r.total_collected),
        Number(r.remaining),
      ]);
    });
  } else if (reportType === 'remaining') {
    const rows = await getRemainingReport(filters);
    sheet.addRow(['الرقم', 'رقم الملف', 'المريض', 'التاريخ', 'الإجمالي', 'المحصل', 'المتبقي']);
    rows.forEach((r) => {
      sheet.addRow([
        r.serial_number,
        r.file_number,
        r.patient_name,
        r.issue_date,
        Number(r.final_total),
        Number(r.total_collected),
        Number(r.remaining),
      ]);
    });
  } else if (reportType === 'patient_status') {
    const data = await getPatientStatusReport(filters);
    if (data.multiple_matches) {
      throw new Error('حدد مريضًا واحدًا قبل التصدير');
    }
    sheet.addRow(['تقرير موقف مريض']);
    sheet.addRow(['رقم الملف', data.patient.file_number, 'الاسم', data.patient.name]);
    sheet.addRow(['رصيد الحساب', data.patient.account_balance]);
    sheet.addRow(['تاريخ الدخول', data.stay.earliest_admission, 'تاريخ الخروج', data.stay.latest_discharge || '—']);
    sheet.addRow(['مدة الإقامة', data.stay.duration_label, 'الحالة', data.stay.admission_status]);
    sheet.addRow([]);
    sheet.addRow(['إجمالي الفواتير', data.totals.invoices_count]);
    sheet.addRow(['إجمالي المبالغ', data.totals.total_billed]);
    sheet.addRow(['إجمالي المحصل', data.totals.total_collected]);
    sheet.addRow(['خصم من الرصيد', data.totals.total_credit_applied]);
    sheet.addRow(['المتبقي', data.totals.total_remaining]);
    sheet.addRow([]);
    sheet.addRow([
      'الرقم',
      'الحالة',
      'نوع الفاتورة',
      'تاريخ الإصدار',
      'الدخول',
      'الخروج',
      'الأيام',
      'الإجمالي',
      'المحصل',
      'خصم الرصيد',
      'المتبقي',
    ]);
    data.invoices.forEach((inv) => {
      sheet.addRow([
        inv.serial_number || 'مسودة',
        inv.status_label,
        inv.invoice_type_label,
        inv.issue_date,
        inv.admission_date,
        inv.discharge_date,
        inv.stay_days,
        inv.final_total,
        inv.total_collected,
        inv.patient_credit_applied,
        inv.remaining,
      ]);
    });
    sheet.addRow([]);
    sheet.addRow(['تاريخ الإيصال', 'رقم الإيصال', 'المبلغ', 'الفاتورة']);
    data.invoices.forEach((inv) => {
      inv.payments.forEach((pay) => {
        sheet.addRow([pay.receipt_date, pay.receipt_number, Number(pay.amount), inv.serial_number || `#${inv.id}`]);
      });
    });
  }

  sheet.getRow(1).font = { bold: true };
  sheet.columns.forEach((col) => {
    col.width = 18;
  });

  return workbook;
}

async function exportExcelBuffer(reportType, filters = {}) {
  const workbook = await buildExcelWorkbook(reportType, filters);
  return workbook.xlsx.writeBuffer();
}

module.exports = {
  getSummaryReport,
  getPaymentsReport,
  getRemainingReport,
  getPatientStatusReport,
  exportExcelBuffer,
  STATUS_LABELS,
};
