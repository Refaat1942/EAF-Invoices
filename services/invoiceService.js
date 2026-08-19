const { v4: uuidv4 } = require('uuid');
const { query, withTransaction } = require('../database/db');
const { calculateInvoiceTotals, calculateStayDays } = require('./calculations');
const { nextSerialNumber } = require('./serialService');
const { generateFilePassword } = require('./passwordService');

const INVOICE_TYPES = {
  civil: 'مدني (خاص)',
  contracted: 'جهات متعاقدة',
  non_contracted: 'جهات غير متعاقدة',
  military: 'عسكري',
};

async function getInvoiceById(id) {
  const { rows } = await query('SELECT * FROM invoices WHERE id = $1', [id]);
  if (!rows.length) return null;
  const invoice = rows[0];

  const items = await query(
    'SELECT * FROM invoice_items WHERE invoice_id = $1 ORDER BY sort_order, id',
    [id]
  );
  const payments = await query(
    'SELECT * FROM invoice_payments WHERE invoice_id = $1 ORDER BY sort_order, id',
    [id]
  );

  return {
    ...invoice,
    invoice_type_label: INVOICE_TYPES[invoice.invoice_type] || invoice.invoice_type,
    items: items.rows,
    payments: payments.rows,
  };
}

async function getInvoiceByToken(token) {
  const { rows } = await query('SELECT id FROM invoices WHERE qr_token = $1', [token]);
  if (!rows.length) return null;
  return getInvoiceById(rows[0].id);
}

async function listInvoices(filters = {}) {
  let sql = 'SELECT * FROM invoices WHERE 1=1';
  const params = [];
  let i = 1;

  if (filters.invoice_type) {
    sql += ` AND invoice_type = $${i++}`;
    params.push(filters.invoice_type);
  }
  if (filters.from_date) {
    sql += ` AND created_at::date >= $${i++}::date`;
    params.push(filters.from_date);
  }
  if (filters.to_date) {
    sql += ` AND created_at::date <= $${i++}::date`;
    params.push(filters.to_date);
  }
  if (filters.search) {
    sql += ` AND (patient_name ILIKE $${i} OR serial_number ILIKE $${i})`;
    params.push(`%${filters.search}%`);
    i++;
  }

  sql += ' ORDER BY created_at DESC';

  if (filters.limit) {
    sql += ` LIMIT $${i++}`;
    params.push(Number(filters.limit));
  }

  const { rows } = await query(sql, params);
  return rows.map((row) => ({
    ...row,
    invoice_type_label: INVOICE_TYPES[row.invoice_type] || row.invoice_type,
  }));
}

async function saveInvoice(data, existingId = null) {
  const stayDays =
    data.stay_days !== undefined && data.stay_days !== ''
      ? Number(data.stay_days)
      : calculateStayDays(data.admission_date, data.discharge_date);

  const totals = calculateInvoiceTotals({ ...data, stay_days: stayDays });

  return withTransaction(async (client) => {
    let serialNumber = data.serial_number;
    let qrToken = data.qr_token;
    let invoiceId = existingId;

    const stayTypeId = data.stay_type_id ? Number(data.stay_type_id) : null;
    let stayTypeName = data.stay_type || '';

    if (stayTypeId) {
      const st = await client.query('SELECT name FROM stay_types WHERE id = $1', [stayTypeId]);
      if (st.rows.length) stayTypeName = st.rows[0].name;
    }

    if (existingId) {
      const existing = await client.query(
        'SELECT serial_number, qr_token, file_password FROM invoices WHERE id = $1',
        [existingId]
      );
      if (!existing.rows.length) throw new Error('الفاتورة غير موجودة');

      serialNumber = existing.rows[0].serial_number;
      qrToken = existing.rows[0].qr_token;
      const filePassword =
        data.file_password !== undefined && String(data.file_password).trim()
          ? String(data.file_password).trim()
          : existing.rows[0].file_password || generateFilePassword(serialNumber);

      await client.query(
        `UPDATE invoices SET
          invoice_type = $1, patient_name = $2, admission_date = $3, discharge_date = $4,
          stay_days = $5, financial_treatment = $6, stay_type = $7, stay_type_id = $8,
          stamp_duty = $9, professional_fees = $10, items_subtotal = $11,
          admin_expenses_percent = $12, admin_expenses = $13, total_after_admin = $14,
          balance = $15, final_total = $16, cash_private = $17, bank_private = $18,
          cash_external = $19, bank_external = $20, total_collected = $21, remaining = $22,
          employee_name = $23, auditor_name = $24, captain_name = $25, manager_name = $26,
          file_password = $27, notes = $28, updated_at = NOW()
        WHERE id = $29`,
        [
          data.invoice_type,
          data.patient_name || '',
          data.admission_date || null,
          data.discharge_date || null,
          stayDays,
          data.financial_treatment || '',
          stayTypeName,
          stayTypeId,
          totals.stamp_duty,
          totals.professional_fees,
          totals.items_subtotal,
          totals.admin_expenses_percent,
          totals.admin_expenses,
          totals.total_after_admin,
          totals.balance,
          totals.final_total,
          totals.cash_private,
          totals.bank_private,
          totals.cash_external,
          totals.bank_external,
          totals.total_collected,
          totals.remaining,
          data.employee_name || '',
          data.auditor_name || '',
          data.captain_name || 'نقيب / عمرو صالح محمد',
          data.manager_name || 'رائد / جمال عبد الناصر - المدير المالي',
          filePassword,
          data.notes || '',
          existingId,
        ]
      );

      await client.query('DELETE FROM invoice_items WHERE invoice_id = $1', [existingId]);
      await client.query('DELETE FROM invoice_payments WHERE invoice_id = $1', [existingId]);
    } else {
      serialNumber = await nextSerialNumber(client);
      qrToken = uuidv4();
      const filePassword =
        data.file_password !== undefined && String(data.file_password).trim()
          ? String(data.file_password).trim()
          : generateFilePassword(serialNumber);

      const inserted = await client.query(
        `INSERT INTO invoices (
          serial_number, invoice_type, patient_name, admission_date, discharge_date,
          stay_days, financial_treatment, stay_type, stay_type_id, stamp_duty, professional_fees,
          items_subtotal, admin_expenses_percent, admin_expenses, total_after_admin,
          balance, final_total, cash_private, bank_private, cash_external, bank_external,
          total_collected, remaining, employee_name, auditor_name, captain_name,
          manager_name, qr_token, file_password, notes
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30)
        RETURNING id`,
        [
          serialNumber,
          data.invoice_type,
          data.patient_name || '',
          data.admission_date || null,
          data.discharge_date || null,
          stayDays,
          data.financial_treatment || '',
          stayTypeName,
          stayTypeId,
          totals.stamp_duty,
          totals.professional_fees,
          totals.items_subtotal,
          totals.admin_expenses_percent,
          totals.admin_expenses,
          totals.total_after_admin,
          totals.balance,
          totals.final_total,
          totals.cash_private,
          totals.bank_private,
          totals.cash_external,
          totals.bank_external,
          totals.total_collected,
          totals.remaining,
          data.employee_name || '',
          data.auditor_name || '',
          data.captain_name || 'نقيب / عمرو صالح محمد',
          data.manager_name || 'رائد / جمال عبد الناصر - المدير المالي',
          qrToken,
          filePassword,
          data.notes || '',
        ]
      );

      invoiceId = inserted.rows[0].id;
    }

    for (let index = 0; index < totals.items.length; index++) {
      const item = totals.items[index];
      await client.query(
        `INSERT INTO invoice_items (invoice_id, description, quantity, amount, total, sort_order)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [invoiceId, item.description || '', item.quantity || 0, item.amount || 0, item.total || 0, index]
      );
    }

    for (let index = 0; index < totals.payments.length; index++) {
      const payment = totals.payments[index];
      await client.query(
        `INSERT INTO invoice_payments (invoice_id, receipt_date, receipt_number, amount, sort_order)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          invoiceId,
          payment.receipt_date || null,
          payment.receipt_number || '',
          payment.amount || 0,
          index,
        ]
      );
    }

    return getInvoiceById(invoiceId);
  });
}

async function deleteInvoice(id) {
  const { rowCount } = await query('DELETE FROM invoices WHERE id = $1', [id]);
  return rowCount > 0;
}

async function getReportsSummary(filters = {}) {
  const invoices = await listInvoices(filters);

  const byType = {};
  Object.keys(INVOICE_TYPES).forEach((key) => {
    byType[key] = { count: 0, total: 0, collected: 0, remaining: 0, label: INVOICE_TYPES[key] };
  });

  let grandTotal = 0;
  let grandCollected = 0;
  let grandRemaining = 0;

  invoices.forEach((inv) => {
    if (!byType[inv.invoice_type]) {
      byType[inv.invoice_type] = {
        count: 0,
        total: 0,
        collected: 0,
        remaining: 0,
        label: INVOICE_TYPES[inv.invoice_type] || inv.invoice_type,
      };
    }
    byType[inv.invoice_type].count += 1;
    byType[inv.invoice_type].total += Number(inv.final_total) || 0;
    byType[inv.invoice_type].collected += Number(inv.total_collected) || 0;
    byType[inv.invoice_type].remaining += Number(inv.remaining) || 0;

    grandTotal += Number(inv.final_total) || 0;
    grandCollected += Number(inv.total_collected) || 0;
    grandRemaining += Number(inv.remaining) || 0;
  });

  const monthlyResult = await query(`
    SELECT to_char(created_at, 'YYYY-MM') AS month,
           COUNT(*)::int AS count,
           COALESCE(SUM(final_total), 0) AS total,
           COALESCE(SUM(total_collected), 0) AS collected,
           COALESCE(SUM(remaining), 0) AS remaining
    FROM invoices
    GROUP BY to_char(created_at, 'YYYY-MM')
    ORDER BY month DESC
    LIMIT 12
  `);

  return {
    total_invoices: invoices.length,
    grand_total: Math.round(grandTotal * 100) / 100,
    grand_collected: Math.round(grandCollected * 100) / 100,
    grand_remaining: Math.round(grandRemaining * 100) / 100,
    by_type: byType,
    monthly: monthlyResult.rows,
    recent: invoices.slice(0, 10),
  };
}

module.exports = {
  INVOICE_TYPES,
  getInvoiceById,
  getInvoiceByToken,
  listInvoices,
  saveInvoice,
  deleteInvoice,
  getReportsSummary,
};
