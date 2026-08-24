const DAILY_API = '/api/daily-charges';

let dailySectionsCache = [];
let dailyCurrentEntryId = null;
let dailyStayContext = null;
let dailyEntriesLoadSeq = 0;
let dailyStayTypesCache = [];

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

function getLocalDateString() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function setDailyTodayDate() {
  const today = getLocalDateString();
  const headerDate = document.getElementById('daily-entry-date');
  if (headerDate) headerDate.value = today;
  document.querySelectorAll('.daily-row-date').forEach((input) => {
    input.value = today;
  });
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

function applyDailyInvoiceSync(data) {
  if (!data?.invoice_sync?.synced || !dailyStayContext?.invoice) return;
  dailyStayContext = {
    ...dailyStayContext,
    invoice: {
      ...dailyStayContext.invoice,
      final_total: data.invoice_sync.final_total ?? 0,
      items_subtotal: data.invoice_sync.items_subtotal ?? 0,
      admission_date: data.invoice_sync.admission_date ?? dailyStayContext.invoice.admission_date,
      discharge_date: data.invoice_sync.discharge_date ?? dailyStayContext.invoice.discharge_date,
    },
    daily_summary: data.invoice_sync.daily_summary ?? { entry_count: 0, daily_total_sum: 0 },
  };
  updateDailyInvoicePanel(dailyStayContext);
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
  if (hasOpenInvoice) {
    sessionStorage.setItem('dailyStayFileNumber', getStayFileNumber());
  }
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
    await loadDailyStayTypes();
    if (dailySectionsCache.length) await loadDailyEntriesIntoSheet();
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
    await loadDailyStayTypes();
    if (dailySectionsCache.length) await loadDailyEntriesIntoSheet();
    await loadDailyPatientHistory();
    const label = data.created ? 'تم إنشاء فاتورة مسودة' : 'تم تحديث الإقامة';
    showToast(`${label} #${data.invoice?.id}`, 'success');
  } catch (err) {
    showToast(err.message, 'danger');
  }
}

async function openDailyItemsPrint(kind) {
  const file_number = getStayFileNumber();
  if (!file_number) {
    showToast('أدخل رقم ملف المريض أولًا', 'warning');
    return;
  }
  const inv = dailyStayContext?.invoice;
  const from_date =
    fmtStayDate(inv?.admission_date) ||
    document.getElementById('daily-stay-admission')?.value?.trim() ||
    '';
  const to_date =
    fmtStayDate(inv?.discharge_date) ||
    document.getElementById('daily-stay-discharge')?.value?.trim() ||
    getLocalDateString();
  const params = new URLSearchParams({
    kind,
    file_number,
  });
  if (from_date) params.set('from_date', from_date);
  if (to_date) params.set('to_date', to_date);
  window.open(`${DAILY_API}/daily-items/print?${params}`, '_blank');
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

function dailyFormatNumber(n, decimals = 2) {
  const num = Number(n) || 0;
  return num.toLocaleString('ar-EG', {
    minimumFractionDigits: 0,
    maximumFractionDigits: decimals,
  });
}

function dailyParseAmount(text) {
  if (typeof parseDisplayAmount === 'function') return parseDisplayAmount(text);
  return parseFloat(
    String(text || '')
      .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
      .replace(/[٬,]/g, '')
      .replace(/[٫]/g, '.')
      .replace(/[^\d.-]/g, '')
  ) || 0;
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

let dailyPriceListMeta = null;

async function loadDailySections() {
  const res = await apiFetch(`${DAILY_API}/sections?with_services=1`);
  dailySectionsCache = await res.json();
  const plSection = dailySectionsCache.find((s) => s.price_list_id);
  dailyPriceListMeta = plSection
    ? { id: plSection.price_list_id, name: plSection.price_list_name }
    : null;
  renderDailySectionsTable();

  const priceSections = dailySectionsCache.filter((s) => s.category_code && !s.catalog_category);
  const totalPriceServices = priceSections.reduce((sum, s) => sum + (s.services?.length || 0), 0);
  const statusEl = document.getElementById('daily-entry-status');
  if (dailyPriceListMeta?.name && statusEl && dailyStayContext?.invoice?.id) {
    const catalogTotal = dailySectionsCache
      .filter((s) => s.catalog_category)
      .reduce((sum, s) => sum + (s.catalog_count || s.services?.length || 0), 0);
    statusEl.title = `اللائحة: ${dailyPriceListMeta.name} — ${totalPriceServices} خدمة | كتالوج: ${catalogTotal} صنف`;
  }
  if (dailyStayContext?.invoice?.id && priceSections.length && totalPriceServices === 0) {
    showToast('لم تُحمَّل خدمات من اللائحة — تأكد من استيراد اللائحة في الإعدادات', 'warning');
  }
}

function dailyEscapeHtml(text) {
  if (typeof escapeHtml === 'function') return escapeHtml(text);
  return String(text || '');
}

function buildCatalogItemOptionHtml(item, selectedId) {
  const selected = String(selectedId) === String(item.id) ? 'selected' : '';
  const label = item.code ? `${item.code} — ${item.name}` : item.name;
  const unitOpts = item.unit_options || [{ level: 'major', unit: item.unit || '', price: item.price }];
  const unitHint = item.unit ? ` (${item.unit})` : '';
  return `<option value="${item.id}" data-name="${dailyEscapeAttr(item.name)}" data-unit="${dailyEscapeAttr(item.unit || '')}" data-unit-options="${dailyEscapeAttr(JSON.stringify(unitOpts))}" title="${dailyEscapeAttr(item.category_name || item.category || '')}" ${selected}>${label}${unitHint}</option>`;
}

function populateDailyCatalogUnitSelect(tr, sectionCode, catalogItemId, preset = {}) {
  const select = tr?.querySelector(`.daily-catalog[data-section="${sectionCode}"]`);
  const unitSelect = tr?.querySelector(`.daily-catalog-unit[data-section="${sectionCode}"]`);
  if (!select || !unitSelect) return;

  const option = select.querySelector(`option[value="${catalogItemId}"]`);
  if (!option || !catalogItemId) {
    unitSelect.style.display = 'none';
    unitSelect.innerHTML = '<option value="">— وحدة —</option>';
    return;
  }

  let unitOptions = [];
  try {
    unitOptions = JSON.parse(option.dataset.unitOptions || '[]');
  } catch {
    unitOptions = [];
  }
  if (!unitOptions.length) {
    unitOptions = [{ level: 'major', unit: option.dataset.unit || '', price: 0 }];
  }

  unitSelect.innerHTML = unitOptions
    .map((opt) => {
      const selected =
        preset.catalog_unit_level === opt.level ||
        (preset.catalog_unit && preset.catalog_unit === opt.unit)
          ? 'selected'
          : '';
      return `<option value="${opt.level}" data-unit="${dailyEscapeAttr(opt.unit)}" data-price="${opt.price}" ${selected}>${dailyEscapeAttr(opt.unit)} — ${dailyFmt(opt.price)}</option>`;
    })
    .join('');

  unitSelect.style.display = unitOptions.length > 1 ? '' : 'none';
  if (!unitSelect.value && unitOptions.length) {
    unitSelect.value = preset.catalog_unit_level || unitOptions[0].level;
  }
}

function applyDailyCatalogUnitPrice(tr, sectionCode) {
  const unitSelect = tr?.querySelector(`.daily-catalog-unit[data-section="${sectionCode}"]`);
  const amountInput = tr?.querySelector(`.daily-amount[data-section="${sectionCode}"]`);
  if (!unitSelect || !amountInput) return;
  const opt = unitSelect.selectedOptions[0];
  const price = Number(opt?.dataset.price) || 0;
  if (price > 0) {
    amountInput.value =
      typeof formatAmountInput === 'function' ? formatAmountInput(price) : dailyFormatInput(price);
    amountInput.dataset.manualAmount = '0';
  }
}

function refreshCatalogSelectsInRows() {
  document.querySelectorAll('.daily-entry-row').forEach((tr) => {
    for (const section of dailySectionsCache) {
      if (!section.catalog_category && !section.uses_catalog) continue;
      const select = tr.querySelector(`.daily-catalog[data-section="${section.code}"]`);
      if (!select) continue;
      const currentVal = select.value;
      const items = section.services || [];
      const options = items.map((item) => buildCatalogItemOptionHtml(item, currentVal)).join('');
      select.innerHTML = `<option value="">— صنف —</option>${options}`;
      if (currentVal && items.some((item) => String(item.id) === String(currentVal))) {
        select.value = currentVal;
        populateDailyCatalogUnitSelect(tr, section.code, currentVal);
      }
    }
  });
}

function buildDailyStayTypeOptions(selectedId = '') {
  if (!dailyStayTypesCache.length) return '<option value="">—</option>';
  return (
    '<option value="">—</option>' +
    dailyStayTypesCache
      .map(
        (t) =>
          `<option value="${t.id}" data-rate="${t.daily_rate || 0}" ${String(selectedId) === String(t.id) ? 'selected' : ''}>${t.name}</option>`
      )
      .join('')
  );
}

function dailyEscapeAttr(text) {
  return String(text || '').replace(/"/g, '&quot;');
}

function getLineForSection(entry, sectionCode) {
  return (entry?.lines || []).find((line) => line.section_code === sectionCode) || {};
}

function renderDailyCellHtml(section, line = {}) {
  if (section.input_type === 'date') {
    const val = line.extra_date ? String(line.extra_date).slice(0, 10) : '';
    return `<td><input type="date" class="form-control form-control-sm daily-field" data-section="${section.code}" data-type="date" value="${val}"></td>`;
  }
  if (section.input_type === 'text') {
    return `<td><input type="text" class="form-control form-control-sm daily-field" data-section="${section.code}" data-type="text" placeholder="${section.name}" value="${dailyEscapeAttr(line.extra_text || '')}"></td>`;
  }

  const usesCatalog = section.catalog_category || section.uses_catalog;
  const selectedId = usesCatalog
    ? line.catalog_item_id || ''
    : line.service_id || section.default_service?.id || '';
  const amountVal =
    line.amount != null && line.amount !== '' && Number(line.amount) > 0
      ? typeof formatAmountInput === 'function'
        ? formatAmountInput(line.amount)
        : dailyFormatInput(line.amount)
      : '';

  const itemOptions = (section.services || [])
    .map((item) => buildCatalogItemOptionHtml(item, selectedId))
    .join('');

  const selectClass = usesCatalog ? 'daily-catalog' : 'daily-service';
  const placeholder = usesCatalog ? '— صنف —' : '— خدمة —';
  const unitSelect =
    usesCatalog
      ? `<select class="form-select form-select-sm mb-1 daily-catalog-unit" data-section="${section.code}" style="display:none"><option value="">— وحدة —</option></select>`
      : '';
  const itemSelect =
    section.services?.length > 0
      ? `<select class="form-select form-select-sm mb-1 ${selectClass}" data-section="${section.code}"><option value="">${placeholder}</option>${itemOptions}</select>${unitSelect}`
      : usesCatalog
        ? `<small class="text-muted d-block mb-1">لا أصناف نشطة — راجع كتالوج الأصناف في الإعدادات</small>`
        : '';

  return `<td>${itemSelect}<input type="text" inputmode="decimal" class="form-control form-control-sm daily-field daily-amount comma-amount" data-section="${section.code}" data-type="amount" data-manual-amount="${amountVal ? '1' : '0'}" value="${amountVal}"></td>`;
}

function renderDailySectionsTable() {
  const head = document.getElementById('daily-sections-head');
  const subhead = document.getElementById('daily-sections-subhead');
  if (!head) return;

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

  head.innerHTML =
    '<th rowspan="2" class="daily-meta-th">التاريخ</th><th rowspan="2" class="daily-meta-th">نوع الإقامة</th>' +
    blocks
      .map((block) => {
        if (block.type === 'consultations') {
          return '<th colspan="3" class="text-center daily-group-th">الكشوفات</th>';
        }
        return `<th rowspan="2" class="daily-section-th" title="${block.section.category_code || ''}">${block.section.name}</th>`;
      })
      .join('') +
    '<th rowspan="2" class="daily-meta-th">إجمالي</th><th rowspan="2" class="daily-meta-th"></th>';

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

  const colCount = dailySectionsCache.length + 4;
  const footLabel = document.getElementById('daily-total-foot-label');
  const footSpacer = document.getElementById('daily-total-foot-spacer');
  if (footLabel) footLabel.colSpan = Math.max(colCount - 2, 1);
  if (footSpacer) footSpacer.colSpan = Math.max(colCount - 3, 0);
}

function bindDailyRowEvents(tr) {
  tr.querySelectorAll('.daily-field, .daily-service, .daily-catalog, .daily-catalog-unit, .daily-row-date, .daily-row-stay-type').forEach((el) => {
    el.addEventListener('input', () => {
      if (el.classList.contains('daily-amount')) el.dataset.manualAmount = '1';
      updateRowTotal(tr);
      updateDailyGrandTotal();
    });
    el.addEventListener('change', (event) => {
      if (el.classList.contains('daily-service') || el.classList.contains('daily-catalog')) onDailyServicePick(event);
      if (el.classList.contains('daily-catalog-unit')) {
        const section = el.dataset.section;
        applyDailyCatalogUnitPrice(tr, section);
      }
      if (el.classList.contains('daily-row-stay-type')) applyStayTypeRateToRow(tr);
      updateRowTotal(tr);
      updateDailyGrandTotal();
    });
  });

  tr.querySelector('.daily-row-delete')?.addEventListener('click', () => deleteDailyEntryRow(tr));

  if (typeof bindCommaAmountInputs === 'function') bindCommaAmountInputs(tr);
}

function applyDefaultPricesForRow(tr) {
  for (const section of dailySectionsCache) {
    if (section.input_type !== 'amount') continue;
    if (section.catalog_category || section.uses_catalog) continue;
    const select = tr.querySelector(`.daily-service[data-section="${section.code}"]`);
    const amountInput = tr.querySelector(`.daily-amount[data-section="${section.code}"]`);
    if (!amountInput || dailyParseAmount(amountInput.value) > 0) continue;

    if (select && section.default_service?.id) {
      select.value = String(section.default_service.id);
      const price = Number(section.default_service.price) || 0;
      if (price > 0) {
        amountInput.value =
          typeof formatAmountInput === 'function' ? formatAmountInput(price) : dailyFormatInput(price);
        amountInput.dataset.manualAmount = '0';
      }
      continue;
    }

    if (select?.value) {
      const price = dailyParseAmount(select.selectedOptions[0]?.dataset.price);
      if (price > 0) {
        amountInput.value =
          typeof formatAmountInput === 'function' ? formatAmountInput(price) : dailyFormatInput(price);
        amountInput.dataset.manualAmount = '0';
      }
    }
  }
}

function getSectionService(sectionCode, serviceId) {
  const section = dailySectionsCache.find((s) => s.code === sectionCode);
  const svc = section?.services?.find((s) => String(s.id) === String(serviceId)) || null;
  if (!svc) return null;
  return {
    ...svc,
    price: Number(svc.list_price ?? svc.price) || 0,
    category_name: svc.category_name || '',
  };
}

function findAccommodationServiceForStayType(stayType) {
  const accSection = dailySectionsCache.find((s) => s.code === 'accommodation');
  if (!accSection?.services?.length || !stayType?.name) return null;
  const stayName = String(stayType.name).trim();
  return (
    accSection.services.find((s) => String(s.name).trim() === stayName) ||
    accSection.services.find((s) => String(s.name).includes(stayName)) ||
    accSection.services.find((s) => stayName.includes(String(s.name)))
  );
}

function applyStayTypeRateToRow(tr) {
  const select = tr.querySelector('.daily-row-stay-type');
  const stayTypeId = select?.value;
  if (!stayTypeId) return;
  const stayType = dailyStayTypesCache.find((t) => String(t.id) === String(stayTypeId));
  const accInput = tr.querySelector('.daily-amount[data-section="accommodation"]');
  const accSelect = tr.querySelector('.daily-service[data-section="accommodation"]');
  if (!accInput || dailyParseAmount(accInput.value) > 0) return;

  const match = findAccommodationServiceForStayType(stayType);
  if (!match || !accSelect) return;

  accSelect.value = String(match.id);
  onDailyServicePick({ target: accSelect });
}

function createDailyEntryRow(entry = {}) {
  const tr = document.createElement('tr');
  tr.className = 'daily-entry-row';
  if (entry.id) tr.dataset.entryId = entry.id;
  if (entry.notes) tr.dataset.entryNotes = entry.notes;

  const dateVal = getLocalDateString();
  tr.innerHTML = `
    <td><input type="date" class="form-control form-control-sm daily-row-date fw-bold bg-light" value="${dateVal}" readonly tabindex="-1"></td>
    <td><select class="form-select form-select-sm daily-row-stay-type">${buildDailyStayTypeOptions(entry.stay_type_id)}</select></td>
    ${dailySectionsCache.map((section) => renderDailyCellHtml(section, getLineForSection(entry, section.code))).join('')}
    <td class="daily-row-total fw-bold text-nowrap"></td>
    <td class="text-center"><button type="button" class="btn btn-sm btn-outline-danger daily-row-delete" title="حذف اليوم">×</button></td>
  `;

  bindDailyRowEvents(tr);
  for (const section of dailySectionsCache) {
    if (!section.catalog_category && !section.uses_catalog) continue;
    const line = getLineForSection(entry, section.code);
    if (line.catalog_item_id) {
      populateDailyCatalogUnitSelect(tr, section.code, line.catalog_item_id, line);
      if (!line.unit_price && !line.amount) {
        applyDailyCatalogUnitPrice(tr, section.code);
      }
    }
  }
  updateRowTotal(tr);
  return tr;
}

function addDailyEntryRow(preset = {}) {
  const body = document.getElementById('daily-sections-body');
  if (!body) return;
  const entryDate = getLocalDateString();
  body.appendChild(createDailyEntryRow({ ...preset, entry_date: entryDate }));
  setDailyTodayDate();
  updateDailyGrandTotal();
}

function rowHasChargeData(tr) {
  let hasValue = false;
  tr.querySelectorAll('.daily-amount').forEach((input) => {
    if (dailyParseAmount(input.value) > 0) hasValue = true;
  });
  tr.querySelectorAll('.daily-field[data-type="date"]').forEach((input) => {
    if (input.value) hasValue = true;
  });
  tr.querySelectorAll('.daily-field[data-type="text"]').forEach((input) => {
    if (input.value?.trim()) hasValue = true;
  });
  return hasValue;
}

function collectDailyLinesFromRow(tr) {
  return dailySectionsCache.map((section) => {
    const field = tr.querySelector(`.daily-field[data-section="${section.code}"]`);
    const catalogSelect = tr.querySelector(`.daily-catalog[data-section="${section.code}"]`);
    const serviceSelect = tr.querySelector(`.daily-service[data-section="${section.code}"]`);
    const usesCatalog = section.catalog_category || section.uses_catalog;
    if (section.input_type === 'date') {
      return { section_code: section.code, extra_date: field?.value || null };
    }
    if (section.input_type === 'text') {
      return { section_code: section.code, extra_text: field?.value || '' };
    }
    const unitSelect = tr.querySelector(`.daily-catalog-unit[data-section="${section.code}"]`);
    const unitOpt = unitSelect?.selectedOptions?.[0];
    return {
      section_code: section.code,
      catalog_item_id: usesCatalog && catalogSelect?.value ? Number(catalogSelect.value) : null,
      catalog_unit_level: usesCatalog && unitSelect?.value ? unitSelect.value : null,
      catalog_unit: usesCatalog && unitOpt?.dataset?.unit ? unitOpt.dataset.unit : null,
      service_id: !usesCatalog && serviceSelect?.value ? Number(serviceSelect.value) : null,
      amount: dailyParseAmount(field?.value),
      quantity: 1,
    };
  });
}

function updateRowTotal(tr) {
  const amountSections = new Set(
    dailySectionsCache.filter((s) => s.input_type === 'amount').map((s) => s.code)
  );
  let total = 0;
  tr.querySelectorAll('.daily-amount').forEach((input) => {
    if (amountSections.has(input.dataset.section)) total += dailyParseAmount(input.value);
  });
  const cell = tr.querySelector('.daily-row-total');
  if (cell) {
    const rounded = Math.round(total * 100) / 100;
    cell.textContent = rounded > 0 ? dailyFmt(rounded) : '';
  }
}

function updateDailyGrandTotal() {
  let total = 0;
  document.querySelectorAll('.daily-entry-row .daily-row-total').forEach((cell) => {
    total += dailyParseAmount(cell.textContent);
  });
  const display = document.getElementById('daily-total-display');
  if (display) {
    const rounded = Math.round(total * 100) / 100;
    display.textContent = rounded > 0 ? dailyFmt(rounded) : '';
  }
}

async function loadDailyEntriesIntoSheet() {
  const body = document.getElementById('daily-sections-body');
  if (!body) return;
  const loadId = ++dailyEntriesLoadSeq;
  body.innerHTML = '';

  const fileNumber = getStayFileNumber();
  if (!fileNumber || !dailyStayContext?.invoice?.id) {
    if (loadId !== dailyEntriesLoadSeq) return;
    addDailyEntryRow();
    setDailyTodayDate();
    return;
  }

  try {
    const res = await apiFetch(
      `${DAILY_API}/entries?file_number=${encodeURIComponent(fileNumber)}&include_lines=1&limit=120`
    );
    if (loadId !== dailyEntriesLoadSeq) return;
    const entries = await res.json();
    if (loadId !== dailyEntriesLoadSeq) return;
    const today = getLocalDateString();
    const todayEntries = entries.filter((entry) => fmtStayDate(entry.entry_date) === today);
    if (!todayEntries.length) {
      addDailyEntryRow();
      setDailyTodayDate();
      return;
    }
    const seenEntryIds = new Set();
    for (const entry of todayEntries) {
      if (entry.id) {
        if (seenEntryIds.has(entry.id)) continue;
        seenEntryIds.add(entry.id);
      }
      body.appendChild(createDailyEntryRow(entry));
    }
    addDailyEntryRow();
    setDailyTodayDate();
    updateDailyGrandTotal();
  } catch (err) {
    if (loadId !== dailyEntriesLoadSeq) return;
    console.error(err);
    addDailyEntryRow();
    setDailyTodayDate();
  }
}

function onDailyServicePick(event) {
  const select = event.target;
  if (!select.classList.contains('daily-service') && !select.classList.contains('daily-catalog')) return;
  const isCatalog = select.classList.contains('daily-catalog');
  const tr = select.closest('.daily-entry-row');
  const section = select.dataset.section;
  if (isCatalog) {
    if (!select.value) {
      const unitSelect = tr?.querySelector(`.daily-catalog-unit[data-section="${section}"]`);
      if (unitSelect) {
        unitSelect.style.display = 'none';
        unitSelect.innerHTML = '<option value="">— وحدة —</option>';
      }
      const amountInput = tr?.querySelector(`.daily-amount[data-section="${section}"]`);
      if (amountInput) amountInput.value = '';
      if (tr) updateRowTotal(tr);
      updateDailyGrandTotal();
      return;
    }
    populateDailyCatalogUnitSelect(tr, section, select.value);
    applyDailyCatalogUnitPrice(tr, section);
    if (tr) updateRowTotal(tr);
    updateDailyGrandTotal();
    return;
  }
  const service = getSectionService(section, select.value);
  const amountInput = tr?.querySelector(`.daily-amount[data-section="${section}"]`);
  if (!amountInput || !service) {
    if (amountInput && !select.value) amountInput.value = '';
    if (tr) updateRowTotal(tr);
    updateDailyGrandTotal();
    return;
  }
  const price = Number(service.price) || 0;
  if (price > 0) {
    amountInput.value =
      typeof formatAmountInput === 'function' ? formatAmountInput(price) : dailyFormatInput(price);
    amountInput.dataset.manualAmount = '0';
    const unit = service.unit ? ` — ${service.unit}` : '';
    if (service.category_name) {
      amountInput.title = isCatalog
        ? `${service.category_name}${unit} — السعر من الكتالوج`
        : `${service.category_name} — السعر من اللائحة`;
    }
  } else {
    amountInput.value = '';
    showToast(
      isCatalog
        ? `الصنف «${service.name}» ليس له سعر في الكتالوج`
        : `الخدمة «${service.name}» ليس لها سعر في اللائحة`,
      'warning'
    );
  }
  if (tr) updateRowTotal(tr);
  updateDailyGrandTotal();
}

async function reloadDailyCatalogSectionsFromSettings() {
  await loadDailySections();
  refreshCatalogSelectsInRows();
}

async function deleteDailyEntryById(entryId) {
  if (!dailyCan('daily_charges.manage')) {
    showToast('ليس لديك صلاحية الحذف', 'warning');
    return false;
  }
  if (!entryId) return false;
  if (!confirm('حذف حركة هذا اليوم؟')) return false;

  try {
    const res = await apiFetch(`${DAILY_API}/entries/${entryId}`, { method: 'DELETE' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'فشل الحذف');
    applyDailyInvoiceSync(data);
    showToast('تم حذف الحركة', 'success');

    await loadDailyEntriesIntoSheet();
    await loadDailyPatientHistory();
    const fileNumber = getStayFileNumber();
    if (data.invoice_sync?.invoice_id && fileNumber) {
      await refreshInvoiceFormAfterDailySave(fileNumber, data.invoice_sync.invoice_id);
    }
    if (fileNumber) await loadOpenPatientStay(fileNumber);
    return true;
  } catch (err) {
    showToast(err.message, 'danger');
    return false;
  }
}

async function deleteDailyEntryRow(tr) {
  const entryId = tr.dataset.entryId;
  if (!entryId) {
    tr.remove();
    if (!document.querySelector('.daily-entry-row')) addDailyEntryRow();
    updateDailyGrandTotal();
    return;
  }
  await deleteDailyEntryById(entryId);
}

function collectDailyRowsForSave() {
  const notes = document.getElementById('daily-notes')?.value || '';
  const today = getLocalDateString();
  const rows = [];
  document.querySelectorAll('.daily-entry-row').forEach((tr) => {
    if (!rowHasChargeData(tr)) return;
    const entryId = tr.dataset.entryId ? Number(tr.dataset.entryId) : null;
    rows.push({
      entry_id: entryId,
      entry_date: today,
      stay_type_id: tr.querySelector('.daily-row-stay-type')?.value || null,
      notes: tr.dataset.entryNotes || notes,
      lines: collectDailyLinesFromRow(tr),
    });
  });
  return rows;
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
          <td class="text-nowrap">
            <button type="button" class="btn btn-sm btn-outline-primary daily-open-entry" data-date="${String(entry.entry_date).slice(0, 10)}">فتح</button>
            ${
              dailyCan('daily_charges.manage')
                ? `<button type="button" class="btn btn-sm btn-outline-danger daily-delete-entry" data-id="${entry.id}" title="حذف">×</button>`
                : ''
            }
          </td>
        </tr>`
      )
      .join('');
    tbody.querySelectorAll('.daily-open-entry').forEach((btn) => {
      btn.addEventListener('click', () => {
        const date = btn.dataset.date;
        const today = getLocalDateString();
        if (date !== today) {
          showToast('يُسجَّل اليوم الحالي فقط في هذه الشاشة — راجع السجل للأيام السابقة', 'info');
          return;
        }
        setDailyTodayDate();
        const row = [...document.querySelectorAll('.daily-entry-row')].find(
          (tr) => tr.querySelector('.daily-row-date')?.value === today
        );
        if (row) {
          row.scrollIntoView({ behavior: 'smooth', block: 'center' });
          row.classList.add('table-info');
          setTimeout(() => row.classList.remove('table-info'), 2000);
        } else {
          addDailyEntryRow();
        }
      });
    });
    tbody.querySelectorAll('.daily-delete-entry').forEach((btn) => {
      btn.addEventListener('click', () => deleteDailyEntryById(btn.dataset.id));
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
  const entries = collectDailyRowsForSave();
  if (!file_number || !entries.length) {
    showToast('أضف صفًا واحدًا على الأقل مع بيانات', 'warning');
    return;
  }

  try {
    const res = await apiFetch(`${DAILY_API}/entries/batch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        file_number,
        patient_name: getStayPatientName(),
        entries,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'فشل الحفظ');

    dailyCurrentEntryId = data.saved?.[data.saved.length - 1]?.id || null;

    const invLabel = data.invoice_sync.created ? 'تم إنشاء فاتورة مسودة' : 'تم تحديث الفاتورة';
    const toastMsg = `تم حفظ ${data.count} صف — ${invLabel} #${data.invoice_sync.invoice_id}`;
    await refreshInvoiceFormAfterDailySave(file_number, data.invoice_sync.invoice_id);
    await loadOpenPatientStay(file_number);
    await loadDailyEntriesIntoSheet();
    await loadDailyPatientHistory();

    const statusEl = document.getElementById('daily-entry-status');
    if (statusEl) statusEl.textContent = `محفوظ — ${data.count} صف`;
    showToast(toastMsg, 'success');
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
  try {
    const res = await apiFetch('/api/settings/stay-types');
    dailyStayTypesCache = await res.json();
  } catch (err) {
    console.error(err);
    dailyStayTypesCache = [];
  }
}

function clearDailyForm() {
  dailyCurrentEntryId = null;
  document.getElementById('daily-notes').value = '';
  document.getElementById('daily-entry-status').textContent = 'جديد';
  setDailyTodayDate();
  const body = document.getElementById('daily-sections-body');
  if (body) {
    body.innerHTML = '';
    addDailyEntryRow();
  }
  updateDailyGrandTotal();
}

async function initDailyChargesView() {
  if (!dailyCan('daily_charges.view')) return;
  if (typeof loadFinancialTreatments === 'function') await loadFinancialTreatments();
  if (!dailySectionsCache.length) await loadDailySections();
  setDailyTodayDate();
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
    await loadDailyEntriesIntoSheet();
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
    if (existingLineIds.has(String(item.daily_entry_line_id))) {
      const row = [...document.querySelectorAll('#items-tbody tr')].find(
        (tr) => String(tr.dataset.dailyLineId) === String(item.daily_entry_line_id)
      );
      if (row) {
        if (item.description) {
          const descEl = row.querySelector('[data-field="description"]');
          if (descEl) descEl.value = item.description;
        }
        const qtyEl = row.querySelector('[data-field="quantity"]');
        const amtEl = row.querySelector('[data-field="amount"]');
        const totalEl = row.querySelector('[data-field="total"]');
        if (qtyEl && item.quantity != null && item.quantity !== '') {
          qtyEl.value =
            typeof formatAmountInput === 'function'
              ? formatAmountInput(item.quantity, 0)
              : String(item.quantity);
        }
        if (amtEl && item.amount != null && item.amount !== '') {
          amtEl.value =
            typeof formatAmountInput === 'function' ? formatAmountInput(item.amount) : String(item.amount);
        }
        if (totalEl && item.total != null && item.total !== '') {
          totalEl.value = typeof fmt === 'function' ? fmt(item.total) : String(item.total);
        } else if (typeof updateInvoiceRowLineTotal === 'function') {
          updateInvoiceRowLineTotal(row);
        }
      }
      continue;
    }
    appendInvoiceItemRow(item);
    existingLineIds.add(String(item.daily_entry_line_id));
    added++;
  }
  if (added > 0) {
    document.querySelectorAll('#items-tbody tr').forEach((row) => {
      if (typeof updateInvoiceRowLineTotal === 'function') updateInvoiceRowLineTotal(row);
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
  document.querySelectorAll('.daily-entry-row').forEach((tr) => applyStayTypeRateToRow(tr));
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
  document.getElementById('daily-print-medicines-btn')?.addEventListener('click', () =>
    openDailyItemsPrint('medicines')
  );
  document.getElementById('daily-print-supplies-btn')?.addEventListener('click', () =>
    openDailyItemsPrint('supplies')
  );
  document.getElementById('daily-print-both-btn')?.addEventListener('click', () =>
    openDailyItemsPrint('medicines_supplies')
  );
  document.getElementById('daily-print-radiology-btn')?.addEventListener('click', () =>
    openDailyItemsPrint('radiology')
  );
  document.getElementById('daily-print-laboratory-btn')?.addEventListener('click', () =>
    openDailyItemsPrint('laboratory')
  );
  document.getElementById('daily-save-btn')?.addEventListener('click', saveDailyEntry);
  document.getElementById('daily-clear-btn')?.addEventListener('click', clearDailyForm);
  document.getElementById('daily-history-btn')?.addEventListener('click', showDailyEntryHistory);
  document.getElementById('daily-add-row-btn')?.addEventListener('click', () => addDailyEntryRow());
  document.getElementById('import-daily-charges-btn')?.addEventListener('click', importDailyChargesToInvoice);
});

window.initDailyChargesView = initDailyChargesView;
window.importDailyChargesToInvoice = importDailyChargesToInvoice;
window.syncDailyChargeRowsFromTotals = syncDailyChargeRowsFromTotals;
window.reloadDailyCatalogSectionsFromSettings = reloadDailyCatalogSectionsFromSettings;
