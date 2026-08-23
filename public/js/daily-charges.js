const DAILY_API = '/api/daily-charges';

let dailySectionsCache = [];
let dailyCurrentEntryId = null;
let dailyStayContext = null;

function getStayFileNumber() {
  return document.getElementById('daily-stay-file-number')?.value.trim() || '';
}

function getStayPatientName() {
  return document.getElementById('daily-stay-patient-name')?.value.trim() || '';
}

function fmtStayDate(value) {
  if (!value) return '';
  return String(value).slice(0, 10);
}

function setDailyWorkflowSteps(hasStay) {
  document.querySelectorAll('.patient-stay-step').forEach((el) => {
    const step = Number(el.dataset.step);
    el.classList.toggle('active', !hasStay && step === 1);
    el.classList.toggle('done', hasStay && step <= 3);
    if (hasStay && step === 2) el.classList.add('active');
  });
  const panel = document.getElementById('daily-step-2-panel');
  if (panel) panel.classList.toggle('daily-step-locked', !hasStay);
}

function updateDailyInvoicePanel(ctx) {
  const empty = document.getElementById('daily-invoice-empty');
  const info = document.getElementById('daily-invoice-info');
  const inv = ctx?.invoice;
  if (!inv?.id) {
    if (empty) empty.style.display = '';
    if (info) info.style.display = 'none';
    return;
  }
  if (empty) empty.style.display = 'none';
  if (info) info.style.display = '';
  const numEl = document.getElementById('daily-inv-number');
  if (numEl) numEl.textContent = inv.serial_number ? inv.serial_number : `#${inv.id}`;
  const statusEl = document.getElementById('daily-inv-status');
  if (statusEl) {
    statusEl.textContent = inv.status_label || inv.status || '—';
    statusEl.className = `badge ${inv.status === 'pending_review' ? 'bg-warning text-dark' : inv.status === 'approved' ? 'bg-success' : 'bg-secondary'}`;
  }
  const periodEl = document.getElementById('daily-inv-period');
  if (periodEl) {
    periodEl.textContent = `${fmtStayDate(inv.admission_date) || '—'} → ${fmtStayDate(inv.discharge_date) || '—'}`;
  }
  const daysEl = document.getElementById('daily-inv-days');
  if (daysEl) daysEl.textContent = dailyFmtInt(ctx.daily_summary?.entry_count ?? 0);
  const dailyTotalEl = document.getElementById('daily-inv-daily-total');
  if (dailyTotalEl) dailyTotalEl.textContent = dailyFmt(ctx.daily_summary?.daily_total_sum ?? 0);
  const finalEl = document.getElementById('daily-inv-final-total');
  if (finalEl) finalEl.textContent = dailyFmt(inv.final_total ?? 0);
}

function applyDailyStayContext(ctx) {
  dailyStayContext = ctx;
  const hasOpenInvoice = Boolean(ctx?.invoice?.id);
  setDailyWorkflowSteps(hasOpenInvoice);

  if (ctx?.patient) {
    document.getElementById('daily-stay-file-number').value = ctx.patient.file_number || '';
    document.getElementById('daily-stay-patient-name').value = ctx.patient.name || ctx.invoice?.patient_name || '';
    if (ctx.patient.account_balance != null) {
      const balanceEl = document.getElementById('daily-stay-balance');
      if (typeof setCommaAmountValue === 'function') {
        setCommaAmountValue(balanceEl, ctx.patient.account_balance);
      } else {
        balanceEl.value = dailyFormatInput(ctx.patient.account_balance);
      }
    }
  }
  if (ctx?.invoice) {
    document.getElementById('daily-stay-admission').value = fmtStayDate(ctx.invoice.admission_date);
    const dischargeEl = document.getElementById('daily-stay-discharge');
    if (dischargeEl) {
      const admission = fmtStayDate(ctx.invoice.admission_date);
      const discharge = ctx.invoice.discharge_date ? fmtStayDate(ctx.invoice.discharge_date) : '';
      dischargeEl.value = discharge && discharge !== admission ? discharge : '';
    }
    if (typeof loadFinancialTreatments === 'function') {
      loadFinancialTreatments({ daily_stay_financial: ctx.invoice.financial_treatment || '' });
    } else {
      document.getElementById('daily-stay-financial').value = ctx.invoice.financial_treatment || '';
    }
  }

  const summary = document.getElementById('daily-patient-summary');
  const summaryText = document.getElementById('daily-patient-summary-text');
  if (hasOpenInvoice && summary && summaryText) {
    summary.style.display = '';
    summaryText.textContent = `${getStayPatientName()} — ملف ${getStayFileNumber()}`;
  } else if (summary) {
    summary.style.display = 'none';
  }

  const statusEl = document.getElementById('daily-entry-status');
  if (statusEl) {
    statusEl.textContent = hasOpenInvoice ? 'جاهز للتسجيل' : 'أكمل تسجيل المريض أولًا';
  }

  updateDailyInvoicePanel(ctx);
  if (typeof bindCommaAmountInputs === 'function') {
    bindCommaAmountInputs(document.getElementById('view-daily'));
  }
  if (hasOpenInvoice) sessionStorage.setItem('dailyStayFileNumber', getStayFileNumber());
}

async function loadOpenPatientStay(fileNumber) {
  const fn = (fileNumber || getStayFileNumber()).trim();
  if (!fn) {
    applyDailyStayContext(null);
    return null;
  }
  try {
    const res = await apiFetch(`${DAILY_API}/open-stay?file_number=${encodeURIComponent(fn)}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'فشل البحث');
    applyDailyStayContext(data);
    await loadDailyPatientHistory();
    return data;
  } catch (err) {
    showToast(err.message, 'danger');
    return null;
  }
}

async function saveOpenPatientStay() {
  if (!dailyCan('daily_charges.manage')) {
    showToast('ليس لديك صلاحية تسجيل الإقامة', 'warning');
    return;
  }
  const file_number = getStayFileNumber();
  const patient_name = getStayPatientName();
  const admission_date = document.getElementById('daily-stay-admission')?.value;
  const dischargeRaw = document.getElementById('daily-stay-discharge')?.value?.trim();
  const discharge_date = dischargeRaw || null;
  if (!file_number || !patient_name || !admission_date) {
    showToast('رقم الملف واسم المريض وتاريخ الدخول مطلوبان', 'warning');
    return;
  }

  try {
    const res = await apiFetch(`${DAILY_API}/open-stay`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        file_number,
        patient_name,
        admission_date,
        discharge_date,
        financial_treatment: document.getElementById('daily-stay-financial')?.value || '',
        account_balance: dailyParseAmount(document.getElementById('daily-stay-balance')?.value),
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'فشل التسجيل');
    applyDailyStayContext(data);
    await loadDailyPatientHistory();
    const label = data.created ? 'تم إنشاء فاتورة مسودة' : 'تم تحديث الإقامة';
    showToast(`${label} #${data.invoice?.id}`, 'success');
  } catch (err) {
    showToast(err.message, 'danger');
  }
}

async function openDailyStayInvoice() {
  const invoiceId = dailyStayContext?.invoice?.id;
  if (!invoiceId) {
    showToast('لا توجد فاتورة مفتوحة — سجّل المريض أولًا', 'warning');
    return;
  }
  if (typeof switchView === 'function' && typeof loadInvoiceForEdit === 'function') {
    await loadInvoiceForEdit(invoiceId, { followUp: true });
  }
}

function dailyCan(view) {
  return typeof can === 'function' && (can(view) || can('daily_charges.view') || can('daily_charges.manage'));
}

function dailyParseAmount(text) {
  if (typeof parseDisplayAmount === 'function') return parseDisplayAmount(text);
  return parseFloat(String(text || '').replace(/,/g, '')) || 0;
}

function dailyFormatNumber(n, decimals = 2) {
  const num = Number(n) || 0;
  return num.toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: decimals,
  });
}

function dailyFmt(n) {
  return dailyFormatNumber(n, 2);
}

function dailyFmtInt(n) {
  return dailyFormatNumber(n, 0);
}

function dailyFormatInput(n, decimals = 2) {
  if (n === '' || n === null || n === undefined) return '';
  const num = Number(n);
  if (Number.isNaN(num)) return '';
  return dailyFormatNumber(num, decimals);
}

async function loadDailySections() {
  const res = await apiFetch(`${DAILY_API}/sections?with_services=1`);
  dailySectionsCache = await res.json();
  renderDailySectionsTable();
}

function renderDailyCell(section) {
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
  return `<td>${serviceSelect}<input type="text" inputmode="decimal" class="form-control form-control-sm daily-field daily-amount comma-amount" data-section="${section.code}" data-type="amount" placeholder="0"></td>`;
}

function renderDailySectionsTable() {
  const head = document.getElementById('daily-sections-head');
  const subhead = document.getElementById('daily-sections-subhead');
  const row = document.getElementById('daily-sections-row');
  if (!head || !row) return;

  const consultationCodes = ['consultant_exam', 'specialist_exam', 'consultation_stamp'];
  const consultationSections = dailySectionsCache.filter((s) => consultationCodes.includes(s.code));
  let consultInserted = false;
  const blocks = [];

  for (const section of dailySectionsCache) {
    if (consultationCodes.includes(section.code)) {
      if (!consultInserted) {
        blocks.push({ type: 'consultations', sections: consultationSections });
        consultInserted = true;
      }
      continue;
    }
    blocks.push({ type: 'single', section });
  }

  head.innerHTML = blocks
    .map((block) => {
      if (block.type === 'consultations') {
        return '<th colspan="3" class="text-center daily-group-th">الكشوفات</th>';
      }
      return `<th rowspan="2" class="daily-section-th" title="${block.section.category_code || ''}">${block.section.name}</th>`;
    })
    .join('');

  if (subhead) {
    subhead.innerHTML = blocks
      .map((block) => {
        if (block.type === 'consultations') {
          return block.sections.map((s) => `<th class="daily-section-th">${s.name}</th>`).join('');
        }
        return '';
      })
      .join('');
    subhead.style.display = consultationSections.length ? '' : 'none';
  }

  row.innerHTML = dailySectionsCache.map((section) => renderDailyCell(section)).join('');

  const footLabel = document.getElementById('daily-total-foot-label');
  const footSpacer = document.getElementById('daily-total-foot-spacer');
  const colCount = dailySectionsCache.length;
  if (footLabel) footLabel.colSpan = Math.max(colCount - 1, 1);
  if (footSpacer) footSpacer.colSpan = Math.max(colCount - 2, 0);

  row.querySelectorAll('.daily-field, .daily-service').forEach((el) => {
    el.addEventListener('input', updateDailyTotalDisplay);
    el.addEventListener('change', onDailyServicePick);
  });
  if (typeof bindCommaAmountInputs === 'function') bindCommaAmountInputs(row);
}

function onDailyServicePick(event) {
  const select = event.target;
  if (!select.classList.contains('daily-service')) return;
  const section = select.dataset.section;
  const option = select.selectedOptions[0];
  const price = dailyParseAmount(option?.dataset.price);
  const amountInput = document.querySelector(`.daily-amount[data-section="${section}"]`);
  if (amountInput && price > 0 && !dailyParseAmount(amountInput.value)) {
    amountInput.value = typeof formatAmountInput === 'function' ? formatAmountInput(price) : String(price);
  }
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
      amount: dailyParseAmount(field?.value),
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
    if (amountSections.has(input.dataset.section)) total += dailyParseAmount(input.value);
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
    else field.value = line.amount ? (typeof formatAmountInput === 'function' ? formatAmountInput(line.amount) : line.amount) : '';
    if (serviceSelect && line.service_id) serviceSelect.value = line.service_id;
  }
  updateDailyTotalDisplay();
}

async function loadDailyEntryForCurrentSelection() {
  const fileNumber = getStayFileNumber();
  const entryDate = document.getElementById('daily-entry-date')?.value;
  if (!fileNumber || !entryDate) return;
  if (!dailyStayContext?.invoice?.id) return;

  try {
    const res = await apiFetch(
      `${DAILY_API}/entries/by-date?file_number=${encodeURIComponent(fileNumber)}&entry_date=${entryDate}`
    );
    const entry = await res.json();
    fillDailyFormFromEntry(entry?.id ? entry : null);
  } catch (err) {
    console.error(err);
  }
}

async function loadDailyPatientHistory() {
  const tbody = document.getElementById('daily-history-tbody');
  const fileNumber = getStayFileNumber();
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
  if (!dailyStayContext?.invoice?.id) {
    showToast('سجّل المريض وفتح الإقامة في الخطوة ① أولًا', 'warning');
    return;
  }
  const file_number = getStayFileNumber();
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
        patient_name: getStayPatientName(),
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
    let toastMsg = 'تم حفظ الحركة اليومية';
    if (data.invoice_sync?.synced) {
      const invLabel = data.invoice_sync.created ? 'تم إنشاء فاتورة مسودة' : 'تم تحديث الفاتورة';
      toastMsg = `${toastMsg} — ${invLabel} #${data.invoice_sync.invoice_id}`;
      await refreshInvoiceFormAfterDailySave(file_number, data.invoice_sync.invoice_id);
      await loadOpenPatientStay(file_number);
    } else if (data.invoice_sync?.error) {
      toastMsg = `${toastMsg} (تعذّر تحديث الفاتورة: ${data.invoice_sync.error})`;
    }
    showToast(toastMsg, data.invoice_sync?.error ? 'warning' : 'success');
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
  if (typeof loadFinancialTreatments === 'function') await loadFinancialTreatments();
  if (!dailySectionsCache.length) await loadDailySections();
  if (!document.getElementById('daily-entry-date').value) {
    document.getElementById('daily-entry-date').value = new Date().toISOString().slice(0, 10);
  }
  await loadDailyStayTypes();
  if (typeof bindCommaAmountInputs === 'function') {
    bindCommaAmountInputs(document.getElementById('view-daily'));
  }
  const savedFile = sessionStorage.getItem('dailyStayFileNumber');
  if (savedFile) {
    document.getElementById('daily-stay-file-number').value = savedFile;
    await loadOpenPatientStay(savedFile);
  } else {
    applyDailyStayContext(null);
    await loadDailyPatientHistory();
  }
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
  targetRow.querySelector('[data-field="quantity"]').value =
    item.quantity != null && item.quantity !== ''
      ? typeof formatAmountInput === 'function'
        ? formatAmountInput(item.quantity, 0)
        : item.quantity
      : typeof formatAmountInput === 'function'
        ? formatAmountInput(1, 0)
        : 1;
  targetRow.querySelector('[data-field="amount"]').value =
    item.amount != null && item.amount !== ''
      ? typeof formatAmountInput === 'function'
        ? formatAmountInput(item.amount)
        : item.amount
      : '';
  if (item.daily_entry_line_id) targetRow.dataset.dailyLineId = item.daily_entry_line_id;
  if (item.daily_entry_id) targetRow.dataset.dailyEntryId = item.daily_entry_id;
}

function syncDailyChargeRowsFromTotals(totalsItems = []) {
  const dailyItems = (totalsItems || []).filter(
    (item) => item.daily_entry_line_id && !item.is_stay_entry
  );
  if (!dailyItems.length) return 0;

  const existingLineIds = new Set(
    [...document.querySelectorAll('#items-tbody tr')]
      .map((row) => row.dataset.dailyLineId)
      .filter(Boolean)
  );
  let added = 0;
  for (const item of dailyItems) {
    if (existingLineIds.has(String(item.daily_entry_line_id))) continue;
    appendInvoiceItemRow(item);
    existingLineIds.add(String(item.daily_entry_line_id));
    added++;
  }
  if (added > 0) {
    document.querySelectorAll('#items-tbody tr').forEach((row) => {
      if (row.dataset.staySync) return;
      const qty = dailyParseAmount(row.querySelector('[data-field="quantity"]')?.value);
      const amt = dailyParseAmount(row.querySelector('[data-field="amount"]')?.value);
      const total = Math.round(qty * amt * 100) / 100;
      const totalEl = row.querySelector('[data-field="total"]');
      if (totalEl) totalEl.value = total ? (typeof fmtInt === 'function' ? fmtInt(total) : total) : '';
    });
  }
  return added;
}

async function refreshInvoiceFormAfterDailySave(fileNumber, invoiceId) {
  const formFile = document.getElementById('file_number')?.value.trim();
  const currentId = document.getElementById('invoice-id')?.value;
  const viewCreate = document.getElementById('view-create')?.style.display !== 'none';
  if (!viewCreate || formFile !== fileNumber) return;
  if (typeof loadInvoiceForEdit === 'function' && invoiceId) {
    if (!currentId || String(currentId) === String(invoiceId)) {
      await loadInvoiceForEdit(invoiceId);
    }
  }
}

async function applyDailyStayTypeRate() {
  const select = document.getElementById('daily-stay-type');
  const stayTypeId = select?.value;
  if (!stayTypeId) return;
  try {
    const res = await apiFetch('/api/settings/stay-types');
    const types = await res.json();
    const stayType = types.find((t) => String(t.id) === String(stayTypeId));
    const accInput = document.querySelector('.daily-amount[data-section="accommodation"]');
    if (accInput && Number(stayType?.daily_rate) > 0 && !accInput.value) {
      accInput.value = stayType.daily_rate;
      updateDailyTotalDisplay();
    }
  } catch (err) {
    console.error(err);
  }
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
  document.getElementById('daily-stay-open-btn')?.addEventListener('click', saveOpenPatientStay);
  document.getElementById('daily-stay-lookup-btn')?.addEventListener('click', () => loadOpenPatientStay());
  document.getElementById('daily-stay-file-number')?.addEventListener('blur', () => loadOpenPatientStay());
  document.getElementById('daily-open-invoice-btn')?.addEventListener('click', openDailyStayInvoice);
  document.getElementById('daily-save-btn')?.addEventListener('click', saveDailyEntry);
  document.getElementById('daily-clear-btn')?.addEventListener('click', clearDailyForm);
  document.getElementById('daily-history-btn')?.addEventListener('click', showDailyEntryHistory);
  document.getElementById('daily-entry-date')?.addEventListener('change', loadDailyEntryForCurrentSelection);
  document.getElementById('daily-stay-type')?.addEventListener('change', applyDailyStayTypeRate);
  document.getElementById('import-daily-charges-btn')?.addEventListener('click', importDailyChargesToInvoice);
});

window.initDailyChargesView = initDailyChargesView;
window.importDailyChargesToInvoice = importDailyChargesToInvoice;
window.syncDailyChargeRowsFromTotals = syncDailyChargeRowsFromTotals;
