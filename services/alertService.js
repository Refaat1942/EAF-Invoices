const { query } = require('../database/db');
const { formatAmountAr } = require('./amountFormat');

async function createAlert(alert = {}, client = null) {
  const run = client ? client.query.bind(client) : query;
  const alertType = String(alert.alert_type || 'general').slice(0, 64);
  const entityType = alert.entity_type ? String(alert.entity_type).slice(0, 64) : null;
  const entityId = alert.entity_id != null ? String(alert.entity_id) : null;

  const recent = await run(
    `SELECT id FROM system_alerts
     WHERE alert_type = $1
       AND COALESCE(entity_type, '') = COALESCE($2, '')
       AND COALESCE(entity_id, '') = COALESCE($3, '')
       AND is_read = FALSE
       AND created_at > NOW() - INTERVAL '24 hours'
     LIMIT 1`,
    [alertType, entityType, entityId]
  );
  if (recent.rows.length) return recent.rows[0];

  const { rows } = await run(
    `INSERT INTO system_alerts (alert_type, severity, title, message, entity_type, entity_id, details)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
     RETURNING *`,
    [
      alertType,
      String(alert.severity || 'warning').slice(0, 16),
      String(alert.title || 'تنبيه').slice(0, 300),
      String(alert.message || '').slice(0, 2000),
      entityType,
      entityId,
      JSON.stringify(alert.details && typeof alert.details === 'object' ? alert.details : {}),
    ]
  );
  return rows[0];
}

async function listAlerts(filters = {}) {
  const limit = Math.min(Math.max(Number(filters.limit) || 30, 1), 100);
  const offset = Math.max(Number(filters.offset) || 0, 0);
  const params = [];
  const where = [];

  if (filters.unread_only === true || filters.unread_only === 'true') {
    where.push('is_read = FALSE');
  }
  if (filters.severity) {
    params.push(String(filters.severity));
    where.push(`severity = $${params.length}`);
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const countRes = await query(
    `SELECT COUNT(*)::int AS total FROM system_alerts ${whereSql}`,
    params
  );
  params.push(limit, offset);
  const { rows } = await query(
    `SELECT id, created_at, alert_type, severity, title, message, entity_type, entity_id, is_read, read_at, details
     FROM system_alerts
     ${whereSql}
     ORDER BY is_read ASC, created_at DESC, id DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );

  return {
    rows,
    total: countRes.rows[0]?.total || 0,
    limit,
    offset,
  };
}

async function getUnreadAlertCount() {
  const { rows } = await query(`SELECT COUNT(*)::int AS c FROM system_alerts WHERE is_read = FALSE`);
  return rows[0]?.c || 0;
}

async function markAlertRead(id, userId = null) {
  const { rows } = await query(
    `UPDATE system_alerts
     SET is_read = TRUE, read_at = NOW(), read_by_user_id = $2
     WHERE id = $1
     RETURNING *`,
    [Number(id), userId || null]
  );
  return rows[0] || null;
}

async function markAllAlertsRead(userId = null) {
  await query(
    `UPDATE system_alerts
     SET is_read = TRUE, read_at = NOW(), read_by_user_id = $1
     WHERE is_read = FALSE`,
    [userId || null]
  );
}

function cashCollectedFromTotals(totals = {}) {
  const credit = Number(totals.patient_credit_applied) || 0;
  const collected = Number(totals.total_collected) || 0;
  return Math.max(0, Math.round((collected - credit) * 100) / 100);
}

async function evaluateInvoiceAlerts(invoice = {}, totals = {}) {
  const alerts = [];
  const invoiceId = invoice.id;
  const label = `فاتورة #${invoiceId} — ${invoice.patient_name || ''} (${invoice.file_number || ''})`;
  const finalTotal = Number(totals.final_total ?? invoice.final_total) || 0;
  const collected = Number(totals.total_collected ?? invoice.total_collected) || 0;
  const credit = Number(totals.patient_credit_applied ?? invoice.patient_credit_applied) || 0;
  const cashCollected = cashCollectedFromTotals(totals.total_collected != null ? totals : invoice);
  const validation = totals.payment_validation;

  if (validation?.has_payments && !validation?.is_balanced) {
    const diff = Math.abs(Number(validation.difference_raw ?? validation.difference) || 0);
    alerts.push(
      await createAlert({
        alert_type: 'invoice_payment_imbalance',
        severity: 'danger',
        title: 'فاتورة غير متوازنة',
        message: `${label}: فرق في المدفوعات ${formatAmountAr(diff)}`,
        entity_type: 'invoice',
        entity_id: String(invoiceId),
        details: { final_total: finalTotal, total_collected: collected, difference: diff },
      })
    );
  }

  if (collected > 0.009 && credit > 0.009 && cashCollected < 0.01) {
    alerts.push(
      await createAlert({
        alert_type: 'invoice_credit_only_collection',
        severity: 'warning',
        title: 'تحصيل من رصيد المريض فقط',
        message: `${label}: المحصل بالكامل (${formatAmountAr(collected)}) من خصم رصيد المريض — بدون نقدي/تحويل`,
        entity_type: 'invoice',
        entity_id: String(invoiceId),
        details: { total_collected: collected, patient_credit_applied: credit },
      })
    );
  }

  if (invoice.status === 'pending_review' && finalTotal > 0 && collected < 0.01) {
    alerts.push(
      await createAlert({
        alert_type: 'invoice_pending_no_payment',
        severity: 'info',
        title: 'فاتورة مرسلة بدون مدفوعات',
        message: `${label}: أُرسلت للمراجعة ولم تُسجَّل مدفوعات بعد`,
        entity_type: 'invoice',
        entity_id: String(invoiceId),
        details: { final_total: finalTotal },
      })
    );
  }

  return alerts.filter(Boolean);
}

async function runSystemHealthChecks() {
  const created = [];

  const pendingRes = await query(
    `SELECT COUNT(*)::int AS c FROM invoices WHERE status = 'pending_review'`
  );
  const pending = pendingRes.rows[0]?.c || 0;
  if (pending > 0) {
    created.push(
      await createAlert({
        alert_type: 'pending_review_count',
        severity: 'info',
        title: 'فواتير بانتظار المراجعة',
        message: `يوجد ${pending} فاتورة بانتظار الاعتماد`,
        entity_type: 'system',
        entity_id: 'pending_review',
        details: { count: pending },
      })
    );
  }

  const negativeRes = await query(
    `SELECT file_number, name, account_balance FROM patients WHERE account_balance < 0 ORDER BY account_balance ASC LIMIT 5`
  );
  for (const row of negativeRes.rows) {
    created.push(
      await createAlert({
        alert_type: 'patient_negative_balance',
        severity: 'warning',
        title: 'رصيد مريض سالب',
        message: `المريض ${row.name || row.file_number} (${row.file_number}): رصيد ${formatAmountAr(row.account_balance)}`,
        entity_type: 'patient',
        entity_id: String(row.file_number),
        details: { account_balance: row.account_balance },
      })
    );
  }

  return created.filter(Boolean);
}

module.exports = {
  createAlert,
  listAlerts,
  getUnreadAlertCount,
  markAlertRead,
  markAllAlertsRead,
  evaluateInvoiceAlerts,
  runSystemHealthChecks,
};
