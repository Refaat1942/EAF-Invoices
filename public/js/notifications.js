/**
 * In-app notifications bell for all authenticated users.
 */
(function () {
  const API = '/api/audit';
  let pollTimer = null;
  let lastCount = -1;
  let panelOpen = false;

  function canNotify() {
    return (
      typeof can === 'function' &&
      (can('invoices.view') || can('daily_charges.view') || can('settings.*'))
    );
  }

  function playNotificationSound() {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = 880;
      gain.gain.value = 0.08;
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.15);
    } catch {
      /* optional */
    }
  }

  async function refreshNotificationBadge() {
    const btn = document.getElementById('nav-alerts-btn');
    const badge = document.getElementById('nav-alerts-badge');
    if (!btn || !badge || !canNotify()) {
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
      if (lastCount >= 0 && count > lastCount) playNotificationSound();
      lastCount = count;
    } catch {
      badge.style.display = 'none';
    }
  }

  async function loadNotificationDropdown() {
    const body = document.getElementById('nav-alerts-dropdown-body');
    if (!body) return;
    body.innerHTML = '<div class="text-muted small p-2 text-center">جاري التحميل...</div>';
    try {
      const res = await apiFetch(`${API}/alerts?limit=15&unread_only=true`);
      const data = await res.json();
      const rows = data.rows || [];
      if (!rows.length) {
        body.innerHTML = '<div class="text-muted small p-3 text-center">لا توجد إشعارات جديدة</div>';
        return;
      }
      body.innerHTML = rows
        .map(
          (row) => `
        <button type="button" class="dropdown-item text-wrap nav-alert-item${row.is_read ? '' : ' fw-bold'}" data-id="${row.id}">
          <div class="small text-muted">${escapeHtml(row.created_at ? new Date(row.created_at).toLocaleString('ar-EG') : '')}</div>
          <div>${escapeHtml(row.title || 'تنبيه')}</div>
          <div class="small text-muted">${escapeHtml(row.message || '')}</div>
        </button>`
        )
        .join('');
      body.querySelectorAll('.nav-alert-item').forEach((btn) => {
        btn.addEventListener('click', async () => {
          await apiFetch(`${API}/alerts/${btn.dataset.id}/read`, { method: 'POST' });
          await refreshNotificationBadge();
          await loadNotificationDropdown();
        });
      });
    } catch (err) {
      body.innerHTML = `<div class="text-danger small p-2">${escapeHtml(err.message)}</div>`;
    }
  }

  function bindNotificationUi() {
    const btn = document.getElementById('nav-alerts-btn');
    if (!btn) return;
    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      panelOpen = !panelOpen;
      const menu = document.getElementById('nav-alerts-dropdown');
      if (menu) {
        menu.classList.toggle('show', panelOpen);
        if (panelOpen) await loadNotificationDropdown();
      }
    });
    document.addEventListener('click', (e) => {
      const menu = document.getElementById('nav-alerts-dropdown');
      if (!menu || !panelOpen) return;
      if (!menu.contains(e.target) && e.target !== btn) {
        panelOpen = false;
        menu.classList.remove('show');
      }
    });
    document.getElementById('nav-alerts-read-all')?.addEventListener('click', async () => {
      await apiFetch(`${API}/alerts/read-all`, { method: 'POST' });
      await refreshNotificationBadge();
      await loadNotificationDropdown();
    });
  }

  function startNotificationPolling() {
    if (pollTimer) clearInterval(pollTimer);
    if (!canNotify()) return;
    void refreshNotificationBadge();
    pollTimer = setInterval(() => {
      void refreshNotificationBadge();
    }, 45000);
  }

  document.addEventListener('DOMContentLoaded', () => {
    bindNotificationUi();
    startNotificationPolling();
  });

  window.refreshNotificationBadge = refreshNotificationBadge;
  window.startNotificationPolling = startNotificationPolling;
})();
