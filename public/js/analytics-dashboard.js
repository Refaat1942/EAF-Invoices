(function () {
  const API = '/api/analytics';

  function card(label, value, cls = '') {
    return `<div class="col-md-4 col-lg-3"><div class="analytics-kpi-card ${cls}"><div class="analytics-kpi-label">${label}</div><div class="analytics-kpi-value">${value}</div></div></div>`;
  }

  async function loadAnalyticsDashboard() {
    const grid = document.getElementById('analytics-kpi-grid');
    const monthlyBody = document.getElementById('analytics-monthly-body');
    const recentBody = document.getElementById('analytics-recent-body');
    if (!grid) return;

    const from = document.getElementById('analytics-from')?.value || '';
    const to = document.getElementById('analytics-to')?.value || '';
    grid.innerHTML = '<div class="col-12 text-muted">جاري التحميل...</div>';

    try {
      const qs = new URLSearchParams();
      if (from) qs.set('from', from);
      if (to) qs.set('to', to);
      const res = await apiFetch(`${API}/dashboard?${qs}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      const k = data.kpis || {};

      grid.innerHTML = [
        card('إجمالي الفواتير', k.total_invoices),
        card('إجمالي المبالغ', window.fmt(k.grand_total), 'is-primary'),
        card('المحصل', window.fmt(k.grand_collected), 'is-success'),
        card('متبقي الفواتير', window.fmt(k.grand_remaining), 'is-danger'),
        card('خصم من أرصدة', window.fmt(k.patient_credit_total)),
        card('هامش المستلزمات', window.fmt(k.supplies_margin), 'is-teal'),
        card('تكلفة المستلزمات', window.fmt(k.supplies_cost)),
        card('بيع المستلزمات', window.fmt(k.supplies_selling)),
        card('مرضى برصيد سالب', k.patients_negative_balance, 'is-danger'),
        card('مسودات', k.draft_invoices),
        card('بانتظار المراجعة', k.pending_review_invoices, 'is-warning'),
        card('تنبيهات غير مقروءة', k.unread_alerts, 'is-warning'),
      ].join('');

      if (monthlyBody) {
        monthlyBody.innerHTML = (data.monthly || [])
          .map(
            (row) => `<tr>
              <td>${row.month}</td>
              <td>${row.count}</td>
              <td>${window.fmt(row.total)}</td>
              <td>${window.fmt(row.collected)}</td>
              <td class="text-danger">${window.fmt(row.remaining)}</td>
            </tr>`
          )
          .join('') || '<tr><td colspan="5" class="text-muted text-center">لا توجد بيانات</td></tr>';
      }

      if (recentBody) {
        recentBody.innerHTML = (data.recent_invoices || [])
          .map(
            (inv) => `<tr>
              <td>${inv.serial_number || '#' + inv.id}</td>
              <td>${escapeHtml(inv.patient_name || '')}</td>
              <td>${escapeHtml(inv.status_label || inv.status || '')}</td>
              <td>${window.fmt(inv.final_total)}</td>
              <td>${window.fmt(inv.total_collected)}</td>
              <td class="text-danger">${window.fmt(inv.remaining)}</td>
            </tr>`
          )
          .join('') || '<tr><td colspan="6" class="text-muted text-center">لا توجد فواتير</td></tr>';
      }
    } catch (err) {
      grid.innerHTML = `<div class="col-12 text-danger">${escapeHtml(err.message)}</div>`;
    }
  }

  function initAnalyticsDashboard() {
    const fromEl = document.getElementById('analytics-from');
    const toEl = document.getElementById('analytics-to');
    const today = new Date();
    const monthStart = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().slice(0, 10);
    if (fromEl && !fromEl.value) fromEl.value = monthStart;
    if (toEl && !toEl.value) toEl.value = today.toISOString().slice(0, 10);
    const refreshBtn = document.getElementById('analytics-refresh-btn');
    if (refreshBtn && !refreshBtn.dataset.bound) {
      refreshBtn.dataset.bound = '1';
      refreshBtn.addEventListener('click', loadAnalyticsDashboard);
    }
    loadAnalyticsDashboard();
  }

  window.initAnalyticsDashboard = initAnalyticsDashboard;
  window.loadAnalyticsDashboard = loadAnalyticsDashboard;
})();
