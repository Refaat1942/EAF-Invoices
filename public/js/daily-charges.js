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
  await loadDailyCatalogStats();

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

async function loadDailyCatalogStats() {
  const el = document.getElementById('daily-catalog-stats');
  if (!el) return;
  try {
    const res = await apiFetch(`${DAILY_API}/catalog/stats`);
    if (!res.ok) return;
    const stats = await res.json();
    if (!stats.total) {
      el.textContent = 'كتالوج الأصناف فارغ — استورد ملف Excel/CSV أو أضف أصناف';
      return;
    }
    const parts = (stats.by_category || []).map((row) => `${row.category}: ${row.count}`);
    el.textContent = `كتالوج: ${stats.total} صنف (${parts.join(' · ')})`;
  } catch (err) {
    console.error(err);
  }
}

const DAILY_CATALOG_CATEGORY_LABELS = {
  Medicine: 'أدوية',
  Supplies: 'مستلزمات',
  Cosmetics: 'مستحضرات تجميل',
};

function dailyComputeSellingPrice(cost, markup) {
  const c = dailyParseAmount(cost);
  const m = dailyParseAmount(markup);
  return Math.round((c + (c * m) / 100) * 100) / 100;
}

function toggleCatalogPricingFields(mode = 'add') {
  const prefix = mode === 'edit' ? 'edit' : 'add';
  const category = document.getElementById(`daily-catalog-${prefix}-category`)?.value;
  const isSupplies = category === 'Supplies';
  const priceWrap = document.getElementById(`daily-catalog-${prefix}-price-wrap`);
  const costWrap = document.getElementById(`daily-catalog-${prefix}-cost-wrap`);
  const markupWrap = document.getElementById(`daily-catalog-${prefix}-markup-wrap`);
  const sellingWrap = document.getElementById(`daily-catalog-${prefix}-selling-wrap`);
  if (priceWrap) priceWrap.style.display = isSupplies ? 'none' : '';
  if (costWrap) costWrap.style.display = isSupplies ? '' : 'none';
  if (markupWrap) markupWrap.style.display = isSupplies ? '' : 'none';
  if (sellingWrap) sellingWrap.style.display = isSupplies ? '' : 'none';
  const priceEl = document.getElementById(`daily-catalog-${prefix}-price`);
  if (priceEl) priceEl.required = !isSupplies;
  const costEl = document.getElementById(`daily-catalog-${prefix}-cost`);
  if (costEl) costEl.required = isSupplies;
  if (isSupplies) updateCatalogSellingPreview(mode);
}

function updateCatalogSellingPreview(mode = 'add') {
  const prefix = mode === 'edit' ? 'edit' : 'add';
  const selling = dailyComputeSellingPrice(
    document.getElementById(`daily-catalog-${prefix}-cost`)?.value,
    document.getElementById(`daily-catalog-${prefix}-markup`)?.value
  );
  const el = document.getElementById(`daily-catalog-${prefix}-selling`);
  if (!el) return;
  el.value =
    selling > 0
      ? typeof formatAmountInput === 'function'
        ? formatAmountInput(selling)
        : String(selling)
      : '';
}

function buildCatalogItemPayload(mode = 'add') {
  const prefix = mode === 'edit' ? 'edit' : 'add';
  const category = document.getElementById(`daily-catalog-${prefix}-category`)?.value;
  const base = {
    code: document.getElementById(`daily-catalog-${prefix}-code`)?.value.trim(),
    name: document.getElementById(`daily-catalog-${prefix}-name`)?.value.trim(),
    category,
    unit: document.getElementById(`daily-catalog-${prefix}-unit`)?.value.trim() || 'مرة',
  };
  if (category === 'Supplies') {
    return {
      ...base,
      cost_price: dailyParseAmount(document.getElementById(`daily-catalog-${prefix}-cost`)?.value),
      markup_percent: dailyParseAmount(document.getElementById(`daily-catalog-${prefix}-markup`)?.value),
    };
  }
  return {
    ...base,
    price: dailyParseAmount(document.getElementById(`daily-catalog-${prefix}-price`)?.value),
  };
}

function dailyEscapeHtml(text) {
  if (typeof escapeHtml === 'function') return escapeHtml(text);
  return String(text || '');
}

function buildCatalogItemOptionHtml(item, selectedId) {
  const selected = String(selectedId) === String(item.id) ? 'selected' : '';
  const label = item.code ? `${item.code} — ${item.name}` : item.name;
  const unitHint = item.unit ? ` (${item.unit})` : '';
  return `<option value="${item.id}" data-name="${dailyEscapeAttr(item.name)}" data-unit="${dailyEscapeAttr(item.unit || '')}" title="${dailyEscapeAttr(item.category_name || item.category || '')}" ${selected}>${label}${unitHint}</option>`;
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
      }
    }
  });
}

async function refreshDailyCatalogAfterChange() {
  await loadDailySections();
  refreshCatalogSelectsInRows();
  await loadDailyCatalogStats();
  const collapse = document.getElementById('daily-catalog-manage-collapse');
  if (collapse?.classList.contains('show')) {
    await loadDailyCatalogManageTable();
  }
}

function renderDailyCatalogManageRow(item) {
  const label = DAILY_CATALOG_CATEGORY_LABELS[item.category] || item.category;
  const priceCell =
    item.category === 'Supplies'
      ? `<small class="d-block text-muted">تكلفة: ${dailyFmt(item.cost_price || 0)}</small>
         <small class="d-block text-muted">ربح: ${dailyFmt(item.markup_percent || 0)}%</small>
         <strong>بيع: ${dailyFmt(item.price)}</strong>`
      : dailyFmt(item.price);
  const statusBadge = item.is_active
    ? '<span class="badge bg-success">نشط</span>'
    : '<span class="badge bg-secondary">موقوف</span>';
  const canManage = dailyCan('daily_charges.manage');
  const actions = canManage
    ? `<button type="button" class="btn btn-outline-primary btn-sm" data-catalog-edit="${item.id}">تعديل</button>
       <button type="button" class="btn btn-outline-${item.is_active ? 'warning' : 'success'} btn-sm" data-catalog-toggle="${item.id}" data-catalog-active="${item.is_active ? '1' : '0'}">${item.is_active ? 'إيقاف' : 'تفعيل'}</button>`
    : '';
  const rowClass = item.is_active ? '' : 'table-secondary';
  return `<tr class="${rowClass}">
    <td class="fw-bold">${dailyEscapeHtml(item.code)}</td>
    <td>${dailyEscapeHtml(item.name)}</td>
    <td>${dailyEscapeHtml(label)}</td>
    <td>${dailyEscapeHtml(item.unit || '')}</td>
    <td>${priceCell}</td>
    <td>${statusBadge}</td>
    <td class="d-flex gap-1 flex-wrap">${actions}</td>
  </tr>`;
}

function bindDailyCatalogManageRowActions() {
  const body = document.getElementById('daily-catalog-manage-body');
  if (!body) return;
  body.querySelectorAll('[data-catalog-edit]').forEach((btn) => {
    btn.addEventListener('click', () => openDailyCatalogEditModal(Number(btn.dataset.catalogEdit)));
  });
  body.querySelectorAll('[data-catalog-toggle]').forEach((btn) => {
    btn.addEventListener('click', () =>
      toggleDailyCatalogItemActive(Number(btn.dataset.catalogToggle), btn.dataset.catalogActive !== '1')
    );
  });
}

async function loadDailyCatalogManageTable() {
  if (!dailyCan('daily_charges.view')) return;
  const body = document.getElementById('daily-catalog-manage-body');
  if (!body) return;
  body.innerHTML = '<tr><td colspan="7" class="text-center text-muted">جاري التحميل...</td></tr>';

  const category = document.getElementById('daily-catalog-filter-category')?.value || '';
  const search = document.getElementById('daily-catalog-filter-search')?.value.trim() || '';
  const params = new URLSearchParams({ active_only: '0' });
  if (category) params.set('category', category);
  if (search) params.set('search', search);

  try {
    const res = await apiFetch(`${DAILY_API}/catalog?${params}`);
    const items = await res.json();
    if (!res.ok) throw new Error(items.error || 'فشل التحميل');
    if (!items.length) {
      body.innerHTML = '<tr><td colspan="7" class="text-center text-muted">لا توجد أصناف</td></tr>';
      return;
    }
    body.innerHTML = items.map((item) => renderDailyCatalogManageRow(item)).join('');
    bindDailyCatalogManageRowActions();
  } catch (err) {
    body.innerHTML = `<tr><td colspan="7" class="text-center text-danger">${dailyEscapeHtml(err.message)}</td></tr>`;
  }
}

async function submitDailyCatalogAdd(event) {
  event.preventDefault();
  if (!dailyCan('daily_charges.manage')) {
    showToast('ليس لديك صلاحية الإضافة', 'warning');
    return;
  }
  const payload = buildCatalogItemPayload('add');
  try {
    const res = await apiFetch(`${DAILY_API}/catalog`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'فشل الإضافة');
    showToast('تم إضافة الصنف', 'success');
    const form = document.getElementById('daily-catalog-add-form');
    if (form) form.reset();
    const unitEl = document.getElementById('daily-catalog-add-unit');
    if (unitEl) unitEl.value = 'مرة';
    const filterCat = document.getElementById('daily-catalog-filter-category')?.value;
    const addCat = document.getElementById('daily-catalog-add-category');
    if (filterCat && addCat) addCat.value = filterCat;
    toggleCatalogPricingFields('add');
    await refreshDailyCatalogAfterChange();
  } catch (err) {
    showToast(err.message, 'danger');
  }
}

async function openDailyCatalogEditModal(itemId) {
  if (!dailyCan('daily_charges.manage')) return;
  try {
    const res = await apiFetch(`${DAILY_API}/catalog/${itemId}`);
    const item = await res.json();
    if (!res.ok) throw new Error(item.error || 'فشل التحميل');
    document.getElementById('daily-catalog-edit-id').value = item.id;
    document.getElementById('daily-catalog-edit-code').value = item.code || '';
    document.getElementById('daily-catalog-edit-name').value = item.name || '';
    document.getElementById('daily-catalog-edit-category').value = item.category || 'Medicine';
    document.getElementById('daily-catalog-edit-unit').value = item.unit || 'مرة';
    const priceEl = document.getElementById('daily-catalog-edit-price');
    const costEl = document.getElementById('daily-catalog-edit-cost');
    const markupEl = document.getElementById('daily-catalog-edit-markup');
    if (priceEl) {
      priceEl.value =
        typeof formatAmountInput === 'function' ? formatAmountInput(item.price) : String(item.price || '');
    }
    if (costEl) {
      costEl.value =
        item.cost_price != null && typeof formatAmountInput === 'function'
          ? formatAmountInput(item.cost_price)
          : item.cost_price != null
            ? String(item.cost_price)
            : '';
    }
    if (markupEl) {
      markupEl.value =
        item.markup_percent != null && typeof formatAmountInput === 'function'
          ? formatAmountInput(item.markup_percent)
          : item.markup_percent != null
            ? String(item.markup_percent)
            : '';
    }
    toggleCatalogPricingFields('edit');
    const modalEl = document.getElementById('daily-catalog-edit-modal');
    if (modalEl && window.bootstrap) {
      window.bootstrap.Modal.getOrCreateInstance(modalEl).show();
    }
  } catch (err) {
    showToast(err.message, 'danger');
  }
}

async function saveDailyCatalogEdit() {
  if (!dailyCan('daily_charges.manage')) return;
  const id = document.getElementById('daily-catalog-edit-id')?.value;
  if (!id) return;
  const payload = buildCatalogItemPayload('edit');
  try {
    const res = await apiFetch(`${DAILY_API}/catalog/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'فشل الحفظ');
    showToast('تم تحديث الصنف', 'success');
    const modalEl = document.getElementById('daily-catalog-edit-modal');
    if (modalEl && window.bootstrap) {
      window.bootstrap.Modal.getOrCreateInstance(modalEl).hide();
    }
    await refreshDailyCatalogAfterChange();
  } catch (err) {
    showToast(err.message, 'danger');
  }
}

async function toggleDailyCatalogItemActive(id, activate) {
  if (!dailyCan('daily_charges.manage')) return;
  const actionLabel = activate ? 'تفعيل' : 'إيقاف';
  if (!confirm(`${actionLabel} هذا الصنف؟`)) return;
  try {
    const res = await apiFetch(`${DAILY_API}/catalog/${id}/active`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_active: activate }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'فشل التحديث');
    showToast(activate ? 'تم تفعيل الصنف' : 'تم إيقاف الصنف', 'success');
    await refreshDailyCatalogAfterChange();
  } catch (err) {
    showToast(err.message, 'danger');
  }
}

let dailyCatalogSearchTimer = null;

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
    .map((item) => {
      const selected = String(selectedId) === String(item.id) ? 'selected' : '';
      const label =
        usesCatalog && item.code ? `${item.code} — ${item.name}` : item.name;
      const unitHint = usesCatalog && item.unit ? ` (${item.unit})` : '';
      return `<option value="${item.id}" data-name="${dailyEscapeAttr(item.name)}" data-unit="${dailyEscapeAttr(item.unit || '')}" title="${dailyEscapeAttr(item.category_name || '')}" ${selected}>${label}${unitHint}</option>`;
    })
    .join('');

  const selectClass = usesCatalog ? 'daily-catalog' : 'daily-service';
  const placeholder = usesCatalog ? '— صنف —' : '— خدمة —';
  const itemSelect =
    section.services?.length > 0
      ? `<select class="form-select form-select-sm mb-1 ${selectClass}" data-section="${section.code}"><option value="">${placeholder}</option>${itemOptions}</select>`
      : usesCatalog
        ? `<small class="text-muted d-block mb-1">لا أصناف — استورد الكتالوج</small>`
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
  tr.querySelectorAll('.daily-field, .daily-service, .daily-catalog, .daily-row-date, .daily-row-stay-type').forEach((el) => {
    el.addEventListener('input', () => {
      if (el.classList.contains('daily-amount')) el.dataset.manualAmount = '1';
      updateRowTotal(tr);
      updateDailyGrandTotal();
    });
    el.addEventListener('change', (event) => {
      if (el.classList.contains('daily-service') || el.classList.contains('daily-catalog')) onDailyServicePick(event);
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
    return {
      section_code: section.code,
      catalog_item_id: usesCatalog && catalogSelect?.value ? Number(catalogSelect.value) : null,
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

let dailyCatalogImportFile = null;
let dailyCatalogImportState = null;

const DAILY_IMPORT_FIELD_LABELS = {
  code: 'الكود',
  name: 'الاسم',
  category: 'الفئة',
  unit: 'الوحدة',
  price: 'السعر',
  cost_price: 'سعر التكلفة',
  markup_percent: 'نسبة الربح %',
};

function resetDailyCatalogImportModal() {
  dailyCatalogImportState = null;
  document.getElementById('daily-catalog-import-loading').style.display = 'none';
  document.getElementById('daily-catalog-import-step-map').style.display = 'none';
  document.getElementById('daily-catalog-import-step-preview').style.display = 'none';
  document.getElementById('daily-catalog-import-step-result').style.display = 'none';
  document.getElementById('daily-catalog-import-confirm-btn').style.display = 'none';
  document.getElementById('daily-catalog-import-hint').style.display = 'none';
  document.getElementById('daily-catalog-import-errors-wrap').style.display = 'none';
}

function renderDailyCatalogImportMapping(state) {
  const wrap = document.getElementById('daily-catalog-import-mapping');
  if (!wrap || !state) return;
  const headers = state.headers || [];
  const mapping = state.mapping || {};
  const fields = (state.fields || []).filter((f) =>
    ['code', 'name', 'category', 'unit', 'price'].includes(f.key)
  );

  wrap.innerHTML = fields
    .map((field) => {
      const options = headers
        .map(
          (h) =>
            `<option value="${dailyEscapeAttr(h)}" ${mapping[field.key] === h ? 'selected' : ''}>${dailyEscapeHtml(h)}</option>`
        )
        .join('');
      const requiredMark = field.required ? ' *' : '';
      return `<div class="col-md-4 col-lg-3">
        <label class="form-label small fw-bold">${dailyEscapeHtml(field.label || DAILY_IMPORT_FIELD_LABELS[field.key] || field.key)}${requiredMark}</label>
        <select class="form-select form-select-sm daily-import-map" data-field="${field.key}">
          <option value="">— لا يطابق —</option>
          ${options}
        </select>
      </div>`;
    })
    .join('');

  wrap.querySelectorAll('.daily-import-map').forEach((select) => {
    select.addEventListener('change', () => {
      if (!dailyCatalogImportState) return;
      if (select.value) {
        dailyCatalogImportState.mapping[select.dataset.field] = select.value;
      } else {
        delete dailyCatalogImportState.mapping[select.dataset.field];
      }
    });
  });

  const hint = document.getElementById('daily-catalog-import-hint');
  if (hint && state.needs_manual_mapping) {
    hint.style.display = '';
    hint.textContent =
      'راجع تعيين الأعمدة — لم يتم التعرف على بعض الأعمدة المطلوبة تلقائيًا.';
  }

  const countEl = document.getElementById('daily-catalog-import-row-count');
  if (countEl) countEl.textContent = `${state.total_rows || 0} صف في الملف`;
}

function renderDailyCatalogImportPreview(rows = []) {
  const body = document.getElementById('daily-catalog-import-preview-body');
  if (!body) return;
  if (!rows.length) {
    body.innerHTML = '<tr><td colspan="6" class="text-muted text-center">لا توجد صفوف للمعاينة</td></tr>';
    return;
  }
  body.innerHTML = rows
    .map(
      (row) =>
        `<tr>
          <td>${row.row_number || ''}</td>
          <td>${dailyEscapeHtml(row.code)}</td>
          <td>${dailyEscapeHtml(row.name)}</td>
          <td>${dailyEscapeHtml(row.category)}</td>
          <td>${dailyEscapeHtml(row.unit)}</td>
          <td>${dailyFmt(row.price)}</td>
        </tr>`
    )
    .join('');
}

function collectDailyCatalogImportMapping() {
  const mapping = {};
  document.querySelectorAll('.daily-import-map').forEach((select) => {
    if (select.value) mapping[select.dataset.field] = select.value;
  });
  return mapping;
}

async function refreshDailyCatalogImportPreview() {
  if (!dailyCatalogImportFile) return;
  const mapping = collectDailyCatalogImportMapping();
  const formData = new FormData();
  formData.append('file', dailyCatalogImportFile);
  formData.append('mapping', JSON.stringify(mapping));

  document.getElementById('daily-catalog-import-loading').style.display = '';
  try {
    const res = await apiFetch(`${DAILY_API}/catalog/import/analyze`, { method: 'POST', body: formData });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'فشل المعاينة');
    dailyCatalogImportState = data;
    renderDailyCatalogImportMapping(data);
    renderDailyCatalogImportPreview(data.preview_rows || []);
    document.getElementById('daily-catalog-import-step-preview').style.display = '';
    document.getElementById('daily-catalog-import-confirm-btn').style.display = '';
  } catch (err) {
    showToast(err.message, 'danger');
  } finally {
    document.getElementById('daily-catalog-import-loading').style.display = 'none';
  }
}

async function openDailyCatalogImportModal(file) {
  if (!dailyCan('daily_charges.manage')) {
    showToast('ليس لديك صلاحية استيراد الكتالوج', 'warning');
    return;
  }
  if (!file) return;

  dailyCatalogImportFile = file;
  resetDailyCatalogImportModal();

  const modalEl = document.getElementById('daily-catalog-import-modal');
  if (modalEl && window.bootstrap) {
    window.bootstrap.Modal.getOrCreateInstance(modalEl).show();
  }

  document.getElementById('daily-catalog-import-loading').style.display = '';
  document.getElementById('daily-catalog-import-step-map').style.display = '';

  const formData = new FormData();
  formData.append('file', file);

  try {
    const res = await apiFetch(`${DAILY_API}/catalog/import/analyze`, { method: 'POST', body: formData });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'فشل تحليل الملف');
    dailyCatalogImportState = data;
    renderDailyCatalogImportMapping(data);
    renderDailyCatalogImportPreview(data.preview_rows || []);
    document.getElementById('daily-catalog-import-step-preview').style.display = '';
    document.getElementById('daily-catalog-import-confirm-btn').style.display = '';
  } catch (err) {
    showToast(err.message, 'danger');
    if (modalEl && window.bootstrap) {
      window.bootstrap.Modal.getOrCreateInstance(modalEl).hide();
    }
  } finally {
    document.getElementById('daily-catalog-import-loading').style.display = 'none';
  }
}

async function confirmDailyCatalogImport() {
  if (!dailyCatalogImportFile) return;
  const mapping = collectDailyCatalogImportMapping();
  const required = ['code', 'name', 'category', 'price'];
  const missing = required.filter((key) => !mapping[key]);
  if (missing.length) {
    showToast(`يجب تعيين: ${missing.map((k) => DAILY_IMPORT_FIELD_LABELS[k]).join('، ')}`, 'warning');
    return;
  }

  const formData = new FormData();
  formData.append('file', dailyCatalogImportFile);
  formData.append('mapping', JSON.stringify(mapping));

  const confirmBtn = document.getElementById('daily-catalog-import-confirm-btn');
  if (confirmBtn) confirmBtn.disabled = true;

  try {
    const res = await apiFetch(`${DAILY_API}/catalog/import/confirm`, { method: 'POST', body: formData });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'فشل الاستيراد');

    document.getElementById('daily-catalog-import-step-map').style.display = 'none';
    document.getElementById('daily-catalog-import-step-preview').style.display = 'none';
    document.getElementById('daily-catalog-import-step-result').style.display = '';
    document.getElementById('daily-catalog-import-confirm-btn').style.display = 'none';

    const summary = document.getElementById('daily-catalog-import-result-summary');
    if (summary) {
      summary.innerHTML = `تم الاستيراد: <strong>${data.inserted || 0}</strong> مُضاف، <strong>${data.updated || 0}</strong> محدّث، <strong>${data.skipped || 0}</strong> متخطى، <strong>${(data.errors || []).length}</strong> خطأ`;
    }

    const errorsWrap = document.getElementById('daily-catalog-import-errors-wrap');
    const errorsList = document.getElementById('daily-catalog-import-errors-list');
    if (data.errors?.length && errorsWrap && errorsList) {
      errorsWrap.style.display = '';
      errorsList.innerHTML = data.errors
        .slice(0, 30)
        .map(
          (err) =>
            `<li>صف ${err.row || '—'} (${dailyEscapeHtml(err.code || '—')}): ${dailyEscapeHtml(err.message)}</li>`
        )
        .join('');
    }

    await refreshDailyCatalogAfterChange();
    showToast('تم استيراد الكتالوج', 'success');
  } catch (err) {
    showToast(err.message, 'danger');
  } finally {
    if (confirmBtn) confirmBtn.disabled = false;
  }
}

async function importDailyCatalog(file) {
  await openDailyCatalogImportModal(file);
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
    rows.push({
      entry_date: today,
      stay_type_id: tr.querySelector('.daily-row-stay-type')?.value || null,
      notes: tr.dataset.entryNotes || notes,
      lines: collectDailyLinesFromRow(tr),
    });
  });
  return mergeDailyEntriesForSave(rows);
}

function mergeDailyEntriesForSave(entries) {
  if (!entries.length) return [];
  const merged = { entry_date: entries[0].entry_date, stay_type_id: null, notes: '', lines: [] };
  const lineMap = new Map();

  for (const entry of entries) {
    if (entry.stay_type_id) merged.stay_type_id = entry.stay_type_id;
    if (entry.notes) merged.notes = entry.notes;
    for (const line of entry.lines || []) {
      const key = line.section_code;
      const existing = lineMap.get(key);
      if (!existing) {
        lineMap.set(key, { ...line });
        continue;
      }
      if (line.extra_date) existing.extra_date = line.extra_date;
      if (line.extra_text) existing.extra_text = line.extra_text;
      if (line.service_id && existing.service_id && Number(line.service_id) !== Number(existing.service_id)) {
        throw new Error('لا يمكن دمج صفوف بخدمات مختلفة لنفس القسم — احفظ كل صف أو وحّد الخدمة');
      }
      if (line.service_id) existing.service_id = line.service_id;
      const addAmt = Number(line.amount) || 0;
      if (addAmt > 0) {
        existing.amount = (Number(existing.amount) || 0) + addAmt;
        if (line.manual_amount) existing.manual_amount = true;
      }
    }
  }

  merged.lines = [...lineMap.values()];
  return [merged];
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

    if (!data.invoice_sync?.synced) {
      const syncErr = data.invoice_sync?.error || data.invoice_sync?.reason || 'فشل ربط الفاتورة';
      showToast(`تم حفظ الحركة اليومية لكن فشل تحديث الفاتورة: ${syncErr}`, 'danger');
      await loadDailyEntriesIntoSheet();
      await loadDailyPatientHistory();
      return;
    }

    dailyCurrentEntryId = data.saved?.[data.saved.length - 1]?.id || null;

    const invLabel = data.invoice_sync.created ? 'تم إنشاء فاتورة مسودة' : 'تم تحديث الفاتورة';
    const toastMsg = `تم حفظ ${data.count} يوم — ${invLabel} #${data.invoice_sync.invoice_id}`;
    await refreshInvoiceFormAfterDailySave(file_number, data.invoice_sync.invoice_id);
    await loadOpenPatientStay(file_number);
    await loadDailyEntriesIntoSheet();
    await loadDailyPatientHistory();

    const statusEl = document.getElementById('daily-entry-status');
    if (statusEl) statusEl.textContent = `محفوظ — ${data.count} يوم`;
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
    bindCommaAmountInputs(document.getElementById('daily-catalog-manage-collapse'));
    bindCommaAmountInputs(document.getElementById('daily-catalog-edit-modal'));
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
          totalEl.value = typeof fmtInt === 'function' ? fmtInt(item.total) : String(item.total);
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
  document.getElementById('daily-catalog-import-btn')?.addEventListener('click', () => {
    document.getElementById('daily-catalog-import-file')?.click();
  });
  document.getElementById('daily-catalog-import-file')?.addEventListener('change', (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (file) openDailyCatalogImportModal(file);
  });
  document.getElementById('daily-catalog-import-refresh-preview-btn')?.addEventListener('click', () =>
    refreshDailyCatalogImportPreview()
  );
  document.getElementById('daily-catalog-import-confirm-btn')?.addEventListener('click', () =>
    confirmDailyCatalogImport()
  );
  document.getElementById('daily-catalog-add-form')?.addEventListener('submit', submitDailyCatalogAdd);
  document.getElementById('daily-catalog-add-category')?.addEventListener('change', () => toggleCatalogPricingFields('add'));
  document.getElementById('daily-catalog-edit-category')?.addEventListener('change', () => toggleCatalogPricingFields('edit'));
  ['add', 'edit'].forEach((mode) => {
    document.getElementById(`daily-catalog-${mode}-cost`)?.addEventListener('input', () => updateCatalogSellingPreview(mode));
    document.getElementById(`daily-catalog-${mode}-markup`)?.addEventListener('input', () => updateCatalogSellingPreview(mode));
  });
  toggleCatalogPricingFields('add');
  document.getElementById('daily-catalog-edit-save-btn')?.addEventListener('click', saveDailyCatalogEdit);
  document.getElementById('daily-catalog-refresh-btn')?.addEventListener('click', () => loadDailyCatalogManageTable());
  document.getElementById('daily-catalog-filter-category')?.addEventListener('change', (event) => {
    const addCat = document.getElementById('daily-catalog-add-category');
    if (addCat && event.target.value) addCat.value = event.target.value;
    loadDailyCatalogManageTable();
  });
  document.getElementById('daily-catalog-filter-search')?.addEventListener('input', () => {
    clearTimeout(dailyCatalogSearchTimer);
    dailyCatalogSearchTimer = setTimeout(() => loadDailyCatalogManageTable(), 300);
  });
  const catalogCollapse = document.getElementById('daily-catalog-manage-collapse');
  if (catalogCollapse) {
    catalogCollapse.addEventListener('shown.bs.collapse', () => {
      loadDailyCatalogManageTable();
      toggleCatalogPricingFields('add');
    });
  }
});

window.initDailyChargesView = initDailyChargesView;
window.importDailyChargesToInvoice = importDailyChargesToInvoice;
window.syncDailyChargeRowsFromTotals = syncDailyChargeRowsFromTotals;
