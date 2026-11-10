/**
 * Quick patient access: a search box in the top bar (any screen, Ctrl+K) and on the home
 * screen, plus the patients this user opened last. One click opens the patient's screens.
 * Search covers name, file number, phone, national ID and passport / residence number.
 */
(function () {
  const RECENT_MAX = 8;
  let searchSeq = 0;

  function canUse() {
    return typeof can === 'function' && can('daily_charges.view');
  }

  function recentKey() {
    const id = (typeof currentUser !== 'undefined' && currentUser?.id) || 'x';
    return `eafRecentPatients:${id}`;
  }

  function readRecent() {
    try {
      const list = JSON.parse(localStorage.getItem(recentKey()) || '[]');
      return Array.isArray(list) ? list : [];
    } catch {
      return [];
    }
  }

  function rememberPatient(fileNumber, name) {
    const fn = String(fileNumber || '').trim();
    if (!fn) return;
    try {
      const old = readRecent();
      const known = old.find((p) => p.file_number === fn);
      const list = old.filter((p) => p.file_number !== fn);
      list.unshift({ file_number: fn, name: String(name || '').trim() || known?.name || '' });
      localStorage.setItem(recentKey(), JSON.stringify(list.slice(0, RECENT_MAX)));
    } catch {
      /* storage unavailable: recent list is only a convenience */
    }
    renderRecent();
  }

  function openPatient(fileNumber) {
    const fn = String(fileNumber || '').trim();
    if (!fn || typeof switchView !== 'function') return;
    closeResults();
    switchView('daily', { openFileNumber: fn });
  }

  function esc(t) {
    return typeof escapeHtml === 'function' ? escapeHtml(t) : String(t || '');
  }

  function patientLine(p) {
    const type = p.patient_type === 'external' ? 'خارجي' : 'داخلي';
    const id = p.id_number ? ` — ${esc(p.id_number)}` : '';
    const open = p.has_open_invoice ? '<span class="badge bg-success ms-1">فاتورة مفتوحة</span>' : '';
    return `<span class="fw-bold">${esc(p.name || '—')}</span>
      <span class="text-muted small"> ملف ${esc(p.file_number)} · ${type}${id}</span>${open}`;
  }

  async function search(term) {
    const q = String(term || '').trim();
    if (q.length < 2) return [];
    const res = await apiFetch(`/api/daily-charges/patients?search=${encodeURIComponent(q)}&limit=8`);
    if (!res.ok) return [];
    return res.json();
  }

  function closeResults() {
    document.getElementById('nav-patient-results')?.classList.remove('show');
    const hub = document.getElementById('hub-patient-results');
    if (hub) hub.innerHTML = '';
  }

  function renderInto(box, rows, asDropdown) {
    if (!box) return;
    if (!rows.length) {
      box.innerHTML = `<div class="${asDropdown ? 'dropdown-item-text' : 'list-group-item'} text-muted small">لا يوجد مريض بهذا البحث</div>`;
    } else {
      box.innerHTML = rows
        .map(
          (p) =>
            `<button type="button" class="${asDropdown ? 'dropdown-item' : 'list-group-item list-group-item-action'} text-wrap quick-patient-item" data-file="${esc(p.file_number)}" data-name="${esc(p.name || '')}">${patientLine(p)}</button>`
        )
        .join('');
    }
    box.querySelectorAll('.quick-patient-item').forEach((btn) => {
      btn.addEventListener('click', () => {
        rememberPatient(btn.dataset.file, btn.dataset.name);
        openPatient(btn.dataset.file);
      });
    });
    if (asDropdown) box.classList.add('show');
  }

  function bindSearchInput(input, box, asDropdown) {
    if (!input || input.dataset.quickBound === '1') return;
    input.dataset.quickBound = '1';
    let timer = null;
    let lastRows = [];
    input.addEventListener('input', () => {
      clearTimeout(timer);
      const term = input.value;
      timer = setTimeout(async () => {
        const seq = ++searchSeq;
        if (String(term).trim().length < 2) {
          lastRows = [];
          if (asDropdown) box?.classList.remove('show');
          else if (box) box.innerHTML = '';
          return;
        }
        const rows = await search(term).catch(() => []);
        if (seq !== searchSeq) return;
        lastRows = rows;
        renderInto(box, rows, asDropdown);
      }, 250);
    });
    input.addEventListener('keydown', async (e) => {
      if (e.key === 'Escape') {
        closeResults();
        input.blur();
        return;
      }
      if (e.key !== 'Enter') return;
      e.preventDefault();
      const rows = lastRows.length ? lastRows : await search(input.value).catch(() => []);
      if (rows.length === 1 || (rows[0] && String(rows[0].file_number) === input.value.trim())) {
        rememberPatient(rows[0].file_number, rows[0].name);
        openPatient(rows[0].file_number);
        input.value = '';
      } else {
        renderInto(box, rows, asDropdown);
      }
    });
  }

  function renderRecent() {
    const box = document.getElementById('hub-recent-patients');
    if (!box) return;
    const list = canUse() ? readRecent() : [];
    if (!list.length) {
      box.innerHTML = '';
      return;
    }
    box.innerHTML =
      '<span class="small fw-bold text-muted align-self-center">آخر المرضى:</span>' +
      list
        .map(
          (p) =>
            `<button type="button" class="btn btn-sm btn-outline-primary fw-bold quick-recent-item" data-file="${esc(p.file_number)}">${esc(p.name || p.file_number)} <span class="text-muted small">(${esc(p.file_number)})</span></button>`
        )
        .join('');
    box.querySelectorAll('.quick-recent-item').forEach((btn) => {
      btn.addEventListener('click', () => openPatient(btn.dataset.file));
    });
  }

  function initQuickPatient() {
    const show = canUse();
    document.getElementById('nav-patient-search-form')?.classList.toggle('d-md-flex', show);
    const hubWrap = document.getElementById('hub-quick-patient');
    if (hubWrap) hubWrap.style.display = show ? '' : 'none';
    if (!show) return;
    bindSearchInput(document.getElementById('nav-patient-search'), document.getElementById('nav-patient-results'), true);
    bindSearchInput(document.getElementById('hub-patient-search'), document.getElementById('hub-patient-results'), false);
    document.getElementById('nav-patient-search-form')?.addEventListener('submit', (e) => e.preventDefault());
    renderRecent();
  }

  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) {
      const input = document.getElementById('nav-patient-search');
      if (input && canUse()) {
        e.preventDefault();
        input.focus();
        input.select();
      }
    }
  });
  document.addEventListener('click', (e) => {
    const form = document.getElementById('nav-patient-search-form');
    if (form && !form.contains(e.target)) document.getElementById('nav-patient-results')?.classList.remove('show');
  });

  window.initQuickPatient = initQuickPatient;
  window.eafRememberPatient = rememberPatient;
  window.renderRecentPatients = renderRecent;
})();
