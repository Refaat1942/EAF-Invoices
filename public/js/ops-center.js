(() => {
  const API = '/api/audit';
  let livePollTimer = null;
  let approvalsPollTimer = null;

  function fmtDateTime(value) {
    if (!value) return '—';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return value;
    return d.toLocaleString('ar-EG');
  }

  function fmtMoney(value) {
    const n = Number(value) || 0;
    return n.toLocaleString('ar-EG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function canLive() {
    return typeof can === 'function' && can('settings.*');
  }

  function canApprovals() {
    return typeof can === 'function' && (can('invoices.approve') || can('settings.*'));
  }

  function presenceClass(presence) {
    if (presence === 'نشط الآن') return 'text-success fw-bold';
    if (presence === 'غير متصل' || presence === 'غير نشط') return 'text-muted';
    return 'text-primary';
  }

  async function refreshApprovalsBadge() {
    const badge = document.getElementById('hub-approvals-badge');
    if (!badge || !canApprovals()) return;
    try {
      const res = await apiFetch(`${API}/approvals/count`);
      const data = await res.json();
      const count = Number(data.count) || 0;
      badge.textContent = String(count);
      badge.hidden = count <= 0;
    } catch {
      badge.hidden = true;
    }
  }

  async function loadLiveActivityView() {
    if (!canLive()) return;
    const usersBody = document.getElementById('live-activity-users-body');
    const eventsBody = document.getElementById('live-activity-events-body');
    const updatedEl = document.getElementById('live-activity-updated');
    if (!usersBody || !eventsBody) return;

    try {
      const res = await apiFetch(`${API}/live-activity`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'تعذر تحميل النشاط');

      if (updatedEl) updatedEl.textContent = `آخر تحديث: ${fmtDateTime(data.generated_at)}`;
      const liveActiveEl = document.getElementById('live-stat-active');
      if (liveActiveEl) liveActiveEl.textContent = data.live_users_count ?? 0;
      const liveDraftsEl = document.getElementById('live-stat-drafts');
      if (liveDraftsEl) liveDraftsEl.textContent = data.workload?.draft_total ?? 0;
      const livePendingEl = document.getElementById('live-stat-pending');
      if (livePendingEl) livePendingEl.textContent = data.workload?.pending_total ?? 0;
      const liveDailyEl = document.getElementById('live-stat-daily');
      if (liveDailyEl) {
        liveDailyEl.textContent =
          `${data.workload?.patients_with_daily_today ?? 0} مريض / ${data.workload?.daily_entries_today ?? 0} بند`;
      }

      const users = data.users || [];
      usersBody.innerHTML = users.length
        ? users
            .map(
              (u) => `<tr>
              <td>
                <div class="fw-bold">${escapeHtml(u.display_name)}</div>
                <div class="small text-muted">${escapeHtml(u.username || '')}</div>
                <div class="small">مسودات: ${u.draft_invoices || 0} · مراجعة: ${u.pending_invoices || 0}</div>
              </td>
              <td class="${presenceClass(u.presence)}">${escapeHtml(u.presence)}</td>
              <td class="small">
                <div>${escapeHtml(u.last_action_label || '—')}</div>
                <div class="text-muted">${escapeHtml(u.last_entity_label || '—')}</div>
                <div class="text-muted">${fmtDateTime(u.last_action_at)}</div>
              </td>
            </tr>`
            )
            .join('')
        : '<tr><td colspan="3" class="text-muted text-center">لا يوجد مستخدمون</td></tr>';

      const events = data.events || [];
      eventsBody.innerHTML = events.length
        ? events
            .map(
              (ev) => `<tr>
              <td class="text-nowrap small">${fmtDateTime(ev.created_at)}</td>
              <td>${escapeHtml(ev.user_name || '—')}</td>
              <td><span class="badge bg-secondary">${escapeHtml(ev.action_label || ev.action)}</span></td>
              <td class="small">${escapeHtml(ev.entity_label || '—')}</td>
            </tr>`
            )
            .join('')
        : '<tr><td colspan="4" class="text-muted text-center">لا توجد أحداث في النافذة الزمنية</td></tr>';
    } catch (err) {
      usersBody.innerHTML = `<tr><td colspan="3" class="text-danger">${escapeHtml(err.message)}</td></tr>`;
      eventsBody.innerHTML = `<tr><td colspan="4" class="text-danger">${escapeHtml(err.message)}</td></tr>`;
    }
  }

  async function loadApprovalsView() {
    if (!canApprovals()) return;
    const body = document.getElementById('approvals-queue-body');
    const updatedEl = document.getElementById('approvals-updated');
    if (!body) return;

    try {
      const res = await apiFetch(`${API}/approvals`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'تعذر تحميل الاعتمادات');

      if (updatedEl) updatedEl.textContent = `آخر تحديث: ${fmtDateTime(data.generated_at)}`;
      const policyEl = document.getElementById('approvals-policy');
      if (policyEl) policyEl.textContent = data.policy || '';

      const summary = data.summary || {};
      const pendingCountEl = document.getElementById('approvals-pending-count');
      if (pendingCountEl) pendingCountEl.textContent = summary.pending_review ?? 0;
      const summaryPendingEl = document.getElementById('approvals-summary-pending');
      if (summaryPendingEl) summaryPendingEl.textContent = summary.pending_review ?? 0;
      const summaryDraftEl = document.getElementById('approvals-summary-draft');
      if (summaryDraftEl) summaryDraftEl.textContent = summary.draft ?? 0;
      const summaryApprovedEl = document.getElementById('approvals-summary-approved');
      if (summaryApprovedEl) summaryApprovedEl.textContent = summary.approved ?? 0;

      const rows = data.rows || [];
      const draftRows = data.draft_rows || [];
      const canApprove = typeof can === 'function' && can('invoices.approve');
      const canDelete = typeof can === 'function' && can('invoices.delete');
      body.innerHTML = rows.length
        ? rows
            .map(
              (inv) => `<tr>
              <td class="fw-bold">${escapeHtml(inv.display_number || `#${inv.id}`)}</td>
              <td>${escapeHtml(inv.patient_name || '—')}</td>
              <td class="fw-bold">${escapeHtml(inv.file_number || '—')}</td>
              <td><span class="badge bg-secondary">${escapeHtml(inv.invoice_type_label || inv.invoice_type || '—')}</span></td>
              <td class="fw-bold">${fmtMoney(inv.final_total)}</td>
              <td>${fmtMoney(inv.total_collected)}</td>
              <td class="${Number(inv.remaining) > 0 ? 'text-danger fw-bold' : ''}">${fmtMoney(inv.remaining)}</td>
              <td class="small">${fmtDateTime(inv.submitted_at || inv.updated_at)}</td>
              <td class="small">${escapeHtml(inv.created_by_name || '—')}</td>
              <td class="text-nowrap">
                <button type="button" class="btn btn-sm btn-outline-primary ops-open-invoice" data-id="${inv.id}">عرض</button>
                ${canApprove ? `<button type="button" class="btn btn-sm btn-outline-success ops-approve-invoice" data-id="${inv.id}">اعتماد</button>` : ''}
                ${canDelete ? `<button type="button" class="btn btn-sm btn-outline-danger ops-delete-invoice" data-id="${inv.id}">حذف</button>` : ''}
              </td>
            </tr>`
            )
            .join('')
        : '<tr><td colspan="10" class="text-center py-4 text-muted">لا توجد فواتير بانتظار الاعتماد 🎉</td></tr>';

      const draftsBody = document.getElementById('approvals-drafts-body');
      const draftsCountEl = document.getElementById('approvals-drafts-count');
      if (draftsCountEl) draftsCountEl.textContent = draftRows.length;
      if (draftsBody) {
        draftsBody.innerHTML = draftRows.length
          ? draftRows
              .map(
                (inv) => `<tr>
              <td class="fw-bold">${escapeHtml(inv.display_number || `#${inv.id}`)}</td>
              <td>${escapeHtml(inv.patient_name || '—')}</td>
              <td class="fw-bold">${escapeHtml(inv.file_number || '—')}</td>
              <td><span class="badge bg-secondary">${escapeHtml(inv.invoice_type_label || inv.invoice_type || '—')}</span></td>
              <td class="fw-bold">${fmtMoney(inv.final_total)}</td>
              <td class="small">${fmtDateTime(inv.updated_at || inv.created_at)}</td>
              <td class="small">${escapeHtml(inv.created_by_name || '—')}</td>
              <td class="text-nowrap">
                <button type="button" class="btn btn-sm btn-outline-primary ops-open-invoice" data-id="${inv.id}">عرض</button>
                ${canDelete ? `<button type="button" class="btn btn-sm btn-outline-danger ops-delete-invoice" data-id="${inv.id}">حذف</button>` : ''}
              </td>
            </tr>`
              )
              .join('')
          : '<tr><td colspan="8" class="text-center py-4 text-muted">لا توجد مسودات</td></tr>';
      }

      await refreshApprovalsBadge();
    } catch (err) {
      body.innerHTML = `<tr><td colspan="10" class="text-danger text-center">${escapeHtml(err.message)}</td></tr>`;
    }
  }

  function stopLivePoll() {
    if (livePollTimer) {
      clearInterval(livePollTimer);
      livePollTimer = null;
    }
  }

  function stopApprovalsPoll() {
    if (approvalsPollTimer) {
      clearInterval(approvalsPollTimer);
      approvalsPollTimer = null;
    }
  }

  function startLivePoll() {
    stopLivePoll();
    livePollTimer = setInterval(() => {
      if (document.getElementById('view-live-activity')?.style.display !== 'none') {
        loadLiveActivityView();
      }
    }, 20000);
  }

  function startApprovalsPoll() {
    stopApprovalsPoll();
    approvalsPollTimer = setInterval(() => {
      if (document.getElementById('view-approvals')?.style.display !== 'none') {
        loadApprovalsView();
      }
    }, 30000);
  }

  function bindOpsCenter() {
    document.getElementById('live-activity-refresh-btn')?.addEventListener('click', loadLiveActivityView);
    document.getElementById('approvals-refresh-btn')?.addEventListener('click', loadApprovalsView);

    const handleApprovalsTableClick = async (e) => {
      const openBtn = e.target.closest('.ops-open-invoice');
      if (openBtn) {
        const id = Number(openBtn.dataset.id);
        if (!id || typeof window.loadInvoiceForEdit !== 'function') return;
        await ActionGuard.runGuarded(
          `ops:open:${id}`,
          () => window.loadInvoiceForEdit(id),
          { elements: [openBtn], busyText: 'جاري الفتح…' }
        );
        return;
      }
      const approveBtn = e.target.closest('.ops-approve-invoice');
      if (approveBtn && typeof window.quickApproveInvoice === 'function') {
        const id = Number(approveBtn.dataset.id);
        if (!id) return;
        await ActionGuard.runGuarded(
          `ops:approve:${id}`,
          async () => {
            await window.quickApproveInvoice(id);
            await loadApprovalsView();
          },
          { elements: [approveBtn], busyText: 'جاري الاعتماد…' }
        );
        return;
      }
      const deleteBtn = e.target.closest('.ops-delete-invoice');
      if (deleteBtn && typeof window.deleteInvoice === 'function') {
        const id = Number(deleteBtn.dataset.id);
        if (!id) return;
        await ActionGuard.runGuarded(
          `ops:delete:${id}`,
          () => window.deleteInvoice(id),
          { elements: [deleteBtn], busyText: 'جاري الحذف…' }
        );
      }
    };
    document.getElementById('approvals-queue-body')?.addEventListener('click', handleApprovalsTableClick);
    document.getElementById('approvals-drafts-body')?.addEventListener('click', handleApprovalsTableClick);
  }

  window.initOpsCenter = function initOpsCenter() {
    bindOpsCenter();
    refreshApprovalsBadge();
    setInterval(refreshApprovalsBadge, 60000);
  };

  window.loadLiveActivityView = function loadLiveActivityViewPublic() {
    loadLiveActivityView();
    startLivePoll();
    stopApprovalsPoll();
  };

  window.loadApprovalsView = function loadApprovalsViewPublic() {
    loadApprovalsView();
    startApprovalsPoll();
    stopLivePoll();
  };

  window.refreshApprovalsBadge = refreshApprovalsBadge;
  window.stopOpsCenterPolls = function stopOpsCenterPolls() {
    stopLivePoll();
    stopApprovalsPoll();
  };
})();
