const { getSummaryReport, getSuppliesMarkupReport } = require('./reportService');
const { getUnreadAlertCount } = require('./alertService');
const { query } = require('../database/db');

async function getAnalyticsDashboard(filters = {}) {
  const summary = await getSummaryReport(filters);
  const suppliesReport = await getSuppliesMarkupReport(filters);
  const suppliesTotals = suppliesReport.totals || {};

  const patientsRes = await query(
    `SELECT COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE account_balance < 0)::int AS negative,
            COALESCE(SUM(account_balance), 0) AS balance_sum
     FROM patients`
  );
  const patients = patientsRes.rows[0] || {};

  const dailyRes = await query(
    `SELECT COUNT(DISTINCT pde.patient_id)::int AS patients_with_entries,
            COUNT(*)::int AS entry_lines
     FROM patient_daily_entry_lines l
     JOIN patient_daily_entries pde ON pde.id = l.daily_entry_id
     WHERE ($1::date IS NULL OR pde.entry_date >= $1::date)
       AND ($2::date IS NULL OR pde.entry_date <= $2::date)`,
    [filters.from_date || null, filters.to_date || null]
  );
  const daily = dailyRes.rows[0] || {};

  const pending = (summary.pending_counts || []).reduce((acc, row) => {
    acc[row.status] = row.count;
    return acc;
  }, {});

  return {
    filters,
    kpis: {
      total_invoices: summary.total_invoices,
      grand_total: summary.grand_total,
      grand_collected: summary.grand_collected,
      grand_remaining: summary.grand_remaining,
      patient_credit_total: summary.patient_credit_total,
      supplies_margin: Math.round((Number(suppliesTotals.total_margin) || 0) * 100) / 100,
      supplies_cost: Math.round((Number(suppliesTotals.total_cost) || 0) * 100) / 100,
      supplies_selling: Math.round((Number(suppliesTotals.total_selling) || 0) * 100) / 100,
      patients_total: patients.total || 0,
      patients_negative_balance: patients.negative || 0,
      patients_balance_sum: Math.round((Number(patients.balance_sum) || 0) * 100) / 100,
      daily_patients: daily.patients_with_entries || 0,
      daily_entry_lines: daily.entry_lines || 0,
      draft_invoices: pending.draft || 0,
      pending_review_invoices: pending.pending_review || 0,
      unread_alerts: await getUnreadAlertCount(),
    },
    by_type: summary.by_type,
    monthly: summary.monthly || [],
    recent_invoices: summary.recent || [],
  };
}

module.exports = { getAnalyticsDashboard };
