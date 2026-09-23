const ExcelJS = require('exceljs');
const { query } = require('../database/db');
const { CENTER_NAME } = require('../config/branding');
const { getInvoiceTypesMap } = require('./invoiceTypeService');
const { getPatientByFileNumber } = require('./patientService');
const { labelTransactionKind } = require('./patientTransactionKinds');
const {
  getNationalityPriceMultiplier,
  getNationalityLabel,
  getPricePathLabel,
  applyNationalityToAmount,
} = require('./nationalityPricing');

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

async function loadNationalityMapByFileNumbers(fileNumbers = []) {
  const nums = [...new Set(fileNumbers.map((n) => String(n || '').trim()).filter(Boolean))];
  if (!nums.length) return {};
  const { rows } = await query(`SELECT file_number, nationality FROM patients WHERE file_number = ANY($1::text[])`, [
    nums,
  ]);
  return Object.fromEntries(rows.map((row) => [row.file_number, row.nationality || '']));
}

function withNationalityMeta(row, nationalityMap = {}) {
  const nationality = nationalityMap[row.file_number] || row.nationality || '';
  const multiplier = getNationalityPriceMultiplier(nationality);
  return {
    ...row,
    nationality,
    nationality_label: getNationalityLabel(nationality),
    price_path_label: getPricePathLabel(nationality),
    nationality_multiplier: multiplier,
  };
}

async function enrichInvoiceList(invoices = []) {
  const nationalityMap = await loadNationalityMapByFileNumbers(invoices.map((inv) => inv.file_number));
  return invoices.map((inv) => withNationalityMeta(inv, nationalityMap));
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
  if (filters.status && filters.status !== 'all') {
    sql += ` AND status = $${i++}`;
    params.push(filters.status);
  } else if (filters.approved_only === true || filters.approved_only === undefined) {
    sql += ` AND status = 'approved'`;
  }
  if (filters.file_number) {
    sql += ` AND file_number ILIKE $${i++}`;
    params.push(`%${String(filters.file_number).trim()}%`);
  }
  if (filters.patient_type) {
    sql += ` AND EXISTS (SELECT 1 FROM patients pt WHERE pt.file_number = invoices.file_number AND pt.patient_type = $${i++})`;
    params.push(filters.patient_type);
  }
  if (filters.nationality) {
    sql += ` AND EXISTS (SELECT 1 FROM patients pt WHERE pt.file_number = invoices.file_number AND COALESCE(pt.nationality, '') ILIKE $${i++})`;
    params.push(`%${String(filters.nationality).trim()}%`);
  }
  if (filters.search) {
    sql += ` AND (patient_name ILIKE $${i} OR serial_number ILIKE $${i} OR file_number ILIKE $${i}
      OR EXISTS (SELECT 1 FROM patients pt WHERE pt.file_number = invoices.file_number
                 AND (COALESCE(pt.phone, '') ILIKE $${i} OR COALESCE(pt.other_phone, '') ILIKE $${i})))`;
    params.push(`%${String(filters.search).trim()}%`);
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
    recent: (await enrichInvoiceList(invoices.slice(0, 15))).map((inv) => ({
      ...inv,
      invoice_type_label: typeMap[inv.invoice_type] || inv.invoice_type,
      status_label: STATUS_LABELS[inv.status] || inv.status,
    })),
    pending_counts: pendingResult.rows,
    filters,
  };
}

async function getPaymentsReport(filters = {}) {
  const invoices = await enrichInvoiceList(await fetchInvoicesForReport(filters));
  return invoices.map((inv) => ({
    serial_number: inv.serial_number || '—',
    file_number: inv.file_number,
    patient_name: inv.patient_name,
    nationality: inv.nationality,
    nationality_label: inv.nationality_label,
    price_path_label: inv.price_path_label,
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
  const invoices = await enrichInvoiceList(await fetchInvoicesForReport(filters));
  return invoices
    .filter((inv) => Number(inv.remaining) > 0)
    .map((inv) => ({
      serial_number: inv.serial_number || '—',
      file_number: inv.file_number,
      patient_name: inv.patient_name,
      nationality: inv.nationality,
      nationality_label: inv.nationality_label,
      price_path_label: inv.price_path_label,
      issue_date: inv.issue_date,
      final_total: inv.final_total,
      total_collected: inv.total_collected,
      remaining: inv.remaining,
    }));
}

async function getInvoicesReport(filters = {}) {
  const invoices = await enrichInvoiceList(
    await fetchInvoicesForReport({ ...filters, approved_only: false })
  );
  const typeMap = await getInvoiceTypesMap();
  return invoices.map((inv) => ({
    ...inv,
    invoice_type_label: typeMap[inv.invoice_type] || inv.invoice_type,
    status_label: STATUS_LABELS[inv.status] || inv.status,
  }));
}

async function getAccountSummaryReport(filters = {}) {
  const invoices = await fetchInvoicesForReport({
    ...filters,
    approved_only: filters.approved_only === true ? true : false,
  });
  const fileNumbers = [...new Set(invoices.map((inv) => String(inv.file_number || '').trim()).filter(Boolean))];
  const phoneMap = {};
  if (fileNumbers.length) {
    const { rows } = await query(
      `SELECT file_number, phone, other_phone FROM patients WHERE file_number = ANY($1::text[])`,
      [fileNumbers]
    );
    rows.forEach((row) => {
      phoneMap[row.file_number] = [row.phone, row.other_phone].filter((p) => String(p || '').trim()).join(' / ');
    });
  }
  const typeMap = await getInvoiceTypesMap();
  const num = (v) => Math.round((Number(v) || 0) * 100) / 100;
  const totals = {
    invoice_count: 0,
    items_only: 0,
    items_subtotal: 0,
    stay_subtotal: 0,
    fees: 0,
    admin_expenses: 0,
    total_after_admin: 0,
    final_total: 0,
    total_collected: 0,
    remaining: 0,
    refundable: 0,
  };
  const rows = invoices.map((inv) => {
    const fees = num(Number(inv.stamp_duty) + Number(inv.professional_fees));
    const finalTotal = num(inv.final_total);
    const collected = num(inv.total_collected);
    const refundable = collected > finalTotal ? num(collected - finalTotal) : 0;
    const row = {
      invoice_id: inv.id,
      serial_number: inv.serial_number || '',
      status: inv.status,
      status_label: STATUS_LABELS[inv.status] || inv.status,
      invoice_type_label: typeMap[inv.invoice_type] || inv.invoice_type,
      issue_date: inv.issue_date || inv.created_at,
      admission_date: inv.admission_date,
      discharge_date: inv.discharge_date,
      file_number: inv.file_number,
      patient_name: inv.patient_name,
      phone: phoneMap[inv.file_number] || '',
      items_only: num(Number(inv.items_subtotal) - Number(inv.stay_subtotal)),
      items_subtotal: num(inv.items_subtotal),
      stay_subtotal: num(inv.stay_subtotal),
      fees,
      admin_expenses_percent: num(inv.admin_expenses_percent),
      admin_expenses: num(inv.admin_expenses),
      total_after_admin: num(inv.total_after_admin),
      patient_credit_applied: num(inv.patient_credit_applied),
      final_total: finalTotal,
      total_collected: collected,
      remaining: num(inv.remaining),
      refundable,
    };
    totals.invoice_count += 1;
    ['items_only', 'items_subtotal', 'stay_subtotal', 'fees', 'admin_expenses', 'total_after_admin', 'final_total', 'remaining', 'refundable'].forEach(
      (key) => {
        totals[key] = num(totals[key] + row[key]);
      }
    );
    totals.total_collected = num(totals.total_collected + collected);
    return row;
  });
  return { rows, totals, filters };
}

const DAILY_ITEMS_KINDS = {
  medicines: {
    title: 'تقرير الأدوية — الحركة اليومية',
    categories: ['Medicine'],
    sections: ['medicines'],
  },
  supplies: {
    title: 'تقرير المستلزمات — الحركة اليومية',
    categories: ['Supplies'],
    sections: ['supplies'],
  },
  medicines_supplies: {
    title: 'تقرير الأدوية والمستلزمات — الحركة اليومية',
    categories: ['Medicine', 'Supplies'],
    sections: ['medicines', 'supplies'],
  },
};

const DAILY_SERVICE_REPORT_KINDS = {
  stay: {
    title: 'تقرير الإقامة — الحركة اليومية',
    section_codes: ['accommodation', 'companion', 'nursing_point', 'patient_assistant'],
  },
  sessions: {
    title: 'تقرير الجلسات — الحركة اليومية',
    section_codes: ['sessions'],
  },
  other: {
    title: 'تقرير الخدمات المتنوعة — الحركة اليومية',
    section_codes: ['other', 'prosthetics'],
  },
  radiology: {
    title: 'تقرير الأشعة — الحركة اليومية',
    section_codes: ['xray_total', 'xray_stamp'],
  },
  laboratory: {
    title: 'تقرير التحاليل — الحركة اليومية',
    section_codes: ['analyses', 'analyses_stamp'],
  },
  exams: {
    title: 'تقرير الكشوفات — الحركة اليومية',
    section_codes: ['consultant_exam', 'specialist_exam', 'consultation_stamp'],
  },
  operations: {
    title: 'تقرير العمليات — الحركة اليومية',
    report_type: 'operations',
  },
  all_sections: {
    title: 'تقرير الحركة اليومية — كل الأقسام',
    report_type: 'all',
  },
};

const DAILY_ALL_SECTIONS_CODES = [
  ...DAILY_SERVICE_REPORT_KINDS.stay.section_codes,
  ...DAILY_SERVICE_REPORT_KINDS.sessions.section_codes,
  'medicines',
  'supplies',
  'cosmetics',
  ...DAILY_SERVICE_REPORT_KINDS.exams.section_codes,
  ...DAILY_SERVICE_REPORT_KINDS.laboratory.section_codes,
  ...DAILY_SERVICE_REPORT_KINDS.radiology.section_codes,
  ...DAILY_SERVICE_REPORT_KINDS.other.section_codes,
];

const DAILY_FREE_ITEMS_KINDS = {
  free_items: {
    title: 'تقرير البنود الحرة',
  },
};

function resolveDailyPrintKind(kind) {
  if (DAILY_ITEMS_KINDS[kind]) return { type: 'catalog', kind };
  const serviceConfig = DAILY_SERVICE_REPORT_KINDS[kind];
  if (serviceConfig?.report_type === 'operations') return { type: 'operations', kind };
  if (serviceConfig?.report_type === 'all') return { type: 'all', kind };
  if (serviceConfig) return { type: 'service', kind };
  if (DAILY_FREE_ITEMS_KINDS[kind]) return { type: 'free', kind };
  return null;
}

const CATALOG_CATEGORY_LABELS = {
  Medicine: 'أدوية',
  Supplies: 'مستلزمات',
  Cosmetics: 'مستحضرات تجميل',
};

function resolveDailyItemCategoryLabel(row) {
  if (row.catalog_item_category) {
    return CATALOG_CATEGORY_LABELS[row.catalog_item_category] || row.catalog_item_category;
  }
  if (row.section_code === 'medicines') return 'أدوية';
  if (row.section_code === 'supplies') return 'مستلزمات';
  if (row.section_code === 'cosmetics') return 'مستحضرات تجميل';
  return '—';
}

async function getDailyItemsReport(kind, filters = {}) {
  const config = DAILY_ITEMS_KINDS[kind];
  if (!config) throw new Error('نوع التقرير غير صالح');

  const fileNumber = String(filters.file_number || '').trim();
  if (!fileNumber) throw new Error('رقم الملف مطلوب');

  let sql = `
    SELECT e.entry_date,
           p.file_number,
           p.name AS patient_name,
           l.section_code,
           l.description,
           l.quantity,
           COALESCE(ii.selling_price_snapshot, l.unit_price) AS unit_price,
           COALESCE(ii.total, l.amount) AS amount,
           COALESCE(ii.cost_price_snapshot, l.cost_price) AS cost_price,
           COALESCE(ii.markup_percent_snapshot, l.markup_percent) AS markup_percent,
           c.code AS catalog_item_code,
           c.name AS catalog_item_name,
           c.category AS catalog_item_category,
           c.unit AS catalog_item_unit,
           s.name AS service_name
    FROM patient_daily_entry_lines l
    JOIN patient_daily_entries e ON e.id = l.entry_id
    JOIN patients p ON p.id = e.patient_id
    LEFT JOIN invoice_items ii ON ii.daily_entry_line_id = l.id AND ii.invoice_id = e.invoice_id
    LEFT JOIN daily_entry_catalog_items c ON c.id = l.catalog_item_id
    LEFT JOIN services s ON s.id = l.service_id
    WHERE p.file_number = $1
      AND COALESCE(l.amount, 0) > 0
      AND (
        c.category = ANY($2::text[])
        OR l.section_code = ANY($3::text[])
      )`;
  const params = [fileNumber, config.categories, config.sections];
  let i = 4;

  if (filters.invoice_id) {
    sql += ` AND (e.invoice_id IS NULL OR e.invoice_id = $${i++})`;
    params.push(filters.invoice_id);
  }

  if (filters.from_date) {
    sql += ` AND e.entry_date >= $${i++}::date`;
    params.push(filters.from_date);
  }
  if (filters.to_date) {
    sql += ` AND e.entry_date <= $${i++}::date`;
    params.push(filters.to_date);
  }

  sql += ` ORDER BY e.entry_date ASC, e.id ASC, l.sort_order ASC, l.id ASC`;

  const { rows } = await query(sql, params);

  let totalAmount = 0;
  let totalCost = 0;
  let totalSelling = 0;
  let totalMargin = 0;

  const mappedRows = rows.map((row) => {
    const qty = Number(row.quantity) || 1;
    const unitPrice = Number(row.unit_price) || 0;
    const lineTotal = Number(row.amount) || 0;
    const costPrice = row.cost_price != null ? Number(row.cost_price) : null;
    const markupPercent = row.markup_percent != null ? Number(row.markup_percent) : null;
    const sellingPrice = unitPrice;
    const isSupplies =
      row.catalog_item_category === 'Supplies' || row.section_code === 'supplies';

    totalAmount += lineTotal;
    if (isSupplies) {
      const lineCost = costPrice != null ? costPrice * qty : 0;
      const lineSelling = sellingPrice * qty;
      totalCost += lineCost;
      totalSelling += lineSelling;
      totalMargin += lineSelling - lineCost;
    }

    return {
      patient_name: row.patient_name || '',
      file_number: row.file_number || fileNumber,
      entry_date: row.entry_date,
      item_name:
        row.catalog_item_name || row.description || row.service_name || '—',
      category: resolveDailyItemCategoryLabel(row),
      quantity: qty,
      unit: row.catalog_item_unit || '—',
      unit_price: unitPrice,
      total: lineTotal,
      cost_price: isSupplies && costPrice != null ? costPrice : null,
      markup_percent: isSupplies && markupPercent != null ? markupPercent : null,
      selling_price: isSupplies ? sellingPrice : null,
      is_supplies: isSupplies,
    };
  });

  const patient = mappedRows[0]
    ? { file_number: mappedRows[0].file_number, name: mappedRows[0].patient_name }
    : await getPatientByFileNumber(fileNumber);

  return {
    report_type: 'catalog',
    kind,
    title: config.title,
    show_supplies_columns: kind === 'supplies' || kind === 'medicines_supplies',
    patient: {
      file_number: patient?.file_number || fileNumber,
      name: patient?.name || mappedRows[0]?.patient_name || '',
    },
    filters: {
      file_number: fileNumber,
      from_date: filters.from_date || null,
      to_date: filters.to_date || null,
    },
    rows: mappedRows,
    totals: {
      row_count: mappedRows.length,
      total_amount: Math.round(totalAmount * 100) / 100,
      total_cost: Math.round(totalCost * 100) / 100,
      total_selling: Math.round(totalSelling * 100) / 100,
      total_margin: Math.round(totalMargin * 100) / 100,
    },
  };
}

async function getDailyServiceReport(kind, filters = {}) {
  const config = DAILY_SERVICE_REPORT_KINDS[kind];
  if (!config) throw new Error('نوع التقرير غير صالح');

  const fileNumber = String(filters.file_number || '').trim();
  if (!fileNumber) throw new Error('رقم الملف مطلوب');

  const { getDefaultPriceList } = require('./priceListService');
  const sectionCodes = config.section_codes || [];
  if (!sectionCodes.length) throw new Error('نوع التقرير غير صالح');
  const params = [fileNumber, sectionCodes];
  let i = 3;

  let sql = `
    SELECT e.entry_date,
           p.file_number,
           p.name AS patient_name,
           l.section_code,
           l.description,
           l.quantity,
           l.unit_price,
           l.amount,
           s.name AS service_name,
           s.code AS service_code,
           dcs.name AS section_name,
           dcs.category_code,
           sc.code AS service_category_code
    FROM patient_daily_entry_lines l
    JOIN patient_daily_entries e ON e.id = l.entry_id
    JOIN patients p ON p.id = e.patient_id
    LEFT JOIN daily_charge_sections dcs ON dcs.code = l.section_code
    LEFT JOIN services s ON s.id = l.service_id
    LEFT JOIN service_categories sc ON sc.id = s.category_id
    WHERE p.file_number = $1
      AND COALESCE(l.amount, 0) > 0
      AND l.section_code = ANY($2::text[])`;

  if (filters.invoice_id) {
    sql += ` AND (e.invoice_id IS NULL OR e.invoice_id = $${i++})`;
    params.push(filters.invoice_id);
  }

  if (filters.from_date) {
    sql += ` AND e.entry_date >= $${i++}::date`;
    params.push(filters.from_date);
  }
  if (filters.to_date) {
    sql += ` AND e.entry_date <= $${i++}::date`;
    params.push(filters.to_date);
  }

  sql += ` ORDER BY e.entry_date ASC, e.id ASC, l.sort_order ASC, l.id ASC`;

  const { rows } = await query(sql, params);
  const priceList = await getDefaultPriceList();

  let totalAmount = 0;
  const mappedRows = rows.map((row) => {
    const qty = Number(row.quantity) || 1;
    const unitPrice = Number(row.unit_price) || 0;
    const lineTotal = Number(row.amount) || 0;
    totalAmount += lineTotal;
    const serviceName =
      row.service_name || row.description || row.section_name || '—';
    return {
      patient_name: row.patient_name || '',
      file_number: row.file_number || fileNumber,
      entry_date: row.entry_date,
      service_name: serviceName,
      quantity: qty,
      unit_price: unitPrice,
      total: lineTotal,
      service_code: row.service_code || '',
      section_code: row.section_code || '',
    };
  });

  const patient = mappedRows[0]
    ? { file_number: mappedRows[0].file_number, name: mappedRows[0].patient_name }
    : await getPatientByFileNumber(fileNumber);

  return {
    report_type: 'service',
    kind,
    title: config.title,
    price_list_name: priceList?.name || '',
    patient: {
      file_number: patient?.file_number || fileNumber,
      name: patient?.name || mappedRows[0]?.patient_name || '',
    },
    filters: {
      file_number: fileNumber,
      from_date: filters.from_date || null,
      to_date: filters.to_date || null,
    },
    rows: mappedRows,
    totals: {
      row_count: mappedRows.length,
      total_amount: Math.round(totalAmount * 100) / 100,
    },
  };
}

async function getDailyFreeItemsReport(filters = {}) {
  const config = DAILY_FREE_ITEMS_KINDS.free_items;
  const fileNumber = String(filters.file_number || '').trim();
  if (!fileNumber) throw new Error('رقم الملف مطلوب');

  const invoiceId =
    filters.invoice_id || (await getDailyPrintInvoiceContext(fileNumber))?.id || null;
  if (!invoiceId) {
    const patient = await getPatientByFileNumber(fileNumber);
    return {
      report_type: 'service',
      kind: 'free_items',
      title: config.title,
      patient: { file_number: fileNumber, name: patient?.name || '' },
      filters: {
        file_number: fileNumber,
        from_date: filters.from_date || null,
        to_date: filters.to_date || null,
      },
      rows: [],
      totals: { row_count: 0, total_amount: 0 },
    };
  }

  const { rows } = await query(
    `SELECT ii.description,
            ii.quantity,
            ii.amount,
            inv.admission_date AS entry_date,
            p.file_number,
            p.name AS patient_name
     FROM invoice_items ii
     JOIN invoices inv ON inv.id = ii.invoice_id
     JOIN patients p ON p.id = inv.patient_id
     WHERE inv.id = $1
       AND ii.daily_entry_line_id IS NULL
       AND ii.daily_entry_id IS NULL
       AND COALESCE(ii.amount, 0) > 0
     ORDER BY ii.sort_order ASC, ii.id ASC`,
    [invoiceId]
  );

  const fromDate = filters.from_date ? String(filters.from_date).slice(0, 10) : null;
  const toDate = filters.to_date ? String(filters.to_date).slice(0, 10) : null;
  let totalAmount = 0;
  const mappedRows = [];
  for (const row of rows) {
    const qty = Number(row.quantity) || 1;
    const unitPrice = Number(row.amount) || 0;
    const lineTotal = unitPrice * qty;
    let description = String(row.description || '').trim();
    let entryDate = row.entry_date;
    const prefix = description.match(/^\[(\d{2})-(\d{2})-(\d{4})\]\s*/);
    if (prefix) {
      entryDate = `${prefix[3]}-${prefix[2]}-${prefix[1]}`;
      description = description.slice(prefix[0].length).trim();
      if ((fromDate && entryDate < fromDate) || (toDate && entryDate > toDate)) continue;
    }
    totalAmount += lineTotal;
    mappedRows.push({
      patient_name: row.patient_name || '',
      file_number: row.file_number || fileNumber,
      entry_date: entryDate,
      service_name: description || '—',
      quantity: qty,
      unit_price: unitPrice,
      total: lineTotal,
      service_code: '',
      section_code: 'free_items',
    });
  }

  const patient = mappedRows[0]
    ? { file_number: mappedRows[0].file_number, name: mappedRows[0].patient_name }
    : await getPatientByFileNumber(fileNumber);

  return {
    report_type: 'service',
    kind: 'free_items',
    title: config.title,
    patient: {
      file_number: patient?.file_number || fileNumber,
      name: patient?.name || mappedRows[0]?.patient_name || '',
    },
    filters: {
      file_number: fileNumber,
      from_date: filters.from_date || null,
      to_date: filters.to_date || null,
    },
    rows: mappedRows,
    totals: {
      row_count: mappedRows.length,
      total_amount: Math.round(totalAmount * 100) / 100,
    },
  };
}

async function getDailyOperationsReport(filters = {}) {
  const fileNumber = String(filters.file_number || '').trim();
  if (!fileNumber) throw new Error('رقم الملف مطلوب');
  const patient = await getPatientByFileNumber(fileNumber);
  if (!patient?.id) throw new Error('المريض غير موجود');

  let sql = `SELECT * FROM patient_operations WHERE patient_id = $1`;
  const params = [patient.id];
  let i = 2;
  if (filters.from_date) {
    sql += ` AND entry_date >= $${i++}::date`;
    params.push(filters.from_date);
  }
  if (filters.to_date) {
    sql += ` AND entry_date <= $${i++}::date`;
    params.push(filters.to_date);
  }
  sql += ` ORDER BY entry_date ASC, id ASC`;
  const { rows } = await query(sql, params);
  let totalAmount = 0;
  const mappedRows = rows.map((row) => {
    const lineTotal = Number(row.final_amount ?? row.amount ?? 0) || 0;
    totalAmount += lineTotal;
    return {
      patient_name: patient.name || '',
      file_number: patient.file_number || fileNumber,
      entry_date: row.entry_date,
      service_name: row.operation_name || row.service_name || '—',
      quantity: 1,
      unit_price: lineTotal,
      total: lineTotal,
      section_code: 'operations',
    };
  });
  return {
    report_type: 'service',
    kind: 'operations',
    title: DAILY_SERVICE_REPORT_KINDS.operations.title,
    patient: { file_number: patient.file_number, name: patient.name || '' },
    filters: {
      file_number: fileNumber,
      from_date: filters.from_date || null,
      to_date: filters.to_date || null,
    },
    rows: mappedRows,
    totals: { row_count: mappedRows.length, total_amount: Math.round(totalAmount * 100) / 100 },
  };
}

async function getDailyAllSectionsReport(filters = {}) {
  const fileNumber = String(filters.file_number || '').trim();
  if (!fileNumber) throw new Error('رقم الملف مطلوب');
  let sql = `
    SELECT e.entry_date,
           p.file_number,
           p.name AS patient_name,
           l.section_code,
           l.description,
           l.quantity,
           l.unit_price,
           l.amount,
           s.name AS service_name,
           dcs.name AS section_name,
           c.name AS catalog_item_name
    FROM patient_daily_entry_lines l
    JOIN patient_daily_entries e ON e.id = l.entry_id
    JOIN patients p ON p.id = e.patient_id
    LEFT JOIN daily_charge_sections dcs ON dcs.code = l.section_code
    LEFT JOIN services s ON s.id = l.service_id
    LEFT JOIN daily_entry_catalog_items c ON c.id = l.catalog_item_id
    WHERE p.file_number = $1
      AND COALESCE(l.amount, 0) > 0
      AND l.section_code = ANY($2::text[])`;
  const params = [fileNumber, DAILY_ALL_SECTIONS_CODES];
  let i = 3;
  if (filters.invoice_id) {
    sql += ` AND (e.invoice_id IS NULL OR e.invoice_id = $${i++})`;
    params.push(filters.invoice_id);
  }
  if (filters.from_date) {
    sql += ` AND e.entry_date >= $${i++}::date`;
    params.push(filters.from_date);
  }
  if (filters.to_date) {
    sql += ` AND e.entry_date <= $${i++}::date`;
    params.push(filters.to_date);
  }
  sql += ` ORDER BY e.entry_date ASC, dcs.sort_order ASC NULLS LAST, l.sort_order ASC, l.id ASC`;
  const { rows } = await query(sql, params);
  let totalAmount = 0;
  const mappedRows = rows.map((row) => {
    const qty = Number(row.quantity) || 1;
    const lineTotal = Number(row.amount) || 0;
    totalAmount += lineTotal;
    return {
      patient_name: row.patient_name || '',
      file_number: row.file_number || fileNumber,
      entry_date: row.entry_date,
      service_name:
        row.catalog_item_name || row.service_name || row.description || row.section_name || '—',
      quantity: qty,
      unit_price: Number(row.unit_price) || lineTotal / qty,
      total: lineTotal,
      section_code: row.section_code || '',
    };
  });
  const patient = await getPatientByFileNumber(fileNumber);
  return {
    report_type: 'service',
    kind: 'all_sections',
    title: DAILY_SERVICE_REPORT_KINDS.all_sections.title,
    patient: { file_number: patient?.file_number || fileNumber, name: patient?.name || '' },
    filters: {
      file_number: fileNumber,
      from_date: filters.from_date || null,
      to_date: filters.to_date || null,
    },
    rows: mappedRows,
    totals: { row_count: mappedRows.length, total_amount: Math.round(totalAmount * 100) / 100 },
  };
}

async function getDailyPrintInvoiceContext(fileNumber) {
  const fn = String(fileNumber || '').trim();
  if (!fn) return null;
  const { rows } = await query(
    `SELECT id, status, employee_name, auditor_name, captain_name, manager_name
     FROM invoices
     WHERE TRIM(file_number) = TRIM($1)
     ORDER BY CASE WHEN status IN ('draft', 'pending_review') THEN 0 ELSE 1 END,
              updated_at DESC
     LIMIT 1`,
    [fn]
  );
  return rows[0] || null;
}

function formatManagerSignatureName(name) {
  const cleaned = String(name || '')
    .replace(/\s*[-–—]\s*المدير المالي\s*$/u, '')
    .trim();
  return cleaned || 'رائد / جمال عبد الناصر';
}

function buildDailyPrintSignatures(invoice) {
  return [
    { title: 'المدير المالي', name: formatManagerSignatureName(invoice?.manager_name) },
    { title: 'رئيس حسابات المرضى', name: invoice?.captain_name || 'نقيب عمرو صالح' },
    { title: 'المراجع المالي', name: invoice?.auditor_name || '' },
    { title: 'الموظف المختص', name: invoice?.employee_name || '' },
  ];
}

async function getDailyPrintReport(kind, filters = {}) {
  const resolved = resolveDailyPrintKind(kind);
  if (!resolved) throw new Error('نوع التقرير غير صالح');
  const invoice = await getDailyPrintInvoiceContext(filters.file_number);
  const scoped = {
    ...filters,
    invoice_id:
      invoice && ['draft', 'pending_review'].includes(invoice.status) ? invoice.id : null,
  };
  let report;
  if (resolved.type === 'operations') report = await getDailyOperationsReport(scoped);
  else if (resolved.type === 'all') report = await getDailyAllSectionsReport(scoped);
  else if (resolved.type === 'service') report = await getDailyServiceReport(resolved.kind, scoped);
  else if (resolved.type === 'free') report = await getDailyFreeItemsReport({ ...scoped, invoice_id: invoice?.id || null });
  else report = await getDailyItemsReport(resolved.kind, scoped);
  report.signatures = buildDailyPrintSignatures(invoice);
  return report;
}

async function getSuppliesMarkupReport(filters = {}) {
  let sql = `
    SELECT e.entry_date,
           p.file_number,
           p.name AS patient_name,
           p.nationality,
           inv.serial_number,
           inv.status AS invoice_status,
           c.code AS item_code,
           COALESCE(c.name, l.description) AS item_name,
           COALESCE(ii.quantity, l.quantity, 1) AS original_quantity,
           COALESCE(ii.returned_quantity, 0) AS returned_quantity,
           l.quantity,
           COALESCE(ii.cost_price_snapshot, l.cost_price) AS cost_price,
           COALESCE(ii.markup_percent_snapshot, l.markup_percent) AS markup_percent,
           COALESCE(ii.selling_price_snapshot, l.unit_price) AS selling_price,
           (COALESCE(ii.selling_price_snapshot, l.unit_price, 0) - COALESCE(ii.cost_price_snapshot, l.cost_price, 0)) AS unit_margin,
           COALESCE(
             ii.margin_amount_snapshot,
             (COALESCE(ii.selling_price_snapshot, l.unit_price, 0) - COALESCE(ii.cost_price_snapshot, l.cost_price, 0))
               * COALESCE(l.quantity, 1)
           ) AS margin_amount,
           COALESCE(ii.total, l.amount) AS line_total
    FROM patient_daily_entry_lines l
    JOIN patient_daily_entries e ON e.id = l.entry_id
    JOIN patients p ON p.id = e.patient_id
    LEFT JOIN daily_entry_catalog_items c ON c.id = l.catalog_item_id
    LEFT JOIN invoices inv ON inv.id = e.invoice_id
    LEFT JOIN invoice_items ii ON ii.daily_entry_line_id = l.id AND ii.invoice_id = e.invoice_id
    WHERE l.catalog_item_id IS NOT NULL
      AND (l.section_code = 'supplies' OR c.category = 'Supplies')
      AND COALESCE(l.amount, 0) > 0`;
  const params = [];
  let i = 1;

  if (filters.from_date) {
    sql += ` AND e.entry_date >= $${i++}::date`;
    params.push(filters.from_date);
  }
  if (filters.to_date) {
    sql += ` AND e.entry_date <= $${i++}::date`;
    params.push(filters.to_date);
  }
  if (filters.file_number) {
    sql += ` AND p.file_number ILIKE $${i++}`;
    params.push(`%${String(filters.file_number).trim()}%`);
  }
  if (filters.patient_type) {
    sql += ` AND p.patient_type = $${i++}`;
    params.push(filters.patient_type);
  }
  if (filters.nationality) {
    sql += ` AND COALESCE(p.nationality, '') ILIKE $${i++}`;
    params.push(`%${String(filters.nationality).trim()}%`);
  }
  if (filters.search) {
    sql += ` AND (p.name ILIKE $${i} OR p.file_number ILIKE $${i} OR inv.serial_number ILIKE $${i})`;
    params.push(`%${String(filters.search).trim()}%`);
    i++;
  }

  sql += ` ORDER BY e.entry_date DESC, e.id DESC, l.sort_order, l.id`;

  const { rows } = await query(sql, params);

  let totalCost = 0;
  let totalSelling = 0;
  let totalMargin = 0;
  let totalAccountingSelling = 0;
  for (const row of rows) {
    const originalQty = Number(row.original_quantity ?? row.quantity) || 1;
    const returnedQty = Number(row.returned_quantity) || 0;
    const netQty = Math.max(0, originalQty - returnedQty);
    const cost = Number(row.cost_price) || 0;
    const selling = Number(row.selling_price) || 0;
    const marginSnapshot = Number(row.margin_amount) || 0;
    const netMargin =
      marginSnapshot > 0 && originalQty > 0
        ? Math.round(marginSnapshot * (netQty / originalQty) * 100) / 100
        : Math.round((selling - cost) * netQty * 100) / 100;
    const mult = getNationalityPriceMultiplier(row.nationality);
    const listLineTotal = Math.round(selling * netQty * 100) / 100;
    const accountingLineTotal = applyNationalityToAmount(listLineTotal, row.nationality);
    row.net_quantity = netQty;
    row.margin_amount = netMargin;
    row.list_line_total = listLineTotal;
    row.line_total = accountingLineTotal;
    row.list_unit_price = selling;
    row.accounting_unit_price = applyNationalityToAmount(selling, row.nationality);
    row.nationality_label = getNationalityLabel(row.nationality);
    row.price_path_label = getPricePathLabel(row.nationality);
    totalCost += cost * netQty;
    totalSelling += listLineTotal;
    totalAccountingSelling += accountingLineTotal;
    totalMargin += netMargin;
  }

  return {
    rows: rows.map((row) => ({
      ...row,
      quantity: Number(row.net_quantity ?? row.quantity) || 1,
      original_quantity: Number(row.original_quantity ?? row.quantity) || 1,
      returned_quantity: Number(row.returned_quantity) || 0,
      net_quantity: Number(row.net_quantity) || 1,
      cost_price: row.cost_price != null ? Number(row.cost_price) : null,
      markup_percent: row.markup_percent != null ? Number(row.markup_percent) : null,
      selling_price: Number(row.list_unit_price) || 0,
      accounting_unit_price: Number(row.accounting_unit_price) || 0,
      unit_margin: Number(row.unit_margin) || 0,
      margin_amount: Number(row.margin_amount) || 0,
      list_line_total: Number(row.list_line_total) || 0,
      line_total: Number(row.line_total) || 0,
      nationality_label: row.nationality_label,
      price_path_label: row.price_path_label,
    })),
    totals: {
      row_count: rows.length,
      total_cost: Math.round(totalCost * 100) / 100,
      total_selling: Math.round(totalSelling * 100) / 100,
      total_accounting_selling: Math.round(totalAccountingSelling * 100) / 100,
      total_margin: Math.round(totalMargin * 100) / 100,
    },
    filters,
  };
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
  const today = require('./dailyChargeService').getCurrentBusinessDateString();
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
    transactions = rows.map((row) => ({
      ...row,
      transaction_kind_label: labelTransactionKind(row.transaction_kind),
    }));
  }

  const accountBalance = Number(patient?.account_balance) || 0;

  return {
    patient: {
      file_number: targetFileNumber,
      name: patientName,
      account_balance: accountBalance,
      nationality: patient?.nationality || '',
      nationality_label: getNationalityLabel(patient?.nationality),
      price_path_label: getPricePathLabel(patient?.nationality),
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

function roundReport(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function isBalancedAmount(diff) {
  return Math.abs(roundReport(diff)) < 0.02;
}

/**
 * Invoice-level reconciliation: final_total ≈ collected + remaining;
 * method_payments sum vs total_collected; collection ledger vs cash methods (approved).
 */
async function getReconciliationReport(filters = {}) {
  const invoices = await enrichInvoiceList(
    await fetchInvoicesForReport({ ...filters, approved_only: false })
  );
  const rows = [];
  let mismatchCount = 0;

  for (const inv of invoices) {
    const finalTotal = roundReport(inv.final_total);
    const collected = roundReport(inv.total_collected);
    const remaining = roundReport(inv.remaining);
    const equationDiff = roundReport(finalTotal - (collected + remaining));
    const equationBalanced = isBalancedAmount(equationDiff);

    const { rows: methodRows } = await query(
      `SELECT pm.code, pm.name, ipa.amount
       FROM invoice_payment_amounts ipa
       JOIN payment_methods pm ON pm.id = ipa.payment_method_id
       WHERE ipa.invoice_id = $1 AND COALESCE(ipa.amount, 0) <> 0`,
      [inv.id]
    );
    const methodSum = roundReport(methodRows.reduce((sum, row) => sum + Number(row.amount), 0));
    const methodDiff = roundReport(collected - methodSum);
    const methodBalanced = isBalancedAmount(methodDiff);

    const cashMethodsSum = roundReport(
      methodRows
        .filter((row) => row.code && row.code !== 'patient_credit')
        .reduce((sum, row) => sum + Number(row.amount), 0)
    );

    const { rows: ledgerRows } = await query(
      `SELECT COALESCE(SUM(amount), 0)::numeric AS total
       FROM patient_transactions
       WHERE invoice_id = $1 AND transaction_kind = 'collection'`,
      [inv.id]
    );
    const collectionLedger = roundReport(ledgerRows[0]?.total || 0);
    const ledgerDiff = roundReport(collectionLedger - cashMethodsSum);
    const ledgerBalanced = inv.status !== 'approved' || isBalancedAmount(ledgerDiff);

    const issues = [];
    if (!equationBalanced) {
      issues.push(`معادلة الفاتورة: الإجمالي − (المحصل + المتبقي) = ${equationDiff}`);
    }
    if (!methodBalanced) {
      issues.push(`طرق الدفع (${methodSum}) ≠ المحصل (${collected}) — فرق ${methodDiff}`);
    }
    if (inv.status === 'approved' && !ledgerBalanced) {
      issues.push(
        `حركة التحصيل (${collectionLedger}) ≠ طرق الدفع النقدية (${cashMethodsSum}) — فرق ${ledgerDiff}`
      );
    }

    const hasIssues = issues.length > 0;
    if (hasIssues) mismatchCount += 1;

    rows.push({
      invoice_id: inv.id,
      serial_number: inv.serial_number,
      file_number: inv.file_number,
      patient_name: inv.patient_name,
      nationality: inv.nationality,
      nationality_label: inv.nationality_label,
      price_path_label: inv.price_path_label,
      status: inv.status,
      status_label: STATUS_LABELS[inv.status] || inv.status,
      issue_date: inv.issue_date,
      final_total: finalTotal,
      total_collected: collected,
      remaining,
      equation_diff: equationDiff,
      equation_balanced: equationBalanced,
      method_payments_sum: methodSum,
      method_payments_diff: methodDiff,
      cash_methods_sum: cashMethodsSum,
      collection_ledger_sum: collectionLedger,
      collection_ledger_diff: ledgerDiff,
      ledger_balanced: ledgerBalanced,
      is_balanced: !hasIssues,
      issues,
    });
  }

  const totals = {
    invoice_count: rows.length,
    mismatch_count: mismatchCount,
    balanced_count: rows.length - mismatchCount,
    grand_final: roundReport(rows.reduce((sum, row) => sum + row.final_total, 0)),
    grand_collected: roundReport(rows.reduce((sum, row) => sum + row.total_collected, 0)),
    grand_remaining: roundReport(rows.reduce((sum, row) => sum + row.remaining, 0)),
    grand_equation_check: roundReport(
      rows.reduce((sum, row) => sum + row.final_total, 0) -
        rows.reduce((sum, row) => sum + row.total_collected + row.remaining, 0)
    ),
  };

  return { rows, totals, filters };
}

const EXCEL_THIN_BORDER = {
  top: { style: 'thin', color: { argb: 'FF000000' } },
  left: { style: 'thin', color: { argb: 'FF000000' } },
  bottom: { style: 'thin', color: { argb: 'FF000000' } },
  right: { style: 'thin', color: { argb: 'FF000000' } },
};

function applyExcelRowBorders(row, colCount, border = EXCEL_THIN_BORDER) {
  for (let c = 1; c <= colCount; c++) {
    row.getCell(c).border = border;
  }
}

function styleExcelTableHeaderRow(row, colCount) {
  row.font = { bold: true, size: 11, name: 'Arial' };
  row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9D9D9' } };
  row.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
  applyExcelRowBorders(row, colCount);
}

function styleExcelDataRow(row, colCount) {
  row.font = { bold: true, size: 10, name: 'Arial' };
  row.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
  applyExcelRowBorders(row, colCount);
}

function formatDailyExcelPeriod(report) {
  const from = report.filters?.from_date;
  const to = report.filters?.to_date;
  if (!from && !to) return 'كل الفترة';
  const fmt = (value) => {
    if (!value) return '—';
    const s = String(value).slice(0, 10);
    const [y, m, d] = s.split('-');
    return y && m && d ? `${d}/${m}/${y}` : s;
  };
  return `${fmt(from)} → ${fmt(to)}`;
}

function formatDailyExcelDate(value) {
  if (!value) return '';
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return '';
    const dd = String(value.getDate()).padStart(2, '0');
    const mm = String(value.getMonth() + 1).padStart(2, '0');
    return `${dd}/${mm}/${value.getFullYear()}`;
  }
  const s = String(value).slice(0, 10);
  const [y, m, d] = s.split('-');
  return y && m && d ? `${d}/${m}/${y}` : s;
}

function setExcelColumnWidths(sheet, widths = []) {
  widths.forEach((width, index) => {
    sheet.getColumn(index + 1).width = width;
  });
}

async function buildDailyPrintExcelBuffer(report) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'EAF Invoices';
  workbook.created = new Date();

  const isCatalog = report.report_type === 'catalog';
  const showSupplies = Boolean(report.show_supplies_columns);
  const headers = isCatalog
    ? [
        'م',
        'المريض',
        'رقم الملف',
        'التاريخ',
        'اسم الصنف',
        'الفئة',
        'الكمية',
        'الوحدة',
        'سعر الوحدة',
        ...(showSupplies ? ['سعر التكلفة', 'نسبة الربح %', 'سعر البيع'] : []),
        'الإجمالي',
      ]
    : ['م', 'المريض', 'رقم الملف', 'التاريخ', 'اسم الخدمة', 'الكمية', 'سعر الوحدة', 'الإجمالي'];
  const colCount = headers.length;
  const sheetTitle = String(report.title || 'تقرير').slice(0, 31);
  const sheet = workbook.addWorksheet(sheetTitle, {
    views: [{ rightToLeft: true, state: 'frozen', ySplit: report.price_list_name ? 6 : 5 }],
  });

  sheet.mergeCells(1, 1, 1, colCount);
  const orgRow = sheet.getRow(1);
  orgRow.getCell(1).value = CENTER_NAME;
  orgRow.getCell(1).font = { bold: true, size: 14, name: 'Arial' };
  orgRow.getCell(1).alignment = { horizontal: 'center', vertical: 'middle' };
  orgRow.height = 24;
  applyExcelRowBorders(orgRow, colCount);

  sheet.mergeCells(2, 1, 2, colCount);
  const deptRow = sheet.getRow(2);
  deptRow.getCell(1).value = 'الإدارة المالية';
  deptRow.getCell(1).font = { bold: true, size: 12, name: 'Arial' };
  deptRow.getCell(1).alignment = { horizontal: 'center', vertical: 'middle' };
  applyExcelRowBorders(deptRow, colCount);

  sheet.mergeCells(3, 1, 3, colCount);
  const titleRow = sheet.getRow(3);
  titleRow.getCell(1).value = report.title || 'تقرير';
  titleRow.getCell(1).font = { bold: true, size: 13, name: 'Arial' };
  titleRow.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF0F0F0' } };
  titleRow.getCell(1).alignment = { horizontal: 'center', vertical: 'middle' };
  titleRow.height = 22;
  applyExcelRowBorders(titleRow, colCount);

  const metaRow = sheet.getRow(4);
  metaRow.values = [
    'المريض',
    report.patient?.name || '',
    'رقم الملف',
    report.patient?.file_number || '',
    'الفترة',
    formatDailyExcelPeriod(report),
  ];
  metaRow.font = { bold: true, size: 10, name: 'Arial' };
  metaRow.alignment = { horizontal: 'center', vertical: 'middle' };
  applyExcelRowBorders(metaRow, Math.min(colCount, 6));

  if (report.price_list_name) {
    const priceRow = sheet.getRow(5);
    priceRow.getCell(1).value = 'لائحة الأسعار';
    priceRow.getCell(2).value = report.price_list_name;
    priceRow.font = { bold: true, size: 10, name: 'Arial' };
    priceRow.alignment = { horizontal: 'center', vertical: 'middle' };
    applyExcelRowBorders(priceRow, Math.min(colCount, 2));
  }

  const headerRowIndex = report.price_list_name ? 6 : 5;
  const headerRow = sheet.getRow(headerRowIndex);
  headerRow.values = headers;
  styleExcelTableHeaderRow(headerRow, colCount);
  headerRow.height = 20;

  let rowIndex = headerRowIndex + 1;
  for (let i = 0; i < (report.rows || []).length; i++) {
    const row = report.rows[i];
    const values = isCatalog
      ? [
          i + 1,
          row.patient_name || '',
          row.file_number || '',
          formatDailyExcelDate(row.entry_date),
          row.item_name || '',
          row.category || '',
          Number(row.quantity) || 0,
          row.unit || '',
          Number(row.unit_price) || 0,
          ...(showSupplies
            ? [
                row.cost_price != null ? Number(row.cost_price) : '',
                row.markup_percent != null ? Number(row.markup_percent) : '',
                row.selling_price != null ? Number(row.selling_price) : '',
              ]
            : []),
          Number(row.total) || 0,
        ]
      : [
          i + 1,
          row.patient_name || '',
          row.file_number || '',
          formatDailyExcelDate(row.entry_date),
          row.service_name || '',
          Number(row.quantity) || 0,
          Number(row.unit_price) || 0,
          Number(row.total) || 0,
        ];
    const dataRow = sheet.getRow(rowIndex++);
    dataRow.values = values;
    styleExcelDataRow(dataRow, colCount);
    const nameCol = isCatalog ? 5 : 5;
    dataRow.getCell(nameCol).alignment = { horizontal: 'right', vertical: 'middle', wrapText: true };
  }

  if ((report.rows || []).length) {
    const totals = report.totals || {};
    const totalRow = sheet.getRow(rowIndex);
    if (isCatalog) {
      totalRow.getCell(1).value = `الإجمالي (${totals.row_count || 0} بند)`;
      sheet.mergeCells(rowIndex, 1, rowIndex, 9);
      totalRow.getCell(1).alignment = { horizontal: 'right', vertical: 'middle' };
      if (showSupplies) {
        totalRow.getCell(10).value =
          totals.total_cost != null ? Number(totals.total_cost) : '';
        totalRow.getCell(11).value = '';
        totalRow.getCell(12).value =
          totals.total_selling != null ? Number(totals.total_selling) : '';
      }
      totalRow.getCell(colCount).value = Number(totals.total_amount) || 0;
    } else {
      totalRow.getCell(1).value = `الإجمالي (${totals.row_count || 0} بند)`;
      sheet.mergeCells(rowIndex, 1, rowIndex, colCount - 1);
      totalRow.getCell(1).alignment = { horizontal: 'right', vertical: 'middle' };
      totalRow.getCell(colCount).value = Number(totals.total_amount) || 0;
    }
    totalRow.font = { bold: true, size: 11, name: 'Arial' };
    totalRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF3CD' } };
    applyExcelRowBorders(totalRow, colCount);
    rowIndex += 1;
  }

  const signatures = report.signatures || [];
  if (signatures.length) {
    rowIndex += 2;
    const titleSigRow = sheet.getRow(rowIndex);
    const lineSigRow = sheet.getRow(rowIndex + 1);
    const nameSigRow = sheet.getRow(rowIndex + 2);
    const base = Math.floor(colCount / signatures.length);
    let extra = colCount % signatures.length;
    let startCol = 1;
    signatures.forEach((sig) => {
      const span = base + (extra > 0 ? 1 : 0);
      if (extra > 0) extra -= 1;
      const endCol = startCol + span - 1;
      if (endCol > startCol) {
        sheet.mergeCells(rowIndex, startCol, rowIndex, endCol);
        sheet.mergeCells(rowIndex + 1, startCol, rowIndex + 1, endCol);
        sheet.mergeCells(rowIndex + 2, startCol, rowIndex + 2, endCol);
      }
      const titleCell = titleSigRow.getCell(startCol);
      titleCell.value = sig.title;
      titleCell.font = { bold: true, size: 11, name: 'Arial' };
      titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
      const lineCell = lineSigRow.getCell(startCol);
      lineCell.value = '';
      lineCell.border = { bottom: { style: 'thin', color: { argb: 'FF000000' } } };
      for (let c = startCol + 1; c <= endCol; c++) {
        lineSigRow.getCell(c).border = { bottom: { style: 'thin', color: { argb: 'FF000000' } } };
      }
      const nameCell = nameSigRow.getCell(startCol);
      nameCell.value = sig.name || '';
      nameCell.font = { size: 10, name: 'Arial' };
      nameCell.alignment = { horizontal: 'center', vertical: 'middle' };
      startCol = endCol + 1;
    });
    titleSigRow.height = 20;
    lineSigRow.height = 28;
    nameSigRow.height = 18;
  }

  if (isCatalog) {
    setExcelColumnWidths(
      sheet,
      showSupplies
        ? [5, 16, 10, 11, 24, 10, 8, 8, 11, 11, 11, 11, 11]
        : [5, 16, 10, 11, 26, 10, 8, 8, 11, 11]
    );
  } else {
    setExcelColumnWidths(sheet, [5, 16, 10, 11, 28, 8, 11, 11]);
  }

  return workbook.xlsx.writeBuffer();
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
    const invoices = await enrichInvoiceList(await fetchInvoicesForReport(filters));
    sheet.addRow([
      'الرقم التسلسلي',
      'رقم الملف',
      'المريض',
      'الجنسية',
      'مسار السعر',
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
        inv.nationality_label || inv.nationality || '—',
        inv.price_path_label || '—',
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
  } else if (reportType === 'supplies_markup') {
    const data = await getSuppliesMarkupReport(filters);
    sheet.addRow(['تقرير هامش المستلزمات']);
    sheet.addRow(['من', filters.from_date || '—', 'إلى', filters.to_date || '—']);
    sheet.addRow([]);
    sheet.addRow(['عدد البنود', data.totals.row_count]);
    sheet.addRow(['إجمالي التكلفة', data.totals.total_cost]);
    sheet.addRow(['إجمالي البيع (لائحة)', data.totals.total_selling]);
    sheet.addRow(['إجمالي البيع (بمسار الجنسية)', data.totals.total_accounting_selling || data.totals.total_selling]);
    sheet.addRow(['إجمالي الهامش', data.totals.total_margin]);
    sheet.addRow([]);
    sheet.addRow([
      'التاريخ',
      'رقم الملف',
      'المريض',
      'الجنسية',
      'مسار السعر',
      'الفاتورة',
      'كود الصنف',
      'الصنف',
      'الكمية',
      'سعر التكلفة',
      'نسبة الربح %',
      'سعر اللائحة',
      'سعر بعد الجنسية',
      'هامش الوحدة',
      'مبلغ الهامش',
      'إجمالي اللائحة',
      'إجمالي بمسار الجنسية',
    ]);
    data.rows.forEach((row) => {
      sheet.addRow([
        row.entry_date,
        row.file_number,
        row.patient_name,
        row.nationality_label || row.nationality || '—',
        row.price_path_label || '—',
        row.serial_number || '—',
        row.item_code || '',
        row.item_name || '',
        row.quantity,
        row.cost_price != null ? Number(row.cost_price) : '',
        row.markup_percent != null ? Number(row.markup_percent) : '',
        Number(row.selling_price),
        Number(row.accounting_unit_price || row.selling_price),
        Number(row.unit_margin),
        Number(row.margin_amount),
        Number(row.list_line_total || row.selling_price * row.quantity),
        Number(row.line_total),
      ]);
    });
  } else if (reportType === 'account_summary') {
    const data = await getAccountSummaryReport(filters);
    sheet.addRow(['تقرير ملخص ومسار الحسابات']);
    sheet.addRow(['من', filters.from_date || '—', 'إلى', filters.to_date || '—', 'بحث', filters.search || filters.file_number || '—']);
    sheet.addRow([]);
    sheet.addRow([
      'الفاتورة',
      'الحالة',
      'النوع',
      'التاريخ',
      'الملف',
      'المريض',
      'التليفون',
      'قيمة البنود',
      'الإقامة',
      'إجمالي البنود والإقامة',
      'دمغة + مهن',
      'نسبة المصروفات الإدارية %',
      'المصروفات الإدارية',
      'بعد المصروفات',
      'خصم من الرصيد',
      'الإجمالي النهائي',
      'المحصل',
      'المتبقي',
      'مستحق إرجاع',
    ]);
    data.rows.forEach((row) => {
      sheet.addRow([
        row.serial_number || `#${row.invoice_id}`,
        row.status_label,
        row.invoice_type_label,
        formatDailyExcelDate(row.issue_date),
        row.file_number,
        row.patient_name,
        row.phone,
        row.items_only,
        row.stay_subtotal,
        row.items_subtotal,
        row.fees,
        row.admin_expenses_percent,
        row.admin_expenses,
        row.total_after_admin,
        row.patient_credit_applied,
        row.final_total,
        row.total_collected,
        row.remaining,
        row.refundable,
      ]);
    });
    const t = data.totals;
    const totalRow = sheet.addRow([
      `الإجمالي (${t.invoice_count} فاتورة)`,
      '', '', '', '', '', '',
      t.items_only,
      t.stay_subtotal,
      t.items_subtotal,
      t.fees,
      '',
      t.admin_expenses,
      t.total_after_admin,
      '',
      t.final_total,
      t.total_collected,
      t.remaining,
      t.refundable,
    ]);
    totalRow.font = { bold: true };
  } else if (reportType === 'reconciliation') {
    const data = await getReconciliationReport(filters);
    sheet.addRow(['تقرير مطابقة الفواتير والتحصيل']);
    sheet.addRow(['من', filters.from_date || '—', 'إلى', filters.to_date || '—']);
    sheet.addRow([]);
    sheet.addRow(['عدد الفواتير', data.totals.invoice_count]);
    sheet.addRow(['متطابقة', data.totals.balanced_count]);
    sheet.addRow(['بها فروق', data.totals.mismatch_count]);
    sheet.addRow([]);
    sheet.addRow([
      'الفاتورة',
      'الملف',
      'المريض',
      'الحالة',
      'الإجمالي',
      'المحصل',
      'المتبقي',
      'فرق المعادلة',
      'مجموع طرق الدفع',
      'فرق الطرق',
      'ledger التحصيل',
      'ملاحظات',
    ]);
    data.rows.forEach((row) => {
      sheet.addRow([
        row.serial_number || `#${row.invoice_id}`,
        row.file_number,
        row.patient_name,
        row.status_label,
        row.final_total,
        row.total_collected,
        row.remaining,
        row.equation_diff,
        row.method_payments_sum,
        row.method_payments_diff,
        row.collection_ledger_sum,
        (row.issues || []).join(' | '),
      ]);
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
  getInvoicesReport,
  getSuppliesMarkupReport,
  getDailyItemsReport,
  getDailyServiceReport,
  getDailyPrintReport,
  getPatientStatusReport,
  getReconciliationReport,
  getAccountSummaryReport,
  exportExcelBuffer,
  buildDailyPrintExcelBuffer,
  STATUS_LABELS,
  DAILY_ITEMS_KINDS,
  DAILY_SERVICE_REPORT_KINDS,
  resolveDailyPrintKind,
};
