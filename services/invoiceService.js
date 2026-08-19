const { v4: uuidv4 } = require('uuid');
const db = require('../database/db');
const { calculateInvoiceTotals, calculateStayDays } = require('../services/calculations');
const { nextSerialNumber, withTransaction } = require('../services/serialService');

const INVOICE_TYPES = {
  civil: 'مدني (خاص)',
  contracted: 'جهات متعاقدة',
  non_contracted: 'جهات غير متعاقدة',
  military: 'عسكري',
};

function getInvoiceById(id) {
  const invoice = db.prepare('SELECT * FROM invoices WHERE id = ?').get(id);
  if (!invoice) return null;

  const items = db
    .prepare('SELECT * FROM invoice_items WHERE invoice_id = ? ORDER BY sort_order, id')
    .all(id);
  const payments = db
    .prepare('SELECT * FROM invoice_payments WHERE invoice_id = ? ORDER BY sort_order, id')
    .all(id);

  return {
    ...invoice,
    invoice_type_label: INVOICE_TYPES[invoice.invoice_type] || invoice.invoice_type,
    items,
    payments,
  };
}

function getInvoiceByToken(token) {
  const invoice = db.prepare('SELECT * FROM invoices WHERE qr_token = ?').get(token);
  if (!invoice) return null;
  return getInvoiceById(invoice.id);
}

function listInvoices(filters = {}) {
  let query = 'SELECT * FROM invoices WHERE 1=1';
  const params = [];

  if (filters.invoice_type) {
    query += ' AND invoice_type = ?';
    params.push(filters.invoice_type);
  }
  if (filters.from_date) {
    query += ' AND date(created_at) >= date(?)';
    params.push(filters.from_date);
  }
  if (filters.to_date) {
    query += ' AND date(created_at) <= date(?)';
    params.push(filters.to_date);
  }
  if (filters.search) {
    query += ' AND (patient_name LIKE ? OR serial_number LIKE ?)';
    const term = `%${filters.search}%`;
    params.push(term, term);
  }

  query += ' ORDER BY created_at DESC';

  if (filters.limit) {
    query += ' LIMIT ?';
    params.push(Number(filters.limit));
  }

  const rows = db.prepare(query).all(...params);
  return rows.map((row) => ({
    ...row,
    invoice_type_label: INVOICE_TYPES[row.invoice_type] || row.invoice_type,
  }));
}

function saveInvoice(data, existingId = null) {
  const stayDays =
    data.stay_days !== undefined && data.stay_days !== ''
      ? Number(data.stay_days)
      : calculateStayDays(data.admission_date, data.discharge_date);

  const totals = calculateInvoiceTotals({ ...data, stay_days: stayDays });

  const transaction = () =>
    withTransaction(() => {
      let serialNumber = data.serial_number;
      let qrToken = data.qr_token;
      let invoiceId = existingId;

      if (existingId) {
      const existing = db.prepare('SELECT serial_number, qr_token FROM invoices WHERE id = ?').get(existingId);
      if (!existing) throw new Error('الفاتورة غير موجودة');
      serialNumber = existing.serial_number;
      qrToken = existing.qr_token;

      db.prepare(`
        UPDATE invoices SET
          invoice_type = ?, patient_name = ?, admission_date = ?, discharge_date = ?,
          stay_days = ?, financial_treatment = ?, stay_type = ?,
          stamp_duty = ?, professional_fees = ?, items_subtotal = ?,
          admin_expenses_percent = ?, admin_expenses = ?, total_after_admin = ?,
          balance = ?, final_total = ?, cash_private = ?, bank_private = ?,
          cash_external = ?, bank_external = ?, total_collected = ?, remaining = ?,
          employee_name = ?, auditor_name = ?, captain_name = ?, manager_name = ?,
          notes = ?, updated_at = datetime('now', 'localtime')
        WHERE id = ?
      `).run(
        data.invoice_type,
        data.patient_name || '',
        data.admission_date || '',
        data.discharge_date || '',
        stayDays,
        data.financial_treatment || '',
        data.stay_type || '',
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
        data.notes || '',
        existingId
      );

      db.prepare('DELETE FROM invoice_items WHERE invoice_id = ?').run(existingId);
      db.prepare('DELETE FROM invoice_payments WHERE invoice_id = ?').run(existingId);
    } else {
      serialNumber = nextSerialNumber();
      qrToken = uuidv4();

      const insertStmt = db.prepare(`
        INSERT INTO invoices (
          serial_number, invoice_type, patient_name, admission_date, discharge_date,
          stay_days, financial_treatment, stay_type, stamp_duty, professional_fees,
          items_subtotal, admin_expenses_percent, admin_expenses, total_after_admin,
          balance, final_total, cash_private, bank_private, cash_external, bank_external,
          total_collected, remaining, employee_name, auditor_name, captain_name,
          manager_name, qr_token, notes
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      const insertResult = insertStmt.run(
        serialNumber,
        data.invoice_type,
        data.patient_name || '',
        data.admission_date || '',
        data.discharge_date || '',
        stayDays,
        data.financial_treatment || '',
        data.stay_type || '',
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
        data.notes || ''
      );

      invoiceId = Number(insertResult.lastInsertRowid);
    }

    const insertItem = db.prepare(`
      INSERT INTO invoice_items (invoice_id, description, quantity, amount, total, sort_order)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    totals.items.forEach((item, index) => {
      insertItem.run(
        invoiceId,
        item.description || '',
        item.quantity || 0,
        item.amount || 0,
        item.total || 0,
        index
      );
    });

    const insertPayment = db.prepare(`
      INSERT INTO invoice_payments (invoice_id, receipt_date, receipt_number, amount, sort_order)
      VALUES (?, ?, ?, ?, ?)
    `);

    totals.payments.forEach((payment, index) => {
      insertPayment.run(
        invoiceId,
        payment.receipt_date || '',
        payment.receipt_number || '',
        payment.amount || 0,
        index
      );
    });

    return getInvoiceById(invoiceId);
    });

  return transaction();
}

function deleteInvoice(id) {
  const result = db.prepare('DELETE FROM invoices WHERE id = ?').run(id);
  return result.changes > 0;
}

function getReportsSummary(filters = {}) {
  const invoices = listInvoices(filters);

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
    byType[inv.invoice_type].total += inv.final_total || 0;
    byType[inv.invoice_type].collected += inv.total_collected || 0;
    byType[inv.invoice_type].remaining += inv.remaining || 0;

    grandTotal += inv.final_total || 0;
    grandCollected += inv.total_collected || 0;
    grandRemaining += inv.remaining || 0;
  });

  const monthly = db.prepare(`
    SELECT strftime('%Y-%m', created_at) as month,
           COUNT(*) as count,
           SUM(final_total) as total,
           SUM(total_collected) as collected,
           SUM(remaining) as remaining
    FROM invoices
    GROUP BY strftime('%Y-%m', created_at)
    ORDER BY month DESC
    LIMIT 12
  `).all();

  return {
    total_invoices: invoices.length,
    grand_total: Math.round(grandTotal * 100) / 100,
    grand_collected: Math.round(grandCollected * 100) / 100,
    grand_remaining: Math.round(grandRemaining * 100) / 100,
    by_type: byType,
    monthly,
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
