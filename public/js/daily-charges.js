const DAILY_API = '/api/daily-charges';

let dailySectionsCache = [];
let dailyCurrentEntryId = null;

function dailyCan(view) {
  return typeof can === 'function' && (can(view) || can('daily_charges.view') || can('daily_charges.manage'));
}

function dailyFmt(n) {
  if (typeof fmt === 'function') return fmt(n);
  return Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 2 });
}

async function loadDailySections() {
  const res = await apiFetch(`${DAILY_API}/sections?with_services=1`);
  dailySectionsCache = await res.json();
  renderDailySectionsTable();
}

function renderDailySectionsTable() {
  const head = document.getElementById('daily-sections-head');
  const row = document.getElementById('daily-sections-row');
  if (!head || !row) return;

  head.innerHTML = dailySectionsCache
    .map((section) => `<th class="daily-section-th" title="${section.category_code || ''}">${section.name}</th>`)
    .join('');

  row.innerHTML = dailySectionsCache
    .map((section) => {
      if (section.input_type === 'date') {
        return `<td><input type="date" class="form-control form-control-sm daily-field" data-section="${section.code}" data-type="date"></td>`;
      }
      if (section.input_type === 'text') {
        return `<td><input type="text" class="form-control form-control-sm daily-field" data-section="${section.code}" data-type="text" placeholder="${section.name}"></td>`;
      }
      const serviceOptions = (section.services || [])
        .map(
          (service) =>
            `<option value="${service.id}" data-price="${service.price}" ${section.default_service?.id === service.id ? 'selected' : ''}>${service.name}</option>`
        )
        .join('');
      const serviceSelect =
        section.services?.length > 0
          ? `<select class="form-select form-select-sm mb-1 daily-service" data-section="${section.code}"><option value="">— خدمة —</option>${serviceOptions}</select>`
          : '';
      return `<td>${serviceSelect}<input type="number" step="0.01" min="0" class="form-control form-control-sm daily-field daily-amount" data-section="${section.code}" data-type="amount" placeholder="0"></td>`;
    })
    .join('');

  row.querySelectorAll('.daily-field, .daily-service').forEach((el) => {
    el.addEventListener('input', updateDailyTotalDisplay);
    el.addEventListener('change', onDailyServicePick);
  });
}

function onDailyServicePick(event) {
  const select = event.target;
  if (!select.classList.contains('daily-service')) return;
  const section = select.dataset.section;
  const option = select.selectedOptions[0];
  const price = parseFloat(option?.dataset.price) || 0;
  const amountInput = document.querySelector(`.daily-amount[data-section="${section}"]`);
  if (amountInput && price > 0 && !amountInput.value) amountInput.value = price;
  updateDailyTotalDisplay();
}

function collectDailyLinesFromForm() {
  return dailySectionsCache.map((section) => {
    const field = document.querySelector(`.daily-field[data-section="${section.code}"]`);
    const serviceSelect = document.querySelector(`.daily-service[data-section="${section.code}"]`);
    if (section.input_type === 'date') {
      return { section_code: section.code, extra_date: field?.value || null };
    }
    if (section.input_type === 'text') {
      return { section_code: section.code, extra_text: field?.value || '' };
    }
    return {
      section_code: section.code,
      service_id: serviceSelect?.value ? Number(serviceSelect.value) : null,
      amount: parseFloat(field?.value) || 0,
      quantity: 1,
    };
  });
}

function updateDailyTotalDisplay() {
  const amountSections = new Set(
    dailySectionsCache.filter((s) => s.input_type === 'amount').map((s) => s.code)
  );
  let total = 0;
  document.querySelectorAll('.daily-amount').forEach((input) => {
    if (amountSections.has(input.dataset.section)) total += parseFloat(input.value) || 0;
  });
  const display = document.getElementById('daily-total-display');
  if (display) display.textContent = dailyFmt(Math.round(total * 100) / 100);
}

function fillDailyFormFromEntry(entry) {
  dailyCurrentEntryId = entry?.id || null;
  document.getElementById('daily-notes').value = entry?.notes || '';
  document.getElementById('daily-stay-type').value = entry?.stay_type_id || '';
  const statusEl = document.getElementById('daily-entry-status');
  if (statusEl) {
    if (entry?.id) {
      statusEl.textContent = entry.invoice_id ? `محفوظ — مرتبط بفاتورة #${entry.invoice_id}` : 'محفوظ';
    } else {
      statusEl.textContent = 'جديد';
    }
  }

  document.querySelectorAll('.daily-field').forEach((field) => {
    field.value = '';
  });
  document.querySelectorAll('.daily-service').forEach((select) => {
    select.value = '';
  });

  for (const line of entry?.lines || []) {
    const field = document.querySelector(`.daily-field[data-section="${line.section_code}"]`);
    const serviceSelect = document.querySelector(`.daily-service[data-section="${line.section_code}"]`);
    const section = dailySectionsCache.find((s) => s.code === line.section_code);
    if (!section || !field) continue;
    if (section.input_type === 'date') field.value = line.extra_date ? String(line.extra_date).slice(0, 10) : '';
    else if (section.input_type === 'text') field.value = line.extra_text || '';
    else field.value = line.amount || '';
    if (serviceSelect && line.service_id) serviceSelect.value = line.service_id;
  }
  updateDailyTotalDisplay();
}

async function loadDailyEntryForCurrentSelection() {
  const fileNumber = document.getElementById('daily-file-number')?.value.trim();
  const entryDate = document.getElementById('daily-entry-date')?.value;
  if (!fileNumber || !entryDate) return;

  try {
    const res = await apiFetch(
      `${DAILY_API}/entries/by-date?file_number=${encodeURIComponent(fileNumber)}&entry_date=${entryDate}`
    );
    const entry = await res.json();
    if (entry?.patient_name && !document.getElementById('daily-patient-name').value) {
      document.getElementById('daily-patient-name').value = entry.patient_name;
    }
    fillDailyFormFromEntry(entry?.id ? entry : null);
  } catch (err) {
    console.error(err);
  }
}

async function loadDailyPatientHistory() {
  const tbody = document.getElementById('daily-history-tbody');
  const fileNumber = document.getElementById('daily-file-number')?.value.trim();
  if (!tbody) return;
  if (!fileNumber) {
    tbody.innerHTML = '<tr><td colspan="6" class="text-muted text-center">اختر مريضًا لعرض السجل</td></tr>';
    return;
  }

  try {
    const res = await apiFetch(`${DAILY_API}/entries?file_number=${encodeURIComponent(fileNumber)}&limit=60`);
    const entries = await res.json();
    if (!entries.length) {
      tbody.innerHTML = '<tr><td colspan="6" class="text-muted text-center">لا توجد حركة مسجلة</td></tr>';
      return;
    }
    tbody.innerHTML = entries
      .map(
        (entry) => `<tr>
          <td>${String(entry.entry_date).slice(0, 10)}</td>
          <td class="fw-bold">${dailyFmt(entry.daily_total)}</td>
          <td>${entry.stay_type_name || '—'}</td>
          <td>${entry.invoice_id ? `#${entry.invoice_id}` : '—'}</td>
          <td>${entry.updated_at ? new Date(entry.updated_at).toLocaleString('ar-EG') : '—'}</td>
          <td><button type="button" class="btn btn-sm btn-outline-primary daily-open-entry" data-date="${String(entry.entry_date).slice(0, 10)}">فتح</button></td>
        </tr>`
      )
      .join('');
    tbody.querySelectorAll('.daily-open-entry').forEach((btn) => {
      btn.addEventListener('click', () => {
        document.getElementById('daily-entry-date').value = btn.dataset.date;
        loadDailyEntryForCurrentSelection();
      });
    });
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="6" class="text-danger">${err.message}</td></tr>`;
  }
}

async function saveDailyEntry() {
  if (!dailyCan('daily_charges.manage')) {
    showToast('ليس لديك صلاحية تسجيل الحركة اليومية', 'warning');
    return;
  }
  const file_number = document.getElementById('daily-file-number').value.trim();
  const entry_date = document.getElementById('daily-entry-date').value;
  if (!file_number || !entry_date) {
    showToast('رقم الملف وتاريخ اليوم مطلوبان', 'warning');
    return;
  }

  try {
    const res = await apiFetch(`${DAILY_API}/entries`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        file_number,
        patient_name: document.getElementById('daily-patient-name').value.trim(),
        entry_date,
        stay_type_id: document.getElementById('daily-stay-type').value || null,
        notes: document.getElementById('daily-notes').value,
        lines: collectDailyLinesFromForm(),
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'فشل الحفظ');
    fillDailyFormFromEntry(data);
    await loadDailyPatientHistory();
    showToast('تم حفظ الحركة اليومية', 'success');
  } catch (err) {
    showToast(err.message, 'danger');
  }
}

async function showDailyEntryHistory() {
  if (!dailyCurrentEntryId) {
    showToast('احفظ اليوم أولًا لعرض سجل التعديلات', 'info');
    return;
  }
  const res = await apiFetch(`${DAILY_API}/entries/${dailyCurrentEntryId}/history`);
  const history = await res.json();
  if (!history.length) {
    showToast('لا يوجد سجل تعديلات', 'info');
    return;
  }
  const lines = history
    .map((row) => `${new Date(row.created_at).toLocaleString('ar-EG')} — ${row.action} — ${row.changed_by_name || '—'}`)
    .join('\n');
  alert(`سجل التعديلات:\n\n${lines}`);
}

async function loadDailyStayTypes() {
  const select = document.getElementById('daily-stay-type');
  if (!select) return;
  try {
    const res = await apiFetch('/api/settings/stay-types');
    const types = await res.json();
    select.innerHTML =
      '<option value="">-- اختر --</option>' +
      types.map((t) => `<option value="${t.id}">${t.name}</option>`).join('');
  } catch (err) {
    console.error(err);
  }
}

function clearDailyForm() {
  dailyCurrentEntryId = null;
  document.querySelectorAll('#view-daily .daily-field').forEach((el) => {
    el.value = '';
  });
  document.querySelectorAll('#view-daily .daily-service').forEach((el) => {
    el.value = '';
  });
  document.getElementById('daily-notes').value = '';
  document.getElementById('daily-entry-status').textContent = 'جديد';
  updateDailyTotalDisplay();
}

async function initDailyChargesView() {
  if (!dailyCan('daily_charges.view')) return;
  if (!dailySectionsCache.length) await loadDailySections();
  if (!document.getElementById('daily-entry-date').value) {
    document.getElementById('daily-entry-date').value = new Date().toISOString().slice(0, 10);
  }
  await loadDailyStayTypes();
  await loadDailyPatientHistory();
}

function appendInvoiceItemRow(item) {
  let targetRow = null;
  document.querySelectorAll('#items-tbody tr').forEach((row) => {
    if (row.dataset.staySync) return;
    const desc = row.querySelector('[data-field="description"]')?.value?.trim();
    if (!desc && !targetRow) targetRow = row;
  });
  if (!targetRow) {
    document.getElementById('add-row-btn')?.click();
    const rows = document.querySelectorAll('#items-tbody tr');
    targetRow = rows[rows.length - 1];
  }
  if (!targetRow) return;
  targetRow.querySelector('[data-field="description"]').value = item.description || '';
  const serviceIdEl = targetRow.querySelector('[data-field="service_id"]');
  if (serviceIdEl) serviceIdEl.value = item.service_id || '';
  targetRow.querySelector('[data-field="quantity"]').value = item.quantity || 1;
  targetRow.querySelector('[data-field="amount"]').value = item.amount || 0;
  if (item.daily_entry_line_id) targetRow.dataset.dailyLineId = item.daily_entry_line_id;
}

async function importDailyChargesToInvoice() {
  const file_number = document.getElementById('file_number')?.value.trim();
  const from_date = document.getElementById('admission_date')?.value;
  const to_date = document.getElementById('discharge_date')?.value;
  const invoice_id = document.getElementById('invoice-id')?.value || '';
  if (!file_number || !from_date || !to_date) {
    showToast('أدخل رقم الملف وتاريخ الدخول والخروج أولًا', 'warning');
    return;
  }

  try {
    const params = new URLSearchParams({ file_number, from_date, to_date });
    if (invoice_id) params.set('invoice_id', invoice_id);
    const res = await apiFetch(`${DAILY_API}/for-invoice?${params}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'فشل الاستيراد');
    if (!data.items?.length) {
      showToast('لا توجد حركة يومية غير مفوترة في هذه الفترة', 'info');
      return;
    }

    const existingLineIds = new Set(
      [...document.querySelectorAll('#items-tbody tr')]
        .map((row) => row.dataset.dailyLineId)
        .filter(Boolean)
    );
    let added = 0;
    for (const item of data.items) {
      if (item.daily_entry_line_id && existingLineIds.has(String(item.daily_entry_line_id))) continue;
      appendInvoiceItemRow(item);
      added++;
    }
    if (!added) {
      showToast('الحركة اليومية مضافة بالفعل في البيان', 'info');
      return;
    }
    await recalculate();
    showToast(`تم استيراد ${added} بند من الحركة اليومية`, 'success');
  } catch (err) {
    showToast(err.message, 'danger');
  }
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('daily-save-btn')?.addEventListener('click', saveDailyEntry);
  document.getElementById('daily-clear-btn')?.addEventListener('click', clearDailyForm);
  document.getElementById('daily-history-btn')?.addEventListener('click', showDailyEntryHistory);
  document.getElementById('daily-file-number')?.addEventListener('blur', async () => {
    await loadDailyEntryForCurrentSelection();
    await loadDailyPatientHistory();
  });
  document.getElementById('daily-entry-date')?.addEventListener('change', loadDailyEntryForCurrentSelection);
  document.getElementById('import-daily-charges-btn')?.addEventListener('click', importDailyChargesToInvoice);
});

window.initDailyChargesView = initDailyChargesView;
window.importDailyChargesToInvoice = importDailyChargesToInvoice;
