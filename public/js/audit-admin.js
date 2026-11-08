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
    if (typeof window.refreshNotificationBadge === 'function') {
      return window.refreshNotificationBadge();
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
        <tr class="audit-alert-row ${row.is_read ? '' : 'table-warning'}" data-id="${row.id}" data-entity-type="${escapeHtml(row.entity_type || '')}" data-entity-id="${escapeHtml(row.entity_id || '')}" data-alert-type="${escapeHtml(row.alert_type || '')}" style="cursor:pointer" title="فتح">
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
        btn.addEventListener('click', async (e) => {
          e.stopPropagation();
          await apiFetch(`${API}/alerts/${btn.dataset.id}/read`, { method: 'POST' });
          await loadAlertsPanel();
          await refreshAlertBadge();
        });
      });
      body.querySelectorAll('.audit-alert-row').forEach((row) => {
        row.addEventListener('click', async () => {
          if (typeof window.openAlertTarget === 'function') {
            await window.openAlertTarget({
              id: Number(row.dataset.id),
              is_read: !row.classList.contains('table-warning'),
              entity_type: row.dataset.entityType,
              entity_id: row.dataset.entityId,
              alert_type: row.dataset.alertType,
            });
            await loadAlertsPanel();
            return;
          }
          if (typeof window.navigateFromAlert === 'function') {
            await window.navigateFromAlert({
              entity_type: row.dataset.entityType,
              entity_id: row.dataset.entityId,
              alert_type: row.dataset.alertType,
            });
          }
        });
      });
    } catch (err) {
      body.innerHTML = `<tr><td colspan="4" class="text-danger">${escapeHtml(err.message)}</td></tr>`;
    }
  }

  const AUDIT_ACTION_LABELS = {
    'invoice.approve': 'اعتماد الفاتورة',
    'invoice.reopen': 'إعادة فتح فاتورة معتمدة',
    'invoice.return': 'إرجاع الفاتورة للموظف للتصحيح',
    'invoice.delete': 'حذف فاتورة',
    'patient.balance_adjust': 'تعديل رصيد المريض',
  };

  function auditActionLabel(row) {
    return row.details?.action_label || AUDIT_ACTION_LABELS[row.action] || row.action;
  }

  function auditDetailsText(d = {}) {
    if (!d || typeof d !== 'object') return '';
    const parts = [];
    if (Array.isArray(d.sections) && d.sections.length && !Array.isArray(d.changes)) parts.push(`الأقسام: ${d.sections.join('، ')}`);
    if (Array.isArray(d.dates) && d.dates.length) parts.push(`التاريخ: ${d.dates.join('، ')}`);
    if (d.items_count) parts.push(`عدد البنود: ${d.items_count}`);
    if (d.room) parts.push(`الغرفة: ${d.room}`);
    if (d.status_before) parts.push(`الحالة قبل: ${d.status_before}`);
    if (d.note) parts.push(`ملاحظة: ${d.note}`);
    if (d.reason) parts.push(`السبب: ${d.reason}`);
    if (d.name) parts.push(d.name);
    const head = parts.length ? escapeHtml(parts.join(' | ')) : '';
    const changes = Array.isArray(d.changes) ? d.changes : [];
    if (!changes.length) return head;
    return `${head}<ul class="mb-0 mt-1 ps-3 text-body">${changes
      .map((c) => `<li class="${/^حذف/.test(c) ? 'text-danger' : /^عدّل/.test(c) ? 'text-warning-emphasis' : 'text-success'}">${escapeHtml(c)}</li>`)
      .join('')}</ul>`;
  }

  async function loadAuditLogsPanel() {
    const body = document.getElementById('audit-logs-body');
    const search = document.getElementById('audit-log-search')?.value?.trim() || '';
    if (!body) return;
    body.innerHTML = '<tr><td colspan="6" class="text-muted text-center">جاري التحميل...</td></tr>';
    try {
      const qs = new URLSearchParams({ limit: '80' });
      if (search) qs.set('q', search);
      const res = await apiFetch(`${API}/logs?${qs}`);
      const data = await res.json();
      const rows = data.rows || [];
      if (!rows.length) {
        body.innerHTML = '<tr><td colspan="6" class="text-muted text-center">لا توجد سجلات</td></tr>';
        return;
      }
      body.innerHTML = rows
        .map(
          (row) => `
        <tr>
          <td class="text-nowrap small">${fmtDateTime(row.created_at)}</td>
          <td>${escapeHtml(row.user_name || '—')}</td>
          <td class="fw-bold">${escapeHtml(auditActionLabel(row))}</td>
          <td>${escapeHtml(row.details?.screen || '—')}</td>
          <td>${escapeHtml(row.entity_label || row.entity_type || '—')}</td>
          <td class="small text-muted">${auditDetailsText(row.details)}</td>
        </tr>`
        )
        .join('');
    } catch (err) {
      body.innerHTML = `<tr><td colspan="6" class="text-danger">${escapeHtml(err.message)}</td></tr>`;
    }
  }

  function bindAuditSection() {
    document.getElementById('audit-run-health-btn')?.addEventListener('click', async () => {
      try {
        const res = await apiFetch(`${API}/health-check`, { method: 'POST' });
        const data = await res.json();
        const orphanMsg = data.orphaned_cleaned ? ` — أُزيل ${data.orphaned_cleaned} تنبيه يتيم` : '';
        showToast(`فحص النظام: ${data.created} تنبيه جديد${orphanMsg}`, 'info');
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
  }

  window.initAuditAdmin = function initAuditAdmin() {
    if (!canAudit()) return;
    if (!window.__eafAuditBound) {
      window.__eafAuditBound = true;
      bindAuditSection();
    }
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
