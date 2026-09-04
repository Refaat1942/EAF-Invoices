/**
 * Audit log + admin alerts UI (settings.* permission).
 */
(function () {
  const API = '/api/audit';
  let alertPollTimer = null;

  function canAudit() {
    return typeof can === 'function' && can('settings.*');
  }

  function fmtDateTime(value) {
    if (!value) return '—';
    try {
      return new Date(value).toLocaleString('ar-EG');
    } catch {
      return value;
    }
  }

  function severityBadge(sev) {
    const map = {
      danger: 'bg-danger',
      warning: 'bg-warning text-dark',
      info: 'bg-info text-dark',
      success: 'bg-success',
    };
    return `<span class="badge ${map[sev] || 'bg-secondary'}">${sev || 'info'}</span>`;
  }

  async function refreshAlertBadge() {
    const btn = document.getElementById('nav-alerts-btn');
    const badge = document.getElementById('nav-alerts-badge');
    if (!btn || !badge || !canAudit()) {
      if (btn) btn.style.display = 'none';
      return;
    }
    btn.style.display = '';
    try {
      const res = await apiFetch(`${API}/alerts/count`);
      const data = await res.json();
      const count = Number(data.count) || 0;
      badge.textContent = count > 99 ? '99+' : String(count);
      badge.style.display = count > 0 ? '' : 'none';
    } catch {
      badge.style.display = 'none';
    }
  }

  async function loadAlertsPanel() {
    const body = document.getElementById('audit-alerts-body');
    if (!body) return;
    body.innerHTML = '<tr><td colspan="4" class="text-muted text-center">جاري التحميل...</td></tr>';
    try {
      const res = await apiFetch(`${API}/alerts?limit=50`);
      const data = await res.json();
      const rows = data.rows || [];
      if (!rows.length) {
        body.innerHTML = '<tr><td colspan="4" class="text-muted text-center">لا توجد تنبيهات</td></tr>';
        return;
      }
      body.innerHTML = rows
        .map(
          (row) => `
        <tr class="${row.is_read ? '' : 'table-warning'}">
          <td>${severityBadge(row.severity)}</td>
          <td class="fw-bold">${escapeHtml(row.title)}</td>
          <td>${escapeHtml(row.message)}</td>
          <td class="text-nowrap">
            ${fmtDateTime(row.created_at)}
            ${
              !row.is_read
                ? `<button type="button" class="btn btn-sm btn-outline-primary ms-1 audit-mark-read" data-id="${row.id}">تم</button>`
                : ''
            }
          </td>
        </tr>`
        )
        .join('');
      body.querySelectorAll('.audit-mark-read').forEach((btn) => {
        btn.addEventListener('click', async () => {
          await apiFetch(`${API}/alerts/${btn.dataset.id}/read`, { method: 'POST' });
          await loadAlertsPanel();
          await refreshAlertBadge();
        });
      });
    } catch (err) {
      body.innerHTML = `<tr><td colspan="4" class="text-danger">${escapeHtml(err.message)}</td></tr>`;
    }
  }

  async function loadAuditLogsPanel() {
    const body = document.getElementById('audit-logs-body');
    const search = document.getElementById('audit-log-search')?.value?.trim() || '';
    if (!body) return;
    body.innerHTML = '<tr><td colspan="5" class="text-muted text-center">جاري التحميل...</td></tr>';
    try {
      const qs = new URLSearchParams({ limit: '80' });
      if (search) qs.set('q', search);
      const res = await apiFetch(`${API}/logs?${qs}`);
      const data = await res.json();
      const rows = data.rows || [];
      if (!rows.length) {
        body.innerHTML = '<tr><td colspan="5" class="text-muted text-center">لا توجد سجلات</td></tr>';
        return;
      }
      body.innerHTML = rows
        .map(
          (row) => `
        <tr>
          <td class="text-nowrap small">${fmtDateTime(row.created_at)}</td>
          <td>${escapeHtml(row.user_name || '—')}</td>
          <td><code>${escapeHtml(row.action)}</code></td>
          <td>${escapeHtml(row.entity_label || row.entity_type || '—')}</td>
          <td class="small text-muted">${escapeHtml(JSON.stringify(row.details || {}))}</td>
        </tr>`
        )
        .join('');
    } catch (err) {
      body.innerHTML = `<tr><td colspan="5" class="text-danger">${escapeHtml(err.message)}</td></tr>`;
    }
  }

  function bindAuditSection() {
    document.getElementById('audit-run-health-btn')?.addEventListener('click', async () => {
      try {
        const res = await apiFetch(`${API}/health-check`, { method: 'POST' });
        const data = await res.json();
        showToast(`فحص النظام: ${data.created} تنبيه جديد`, 'info');
        await loadAlertsPanel();
        await refreshAlertBadge();
      } catch (err) {
        showToast(err.message, 'danger');
      }
    });
    document.getElementById('audit-mark-all-read-btn')?.addEventListener('click', async () => {
      await apiFetch(`${API}/alerts/read-all`, { method: 'POST' });
      await loadAlertsPanel();
      await refreshAlertBadge();
    });
    document.getElementById('audit-refresh-btn')?.addEventListener('click', async () => {
      await loadAlertsPanel();
      await loadAuditLogsPanel();
      await refreshAlertBadge();
    });
    document.getElementById('audit-log-search-btn')?.addEventListener('click', () => loadAuditLogsPanel());
    document.getElementById('audit-log-search')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') loadAuditLogsPanel();
    });
    document.getElementById('nav-alerts-btn')?.addEventListener('click', () => {
      switchView('settings', { keepForm: true });
      showSettingsSection('audit-monitor');
    });
  }

  window.initAuditAdmin = function initAuditAdmin() {
    if (!canAudit()) return;
    bindAuditSection();
    refreshAlertBadge();
    apiFetch(`${API}/health-check`, { method: 'POST' }).catch(() => {});
    if (alertPollTimer) clearInterval(alertPollTimer);
    alertPollTimer = setInterval(refreshAlertBadge, 60000);
  };

  window.loadAuditMonitorSection = function loadAuditMonitorSection() {
    if (!canAudit()) return;
    loadAlertsPanel();
    loadAuditLogsPanel();
    refreshAlertBadge();
  };
})();
