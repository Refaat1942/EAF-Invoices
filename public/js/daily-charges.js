const DAILY_API = '/api/daily-charges';

const DAILY_TAB_GROUPS = [
  { id: 'stay', label: 'إقامة ورعاية', codes: ['accommodation', 'companion', 'nursing_point'] },
  { id: 'sessions', label: 'جلسات', codes: ['sessions_date', 'sessions_detail', 'sessions'] },
  { id: 'medicines', label: 'أدوية', codes: ['medicines'] },
  { id: 'supplies', label: 'مستلزمات', codes: ['supplies', 'cosmetics'] },
  { id: 'exams', label: 'كشوفات', codes: ['consultant_exam', 'specialist_exam', 'consultation_stamp'] },
  { id: 'lab', label: 'تحاليل', codes: ['analyses', 'analyses_stamp'] },
  { id: 'radiology', label: 'أشعة', codes: ['xray_type', 'xray_total', 'xray_stamp'] },
  { id: 'other', label: 'أخرى', codes: ['other', 'prosthetics'] },
];

const DAILY_EXAM_CODES = ['consultant_exam', 'specialist_exam', 'consultation_stamp'];

let dailySectionsCache = [];
let dailyCurrentEntryId = null;
let dailyStayContext = null;
let dailyEntriesLoadSeq = 0;
let dailyStayTypesCache = [];
let dailySpecialtiesCache = [];

function dailyEscapeHtml(text) {
  if (typeof escapeHtml === 'function') return escapeHtml(text);
  return String(text || '');
}

async function loadDailyDoctorSpecialties() {
  try {
    dailySpecialtiesCache = await apiJson('/api/doctors/specialties');
  } catch {
    dailySpecialtiesCache = [];
  }
}

function buildDailySpecialtyOptions(selected = '') {
  let html = '<option value="">— التخصص —</option>';
  for (const s of dailySpecialtiesCache) {
    html += `<option value="${dailyEscapeHtml(s)}"${s === selected ? ' selected' : ''}>${dailyEscapeHtml(s)}</option>`;
  }
  return html;
}

async function populateDailyDoctorSelect(selectEl, specialty, selectedId, search = '') {
  if (!selectEl) return;
  const params = new URLSearchParams();
  if (specialty) params.set('specialty', specialty);
  if (selectedId) params.set('include_doctor_id', selectedId);
  if (search) params.set('search', search);
  params.set('limit', '100');
  try {
    const doctors = await apiJson(`/api/doctors/for-daily?${params}`);
    let html = '<option value="">— الطبيب —</option>';
    for (const d of doctors) {
      html += `<option value="${d.id}"${String(d.id) === String(selectedId) ? ' selected' : ''}>${dailyEscapeHtml(d.name)}</option>`;
    }
    selectEl.innerHTML = html;
  } catch {
    selectEl.innerHTML = '<option value="">— الطبيب —</option>';
  }
}

function onDailyDoctorSearchInput(inputEl) {
  const tr = inputEl.closest('.daily-entry-row');
  const specialty = tr?.querySelector('.daily-row-specialty')?.value || '';
  const doctorSel = tr?.querySelector('.daily-row-doctor');
  if (!doctorSel) return;
  clearTimeout(tr._doctorSearchTimer);
  tr._doctorSearchTimer = setTimeout(() => {
    populateDailyDoctorSelect(doctorSel, specialty, doctorSel.value || null, inputEl.value.trim());
  }, 300);
}

async function onDailySpecialtyChange(selectEl) {
  const tr = selectEl.closest('.daily-entry-row');
  const doctorSel = tr?.querySelector('.daily-row-doctor');
  if (doctorSel) {
    doctorSel.value = '';
    await populateDailyDoctorSelect(doctorSel, selectEl.value, null);
  }
}

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
  if (dailyBusinessDate) return dailyBusinessDate;
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function codesForActiveDailyTab() {
  if (activeDailyTab === 'all') return null;
  const group = DAILY_TAB_GROUPS.find((g) => g.id === activeDailyTab);
  return group ? group.codes : null;
}

function isSectionVisibleInActiveTab(sectionCode) {
  const codes = codesForActiveDailyTab();
  if (!codes) return true;
  return codes.includes(sectionCode);
}

function applyDailyTabColumnVisibility() {
  const codes = codesForActiveDailyTab();
  document.querySelectorAll('.daily-section-th[data-section], .daily-section-cell[data-section]').forEach((el) => {
    const show = !codes || codes.includes(el.dataset.section);
    el.classList.toggle('daily-col-hidden', !show);
  });
  const showExams = !codes || codes.some((c) => DAILY_EXAM_CODES.includes(c));
  document.querySelectorAll('[data-section-group="exams"]').forEach((el) => {
    el.classList.toggle('daily-col-hidden', !showExams);
  });
  const hint = document.getElementById('daily-tab-hint');
  if (hint && codes) {
    const label = DAILY_TAB_GROUPS.find((g) => g.id === activeDailyTab)?.label || '';
    hint.textContent = `قسم «${label}» — الأعمدة المعروضة لهذا القسم فقط. احفظ الكل بعد إدخال كل الأقسام.`;
  } else if (hint) {
    hint.textContent = 'كل أقسام الحركة اليومية — أو اختر تبويبًا لعرض قسم واحد.';
  }
}

function renderDailyEntryTabs() {
  const nav = document.getElementById('daily-entry-tabs');
  if (!nav) return;
  const tabs = [{ id: 'all', label: 'كل الأقسام' }, ...DAILY_TAB_GROUPS];
  nav.innerHTML = tabs
    .map(
      (t) =>
        `<li class="nav-item" role="presentation"><button type="button" class="nav-link ${activeDailyTab === t.id ? 'active' : ''}" data-daily-tab="${t.id}" role="tab">${t.label}</button></li>`
    )
    .join('');
  nav.querySelectorAll('[data-daily-tab]').forEach((btn) => {
    btn.addEventListener('click', () => {
      activeDailyTab = btn.dataset.dailyTab;
      nav.querySelectorAll('.nav-link').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      applyDailyTabColumnVisibility();
    });
  });
  applyDailyTabColumnVisibility();
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
    const data = await apiJson(`${DAILY_API}/open-stay?file_number=${encodeURIComponent(fn)}`);
    applyDailyStayContext(data);
    await loadDailyStayTypes();
    if (dailySectionsCache.length) await loadDailyEntriesIntoSheet();
    await loadDailyPatientHistory();
    return data;
  } catch (err) {
    showToast(sanitizeApiErrorMessage(err.message), 'danger');
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
    const data = await apiJson(`${DAILY_API}/open-stay`, {
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
    applyDailyStayContext(data);
    await loadDailyStayTypes();
    if (dailySectionsCache.length) await loadDailyEntriesIntoSheet();
    await loadDailyPatientHistory();
    const label = data.created ? 'تم إنشاء فاتورة مسودة' : 'تم تحديث الإقامة';
    showToast(`${label} #${data.invoice?.id}`, 'success');
  } catch (err) {
    showToast(sanitizeApiErrorMessage(err.message), 'danger');
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
let dailySectionsLoadFailed = false;
let dailySaveInFlight = false;
let dailyBusinessDate = null;
let activeDailyTab = 'medicines';

function isManualDailyAmountSection(section) {
  return ['accommodation', 'companion', 'nursing_point'].includes(String(section?.code || '').trim());
}

async function loadDailySections() {
  dailySectionsLoadFailed = false;
  try {
    const payload = await apiJson(`${DAILY_API}/sections?with_services=1`);
    if (Array.isArray(payload)) {
      dailySectionsCache = payload;
      dailyBusinessDate = null;
    } else {
      dailySectionsCache = payload.sections || [];
      dailyBusinessDate = payload.business_date || null;
    }
  } catch (err) {
    dailySectionsLoadFailed = true;
    dailySectionsCache = [];
    renderDailySectionsTable();
    showToast(sanitizeApiErrorMessage(err.message), 'danger');
    return;
  }
  const plSection = dailySectionsCache.find((s) => s.price_list_id);
  dailyPriceListMeta = plSection
    ? { id: plSection.price_list_id, name: plSection.price_list_name }
    : null;
  renderDailySectionsTable();
  renderDailyEntryTabs();
  setDailyTodayDate();

  const priceSections = dailySectionsCache.filter((s) => s.category_code && !s.catalog_category);
  const statusEl = document.getElementById('daily-entry-status');
  if (dailyPriceListMeta?.name && statusEl && dailyStayContext?.invoice?.id) {
    const catalogTotal = dailySectionsCache
      .filter((s) => s.catalog_category)
      .reduce((sum, s) => sum + (s.catalog_count || 0), 0);
    statusEl.title = `اللائحة: ${dailyPriceListMeta.name} | كتالوج: ${catalogTotal} صنف — بحث عند الاختيار`;
  }
  if (dailyStayContext?.invoice?.id && priceSections.length && !dailyPriceListMeta?.id) {
    showToast('لم تُحمَّل خدمات من اللائحة — تأكد من استيراد اللائحة في الإعدادات', 'warning');
  }
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
  const hasPicker =
    usesCatalog || (section.category_code && section.input_type === 'amount' && !usesCatalog);
  const amountVal =
    line.amount != null && line.amount !== '' && Number(line.amount) > 0
      ? typeof formatAmountInput === 'function'
        ? formatAmountInput(line.amount)
        : dailyFormatInput(line.amount)
      : '';

  let pickerHtml = '';
  if (hasPicker && window.DailyEntryPicker) {
    pickerHtml = DailyEntryPicker.buildCellHtml(section, line);
  } else if (
    section.category_code &&
    !usesCatalog &&
    (section.service_count === 0 || section.service_count == null) &&
    !isManualDailyAmountSection(section)
  ) {
    pickerHtml =
      '<small class="text-muted d-block mb-1">لا توجد خدمات في اللائحة النشطة — راجع استيراد اللائحة</small>';
  } else if (isManualDailyAmountSection(section) && section.service_count === 0) {
    pickerHtml =
      '<small class="text-muted d-block mb-1">لا خدمات في اللائحة — أدخل المبلغ يدوياً</small>';
  } else if (usesCatalog) {
    pickerHtml =
      '<small class="text-muted d-block mb-1">لا أصناف نشطة — راجع كتالوج الأصناف في الإعدادات</small>';
  }

  return `<td class="daily-section-cell" data-section="${section.code}">${pickerHtml}<input type="text" inputmode="decimal" class="form-control form-control-sm daily-field daily-amount comma-amount" data-section="${section.code}" data-type="amount" data-manual-amount="${amountVal ? '1' : '0'}" value="${amountVal}"></td>`;
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
    '<th rowspan="2" class="daily-meta-th">التخصص</th><th rowspan="2" class="daily-meta-th">الطبيب</th>' +
    blocks
      .map((block) => {
        if (block.type === 'consultations') {
          return '<th colspan="3" class="text-center daily-group-th" data-section-group="exams">الكشوفات</th>';
        }
        return `<th rowspan="2" class="daily-section-th" data-section="${block.section.code}" title="${block.section.category_code || ''}">${block.section.name}</th>`;
      })
      .join('') +
    '<th rowspan="2" class="daily-meta-th">إجمالي</th><th rowspan="2" class="daily-meta-th"></th>';

  if (subhead) {
    subhead.innerHTML = blocks
      .map((block) => {
        if (block.type === 'consultations') {
          return block.sections
            .map((s) => `<th class="daily-section-th" data-section="${s.code}" data-section-group="exams">${s.name}</th>`)
            .join('');
        }
        return '';
      })
      .join('');
    subhead.style.display = consultationSections.length ? '' : 'none';
  }

  const colCount = dailySectionsCache.length + 6;
  const footLabel = document.getElementById('daily-total-foot-label');
  const footSpacer = document.getElementById('daily-total-foot-spacer');
  if (footLabel) footLabel.colSpan = Math.max(colCount - 2, 1);
  if (footSpacer) footSpacer.colSpan = Math.max(colCount - 3, 0);
  applyDailyTabColumnVisibility();
}

function bindDailyRowEvents(tr) {
  tr.querySelectorAll('.daily-field, .daily-catalog-unit, .daily-row-date, .daily-row-stay-type').forEach((el) => {
    el.addEventListener('input', () => {
      if (el.classList.contains('daily-amount')) el.dataset.manualAmount = '1';
      updateRowTotal(tr);
      updateDailyGrandTotal();
    });
    el.addEventListener('change', () => {
      updateRowTotal(tr);
      updateDailyGrandTotal();
    });
  });

  if (window.DailyEntryPicker) DailyEntryPicker.bindRow(tr);

  tr.querySelector('.daily-row-delete')?.addEventListener('click', () => deleteDailyEntryRow(tr));

  if (typeof bindCommaAmountInputs === 'function') bindCommaAmountInputs(tr);
}

function applyDefaultPricesForRow(tr) {
  for (const section of dailySectionsCache) {
    if (section.input_type !== 'amount') continue;
    if (section.catalog_category || section.uses_catalog) continue;
    if (isManualDailyAmountSection(section)) continue;
    const amountInput = tr.querySelector(`.daily-amount[data-section="${section.code}"]`);
    if (!amountInput || dailyParseAmount(amountInput.value) > 0) continue;

    if (section.default_service?.id && window.DailyEntryPicker) {
      const picker = tr.querySelector(`.daily-picker[data-section="${section.code}"]`);
      if (picker) {
        DailyEntryPicker.applyPickerSelection(tr, section, picker, section.default_service);
      }
    }
  }
}

async function findAccommodationServiceForStayType(stayType) {
  if (!stayType?.name || !window.DailyEntryPicker) return null;
  try {
    const result = await DailyEntryPicker.searchPicker('accommodation', String(stayType.name).trim(), 1);
    const stayName = String(stayType.name).trim();
    return (
      result.rows?.find((s) => String(s.name).trim() === stayName) ||
      result.rows?.find((s) => String(s.name).includes(stayName)) ||
      result.rows?.[0] ||
      null
    );
  } catch {
    return null;
  }
}

async function applyStayTypeRateToRow(tr) {
  const select = tr.querySelector('.daily-row-stay-type');
  const stayTypeId = select?.value;
  if (!stayTypeId) return;
  const stayType = dailyStayTypesCache.find((t) => String(t.id) === String(stayTypeId));
  const accInput = tr.querySelector('.daily-amount[data-section="accommodation"]');
  const accPicker = tr.querySelector('.daily-picker[data-section="accommodation"]');
  if (!accInput || dailyParseAmount(accInput.value) > 0) return;

  const match = await findAccommodationServiceForStayType(stayType);
  if (!match || !accPicker) return;

  const section = dailySectionsCache.find((s) => s.code === 'accommodation');
  if (section && window.DailyEntryPicker) {
    DailyEntryPicker.applyPickerSelection(tr, section, accPicker, match);
  }
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
    <td><select class="form-select form-select-sm daily-row-specialty">${buildDailySpecialtyOptions(entry.doctor_specialty || '')}</select></td>
    <td>
      <input type="search" class="form-control form-control-sm daily-doctor-search mb-1" placeholder="بحث طبيب..." autocomplete="off">
      <select class="form-select form-select-sm daily-row-doctor"><option value="">— الطبيب —</option></select>
    </td>
    ${dailySectionsCache.map((section) => renderDailyCellHtml(section, getLineForSection(entry, section.code))).join('')}
    <td class="daily-row-total fw-bold text-nowrap"></td>
    <td class="text-center"><button type="button" class="btn btn-sm btn-outline-danger daily-row-delete" title="حذف اليوم">×</button></td>
  `;

  const specialtySel = tr.querySelector('.daily-row-specialty');
  const doctorSel = tr.querySelector('.daily-row-doctor');
  const doctorSearch = tr.querySelector('.daily-doctor-search');
  if (specialtySel) {
    specialtySel.addEventListener('change', () => onDailySpecialtyChange(specialtySel));
  }
  if (doctorSearch) {
    doctorSearch.addEventListener('input', () => onDailyDoctorSearchInput(doctorSearch));
  }
  if (doctorSel && entry.doctor_specialty) {
    populateDailyDoctorSelect(doctorSel, entry.doctor_specialty, entry.doctor_id || null);
  }

  bindDailyRowEvents(tr);
  if (window.DailyEntryPicker) {
    for (const section of dailySectionsCache) {
      DailyEntryPicker.hydratePicker(tr, section, getLineForSection(entry, section.code));
    }
  }
  applyDailyTabColumnVisibility();
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
    const pickerFields = window.DailyEntryPicker ? DailyEntryPicker.readPickerFields(tr, section) : {};
    if (section.input_type === 'date') {
      return { section_code: section.code, extra_date: field?.value || null };
    }
    if (section.input_type === 'text') {
      return { section_code: section.code, extra_text: field?.value || '' };
    }
    return {
      section_code: section.code,
      catalog_item_id: pickerFields.catalog_item_id ?? null,
      catalog_unit_level: pickerFields.catalog_unit_level ?? null,
      catalog_unit: pickerFields.catalog_unit ?? null,
      service_id: pickerFields.service_id ?? null,
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
    const entries = await apiJson(
      `${DAILY_API}/entries?file_number=${encodeURIComponent(fileNumber)}&include_lines=1&limit=120`
    );
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
    if (!dailySectionsLoadFailed) {
      showToast(sanitizeApiErrorMessage(err.message), 'danger');
    }
    addDailyEntryRow();
    setDailyTodayDate();
  }
}

async function reloadDailyCatalogSectionsFromSettings() {
  await loadDailySections();
}

async function deleteDailyEntryById(entryId) {
  if (!dailyCan('daily_charges.manage')) {
    showToast('ليس لديك صلاحية الحذف', 'warning');
    return false;
  }
  if (!entryId) return false;
  if (!confirm('حذف حركة هذا اليوم؟')) return false;

  try {
    const data = await apiJson(`${DAILY_API}/entries/${entryId}`, { method: 'DELETE' });
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
    showToast(sanitizeApiErrorMessage(err.message), 'danger');
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
      doctor_specialty: tr.querySelector('.daily-row-specialty')?.value || '',
      doctor_id: tr.querySelector('.daily-row-doctor')?.value || null,
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
    const entries = await apiJson(`${DAILY_API}/entries?file_number=${encodeURIComponent(fileNumber)}&limit=60`);
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
    tbody.innerHTML = `<tr><td colspan="6" class="text-danger">${dailyEscapeHtml(sanitizeApiErrorMessage(err.message))}</td></tr>`;
  }
}

async function saveDailyEntry() {
  if (dailySaveInFlight) return;
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
    dailySaveInFlight = true;
    const saveBtn = document.getElementById('daily-save-btn');
    if (saveBtn) saveBtn.disabled = true;

    const data = await apiJson(`${DAILY_API}/entries/batch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        file_number,
        patient_name: getStayPatientName(),
        entries,
      }),
    });

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
  } finally {
    dailySaveInFlight = false;
    const saveBtn = document.getElementById('daily-save-btn');
    if (saveBtn) saveBtn.disabled = false;
  }
}

async function showDailyEntryHistory() {
  if (!dailyCurrentEntryId) {
    showToast('احفظ اليوم أولًا لعرض سجل التعديلات', 'info');
    return;
  }
  try {
    const history = await apiJson(`${DAILY_API}/entries/${dailyCurrentEntryId}/history`);
    if (!history.length) {
      showToast('لا يوجد سجل تعديلات', 'info');
      return;
    }
    const lines = history
      .map((row) => `${new Date(row.created_at).toLocaleString('ar-EG')} — ${row.action} — ${row.changed_by_name || '—'}`)
      .join('\n');
    alert(`سجل التعديلات:\n\n${lines}`);
  } catch (err) {
    showToast(sanitizeApiErrorMessage(err.message), 'danger');
  }
}

async function loadDailyStayTypes() {
  try {
    dailyStayTypesCache = await apiJson('/api/settings/stay-types');
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
  try {
    if (typeof loadFinancialTreatments === 'function') await loadFinancialTreatments();
    await loadDailyDoctorSpecialties();
    if (!dailySectionsCache.length) await loadDailySections();
    if (dailySectionsLoadFailed) return;
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
  } catch (err) {
    showToast(sanitizeApiErrorMessage(err.message), 'danger');
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
    const data = await apiJson(`${DAILY_API}/for-invoice?${params}`);
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
    showToast(sanitizeApiErrorMessage(err.message), 'danger');
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
window.loadDailyDoctorSpecialties = loadDailyDoctorSpecialties;
window.importDailyChargesToInvoice = importDailyChargesToInvoice;
window.syncDailyChargeRowsFromTotals = syncDailyChargeRowsFromTotals;
window.reloadDailyCatalogSectionsFromSettings = reloadDailyCatalogSectionsFromSettings;
