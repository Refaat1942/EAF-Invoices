const { query } = require('../database/db');
const { listInvoices } = require('./invoiceService');
const { listAuditLogs } = require('./auditLogService');

const ACTION_LABELS = {
  'invoice.create': 'إنشاء فاتورة',
  'invoice.update': 'تحديث فاتورة',
  'invoice.submit': 'إرسال للمراجعة',
  'invoice.approve': 'اعتماد فاتورة',
  'invoice.delete': 'حذف فاتورة',
  'patient.balance_adjust': 'تعديل رصيد مريض',
};

function actionLabel(action) {
  return ACTION_LABELS[String(action || '').trim()] || String(action || 'نشاط');
}

function minutesAgo(dateValue) {
  if (!dateValue) return null;
  const d = new Date(dateValue);
  if (Number.isNaN(d.getTime())) return null;
  return Math.max(0, Math.round((Date.now() - d.getTime()) / 60000));
}

function userPresenceLabel(lastActionAt, lastLogin) {
  const actionMins = minutesAgo(lastActionAt);
  const loginMins = minutesAgo(lastLogin);
  const mins = actionMins != null && loginMins != null ? Math.min(actionMins, loginMins) : actionMins ?? loginMins;
  if (mins == null) return 'غير متصل';
  if (mins <= 5) return 'نشط الآن';
  if (mins <= 30) return `منذ ${mins} د`;
  if (mins <= 120) return `منذ ${Math.round(mins / 60)} س`;
  return 'غير نشط';
}

async function getLiveActivity({ hours = 24, limit = 100 } = {}) {
  const windowHours = Math.min(Math.max(Number(hours) || 24, 1), 72);
  const maxEvents = Math.min(Math.max(Number(limit) || 100, 20), 200);

  const usersRes = await query(
    `SELECT
       u.id,
       u.username,
       u.full_name,
       u.last_login,
       u.is_active,
       COALESCE(draft_counts.c, 0)::int AS draft_invoices,
       COALESCE(pending_counts.c, 0)::int AS pending_invoices,
       last_log.action AS last_action,
       last_log.created_at AS last_action_at,
       last_log.entity_label AS last_entity_label,
       COALESCE(hour_counts.c, 0)::int AS actions_last_hour
     FROM users u
     LEFT JOIN LATERAL (
       SELECT COUNT(*)::int AS c FROM invoices i
       WHERE i.created_by_user_id = u.id AND i.status = 'draft'
     ) draft_counts ON TRUE
     LEFT JOIN LATERAL (
       SELECT COUNT(*)::int AS c FROM invoices i
       WHERE i.created_by_user_id = u.id AND i.status = 'pending_review'
     ) pending_counts ON TRUE
     LEFT JOIN LATERAL (
       SELECT al.action, al.created_at, al.entity_label
       FROM audit_logs al
       WHERE al.user_id = u.id
       ORDER BY al.created_at DESC, al.id DESC
       LIMIT 1
     ) last_log ON TRUE
     LEFT JOIN LATERAL (
       SELECT COUNT(*)::int AS c FROM audit_logs al
       WHERE al.user_id = u.id AND al.created_at > NOW() - INTERVAL '1 hour'
     ) hour_counts ON TRUE
     WHERE u.is_active = TRUE
     ORDER BY last_log.created_at DESC NULLS LAST, u.last_login DESC NULLS LAST, u.full_name, u.username`
  );

  const users = usersRes.rows.map((row) => ({
    ...row,
    display_name: row.full_name || row.username || 'مستخدم',
    last_action_label: actionLabel(row.last_action),
    presence: userPresenceLabel(row.last_action_at, row.last_login),
    is_live: minutesAgo(row.last_action_at) != null && minutesAgo(row.last_action_at) <= 15,
  }));

  const since = new Date(Date.now() - windowHours * 60 * 60 * 1000).toISOString();
  const eventsResult = await listAuditLogs({ from: since, limit: maxEvents, offset: 0 });
  const events = (eventsResult.rows || []).map((row) => ({
    ...row,
    action_label: actionLabel(row.action),
  }));

  const workloadRes = await query(
    `SELECT
       (SELECT COUNT(*)::int FROM invoices WHERE status = 'draft') AS draft_total,
       (SELECT COUNT(*)::int FROM invoices WHERE status = 'pending_review') AS pending_total,
       (SELECT COUNT(*)::int FROM patient_daily_entries WHERE entry_date = CURRENT_DATE) AS daily_entries_today,
       (SELECT COUNT(DISTINCT file_number)::int FROM patient_daily_entries WHERE entry_date = CURRENT_DATE) AS patients_with_daily_today`
  );

  return {
    generated_at: new Date().toISOString(),
    window_hours: windowHours,
    users,
    events,
    workload: workloadRes.rows[0] || {},
    live_users_count: users.filter((u) => u.is_live).length,
  };
}

async function getApprovalsQueue({ limit = 200 } = {}) {
  const maxLimit = Math.min(Math.max(Number(limit) || 200, 1), 500);
  const pending = await listInvoices({ status: 'pending_review', limit: maxLimit });

  const summaryRes = await query(
    `SELECT
       COUNT(*) FILTER (WHERE status = 'pending_review')::int AS pending_review,
       COUNT(*) FILTER (WHERE status = 'draft')::int AS draft,
       COUNT(*) FILTER (WHERE status = 'approved')::int AS approved
     FROM invoices`
  );
  const summary = summaryRes.rows[0] || { pending_review: 0, draft: 0, approved: 0 };

  const mapQueueRow = (inv) => ({
    id: inv.id,
    file_number: inv.file_number,
    patient_name: inv.patient_name,
    patient_phone: inv.patient_phone,
    invoice_type: inv.invoice_type,
    invoice_type_label: inv.invoice_type_label,
    status: inv.status,
    status_label: inv.status_label,
    final_total: inv.final_total,
    total_collected: inv.total_collected,
    remaining: inv.remaining,
    submitted_at: inv.submitted_at,
    updated_at: inv.updated_at,
    created_at: inv.created_at,
    created_by_name: inv.created_by_name,
    contracted_entity_name: inv.contracted_entity_name,
    display_number: inv.serial_number || `#${inv.id}`,
  });

  const rows = pending.map(mapQueueRow);
  const draftInvoices = await listInvoices({ status: 'draft', limit: maxLimit });
  const draft_rows = draftInvoices.map(mapQueueRow);

  return {
    generated_at: new Date().toISOString(),
    summary,
    rows,
    draft_rows,
    policy:
      'سايكل الاعتماد: مسودة → إرسال للمراجعة → اعتماد نهائي (يُمنح الرقم التسلسلي). الفواتير أدناه بانتظار الاعتماد.',
  };
}

async function getApprovalsCount() {
  const { rows } = await query(
    `SELECT COUNT(*)::int AS c FROM invoices WHERE status = 'pending_review'`
  );
  return rows[0]?.c || 0;
}

module.exports = {
  getLiveActivity,
  getApprovalsQueue,
  getApprovalsCount,
  actionLabel,
};
