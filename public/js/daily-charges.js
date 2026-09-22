const DAILY_API = '/api/daily-charges';

const DAILY_TAB_GROUPS = [
  { id: 'stay', label: 'إقامة ورعاية', icon: '🏨', tileClass: 'hub-tile--teal', codes: ['accommodation', 'companion', 'nursing_point', 'patient_assistant'] },
  { id: 'sessions', label: 'جلسات', icon: '📅', tileClass: 'hub-tile--indigo', codes: ['sessions_date', 'sessions_detail', 'sessions'] },
  { id: 'medicines', label: 'أدوية', icon: '💊', tileClass: 'hub-tile--blue', codes: ['medicines'] },
  { id: 'supplies', label: 'مستلزمات', icon: '🧴', tileClass: 'hub-tile--green', codes: ['supplies', 'cosmetics'] },
  { id: 'exams', label: 'كشوفات', icon: '🩺', tileClass: 'hub-tile--primary', codes: ['consultant_exam', 'specialist_exam', 'consultation_stamp'] },
  { id: 'lab', label: 'تحاليل', icon: '🔬', tileClass: 'hub-tile--slate', codes: ['analyses', 'analyses_stamp'] },
  { id: 'radiology', label: 'أشعة', icon: '🩻', tileClass: 'hub-tile--blue', codes: ['xray_type', 'xray_total', 'xray_stamp'] },
  { id: 'other', label: 'خدمات متنوعة', icon: '📎', tileClass: 'hub-tile--slate', codes: ['other', 'prosthetics'] },
  { id: 'operations', label: 'عمليات', icon: '⚕️', tileClass: 'hub-tile--red', codes: [] },
  { id: 'free-items', label: 'بنود حرة', icon: '✏️', tileClass: 'hub-tile--indigo', codes: [] },
];

const DAILY_EXAM_CODES = ['consultant_exam', 'specialist_exam', 'consultation_stamp'];

const DAILY_INVOICE_TYPE_LABELS = {
  civil: 'مدني (خاص)',
  contracted: 'جهات متعاقدة',
  non_contracted: 'جهات غير متعاقدة',
  military: 'عسكري',
  hospital: 'حالة مستشفى',
  special: 'حالة خاصة',
  operations: 'عمليات',
};

const DAILY_CLINICAL_TABS = ['exams', 'lab', 'radiology', 'sessions', 'medicines', 'supplies'];
const DAILY_TODAY_MERGE_TABS = [...DAILY_CLINICAL_TABS, 'other'];
const DAILY_SHEET_ROW_CLASS_BY_TAB = {
  medicines: 'daily-med-row',
  supplies: 'daily-sup-row',
  lab: 'daily-lab-row',
  radiology: 'daily-rad-row',
  exams: 'daily-exam-row',
  sessions: 'daily-session-row',
  other: 'daily-misc-row',
};

const DAILY_SHEET_PANEL_TABS = ['operations', 'free-items'];

const DAILY_ADD_ROW_LABELS = {
  stay: '+ صف إقامة',
  sessions: '+ صف جلسة',
  medicines: '+ صف دواء',
  supplies: '+ صف مستلزم',
  exams: '+ صف كشف',
  lab: '+ صف تحليل',
  radiology: '+ صف أشعة',
  other: '+ صف خدمة',
};

const DAILY_PRICING_API = '/api/pricing';


/** Admin-only per-tab service list upload (catalog or price-list Excel). */
const DAILY_TAB_IMPORT_CONFIG = {
  medicines: {
    kind: 'catalog',
    defaultCategory: 'Medicine',
    label: 'رفع قائمة أدوية',
    accept: '.xlsx,.xls,.csv,.txt',
  },
  supplies: {
    kind: 'catalog',
    defaultCategory: 'Supplies',
    allowCategories: ['Supplies', 'Cosmetics'],
    label: 'رفع قائمة مستلزمات',
    accept: '.xlsx,.xls,.csv,.txt',
  },
  sessions: { kind: 'section_excel', tab: 'sessions', label: 'رفع العلاج الطبيعي' },
  exams: { kind: 'section_excel', tab: 'exams', label: 'رفع الكشوفات' },
  lab: { kind: 'section_excel', tab: 'lab', label: 'رفع التحاليل' },
  radiology: { kind: 'section_excel', tab: 'radiology', label: 'رفع الأشعة' },
  other: { kind: 'section_excel', tab: 'other', label: 'رفع ملف خدمات' },
  stay: { kind: 'section_excel', tab: 'stay', label: 'رفع الإقامات' },
  operations: { kind: 'section_excel', tab: 'operations', label: 'رفع العمليات الجراحية' },
};

function isDailyAdminImportAllowed() {
  return typeof can === 'function' && can('settings.*');
}

function updateDailyTabImportButton() {
  const btn = document.getElementById('daily-tab-import-btn');
  const input = document.getElementById('daily-tab-import-input');
  if (!btn || !input) return;
  const cfg = DAILY_TAB_IMPORT_CONFIG[activeDailyTab];
  const allowed = isDailyAdminImportAllowed() && cfg;
  btn.classList.toggle('d-none', !allowed);
  if (cfg) {
    btn.textContent = `📤 ${cfg.label}`;
    input.accept = cfg.accept || '.xlsx,.xls';
  }
}

async function handleDailyTabImport(file) {
  const cfg = DAILY_TAB_IMPORT_CONFIG[activeDailyTab];
  if (!cfg || !file || !isDailyAdminImportAllowed()) return;

  const btn = document.getElementById('daily-tab-import-btn');
  if (btn) btn.disabled = true;
  try {
    if (cfg.kind === 'catalog') {
      const form = new FormData();
      form.append('file', file);
      if (cfg.defaultCategory) form.append('default_category', cfg.defaultCategory);
      if (cfg.allowCategories?.length) form.append('allow_categories', cfg.allowCategories.join(','));
      const res = await apiFetch(`${DAILY_API}/catalog/import`, { method: 'POST', body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      const msg = `كتالوج: ${data.inserted || 0} جديد، ${data.updated || 0} محدّث`;
      showToast(msg, 'success');
      if (typeof loadCatalogCache === 'function') await loadCatalogCache();
      await reloadDailyServiceCaches();
    } else if (cfg.kind === 'section_excel') {
      const form = new FormData();
      form.append('file', file);
      form.append('tab', cfg.tab || activeDailyTab);
      const res = await apiFetch(`${DAILY_API}/catalog/import-section-excel`, { method: 'POST', body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      const label = data.template_label || cfg.label;
      const inserted = Number(data.inserted ?? data.imported ?? 0) || 0;
      const updated = Number(data.updated ?? 0) || 0;
      const total = Number(data.imported ?? data.total ?? inserted + updated) || 0;
      const dest = data.source === 'price_list' ? 'اللائحة' : 'الكتالوج';
      const msg = `شيت «${label}» → ${dest}: ${total} بند (${inserted} جديد، ${updated} محدّث)`;
      showToast(msg, total > 0 ? 'success' : 'warning');
      if (typeof loadCatalogCache === 'function') await loadCatalogCache();
      await loadDailySections();
      await reloadDailyServiceCaches();
    }
  } catch (err) {
    showToast(sanitizeApiErrorMessage(err.message), 'danger');
  } finally {
    if (btn) btn.disabled = false;
    const input = document.getElementById('daily-tab-import-input');
    if (input) input.value = '';
  }
}

let dailySectionsCache = [];
let dailyCurrentEntryId = null;
let dailyStayContext = null;
let dailySavedSheetFingerprint = '';

function isExternalDailyPatient(ctx = dailyStayContext) {
  return String(ctx?.patient?.patient_type || '').toLowerCase() === 'external';
}

function canUseDailyStayCharges(ctx = dailyStayContext) {
  return !isExternalDailyPatient(ctx);
}
let dailyEntriesLoadSeq = 0;
let dailyStayTypesCache = [];
let dailyStayGradesCache = [];
let dailySpecialtiesCache = [];
let dailyCompanionServicesCache = [];
let dailyCompanionKindOptionsCache = [];
let dailyExamServicesCache = [];
let dailyExamSpecialtiesCache = [];
let dailySuppliesMarkupPercent = 20;

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

function formatDailyInvoicePeriodRange(admissionDate, dischargeDate) {
  const from = fmtStayDate(admissionDate) || '—';
  const to = fmtStayDate(dischargeDate) || '—';
  return `${from} → ${to}`;
}

function getDailyInvoicePeriodBounds() {
  const inv = dailyStayContext?.invoice;
  const from =
    fmtStayDate(inv?.admission_date) ||
    document.getElementById('daily-stay-admission')?.value?.trim() ||
    '';
  const dischargeInput = document.getElementById('daily-stay-discharge')?.value?.trim() || '';
  let to = dischargeInput || fmtStayDate(inv?.discharge_date) || '';
  if (from) {
    const today = getLocalDateString();
    const openStay = !dischargeInput && (!to || to === from);
    if (openStay) {
      to = today >= from ? today : from;
    } else if (!to) {
      to = today;
    }
  }
  return { from, to };
}

function entryInInvoicePeriod(entry, bounds = getDailyInvoicePeriodBounds()) {
  const d = fmtStayDate(entry?.entry_date);
  if (!d) return false;
  if (bounds.from && d < bounds.from) return false;
  if (bounds.to && d > bounds.to) return false;
  return true;
}

function computeStayPeriodTotal() {
  const bounds = getDailyInvoicePeriodBounds();
  let total = 0;
  for (const entry of dailySheetEntriesCache || []) {
    if (!entryInInvoicePeriod(entry, bounds)) continue;
    if (!entryHasStayChargeData(entry)) continue;
    for (const line of entry.lines || []) {
      if (!STAY_CHARGE_SECTIONS.includes(line.section_code)) continue;
      total += dailyParseAmount(line.amount || line.unit_price);
    }
  }
  return total;
}

function computeSavedStayTotalForDomDates() {
  const dates = new Set();
  document.querySelectorAll('#daily-sections-body .daily-stay-row').forEach((tr) => {
    const d = fmtStayDate(tr.querySelector('.daily-row-date')?.value);
    if (d) dates.add(d);
  });
  if (!dates.size) return 0;
  const bounds = getDailyInvoicePeriodBounds();
  let total = 0;
  for (const entry of dailySheetEntriesCache || []) {
    const d = fmtStayDate(entry.entry_date);
    if (!dates.has(d)) continue;
    if (!entryInInvoicePeriod(entry, bounds)) continue;
    for (const line of entry.lines || []) {
      if (!STAY_CHARGE_SECTIONS.includes(line.section_code)) continue;
      total += dailyParseAmount(line.amount || line.unit_price);
    }
  }
  return total;
}

function computeDomStayTabTotal() {
  let total = 0;
  const rows = document.querySelectorAll('#daily-sections-body .daily-stay-row');
  if (!rows.length) return 0;
  rows.forEach((tr) => {
    if (!stayRowGroupHasChargeData(tr)) return;
    const rowDate = fmtStayDate(tr.querySelector('.daily-row-date')?.value);
    if (isDailyStayDateSuppressed(rowDate)) return;
    updateStayRowGroupTotal(tr);
    total += dailyParseAmount(tr.querySelector('.daily-row-total')?.textContent);
  });
  return Math.round(total * 100) / 100;
}

function previewInvoiceFinalTotalFromStayEdits(ctx = dailyStayContext) {
  const base = Number(ctx?.invoice?.final_total) || 0;
  if (!document.querySelector('#daily-sections-body .daily-stay-row')) return base;
  const domStay = computeDomStayTabTotal();
  const savedStay = computeSavedStayTotalForDomDates();
  return Math.round((base - savedStay + domStay) * 100) / 100;
}

function refreshDailyStayLiveTotals() {
  computeDomStayTabTotal();
  updateSectionTabTotal();
  const previewEl = document.getElementById('daily-invoice-final-total');
  if (!previewEl || !dailyStayContext?.invoice?.id) return;
  const preview = previewInvoiceFinalTotalFromStayEdits();
  previewEl.textContent = dailyFmt(preview);
  const remainingEl = document.getElementById('daily-invoice-remaining-total');
  if (remainingEl) {
    const collected = Number(dailyStayContext.invoice.total_collected) || 0;
    remainingEl.textContent = dailyFmt(Math.max(0, preview - collected));
  }
}

function getLocalDateString() {
  if (dailyBusinessDate) return dailyBusinessDate;
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

let dailySheetSerialNext = 1;
const dailySheetSerialMap = new Map();
let dailySheetEntriesCache = [];
let dailyChargesDeleteInProgress = false;
let dailyAutosaveInFlight = null;
let dailySaveInFlight = null;
/** Dates the user explicitly deleted on the stay tab — skip auto-room refill and autosave. */
const dailyStaySuppressedDates = new Set();
let dailyStaySuppressedFile = '';

function resetDailyStaySuppression(fileNumber = '') {
  dailyStaySuppressedDates.clear();
  dailyStaySuppressedFile = String(fileNumber || '').trim();
}

function suppressDailyStayDate(date) {
  const d = fmtStayDate(date);
  if (!d) return;
  dailyStaySuppressedDates.add(d);
  dailyStaySuppressedFile = getStayFileNumber();
}

function clearDailyStayDateSuppression(date) {
  dailyStaySuppressedDates.delete(fmtStayDate(date));
}

function isDailyStayDateSuppressed(date) {
  const d = fmtStayDate(date);
  if (!d) return false;
  if (getStayFileNumber() !== dailyStaySuppressedFile) return false;
  return dailyStaySuppressedDates.has(d);
}
let dailyOperationsAllTotalCache = 0;
let dailyOperationsTodaySavedTotal = 0;

function dailyRowSerialCellHtml(serial = '') {
  const val = serial ? String(serial) : '';
  return `<td class="daily-col-serial"><input type="text" class="form-control form-control-sm daily-row-serial bg-light text-center fw-bold" readonly tabindex="-1" value="${dailyEscapeAttr(val)}"></td>`;
}

function renumberSheetRowSerials() {
  let n = 0;
  document.querySelectorAll('#daily-sections-body .daily-entry-row').forEach((tr) => {
    n += 1;
    stampDailyRowSerial(tr, n);
  });
}

function sumEntryLinesAmount(lines, sectionCodes) {
  const codes = Array.isArray(sectionCodes) ? sectionCodes : [sectionCodes];
  let total = 0;
  for (const line of lines || []) {
    if (!codes.includes(line.section_code)) continue;
    total += dailyParseAmount(line.amount);
  }
  return total;
}

function computeAllDaysTabTotal(entries, tab) {
  let total = 0;
  for (const entry of entries || []) {
    const lines = entry.lines || [];
    switch (tab) {
      case 'medicines':
        total += sumEntryLinesAmount(lines, 'medicines');
        break;
      case 'supplies':
        total += sumEntryLinesAmount(lines, ['supplies', 'cosmetics']);
        break;
      case 'lab':
        total += sumEntryLinesAmount(lines, ['analyses', 'analyses_stamp']);
        break;
      case 'radiology':
        total += sumEntryLinesAmount(lines, ['xray_total', 'xray_stamp']);
        break;
      case 'exams':
        total += sumEntryLinesAmount(lines, ['consultant_exam', 'specialist_exam', 'consultation_stamp']);
        break;
      case 'sessions':
        total += sumEntryLinesAmount(lines, 'sessions');
        break;
      case 'other':
        total += sumEntryLinesAmount(lines, ['other', 'prosthetics']);
        break;
      case 'stay':
        total += sumEntryLinesAmount(lines, [
          'accommodation',
          'companion',
          'nursing_point',
          'patient_assistant',
        ]);
        break;
      default:
        break;
    }
  }
  return total;
}

function getOperationRowTotalFromPayload(op = {}) {
  return (
    dailyParseAmount(op.amount) +
    dailyParseAmount(op.companion_amount) +
    dailyParseAmount(op.nursing_point_amount) +
    dailyParseAmount(op.patient_assistant_amount)
  );
}

function getOperationRowTotal(tr) {
  if (!tr) return 0;
  return (
    dailyParseAmount(tr.querySelector('.daily-op-amount')?.value) +
    dailyParseAmount(tr.querySelector('.daily-op-companion')?.value) +
    dailyParseAmount(tr.querySelector('.daily-op-nursing')?.value) +
    dailyParseAmount(tr.querySelector('.daily-op-assistant-amt')?.value)
  );
}

function updateOperationRowTotal(tr) {
  if (!tr) return;
  const total = getOperationRowTotal(tr);
  const el = tr.querySelector('.daily-op-row-total');
  if (el) el.value = total > 0 ? formatAmountFieldValue(total) : '';
}

function getOperationsAllDaysTotal() {
  let domTotal = 0;
  document.querySelectorAll('#daily-operations-tbody .daily-operation-row').forEach((tr) => {
    domTotal += getOperationRowTotal(tr);
  });
  return domTotal;
}

function rebuildDailySheetSerialState(entries = []) {
  dailySheetSerialMap.clear();
  dailySheetSerialNext = 1;
}

function resolveDailyRowSerial(entry, line = null) {
  return allocateDailyRowSerial();
}

function allocateDailyRowSerial() {
  const n = dailySheetSerialNext;
  dailySheetSerialNext += 1;
  return n;
}

function stampDailyRowSerial(tr, serial) {
  const s = serial ? String(serial) : '';
  if (s) tr.dataset.dailySerial = s;
  const el = tr.querySelector('.daily-row-serial');
  if (el) el.value = s;
}

function renumberPanelRowSerials(selector) {
  let n = 0;
  document.querySelectorAll(selector).forEach((tr) => {
    n += 1;
    stampDailyRowSerial(tr, n);
  });
}

async function fetchDailyDoctorSuggestions(search = '', selectedId = null, limit = 50) {
  const params = new URLSearchParams();
  if (search) params.set('search', search);
  if (selectedId) params.set('include_doctor_id', selectedId);
  params.set('limit', String(limit));
  return await apiJson(`/api/doctors/for-daily?${params}`);
}

function buildDailyDoctorSuggestHtml(name = '', doctorId = '') {
  return `
    <div class="daily-doctor-suggest-wrap position-relative">
      <div class="input-group input-group-sm">
        <input type="search" class="form-control daily-exam-doctor-search" value="${dailyEscapeAttr(name)}" autocomplete="off" placeholder="ابحث عن الطبيب">
        <button type="button" class="btn btn-outline-secondary daily-exam-doctor-clear" title="مسح الطبيب" aria-label="مسح">×</button>
      </div>
      <input type="hidden" class="daily-exam-doctor" value="${dailyEscapeAttr(doctorId ? String(doctorId) : '')}">
      <div class="daily-doctor-suggest-menu list-group shadow d-none"></div>
    </div>`;
}

function positionDailyDoctorSuggestMenu(input, menu) {
  if (window.DailyEntryPicker?.positionFloatingSuggest) {
    window.DailyEntryPicker.positionFloatingSuggest(input, menu);
    return;
  }
  menu.style.position = 'absolute';
  menu.style.top = '100%';
  menu.style.left = '0';
  menu.style.right = '0';
}

function renderDailyDoctorSuggestMenu(menu, doctors) {
  if (!doctors.length) {
    menu.innerHTML = '<div class="list-group-item small text-muted py-2">لا نتائج</div>';
    return;
  }
  menu.innerHTML = doctors
    .map(
      (d) =>
        `<button type="button" class="list-group-item list-group-item-action py-2 daily-doctor-suggest-opt" data-id="${d.id}" data-name="${dailyEscapeAttr(d.name)}" data-price="${Number(d.consultation_price) || 0}">${dailyEscapeHtml(d.name)}${d.specialty ? `<span class="text-muted small d-block">${dailyEscapeHtml(d.specialty)}</span>` : ''}${Number(d.consultation_price) > 0 ? `<span class="text-primary small d-block">${dailyFmt(d.consultation_price)} ج.م</span>` : ''}</button>`
    )
    .join('');
}

function bindDailyDoctorSuggestWrap(tr) {
  const wrap = tr.querySelector('.daily-doctor-suggest-wrap');
  if (!wrap || wrap.dataset.bound === '1') return;
  wrap.dataset.bound = '1';
  const input = wrap.querySelector('.daily-exam-doctor-search');
  const hidden = wrap.querySelector('.daily-exam-doctor');
  const menu = wrap.querySelector('.daily-doctor-suggest-menu');
  const clearBtn = wrap.querySelector('.daily-exam-doctor-clear');
  if (!input || !hidden || !menu) return;

  const hideMenu = () => menu.classList.add('d-none');
  const clearDoctorSelection = () => {
    hidden.value = '';
    tr.dataset.doctorId = '';
    wrap._pickedDoctorLabel = '';
    wrap._pickedDoctorId = '';
  };
  const applyDoctorExamPrice = (_doctorPrice) => {
    /* سعر الكشف يأتي من حالة الكشف/اللائحة — لا نستبدله بسعر استشارة الطبيب */
  };

  const pickDoctor = (id, name, doctorPrice = 0) => {
    const label = String(name || '').trim();
    tr._doctorHydrateSeq = (Number(tr._doctorHydrateSeq) || 0) + 1;
    hidden.value = id ? String(id) : '';
    input.value = label;
    tr.dataset.doctorId = hidden.value;
    wrap._pickedDoctorLabel = label;
    wrap._pickedDoctorId = hidden.value;
    if (tr.classList.contains('daily-exam-row') && id && examRowDoctorEntryConflict(tr, id)) {
      delete tr.dataset.entryId;
      delete tr.dataset.examLineId;
      delete tr.dataset.stampLineId;
    }
    hideMenu();
    applyDoctorExamPrice(doctorPrice);
  };

  const showDoctorResults = async (query = '') => {
    const q = String(query || '').trim();
    try {
      const doctors = await fetchDailyDoctorSuggestions(q);
      renderDailyDoctorSuggestMenu(menu, doctors);
      menu.classList.remove('d-none');
      positionDailyDoctorSuggestMenu(input, menu);
    } catch {
      hideMenu();
    }
  };

  menu.addEventListener('click', (e) => {
    const btn = e.target.closest('.daily-doctor-suggest-opt');
    if (!btn) return;
    pickDoctor(btn.dataset.id, btn.dataset.name || btn.textContent.trim(), btn.dataset.price);
  });

  clearBtn?.addEventListener('click', () => {
    input.value = '';
    clearDoctorSelection();
    hideMenu();
    input.focus();
  });

  input.addEventListener('input', () => {
    const text = input.value.trim();
    if (!wrap._pickedDoctorLabel || text !== wrap._pickedDoctorLabel) {
      clearDoctorSelection();
    }
    clearTimeout(wrap._doctorTimer);
    wrap._doctorTimer = setTimeout(async () => {
      if (!text) {
        clearDoctorSelection();
        hideMenu();
        return;
      }
      await showDoctorResults(text);
    }, 280);
  });

  input.addEventListener('focus', () => {
    void showDoctorResults(input.value.trim());
  });

  document.addEventListener('click', (e) => {
    if (!wrap.contains(e.target)) hideMenu();
  });
}

async function hydrateDailyDoctorSuggest(tr, doctorId) {
  if (!doctorId) return;
  const wrap = tr.querySelector('.daily-doctor-suggest-wrap');
  const input = tr.querySelector('.daily-exam-doctor-search');
  const hidden = tr.querySelector('.daily-exam-doctor');
  if (input?.value?.trim()) return;
  const seq = (tr._doctorHydrateSeq = (Number(tr._doctorHydrateSeq) || 0) + 1);
  try {
    const doctors = await fetchDailyDoctorSuggestions('', doctorId, 1);
    if (seq !== tr._doctorHydrateSeq) return;
    if (!doctors[0]) return;
    if (input?.value?.trim()) return;
    if (hidden) hidden.value = String(doctors[0].id);
    if (input) input.value = doctors[0].name;
    tr.dataset.doctorId = String(doctors[0].id);
    if (wrap) {
      wrap._pickedDoctorLabel = doctors[0].name || '';
      wrap._pickedDoctorId = String(doctors[0].id);
    }
  } catch {
    /* ignore */
  }
}

function codesForActiveDailyTab() {
  if (!activeDailyTab) return null;
  const group = DAILY_TAB_GROUPS.find((g) => g.id === activeDailyTab);
  if (!group || !group.codes?.length) return null;
  return group.codes;
}

function sectionsForActiveView() {
  const codes = codesForActiveDailyTab();
  if (!codes) return dailySectionsCache;
  return dailySectionsCache.filter((s) => codes.includes(s.code));
}

function shouldShowDailyMetaInView() {
  if (!activeDailyTab) return true;
  const hideMetaTabs = ['medicines', 'supplies', 'exams', 'lab', 'radiology', 'other', 'stay', 'sessions'];
  return !hideMetaTabs.includes(activeDailyTab);
}

function updateFocusedSectionTitle() {
  const el = document.getElementById('daily-focused-section-title');
  if (!el) return;
  if (!activeDailyTab) {
    el.classList.add('d-none');
    el.textContent = '';
    return;
  }
  const group = DAILY_TAB_GROUPS.find((g) => g.id === activeDailyTab);
  el.textContent = group ? `قسم: ${group.label}` : '';
  el.classList.remove('d-none');
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

  const catalogTabs = ['medicines', 'supplies', 'exams', 'lab', 'radiology', 'other', 'sessions'];
  const hideMeta = catalogTabs.includes(activeDailyTab);
  document
    .querySelectorAll('#daily-sections-head .daily-meta-th[rowspan="2"], #daily-sections-subhead .daily-meta-th')
    .forEach((el) => {
      el.classList.toggle('daily-col-hidden', hideMeta);
    });
  document.querySelectorAll('.daily-entry-row .daily-row-date, .daily-row-stay-type, .daily-row-specialty, .daily-row-doctor, .daily-doctor-search').forEach((el) => {
    const cell = el.closest('td');
    if (cell) cell.classList.toggle('daily-col-hidden', hideMeta);
  });

  const mainSheet = document.getElementById('daily-main-sheet-wrap');
  const opsPanel = document.getElementById('daily-operations-panel');
  const freePanel = document.getElementById('daily-free-items-panel');
  if (mainSheet) mainSheet.style.display = DAILY_SHEET_PANEL_TABS.includes(activeDailyTab) ? 'none' : '';
  if (opsPanel) opsPanel.style.display = activeDailyTab === 'operations' ? '' : 'none';
  if (freePanel) freePanel.style.display = activeDailyTab === 'free-items' ? '' : 'none';

  updateDailyAddRowButtons();
  const saveBtn = document.getElementById('daily-save-btn');
  const saveAllBtn = document.getElementById('daily-save-all-btn');
  if (saveBtn) saveBtn.classList.toggle('d-none', activeDailyTab === 'free-items');
  if (saveAllBtn) saveAllBtn.classList.toggle('d-none', activeDailyTab === 'free-items');

  updateDailyTabImportButton();
  updateDailySheetScopeUi();

  if (activeDailyTab === 'operations') ensureOperationRows();

  updateSectionTabTotal();

  const hint = document.getElementById('daily-tab-hint');
  if (hint && activeDailyTab === 'free-items') {
    hint.textContent =
      'بنود حرة — اكتب الوصف والسعر ثم اضغط «حفظ» مرة واحدة. لا تكرّر الضغط حتى يظهر «تم الحفظ».';
  } else if (hint && activeDailyTab === 'exams') {
    hint.textContent =
      'كشوفات — حالة الكشف من لائحة الأسعار. السعر يُملأ تلقائيًا ويمكن تعديله قبل الحفظ. لرؤية كشوفات أيام الدخول السابقة: «عرض الحركة → كل أيام الإقامة» (الصفوف الصفراء = يوم سابق).';
  } else if (hint && activeDailyTab === 'medicines') {
    hint.textContent = 'أدوية — ابحث عن الصنف، السعر من اللائحة المرفوعة. الإجمالي في أسفل الجدول.';
  } else if (hint && activeDailyTab === 'supplies') {
    hint.textContent =
      'مستلزمات — م، تاريخ، رقم الفاتورة، الصنف، العدد، سعر البيع والإجمالي، سعر/إجمالي التكلفة (هامش الربح من الإعدادات).';
  } else if (hint && activeDailyTab === 'sessions') {
    hint.textContent =
      'جلسات — تاريخ الجلسة، اسم المريض، نوع الجلسة، صباحي/مسائي، العدد، السعر، والإجمالي. الصفوف المميزة باللون الأصفر = أيام سابقة (من «عرض الحركة: كل أيام الإقامة»).';
  } else if (hint && activeDailyTab === 'lab') {
    hint.textContent =
      'تحاليل — م، تاريخ التحليل، نوع التحليل، سعر التحليل، الإجمالي، والدمغة.';
  } else if (hint && activeDailyTab === 'radiology') {
    hint.textContent =
      'أشعة — ابحث عن نوع الأشعة. تُستورد من «الخدمات الطبية» (أشعة/دوبلكس/سونار) أو ملف أشعة مخصص.';
  } else if (hint && activeDailyTab === 'other') {
    hint.textContent =
      'خدمات متنوعة — ارفع «الخدمات الطبية» أو «إجراءات وحقن الألم» من زر الاستيراد (إدارة).';
  } else if (hint && activeDailyTab === 'operations') {
    hint.textContent =
      'عمليات — تاريخ، العملية، الأوقات، المرافق، نقطة تمريض، مساعد تمريض، والإجمالي يُحسب تلقائياً. مرّر الجدول لليمين/اليسار لرؤية كل الأعمدة.';
  } else if (hint && activeDailyTab === 'stay') {
    hint.textContent =
      'إقامة — «+ صف إقامة» = يوم جديد. «+ إقامة لنفس اليوم» أو زر + بجانب سعر الإقامة = إقامة ثانية لنفس التاريخ (نوع/سعر مختلف). تُجمع محاسبياً تحت إقامة ورعاية في الفاتورة الكبيرة.';
  } else if (hint && codes) {
    const label = DAILY_TAB_GROUPS.find((g) => g.id === activeDailyTab)?.label || '';
    hint.textContent = `قسم «${label}» — ابحث واختر البند، السعر من اللائحة تلقائياً. احفظ لتُضاف على الفاتورة الكبيرة.`;
  } else if (hint) {
    hint.textContent = 'اختر قسماً من التبويبات أعلاه.';
  }
  if (hint) {
    hint.style.display = hint.textContent?.trim() ? '' : 'none';
  }
  updateDailyClinicalContextBar();
  renderDailySectionTabs();
}

const DAILY_FOOTER_SPLIT_TABS = new Set([
  'medicines',
  'supplies',
  'lab',
  'radiology',
  'exams',
  'sessions',
  'other',
]);

let dailySheetDateScope = 'today';

function dailySheetScopeSupported() {
  return DAILY_FOOTER_SPLIT_TABS.has(activeDailyTab);
}

function getClinicalSheetEntries(allEntries = dailySheetEntriesCache) {
  const list = allEntries || [];
  const today = getLocalDateString();
  if (!dailySheetScopeSupported() || dailySheetDateScope === 'today') {
    return list.filter((entry) => fmtStayDate(entry.entry_date) === today);
  }
  const bounds = getDailyInvoicePeriodBounds();
  return list
    .filter((entry) => entryInInvoicePeriod(entry, bounds))
    .sort((a, b) => fmtStayDate(a.entry_date).localeCompare(fmtStayDate(b.entry_date)));
}

function markDailySheetRowsByEntryDate() {
  const today = getLocalDateString();
  document.querySelectorAll('#daily-sections-body .daily-entry-row').forEach((tr) => {
    const entryId = Number(tr.dataset.entryId);
    let entryDate = '';
    if (entryId) {
      const entry = (dailySheetEntriesCache || []).find((e) => Number(e.id) === entryId);
      entryDate = fmtStayDate(entry?.entry_date);
    }
    if (!entryDate) {
      entryDate =
        fmtStayDate(tr.querySelector('.daily-exam-date')?.value) ||
        fmtStayDate(tr.querySelector('.daily-session-date')?.value) ||
        fmtStayDate(tr.querySelector('.daily-lab-date')?.value) ||
        fmtStayDate(tr.querySelector('.daily-rad-date')?.value) ||
        '';
    }
    tr.classList.toggle('daily-entry-row--prior-day', Boolean(entryDate && entryDate !== today));
  });
}

function countPriorDaysWithTabData(tab) {
  const dates = new Set();
  for (const entry of cachedEntriesNotOnSheet()) {
    if (computeAllDaysTabTotal([entry], tab) <= 0) continue;
    const d = fmtStayDate(entry.entry_date);
    if (d) dates.add(d);
  }
  return dates.size;
}

function updateDailySheetScopeUi() {
  const wrap = document.getElementById('daily-sheet-scope-wrap');
  const sel = document.getElementById('daily-sheet-scope');
  const jump = document.getElementById('daily-sheet-scope-jump');
  if (!wrap) return;
  const show = dailySheetScopeSupported();
  wrap.classList.toggle('d-none', !show);
  if (!show) return;
  if (sel && sel.value !== dailySheetDateScope) sel.value = dailySheetDateScope;
  const prior = computePriorDaysTabTotal(activeDailyTab);
  const priorDays = countPriorDaysWithTabData(activeDailyTab);
  if (jump) {
    if (dailySheetDateScope === 'today' && prior > 0) {
      jump.classList.remove('d-none');
      jump.textContent = `عرض ${priorDays} يوم سابق (${dailyFmt(prior)})`;
    } else {
      jump.classList.add('d-none');
      jump.textContent = '';
    }
  }
}

function getDomLoadedDailyEntryIds() {
  const ids = new Set();
  document.querySelectorAll('#daily-sections-body tr[data-entry-id]').forEach((tr) => {
    const id = Number(tr.dataset.entryId);
    if (id) ids.add(id);
  });
  return ids;
}

/** Saved entries not shown in the current sheet (avoids double-count with today’s rows). */
function cachedEntriesNotOnSheet() {
  const loaded = getDomLoadedDailyEntryIds();
  return (dailySheetEntriesCache || []).filter((entry) => entry.id && !loaded.has(entry.id));
}

function computePriorDaysTabTotal(tab) {
  if (tab === 'stay') return 0;
  return computeAllDaysTabTotal(cachedEntriesNotOnSheet(), tab);
}

function computeTodayDomTabTotal(tab) {
  if (tab === 'medicines') {
    let total = 0;
    document.querySelectorAll('.daily-med-row').forEach((tr) => {
      total += dailyParseAmount(tr.querySelector('.daily-med-total')?.value);
    });
    return total;
  }
  if (tab === 'supplies') {
    let total = 0;
    document.querySelectorAll('.daily-sup-row').forEach((tr) => {
      total += dailyParseAmount(tr.querySelector('.daily-sup-sell-total')?.value);
    });
    return total;
  }
  if (tab === 'lab') {
    let total = 0;
    document.querySelectorAll('.daily-lab-row').forEach((tr) => {
      total += getLabRowGrandTotal(tr);
    });
    return total;
  }
  if (tab === 'radiology') {
    let total = 0;
    document.querySelectorAll('.daily-rad-row').forEach((tr) => {
      total += getRadRowGrandTotal(tr);
    });
    return total;
  }
  if (tab === 'other') {
    let total = 0;
    document.querySelectorAll('.daily-misc-row').forEach((tr) => {
      total += dailyParseAmount(tr.querySelector('.daily-misc-total')?.value);
    });
    return total;
  }
  if (tab === 'sessions') {
    let total = 0;
    document.querySelectorAll('.daily-session-row').forEach((tr) => {
      total += dailyParseAmount(tr.querySelector('.daily-session-total')?.value);
    });
    return total;
  }
  if (tab === 'exams') {
    let total = 0;
    document.querySelectorAll('.daily-exam-row').forEach((tr) => {
      if (!rowHasChargeData(tr)) return;
      total += getExamRowGrandTotal(tr);
    });
    return total;
  }
  return 0;
}

function computeSectionFooterTotal(tab) {
  if (tab === 'stay') {
    if (document.querySelector('#daily-sections-body .daily-stay-row')) {
      return computeDomStayTabTotal();
    }
    if (dailySheetEntriesCache?.length) return computeStayPeriodTotal();
    return 0;
  }
  return computePriorDaysTabTotal(tab) + computeTodayDomTabTotal(tab);
}

function updateDailyFooterLabel(priorTotal, todayTotal) {
  const footLabel = document.getElementById('daily-total-foot-label');
  if (!footLabel) return;
  const base = footLabel.getAttribute('data-base-label') || footLabel.textContent || 'إجمالي';
  if (dailySheetDateScope === 'period' && dailySheetScopeSupported()) {
    footLabel.textContent = base.replace('(كل الأيام)', '(كل الأيام المعروضة)');
    return;
  }
  const todayLabel = base.replace('(كل الأيام)', '(اليوم)');
  if (priorTotal > 0) {
    footLabel.textContent = `${todayLabel} — محفوظ في أيام أخرى: ${dailyFmt(priorTotal)} (اختر «كل أيام الإقامة» لعرضها)`;
  } else {
    footLabel.textContent = todayLabel;
  }
}

function updateSectionTabTotal() {
  const display = document.getElementById('daily-total-display');
  if (!display) return;
  display.removeAttribute('title');
  let total = 0;
  if (activeDailyTab === 'operations') {
    total = getOperationsAllDaysTotal();
    display.textContent = total > 0 ? dailyFmt(total) : '';
    return;
  }
  if (activeDailyTab === 'free-items') {
    document.querySelectorAll('#daily-free-items-tbody .daily-free-item-row').forEach((tr) => {
      const qty = dailyParseAmount(tr.querySelector('.daily-free-qty')?.value) || 1;
      const amt = dailyParseAmount(tr.querySelector('.daily-free-amount')?.value);
      total += qty * amt;
    });
    display.textContent = total > 0 ? dailyFmt(total) : '';
    return;
  }
  if (!activeDailyTab) {
    display.textContent = '';
    return;
  }
  if (activeDailyTab === 'stay') {
    total = computeSectionFooterTotal('stay');
    display.textContent = total > 0 ? dailyFmt(total) : '';
    return;
  }
  if (DAILY_FOOTER_SPLIT_TABS.has(activeDailyTab)) {
    const prior = computePriorDaysTabTotal(activeDailyTab);
    const today = computeTodayDomTabTotal(activeDailyTab);
    updateDailyFooterLabel(prior, today);
    if (dailySheetDateScope === 'period') {
      const allVisible = today;
      display.textContent = allVisible > 0 ? dailyFmt(allVisible) : '';
    } else {
      display.textContent = today > 0 ? dailyFmt(today) : '';
      if (prior > 0) {
        display.title = `محفوظ في أيام أخرى: ${dailyFmt(prior)} — الإجمالي الكلي: ${dailyFmt(prior + today)}`;
      }
    }
    updateDailySheetScopeUi();
    return;
  }
  total = computeSectionFooterTotal(activeDailyTab);
  display.textContent = total > 0 ? dailyFmt(total) : '';
}

function updateGlassesFinalAmount() {
  updateSectionTabTotal();
}

function getGlassesFinalAmount() {
  return 0;
}

const OPERATION_CASE_OPTIONS = [
  { value: 'special', label: 'حالة خاصة' },
  { value: 'hospital', label: 'حالة مستشفى' },
  { value: 'transferred_contracted', label: 'محول من جهة متعاقدة' },
  { value: 'special_contracted', label: 'خاص يتبع جهة متعاقدة' },
  { value: 'military', label: 'حالة عسكرية' },
];

const OPERATION_CASE_LEGACY_LABELS = {
  civil: 'نقدي / مدني (قديم)',
  contracted: 'جهة متعاقدة (قديم)',
  non_contracted: 'جهة غير متعاقدة (قديم)',
};

function operationCaseTypeLabel(value) {
  const v = String(value || '').trim();
  const opt = OPERATION_CASE_OPTIONS.find((o) => o.value === v);
  if (opt) return opt.label;
  return OPERATION_CASE_LEGACY_LABELS[v] || v || '—';
}

function buildOperationCaseTypeOptions(selected = 'special') {
  const sel = String(selected || 'special').trim() || 'special';
  const known = new Set(OPERATION_CASE_OPTIONS.map((o) => o.value));
  let html = OPERATION_CASE_OPTIONS.map(
    (opt) =>
      `<option value="${opt.value}"${sel === opt.value ? ' selected' : ''}>${dailyEscapeHtml(opt.label)}</option>`
  ).join('');
  if (sel && !known.has(sel)) {
    const legacyLabel = OPERATION_CASE_LEGACY_LABELS[sel] || sel;
    html += `<option value="${dailyEscapeAttr(sel)}" selected>${dailyEscapeHtml(legacyLabel)}</option>`;
  }
  return html;
}

function updateOperationsTotal() {
  const total = getOperationsAllDaysTotal();
  const cell = document.getElementById('daily-operations-total');
  if (cell) cell.textContent = total > 0 ? dailyFmt(total) : '0';
  updateSectionTabTotal();
  updateDailyGrandTotal();
}

async function refreshOperationsTotalsCache() {
  const fileNumber = getStayFileNumber();
  if (!fileNumber || !dailyStayContext?.invoice?.id) {
    dailyOperationsAllTotalCache = 0;
    dailyOperationsTodaySavedTotal = 0;
    return;
  }
  try {
    const allOps = await apiJson(
      `${DAILY_API}/operations?file_number=${encodeURIComponent(fileNumber)}`
    );
    dailyOperationsAllTotalCache = (allOps || []).reduce(
      (sum, op) =>
        sum +
        dailyParseAmount(op.amount) +
        dailyParseAmount(op.companion_amount) +
        dailyParseAmount(op.nursing_point_amount) +
        dailyParseAmount(op.patient_assistant_amount),
      0
    );
    dailyOperationsTodaySavedTotal = 0;
  } catch {
    dailyOperationsAllTotalCache = 0;
    dailyOperationsTodaySavedTotal = 0;
  }
}

function formatOperationTimeForInput(value) {
  if (!value) return '';
  const s = String(value).trim();
  const m = s.match(/^(\d{1,2}):(\d{2})/);
  if (!m) return '';
  return `${String(m[1]).padStart(2, '0')}:${m[2]}`;
}

function operationTimeToMinutes(value) {
  const t = formatOperationTimeForInput(value);
  if (!t) return null;
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

function computeOperationDurationHours(startTime, endTime) {
  const start = operationTimeToMinutes(startTime);
  const end = operationTimeToMinutes(endTime);
  if (start == null || end == null || end < start) return 0;
  return Math.round(((end - start) / 60) * 100) / 100;
}

const OPERATION_PICKER_SECTION_CODE = 'operation_pick';

function buildOperationNamePickerHtml(selectedName = '') {
  return `
    <div class="daily-op-picker position-relative" data-section="${OPERATION_PICKER_SECTION_CODE}">
      <div class="input-group input-group-sm">
        <input type="search" class="form-control form-control-sm daily-op-picker-search" value="${dailyEscapeAttr(selectedName)}" autocomplete="off" placeholder="">
        <button type="button" class="btn btn-outline-secondary btn-sm daily-op-picker-clear" title="مسح الاختيار" aria-label="مسح">×</button>
      </div>
      <input type="hidden" class="daily-op-picker-value">
      <div class="daily-op-picker-suggest service-suggest d-none"></div>
    </div>`;
}

function getOperationNameFromRow(tr) {
  const search = tr?.querySelector('.daily-op-picker-search');
  if (search) return String(search.value || '').trim();
  return String(tr?.querySelector('.daily-op-name')?.value || '').trim();
}

function positionOpPickerSuggest(tr, container) {
  const searchInput = tr?.querySelector('.daily-op-picker-search');
  if (searchInput && window.DailyEntryPicker?.positionFloatingSuggest) {
    DailyEntryPicker.positionFloatingSuggest(searchInput, container);
  }
}

function renderOperationPickerSuggestions(container, result, query, tr) {
  const rows = result?.rows || [];
  const q = String(query || '').trim();
  if (result?.min_search && q.length < 2 && !rows.length) {
    container.innerHTML =
      '<div class="service-suggest-empty p-2 small text-muted">اكتب للبحث أو اختر من القائمة — مثال: غضروف، حقن، توسيع</div>';
    container.classList.remove('d-none');
    positionOpPickerSuggest(tr, container);
    return;
  }
  if (!rows.length) {
    const hint = result?.hint
      ? `<div class="p-2 small text-warning">${dailyEscapeHtml(result.hint)}</div>`
      : '';
    let emptyMsg = 'لا توجد نتائج مطابقة — جرّب جزء من اسم العملية (مثل: غضروف، حقن، توسيع)';
    if (result?.empty_catalog) {
      emptyMsg = 'لا توجد عمليات في اللائحة — ارفع ملف العمليات الجراحية أولاً';
    } else if (result?.catalog_total > 0) {
      emptyMsg = `لا توجد نتائج مطابقة — اللائحة تحتوي ${result.catalog_total} عملية. جرّب: غضروف، حقن، توسيع`;
    }
    container.innerHTML =
      hint + `<div class="service-suggest-empty p-2 small text-muted">${dailyEscapeHtml(emptyMsg)}</div>`;
    container.classList.remove('d-none');
    positionOpPickerSuggest(tr, container);
    return;
  }
  container.innerHTML = rows
    .map((item) => {
      const price = Number(item.price ?? item.list_price) || 0;
      const label = item.code ? `${item.code} — ${item.name}` : item.name;
      return `<button type="button" class="service-suggest-item daily-op-suggest-item w-100 text-start border-0 bg-transparent" data-name="${dailyEscapeAttr(item.name || '')}" data-price="${price}">
        <div class="daily-picker-suggest-label"><strong>${dailyEscapeHtml(label)}</strong></div>
        <div class="daily-picker-suggest-meta text-muted"><span>${dailyFmt(price)}</span></div>
      </button>`;
    })
    .join('');
  container.classList.remove('d-none');
  positionOpPickerSuggest(tr, container);
  container.querySelectorAll('.daily-op-suggest-item').forEach((btn) => {
    btn.addEventListener('mousedown', (e) => {
      e.preventDefault();
      const name = btn.dataset.name || '';
      const price = Number(btn.dataset.price) || 0;
      const searchInput = tr.querySelector('.daily-op-picker-search');
      if (searchInput) {
        searchInput.value = name;
        searchInput.title = name;
      }
      const amountInput = tr.querySelector('.daily-op-amount');
      if (amountInput && price > 0) {
        if (typeof setCommaAmountValue === 'function') setCommaAmountValue(amountInput, price);
        else amountInput.value = formatAmountFieldValue(price);
      }
      container.classList.add('d-none');
      updateOperationRowTotal(tr);
      updateOperationsTotal();
    });
  });
}

function bindOperationNamePicker(tr) {
  const picker = tr?.querySelector('.daily-op-picker');
  const searchInput = picker?.querySelector('.daily-op-picker-search');
  const suggest = picker?.querySelector('.daily-op-picker-suggest');
  const clearBtn = picker?.querySelector('.daily-op-picker-clear');
  if (!picker || !searchInput || !suggest) return;
  if (picker.dataset.bound === '1') return;
  picker.dataset.bound = '1';

  let debounceTimer = null;
  let searchAbort = null;

  const runSearch = async () => {
    const q = searchInput.value.trim();
    if (q.length < 2) {
      suggest.classList.add('d-none');
      return;
    }
    if (searchAbort) searchAbort.abort();
    searchAbort = new AbortController();
    try {
      const params = new URLSearchParams({
        section_code: OPERATION_PICKER_SECTION_CODE,
        search: q,
        limit: '30',
      });
      const res = await apiFetch(`${DAILY_API}/picker/search?${params}`, {
        signal: searchAbort.signal,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      renderOperationPickerSuggestions(suggest, data, q, tr);
    } catch (err) {
      if (err?.name === 'AbortError') return;
      suggest.innerHTML = '<div class="service-suggest-empty p-2 small text-muted">تعذر البحث</div>';
      suggest.classList.remove('d-none');
    }
  };

  const runBrowse = async () => {
    if (searchAbort) searchAbort.abort();
    searchAbort = new AbortController();
    try {
      const res = await apiFetch(
        `${DAILY_API}/picker/list?category_code=SPINE_CENTER&limit=50`,
        { signal: searchAbort.signal }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      renderOperationPickerSuggestions(
        suggest,
        {
          rows: data.rows || [],
          catalog_total: data.total || (data.rows || []).length,
          empty_catalog: !(data.rows || []).length,
        },
        '',
        tr
      );
    } catch (err) {
      if (err?.name === 'AbortError') return;
    }
  };

  searchInput.addEventListener('input', () => {
    clearTimeout(debounceTimer);
    const q = searchInput.value.trim();
    if (q.length < 2) {
      void runBrowse();
      return;
    }
    debounceTimer = setTimeout(runSearch, 250);
  });
  searchInput.addEventListener('focus', () => {
    const q = searchInput.value.trim();
    if (q.length >= 2) runSearch();
    else void runBrowse();
  });
  searchInput.addEventListener('blur', () => {
    setTimeout(() => suggest.classList.add('d-none'), 200);
  });
  clearBtn?.addEventListener('click', () => {
    searchInput.value = '';
    const valueInput = picker.querySelector('.daily-op-picker-value');
    if (valueInput) valueInput.value = '';
    const amountInput = tr.querySelector('.daily-op-amount');
    if (amountInput) amountInput.value = '';
    suggest.classList.add('d-none');
    searchInput.focus();
    updateOperationsTotal();
  });
}

function createOperationRowHtml(op = {}) {
  const amountVal =
    op.amount != null && Number(op.amount) > 0
      ? typeof formatAmountInput === 'function'
        ? formatAmountInput(op.amount)
        : dailyFormatInput(op.amount)
      : '';
  const companionVal =
    op.companion_amount != null && Number(op.companion_amount) > 0
      ? formatAmountFieldValue(op.companion_amount)
      : '';
  const nursingVal =
    op.nursing_point_amount != null && Number(op.nursing_point_amount) > 0
      ? formatAmountFieldValue(op.nursing_point_amount)
      : '';
  const assistantVal =
    op.patient_assistant_amount != null && Number(op.patient_assistant_amount) > 0
      ? formatAmountFieldValue(op.patient_assistant_amount)
      : '';
  const dateVal = op.entry_date
    ? String(op.entry_date).slice(0, 10)
    : document.getElementById('daily-entry-date')?.value?.trim() || getLocalDateString();
  const startTimeVal = formatOperationTimeForInput(op.operation_start_time);
  const endTimeVal = formatOperationTimeForInput(op.operation_end_time);
  const rowTotal =
    (Number(op.amount) || 0) +
    (Number(op.companion_amount) || 0) +
    (Number(op.nursing_point_amount) || 0) +
    (Number(op.patient_assistant_amount) || 0);
  const rowTotalVal = rowTotal > 0 ? formatAmountFieldValue(rowTotal) : '';
  return `
    <td class="daily-col-serial"><input type="text" class="form-control form-control-sm daily-row-serial bg-light text-center fw-bold" readonly tabindex="-1"></td>
    <td><input type="date" class="form-control form-control-sm daily-op-date" value="${dailyEscapeAttr(dateVal)}" autocomplete="off"></td>
    <td>${buildOperationNamePickerHtml(op.operation_name || '')}</td>
    <td><input type="time" class="form-control form-control-sm daily-op-start-time" value="${dailyEscapeAttr(startTimeVal)}" autocomplete="off"></td>
    <td><input type="time" class="form-control form-control-sm daily-op-end-time" value="${dailyEscapeAttr(endTimeVal)}" autocomplete="off"></td>
    <td><input type="text" class="form-control form-control-sm daily-op-surgeon" value="${dailyEscapeAttr(op.surgeon_name || '')}" autocomplete="off"></td>
    <td><input type="text" class="form-control form-control-sm daily-op-anesthesia" value="${dailyEscapeAttr(op.anesthesia_doctor || '')}" autocomplete="off"></td>
    <td><input type="text" class="form-control form-control-sm daily-op-assistant" value="${dailyEscapeAttr(op.assistant_surgeon || '')}" autocomplete="off"></td>
    <td><select class="form-select form-select-sm daily-op-case-type fw-bold">${buildOperationCaseTypeOptions(op.case_type || 'special')}</select></td>
    <td><input type="text" inputmode="decimal" class="form-control form-control-sm daily-op-amount comma-amount" value="${dailyEscapeAttr(amountVal)}" autocomplete="off"></td>
    <td><input type="text" inputmode="decimal" class="form-control form-control-sm daily-op-companion comma-amount" value="${dailyEscapeAttr(companionVal)}" autocomplete="off"></td>
    <td><input type="text" inputmode="decimal" class="form-control form-control-sm daily-op-nursing comma-amount" value="${dailyEscapeAttr(nursingVal)}" autocomplete="off"></td>
    <td><input type="text" inputmode="decimal" class="form-control form-control-sm daily-op-assistant-amt comma-amount" value="${dailyEscapeAttr(assistantVal)}" autocomplete="off"></td>
    <td><input type="text" class="form-control form-control-sm daily-op-row-total bg-light fw-bold" readonly value="${dailyEscapeAttr(rowTotalVal)}"></td>
    <td class="text-center"><button type="button" class="btn btn-sm btn-outline-danger daily-op-remove" title="حذف">×</button></td>`;
}

function applyOperationCaseTypeStyle(select) {
  if (!select) return;
  select.classList.remove(
    'border-warning',
    'border-info',
    'border-primary',
    'border-success',
    'border-secondary',
    'bg-warning-subtle',
    'bg-info-subtle',
    'bg-primary-subtle',
    'bg-success-subtle'
  );
  const map = {
    special: ['border-secondary'],
    hospital: ['border-info', 'bg-info-subtle'],
    transferred_contracted: ['border-primary', 'bg-primary-subtle'],
    special_contracted: ['border-success', 'bg-success-subtle'],
    military: ['border-warning', 'bg-warning-subtle'],
  };
  (map[select.value] || ['border-secondary']).forEach((cls) => select.classList.add(cls));
}

function bindOperationRowEvents(tr) {
  const onChargeChange = () => {
    updateOperationRowTotal(tr);
    updateOperationsTotal();
  };
  tr.querySelectorAll('.daily-op-amount, .daily-op-companion, .daily-op-nursing, .daily-op-assistant-amt').forEach((el) => {
    el.addEventListener('input', onChargeChange);
  });
  tr.querySelector('.daily-op-remove')?.addEventListener('click', () => {
    tr.remove();
    ensureOperationRows();
    renumberPanelRowSerials('#daily-operations-tbody .daily-operation-row');
    updateOperationsTotal();
  });
  const caseType = tr.querySelector('.daily-op-case-type');
  if (caseType) {
    applyOperationCaseTypeStyle(caseType);
    caseType.addEventListener('change', () => applyOperationCaseTypeStyle(caseType));
  }
  if (typeof bindCommaAmountInputs === 'function') bindCommaAmountInputs(tr);
  bindDailyAmountRecalc(tr);
  bindOperationNamePicker(tr);
  updateOperationRowTotal(tr);
}

function getDailyAddRowLabel(tab = activeDailyTab) {
  return DAILY_ADD_ROW_LABELS[tab] || '+ صف جديد';
}

function updateDailyAddRowButtons() {
  const showMainAdd = !DAILY_SHEET_PANEL_TABS.includes(activeDailyTab);
  const label = getDailyAddRowLabel();
  ['daily-add-row-btn', 'daily-sheet-add-row-btn'].forEach((id) => {
    const btn = document.getElementById(id);
    if (!btn) return;
    btn.classList.toggle('d-none', !showMainAdd);
    if (showMainAdd) btn.textContent = label;
  });
  const extraAccBtn = document.getElementById('daily-stay-extra-acc-btn');
  if (extraAccBtn) {
    extraAccBtn.classList.toggle('d-none', activeDailyTab !== 'stay' || !canUseDailyStayCharges());
  }
}

function resolveStayRowForAccommodationAddon() {
  const active = document.activeElement?.closest?.('.daily-stay-row, .daily-stay-addon-row');
  const primaryFromFocus = active ? findStayPrimaryRow(active) : null;
  if (primaryFromFocus) return primaryFromFocus;
  const rows = [...document.querySelectorAll('#daily-sections-body .daily-stay-row')];
  if (!rows.length) return null;
  return rows[rows.length - 1];
}

function addStayAccommodationAddonForDay() {
  if (activeDailyTab !== 'stay' || !canUseDailyStayCharges()) {
    showToast('المريض الخارجي لا يُسجَّل عليه إقامة', 'warning');
    return;
  }
  let primaryTr = resolveStayRowForAccommodationAddon();
  if (!primaryTr) {
    addDailyEntryRow();
    primaryTr = document.querySelector('#daily-sections-body .daily-stay-row:last-of-type');
  }
  if (!primaryTr) {
    showToast('أضف صف إقامة أولاً', 'warning');
    return;
  }
  const addon = createStayAddonRow(primaryTr, 'accommodation');
  insertStayAddonRow(primaryTr, addon);
  bindStayAddonButtons(primaryTr);
  if (typeof bindCommaAmountInputs === 'function') bindCommaAmountInputs(addon);
  updateStayRowGroupTotal(primaryTr);
  updateDailyGrandTotal();
  updateSectionTabTotal();
  addon.querySelector('.daily-row-stay-type')?.focus();
  showToast('أضف نوع الإقامة والسعر ثم احفظ — تُجمع مع إقامة اليوم في الفاتورة', 'info');
}

function focusDailyEntryRow(tr) {
  if (!tr) return;
  const focusable = tr.querySelector(
    '.daily-picker-search, .daily-op-name, input:not([readonly]):not([type="hidden"]), select, textarea'
  );
  focusable?.focus();
}

function findBlankDailyEntryRow() {
  const selector =
    activeDailyTab === 'stay'
      ? '#daily-sections-body .daily-stay-row'
      : '#daily-sections-body .daily-entry-row';
  for (const row of document.querySelectorAll(selector)) {
    if (row.dataset.entryId) continue;
    if (activeDailyTab === 'stay') {
      if (!stayRowGroupHasChargeData(row)) return row;
      continue;
    }
    if (!rowHasChargeData(row)) return row;
  }
  return null;
}

function addIsoDateDays(iso, days) {
  const d = new Date(`${iso}T12:00:00`);
  if (Number.isNaN(d.getTime())) return '';
  d.setDate(d.getDate() + days);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function collectStayDatesInDom() {
  const dates = new Set();
  document.querySelectorAll('#daily-sections-body .daily-stay-row').forEach((tr) => {
    const d = fmtStayDate(tr.querySelector('.daily-row-date')?.value);
    if (d) dates.add(d);
  });
  return dates;
}

/** Next calendar day in the invoice stay period without a row yet (not suppressed). */
function suggestNextStayEntryDate() {
  const used = collectStayDatesInDom();
  const { from, to } = getDailyInvoicePeriodBounds();
  const end = to || getLocalDateString();
  const start = from || end;
  if (start > end) {
    const today = getLocalDateString();
    if (!used.has(today) && !isDailyStayDateSuppressed(today)) return today;
    return null;
  }
  for (let cursor = start; ; cursor = addIsoDateDays(cursor, 1)) {
    if (cursor > end) break;
    if (!used.has(cursor) && !isDailyStayDateSuppressed(cursor)) return cursor;
  }
  return null;
}

function isDailyEntryPresetEmpty(preset = {}) {
  if (preset.id) return false;
  return !Object.keys(preset).some((key) => {
    const value = preset[key];
    return value != null && value !== '';
  });
}

function operationRowIsBlank(tr) {
  if (!tr) return true;
  return !getOperationNameFromRow(tr) && getOperationRowTotal(tr) <= 0;
}

function findBlankOperationRow() {
  for (const row of document.querySelectorAll('#daily-operations-tbody .daily-operation-row')) {
    if (!operationRowIsBlank(row)) continue;
    return row;
  }
  return null;
}

function isOperationPresetEmpty(op = {}) {
  return !(
    op.operation_name ||
    Number(op.amount) > 0 ||
    Number(op.companion_amount) > 0 ||
    Number(op.nursing_point_amount) > 0 ||
    Number(op.patient_assistant_amount) > 0 ||
    op.surgeon_name ||
    op.anesthesia_doctor ||
    op.assistant_surgeon
  );
}

function handleDailySheetAddRow() {
  if (activeDailyTab === 'operations') {
    addOperationRow();
    return;
  }
  if (activeDailyTab === 'stay') {
    clearDailyStayDateSuppression(getLocalDateString());
  }
  addDailyEntryRow();
}

function ensureOperationRows() {
  const tbody = document.getElementById('daily-operations-tbody');
  if (!tbody) return;
  if (!tbody.querySelector('.daily-operation-row')) {
    addOperationRow();
  }
}

function addOperationRow(op = {}) {
  const tbody = document.getElementById('daily-operations-tbody');
  if (!tbody) return;
  if (isOperationPresetEmpty(op)) {
    const blank = findBlankOperationRow();
    if (blank) {
      blank.querySelector('.daily-op-name')?.focus();
      return;
    }
  }
  const tr = document.createElement('tr');
  tr.className = 'daily-operation-row';
  tr.innerHTML = createOperationRowHtml(op);
  tbody.appendChild(tr);
  bindOperationRowEvents(tr);
  updateOperationRowTotal(tr);
  renumberPanelRowSerials('#daily-operations-tbody .daily-operation-row');
  updateOperationsTotal();
  if (isOperationPresetEmpty(op)) tr.querySelector('.daily-op-name')?.focus();
}

function collectOperationsFromTable() {
  const rows = [];
  document.querySelectorAll('#daily-operations-tbody .daily-operation-row').forEach((tr) => {
    const operation_name = getOperationNameFromRow(tr);
    const amount = dailyParseAmount(tr.querySelector('.daily-op-amount')?.value);
    const companion_amount = dailyParseAmount(tr.querySelector('.daily-op-companion')?.value);
    const nursing_point_amount = dailyParseAmount(tr.querySelector('.daily-op-nursing')?.value);
    const patient_assistant_amount = dailyParseAmount(tr.querySelector('.daily-op-assistant-amt')?.value);
    const operation_start_time = tr.querySelector('.daily-op-start-time')?.value || '';
    const operation_end_time = tr.querySelector('.daily-op-end-time')?.value || '';
    const duration_hours = computeOperationDurationHours(operation_start_time, operation_end_time);
    const entry_date =
      tr.querySelector('.daily-op-date')?.value?.trim() ||
      document.getElementById('daily-entry-date')?.value?.trim() ||
      getLocalDateString();
    const rowTotal = getOperationRowTotal(tr);
    if (!operation_name && rowTotal <= 0) return;
    rows.push({
      entry_date,
      operation_name,
      operation_start_time,
      operation_end_time,
      duration_hours,
      surgeon_name: tr.querySelector('.daily-op-surgeon')?.value?.trim() || '',
      anesthesia_doctor: tr.querySelector('.daily-op-anesthesia')?.value?.trim() || '',
      assistant_surgeon: tr.querySelector('.daily-op-assistant')?.value?.trim() || '',
      case_type: tr.querySelector('.daily-op-case-type')?.value || 'special',
      amount,
      companion_amount,
      nursing_point_amount,
      patient_assistant_amount,
    });
  });
  return rows;
}

async function loadOperationsForPatient() {
  const tbody = document.getElementById('daily-operations-tbody');
  if (!tbody) return;
  const fileNumber = getStayFileNumber();
  if (!fileNumber || !dailyStayContext?.invoice?.id) {
    tbody.innerHTML = '';
    if (activeDailyTab === 'operations') ensureOperationRows();
    else updateOperationsTotal();
    return;
  }
  try {
    await refreshOperationsTotalsCache();
    const ops = await apiJson(
      `${DAILY_API}/operations?file_number=${encodeURIComponent(fileNumber)}`
    );
    tbody.innerHTML = '';
    if (ops.length) {
      ops.forEach((op) => addOperationRow(op));
      renumberPanelRowSerials('#daily-operations-tbody .daily-operation-row');
    } else {
      ensureOperationRows();
    }
    updateOperationsTotal();
    captureDailySheetBaseline();
  } catch (err) {
    console.error(err);
    tbody.innerHTML = '';
    ensureOperationRows();
    updateOperationsTotal();
    captureDailySheetBaseline();
  }
}

async function loadOperationsForToday() {
  return loadOperationsForPatient();
}

async function saveOperationsPanel(options = {}) {
  const { silent = false } = options;
  if (!dailyCan('daily_charges.manage')) {
    if (!silent) showToast('ليس لديك صلاحية', 'warning');
    return false;
  }
  const file_number = getStayFileNumber();
  if (!file_number || !dailyStayContext?.invoice?.id) {
    if (!silent) showToast('لا توجد فاتورة مفتوحة', 'warning');
    return false;
  }
  const operations = collectOperationsFromTable();
  if (!operations.length) {
    if (!silent) showToast('أضف عملية واحدة على الأقل (اسم أو مبلغ)', 'warning');
    return false;
  }
  try {
    const data = await apiJson(`${DAILY_API}/operations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ file_number, operations }),
    });
    const prevTab = activeDailyTab;
    await refreshInvoiceFormAfterDailySave(file_number, data.invoice_id);
    await refreshOperationsTotalsCache();
    await refreshDailyStaySummary(file_number);
    if (!silent || !isDailyPanelFocused()) {
      await loadOperationsForPatient();
      if (prevTab && activeDailyTab !== prevTab) showDailySection(prevTab);
    }
    const totalLabel =
      data.final_total != null
        ? dailyFmt(data.final_total)
        : dailyFmt(operations.reduce((s, o) => s + getOperationRowTotalFromPayload(o), 0));
    if (!silent) {
      showToast(`تم الحفظ — أُضيف على الفاتورة الكبيرة (${totalLabel})`, 'success');
    } else if (window.AutoSave) {
      AutoSave.noteSaved('daily', getDailyAutosaveFingerprint());
    }
    captureDailySheetBaseline();
    return true;
  } catch (err) {
    if (!silent) {
      showToast(sanitizeApiErrorMessage(err.message), 'danger');
    } else if (window.AutoSave) {
      AutoSave.setStatus('daily', 'error', sanitizeApiErrorMessage(err.message));
    }
    return false;
  }
}

function createFreeItemRowHtml(item = {}) {
  const qty =
    item.quantity != null && item.quantity !== ''
      ? typeof dailyFormatInput === 'function'
        ? dailyFormatInput(item.quantity, 0)
        : String(item.quantity)
      : '1';
  const amt =
    item.amount != null && item.amount !== ''
      ? typeof dailyFormatInput === 'function'
        ? dailyFormatInput(item.amount)
        : String(item.amount)
      : '';
  const lineTotal = (Number(item.quantity) || 1) * dailyParseAmount(item.amount);
  const totalVal = lineTotal > 0 && typeof dailyFormatInput === 'function' ? dailyFormatInput(lineTotal) : '';
  return `
    <td class="daily-col-serial"><input type="text" class="form-control form-control-sm daily-row-serial bg-light text-center fw-bold" readonly tabindex="-1"></td>
    <td><input type="text" class="form-control form-control-sm daily-free-desc" value="${dailyEscapeHtml(item.description || '')}" autocomplete="off"></td>
    <td><input type="text" inputmode="decimal" class="form-control form-control-sm daily-free-qty comma-amount" data-decimals="0" value="${qty}" autocomplete="off"></td>
    <td><input type="text" inputmode="decimal" class="form-control form-control-sm daily-free-amount comma-amount" value="${amt}" autocomplete="off"></td>
    <td><input type="text" class="form-control form-control-sm daily-free-line-total bg-light fw-bold" readonly tabindex="-1" value="${totalVal}"></td>
    <td><button type="button" class="btn btn-sm btn-outline-danger daily-free-remove" title="حذف">×</button></td>`;
}

function bindFreeItemRowEvents(tr) {
  const updateLine = () => {
    const qty = dailyParseAmount(tr.querySelector('.daily-free-qty')?.value) || 1;
    const amt = dailyParseAmount(tr.querySelector('.daily-free-amount')?.value);
    const totalEl = tr.querySelector('.daily-free-line-total');
    if (totalEl) {
      totalEl.value = amt ? (typeof dailyFormatInput === 'function' ? dailyFormatInput(qty * amt) : String(qty * amt)) : '';
    }
    updateFreeItemsTotal();
  };
  tr.querySelectorAll('.daily-free-qty, .daily-free-amount').forEach((el) => {
    el.addEventListener('input', updateLine);
  });
  tr.querySelector('.daily-free-remove')?.addEventListener('click', () => {
    tr.remove();
    updateFreeItemsTotal();
    if (!document.querySelector('#daily-free-items-tbody .daily-free-item-row')) addFreeItemRow();
  });
  if (typeof bindCommaAmountInputs === 'function') bindCommaAmountInputs(tr);
  updateLine();
}

function freeItemRowIsBlank(tr) {
  if (!tr) return true;
  const desc = tr.querySelector('.daily-free-desc')?.value?.trim() || '';
  const amt = dailyParseAmount(tr.querySelector('.daily-free-amount')?.value);
  return !desc && amt <= 0;
}

function addFreeItemRow(item = {}) {
  const tbody = document.getElementById('daily-free-items-tbody');
  if (!tbody) return;
  const hasSavedIdentity = Boolean(item.id);
  if (!hasSavedIdentity) {
    const rows = tbody.querySelectorAll('.daily-free-item-row');
    for (const row of rows) {
      if (freeItemRowIsBlank(row)) {
        row.querySelector('.daily-free-desc')?.focus();
        return;
      }
    }
  }
  const tr = document.createElement('tr');
  tr.className = 'daily-free-item-row';
  if (item.id) tr.dataset.itemId = String(item.id);
  tr.innerHTML = createFreeItemRowHtml(item);
  tbody.appendChild(tr);
  bindFreeItemRowEvents(tr);
  renumberPanelRowSerials('#daily-free-items-tbody .daily-free-item-row');
  updateFreeItemsTotal();
  if (!hasSavedIdentity) tr.querySelector('.daily-free-desc')?.focus();
}

function collectFreeItemsFromTable() {
  const rows = [];
  document.querySelectorAll('#daily-free-items-tbody .daily-free-item-row').forEach((tr) => {
    const description = tr.querySelector('.daily-free-desc')?.value?.trim() || '';
    const quantity = dailyParseAmount(tr.querySelector('.daily-free-qty')?.value) || 1;
    const amount = dailyParseAmount(tr.querySelector('.daily-free-amount')?.value);
    const id = tr.dataset.itemId ? Number(tr.dataset.itemId) : null;
    if (!description && amount <= 0) return;
    rows.push({
      id,
      description,
      quantity,
      amount,
      returned_quantity: 0,
      patient_credit_applied: 0,
    });
  });
  return rows;
}

function updateFreeItemsTotal() {
  let total = 0;
  document.querySelectorAll('#daily-free-items-tbody .daily-free-item-row').forEach((tr) => {
    const qty = dailyParseAmount(tr.querySelector('.daily-free-qty')?.value) || 1;
    const amt = dailyParseAmount(tr.querySelector('.daily-free-amount')?.value);
    total += qty * amt;
  });
  const el = document.getElementById('daily-free-items-total');
  if (el) el.textContent = dailyFmt(total);
}

async function loadFreeItemsPanel() {
  const tbody = document.getElementById('daily-free-items-tbody');
  if (!tbody) return;
  const fileNumber = getStayFileNumber();
  if (!fileNumber || !dailyStayContext?.invoice?.id) {
    tbody.innerHTML = '';
    updateFreeItemsTotal();
    return;
  }
  try {
    const data = await apiJson(`${DAILY_API}/free-items?file_number=${encodeURIComponent(fileNumber)}`);
    tbody.innerHTML = '';
    const items = data.items || [];
    if (items.length) items.forEach((item) => addFreeItemRow(item));
    else addFreeItemRow();
    updateFreeItemsTotal();
    captureDailySheetBaseline();
  } catch (err) {
    showToast(sanitizeApiErrorMessage(err.message), 'danger');
    tbody.innerHTML = '';
    addFreeItemRow();
    captureDailySheetBaseline();
  }
}

async function saveFreeItems(options = {}) {
  const { silent = false } = options;
  if (!dailyCan('daily_charges.manage')) {
    if (!silent) showToast('ليس لديك صلاحية', 'warning');
    return false;
  }
  const file_number = getStayFileNumber();
  if (!file_number || !dailyStayContext?.invoice?.id) {
    if (!silent) showToast('لا توجد فاتورة مفتوحة', 'warning');
    return false;
  }
  const items = collectFreeItemsFromTable();
  if (!items.length) {
    if (!silent) showToast('أضف بندًا واحدًا على الأقل', 'warning');
    return false;
  }
  try {
    const data = await apiJson(`${DAILY_API}/free-items`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ file_number, items }),
    });
    const prevTab = activeDailyTab;
    await refreshDailyStaySummary(file_number);
    if (!silent || !isDailyPanelFocused()) {
      await loadFreeItemsPanel();
      if (prevTab && activeDailyTab !== prevTab) showDailySection(prevTab);
    }
    const freeTotal =
      data.free_items_total ??
      (data.items || items).reduce(
        (sum, row) => sum + (Number(row.quantity) || 1) * (Number(row.amount) || 0),
        0
      );
    if (!silent) {
      showToast(`تم الحفظ — البنود الحرة على الفاتورة: ${dailyFmt(freeTotal)}`, 'success');
    } else if (window.AutoSave) {
      AutoSave.noteSaved('daily', getDailyAutosaveFingerprint());
    }
    captureDailySheetBaseline();
    return true;
  } catch (err) {
    if (!silent) {
      showToast(sanitizeApiErrorMessage(err.message), 'danger');
    } else if (window.AutoSave) {
      AutoSave.setStatus('daily', 'error', sanitizeApiErrorMessage(err.message));
    }
    return false;
  }
}

function renderDailySectionTabs() {
  const tabsEl = document.getElementById('daily-entry-tabs');
  if (!tabsEl) return;
  const hideStay = !canUseDailyStayCharges();
  tabsEl.innerHTML = DAILY_TAB_GROUPS
    .filter((g) => !(hideStay && g.id === 'stay'))
    .map((g) => {
      const active = activeDailyTab === g.id ? ' active' : '';
      return `<li class="nav-item" role="presentation">
        <button type="button" class="nav-link daily-section-tab fw-bold${active}" data-daily-tab="${g.id}" role="tab">
          ${g.icon || ''} ${dailyEscapeHtml(g.label)}
        </button>
      </li>`;
    })
    .join('');
}

function defaultDailyTabForPatient(ctx) {
  const pType = ctx?.patient?.patient_type || 'internal';
  return pType === 'external' ? 'medicines' : 'stay';
}

function renderDailySectionTiles() {
  renderDailySectionTabs();
}

function captureDailySheetBaseline() {
  try {
    dailySavedSheetFingerprint = getDailyAutosaveFingerprint();
  } catch {
    dailySavedSheetFingerprint = '';
  }
}

function resolvePickerSectionForRow(tr) {
  const picker = tr?.querySelector('.daily-picker[data-section]');
  if (!picker) return null;
  const code = picker.dataset.section;
  return dailySectionsCache.find((s) => s.code === code) || null;
}

function resolveSavedLineForPickerRow(tr, section) {
  const code = section?.code;
  if (!code) return {};
  const entryId = Number(tr.dataset.entryId);
  const entry = entryId
    ? (dailySheetEntriesCache || []).find((e) => Number(e.id) === entryId)
    : null;
  const lines = entry?.lines || tr._entryLinesSnapshot || [];
  const lineId =
    Number(tr.dataset.lineId) || Number(tr.dataset.examLineId) || Number(tr.dataset.catalogCode) || 0;
  if (lineId) {
    const byId = lines.find((l) => Number(l.id) === lineId);
    if (byId) return byId;
  }
  if (code === 'sessions') {
    return lines.find((l) => l.section_code === 'sessions') || {};
  }
  return getLineForSection({ lines }, code) || {};
}

async function awaitDailySheetPickerHydration() {
  const pickerApi = window.DailyEntryPicker;
  if (!pickerApi?.hydratePicker) return;
  const tasks = [];
  document.querySelectorAll('#daily-sections-body .daily-entry-row').forEach((tr) => {
    const section = resolvePickerSectionForRow(tr);
    if (!section) return;
    tasks.push(pickerApi.hydratePicker(tr, section, resolveSavedLineForPickerRow(tr, section)));
  });
  if (tasks.length) await Promise.allSettled(tasks);
  if (activeDailyTab === 'sessions') {
    document.querySelectorAll('.daily-session-row').forEach((tr) => {
      const picker = tr.querySelector('.daily-picker[data-section="sessions"]');
      syncSessionsRowDisplay(tr, picker?._selectedItem);
    });
  }
}

function dailyTabHasUnsavedChanges() {
  if (!dailyStayContext?.invoice?.id) return false;
  if (!dailyCan('daily_charges.manage')) return false;
  try {
    const current = getDailyAutosaveFingerprint();
    if (!dailySavedSheetFingerprint) {
      if (activeDailyTab === 'operations') return collectOperationsFromTable().length > 0;
      if (activeDailyTab === 'free-items') {
        return collectFreeItemsFromTable().some((item) => item.description || item.amount > 0);
      }
      return collectDailyRowsForSave().length > 0;
    }
    return current !== dailySavedSheetFingerprint;
  } catch {
    return false;
  }
}

async function confirmUnsavedBeforeTabSwitch() {
  if (!dailyTabHasUnsavedChanges()) return true;
  const label = dailyTabLabel(activeDailyTab);
  return confirm(
    `يوجد بيانات غير محفوظة في «${label}».\n\nمواصلة الانتقال بدون حفظ؟\n(اختر «إلغاء» للرجوع والحفظ أولاً)`
  );
}

function dailyTabLabel(tabId) {
  const id = tabId || activeDailyTab;
  return DAILY_TAB_GROUPS.find((g) => g.id === id)?.label || id || 'الشاشة';
}

async function showDailySection(sectionId, options = {}) {
  const skipUnsavedPrompt = options.skipUnsavedPrompt === true;
  if (sectionId && sectionId !== activeDailyTab && !skipUnsavedPrompt) {
    const proceed = await confirmUnsavedBeforeTabSwitch();
    if (!proceed) return false;
  }
  if (sectionId) {
    activeDailyTab = sectionId;
    sessionStorage.setItem('dailyActiveTab', sectionId);
  }
  if (!activeDailyTab) activeDailyTab = 'medicines';
  if (activeDailyTab === 'stay' && !canUseDailyStayCharges()) {
    activeDailyTab = defaultDailyTabForPatient(dailyStayContext);
    showToast('المريض الخارجي لا يُسجَّل عليه إقامة', 'warning');
  }
  const sectionWorkspace = document.getElementById('daily-section-workspace');
  if (sectionWorkspace) sectionWorkspace.classList.remove('d-none');
  updateFocusedSectionTitle();
  renderDailySectionsTable();
  applyDailyTabColumnVisibility();
  if (sectionId === 'free-items') void loadFreeItemsPanel();
  if (sectionId === 'operations') void loadOperationsForPatient();
  if (
    activeDailyTab &&
    dailyStayContext?.invoice?.id &&
    !['operations', 'free-items'].includes(activeDailyTab)
  ) {
    void loadDailyEntriesIntoSheet();
  }
  return true;
}

function showDailyPatientPicker() {
  document.getElementById('daily-patient-picker-wrap')?.classList.remove('d-none');
  document.getElementById('daily-patient-workspace')?.classList.add('d-none');
  document.getElementById('daily-change-patient-btn')?.classList.add('d-none');
  document.getElementById('daily-patient-results-wrap')?.classList.add('d-none');
  const searchInput = document.getElementById('daily-patient-search');
  if (searchInput) searchInput.value = '';
  resetDailyPatientPickerList();
  sessionStorage.removeItem('dailyStayFileNumber');
  dailyStayContext = null;
  dailySavedSheetFingerprint = '';
  activeDailyTab = '';
  dailySheetSerialNext = 1;
  dailySheetSerialMap.clear();
  dailySheetEntriesCache = [];
  updateDailyMilitaryAuthBanner(null);
  if (typeof window.updateGlobalInvoicePrintButton === 'function') window.updateGlobalInvoicePrintButton();
}

function resetDailyPatientPickerList() {
  const list = document.getElementById('daily-patient-list');
  if (list) list.innerHTML = '';
}

function showDailyPatientResults() {
  document.getElementById('daily-patient-results-wrap')?.classList.remove('d-none');
}

function showDailyPatientWorkspace(ctx = dailyStayContext, options = {}) {
  const preserveTab = options.preserveTab === true && Boolean(activeDailyTab);
  document.getElementById('daily-patient-picker-wrap')?.classList.add('d-none');
  document.getElementById('daily-patient-workspace')?.classList.remove('d-none');
  document.getElementById('daily-change-patient-btn')?.classList.remove('d-none');
  if (preserveTab) {
    updateFocusedSectionTitle();
    renderDailySectionTabs();
    renderDailySectionsTable();
    applyDailyTabColumnVisibility();
  } else {
    showDailySection(defaultDailyTabForPatient(ctx));
    renderDailySectionTabs();
  }
}

function updateDailyPatientHeader(ctx) {
  const changeRoomBtn = document.getElementById('daily-change-room-btn');
  const editPatientBtn = document.getElementById('daily-edit-patient-btn');
  const convertBtn = document.getElementById('daily-convert-internal-btn');
  const p = ctx?.patient;
  const hasInvoice = Boolean(ctx?.invoice?.id);
  const isExternal = p?.patient_type === 'external';
  const showRoom = hasInvoice && !isExternal;
  if (changeRoomBtn) changeRoomBtn.classList.toggle('d-none', !showRoom);
  if (editPatientBtn) editPatientBtn.classList.toggle('d-none', !hasInvoice);
  if (convertBtn) convertBtn.classList.toggle('d-none', !hasInvoice || !isExternal);
  updateDailyPatientSummaryTable(ctx);
}

async function convertExternalPatientToInternal() {
  if (!dailyCan('daily_charges.manage')) {
    showToast('ليس لديك صلاحية التحويل', 'warning');
    return;
  }
  const file_number = getStayFileNumber();
  if (!file_number) {
    showToast('اختر مريضًا أولًا', 'warning');
    return;
  }
  if (
    !confirm(
      'تحويل المريض إلى قسم داخلي؟\n\nسيتم تفعيل تبويب الإقامة والرعاية وإمكانية تسجيل الغرفة.'
    )
  ) {
    return;
  }
  try {
    const data = await apiJson(`${DAILY_API}/convert-to-internal`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ file_number }),
    });
    applyDailyStayContext(data);
    await loadDailyStayTypes();
    renderDailySectionTabs();
    showDailySection('stay');
    await loadDailyEntriesIntoSheet();
    showToast('تم تحويل المريض إلى داخلي — يمكنك الآن تسجيل الإقامة', 'success');
  } catch (err) {
    showToast(sanitizeApiErrorMessage(err.message), 'danger');
  }
}

function updateDailyPatientSummaryTable(ctx) {
  const body = document.getElementById('daily-patient-summary-body');
  if (!body) return;
  const p = ctx?.patient || {};
  const inv = ctx?.invoice || {};
  const typeLabel = p.patient_type === 'external' ? 'خارجي' : 'داخلي';
  const genderLabel =
    p.gender === 'male' ? 'ذكر' : p.gender === 'female' ? 'أنثى' : p.gender || '—';
  const account = Number(p.account_balance) || 0;
  const roomInsurance = Number(p.room_insurance_amount) || 0;
  const prepaid = Math.round((account + roomInsurance) * 100) / 100;
  const remaining = inv.remaining ?? inv.outstanding_amount ?? 0;
  const collected = inv.total_collected ?? 0;
  const finalTotal = inv.final_total ?? 0;
  const prepaidHint =
    roomInsurance > 0
      ? ` <span class="small text-muted">(${dailyFmt(account)} رصيد + ${dailyFmt(roomInsurance)} تأمين)</span>`
      : '';
  const invLabel = inv.serial_number ? inv.serial_number : inv.id ? `#${inv.id}` : '—';
  const statusLabel = inv.status_label || inv.status || '—';
  const statusClass =
    inv.status === 'pending_review'
      ? 'bg-warning text-dark'
      : inv.status === 'approved'
        ? 'bg-success'
        : 'bg-secondary';
  const period = inv.admission_date
    ? formatDailyInvoicePeriodRange(inv.admission_date, inv.discharge_date)
    : '—';
  const financialDisplay = formatFinancialTreatmentDisplay(inv, p);

  body.innerHTML = `
    <tr>
      <th class="daily-summary-label text-nowrap">اسم المريض</th>
      <td class="fw-bold">${dailyEscapeHtml(p.name || inv.patient_name || '—')}</td>
      <th class="daily-summary-label text-nowrap">رقم الملف</th>
      <td class="fw-bold">${dailyEscapeHtml(p.file_number || inv.file_number || '—')}</td>
    </tr>
    <tr>
      <th class="daily-summary-label text-nowrap">الهاتف</th>
      <td>${dailyEscapeHtml(p.phone || '—')}</td>
      <th class="daily-summary-label text-nowrap">الجنس</th>
      <td>${dailyEscapeHtml(genderLabel)}</td>
    </tr>
    <tr>
      <th class="daily-summary-label text-nowrap">النوع</th>
      <td>${dailyEscapeHtml(typeLabel)}</td>
      <th class="daily-summary-label text-nowrap">الجنسية</th>
      <td>${dailyEscapeHtml(p.nationality || '—')}</td>
    </tr>
    <tr>
      <th class="daily-summary-label text-nowrap">رقم الفاتورة</th>
      <td class="fw-bold">${dailyEscapeHtml(invLabel)}</td>
      <th class="daily-summary-label text-nowrap">حالة الفاتورة</th>
      <td><span class="badge ${statusClass}">${dailyEscapeHtml(statusLabel)}</span></td>
    </tr>
    <tr>
      <th class="daily-summary-label text-nowrap">المعاملة المالية</th>
      <td>${dailyEscapeHtml(financialDisplay)}</td>
      <th class="daily-summary-label text-nowrap">فترة الفاتورة</th>
      <td class="invoice-period-range text-nowrap" dir="ltr">${dailyEscapeHtml(period)}</td>
    </tr>
    <tr>
      <th class="daily-summary-label text-nowrap">إجمالي الفاتورة</th>
      <td class="fw-bold text-primary amount-total" id="daily-invoice-final-total">${dailyFmt(finalTotal)}</td>
      <th class="daily-summary-label text-nowrap"></th>
      <td></td>
    </tr>
    <tr class="table-warning">
      <th class="daily-summary-label text-nowrap">رصيد الحساب</th>
      <td class="fw-bold text-success amount-total">${dailyFmt(prepaid)}${prepaidHint}</td>
      <th class="daily-summary-label text-nowrap">المحصل</th>
      <td class="fw-bold amount-total">${dailyFmt(collected)}</td>
    </tr>
    <tr class="table-warning">
      <th class="daily-summary-label text-nowrap">المتبقي على الفاتورة</th>
      <td class="fw-bold text-danger amount-total" id="daily-invoice-remaining-total">${dailyFmt(remaining)}</td>
      <th class="daily-summary-label text-nowrap">تأمين الغرفة (ضمن الإقامة)</th>
      <td class="fw-bold amount-total">${roomInsurance > 0 ? dailyFmt(roomInsurance) : '—'}</td>
    </tr>`;
}

async function loadDailyPatientGrid(search = '') {
  const list = document.getElementById('daily-patient-list');
  if (!list) return;
  const q = String(search || '').trim();
  if (!q) {
    document.getElementById('daily-patient-results-wrap')?.classList.add('d-none');
    resetDailyPatientPickerList();
    return;
  }
  showDailyPatientResults();
  list.innerHTML = '<tr><td colspan="4" class="text-center text-muted py-4">جاري البحث...</td></tr>';
  try {
    const params = new URLSearchParams({ limit: '80', search: q });
    const patients = await apiJson(`${DAILY_API}/patients?${params}`);
    if (!patients.length) {
      list.innerHTML =
        '<tr><td colspan="4" class="text-center text-muted py-4 mb-0">لا يوجد مرضى — <button type="button" class="btn btn-link btn-sm fw-bold p-0" id="daily-empty-register-btn">سجّل مريض جديد</button></td></tr>';
      document.getElementById('daily-empty-register-btn')?.addEventListener('click', () => {
        if (typeof switchView === 'function') switchView('patient-register');
      });
      return;
    }
    list.innerHTML = patients
      .map((p) => {
        const typeLabel = p.patient_type === 'external' ? 'خارجي' : 'داخلي';
        const typeBadge =
          p.patient_type === 'external'
            ? 'bg-info-subtle text-dark border'
            : 'bg-primary-subtle text-primary border';
        const openBadge = p.has_open_invoice
          ? '<span class="badge bg-warning text-dark ms-1">فاتورة مفتوحة</span>'
          : '';
        return `<tr class="daily-patient-row" data-file-number="${dailyEscapeHtml(p.file_number)}">
          <td class="fw-bold">${dailyEscapeHtml(p.file_number)}</td>
          <td>${dailyEscapeHtml(p.name)}${openBadge}</td>
          <td><span class="badge ${typeBadge}">${typeLabel}</span></td>
          <td>${dailyEscapeHtml(p.phone || '—')}</td>
        </tr>`;
      })
      .join('');
  } catch (err) {
    list.innerHTML = `<tr><td colspan="4" class="text-center text-danger py-3">${dailyEscapeHtml(sanitizeApiErrorMessage(err.message))}</td></tr>`;
  }
}

async function selectDailyPatient(fileNumber, options = {}) {
  const fn = String(fileNumber || '').trim();
  if (!fn) return;
  const fileInput = document.getElementById('daily-stay-file-number');
  if (fileInput) fileInput.value = fn;
  sessionStorage.setItem('dailyStayFileNumber', fn);
  const prevTab = options.preserveTab ? activeDailyTab || sessionStorage.getItem('dailyActiveTab') : '';
  await loadOpenPatientStay(fn);
  if (!prevTab || prevTab === 'stay') {
    await showDailySection('stay', { skipUnsavedPrompt: true });
  } else if (prevTab !== activeDailyTab) {
    showDailySection(prevTab);
  }
}

async function ensureOpenStayInvoice(ctx) {
  if (ctx?.invoice?.id) return ctx;
  const p = ctx?.patient;
  if (!p?.file_number?.trim() || !p?.name?.trim()) return ctx;
  if (!dailyCan('daily_charges.manage')) return ctx;
  try {
    const data = await apiJson(`${DAILY_API}/open-stay`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        file_number: p.file_number.trim(),
        patient_name: p.name.trim(),
        admission_date: getLocalDateString(),
        patient_type: p.patient_type || 'internal',
        phone: p.phone || '',
        nationality: normalizeNationalitySelectValue(p.nationality),
        gender: p.gender || '',
        financial_treatment: '',
      }),
    });
    return data;
  } catch {
    return ctx;
  }
}

function renderDailyEntryTabs() {
  renderDailySectionTiles();
}

function setDailyTodayDate() {
  const today = getLocalDateString();
  const headerDate = document.getElementById('daily-entry-date');
  if (headerDate) headerDate.value = today;
  document.querySelectorAll('.daily-row-date').forEach((input) => {
    if (activeDailyTab === 'stay') {
      if (!input.value) input.value = today;
      return;
    }
    input.value = today;
  });
}

function setDailyWorkflowSteps(_hasStay) {
  /* legacy — workflow is always one screen with tabs */
}

function openDailyInvoiceFromDaily() {
  const invId = dailyStayContext?.invoice?.id;
  if (!invId) {
    showToast('لا توجد فاتورة مفتوحة — سجّل المريض أولًا', 'warning');
    return;
  }
  if (typeof loadInvoiceForEdit === 'function') {
    void loadInvoiceForEdit(invId, { followUp: true });
  }
}

function updateDailyInvoicePanel(ctx) {
  const empty = document.getElementById('daily-invoice-empty');
  const actionsWrap = document.getElementById('daily-invoice-actions');
  const reviewPanel = document.getElementById('daily-invoice-review-panel');
  const pdfBtn = document.getElementById('daily-invoice-pdf-btn');
  const inv = ctx?.invoice;
  updateDailyPatientSummaryTable(ctx);
  if (!inv?.id) {
    if (empty) empty.style.display = '';
    if (actionsWrap) actionsWrap.classList.add('d-none');
    if (reviewPanel) reviewPanel.classList.add('d-none');
    return;
  }
  if (empty) empty.style.display = 'none';
  if (actionsWrap) actionsWrap.classList.remove('d-none');
  if (pdfBtn) {
    const showPdf =
      typeof can === 'function' &&
      (can('invoices.view') || can('invoices.edit') || can('invoices.create')) &&
      inv.status === 'approved';
    pdfBtn.classList.toggle('d-none', !showPdf);
  }
  if (typeof window.updateGlobalInvoicePrintButton === 'function') window.updateGlobalInvoicePrintButton();
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
  const reviewPanel = document.getElementById('daily-invoice-review-panel');
  if (reviewPanel && !reviewPanel.classList.contains('d-none')) {
    renderDailyInvoiceReviewPanel();
  }
}

function patientTypeLabel(type) {
  return String(type || '').toLowerCase() === 'external' ? 'مريض خارجي' : 'مريض داخلي';
}

function applyDailyPatientTypeUI(patientType) {
  const type = String(patientType || 'internal').toLowerCase() === 'external' ? 'external' : 'internal';
  const display = document.getElementById('daily-stay-type-display');
  if (display) display.textContent = patientTypeLabel(type);
  const balanceWrap = document.getElementById('daily-stay-balance-wrap');
  if (balanceWrap) balanceWrap.style.display = type === 'external' ? 'none' : '';
  const internalWrap = document.getElementById('daily-stay-internal-wrap');
  if (internalWrap) internalWrap.style.display = type === 'internal' ? '' : 'none';
  const changeBtn = document.getElementById('daily-change-room-btn');
  if (changeBtn && type === 'external') changeBtn.classList.add('d-none');
  const regInternal = document.getElementById('patient-reg-internal-wrap');
  if (regInternal) regInternal.style.display = patientRegSelectedType === 'internal' ? '' : 'none';
}

function isEntityInvoiceType(type) {
  return type === 'contracted' || type === 'non_contracted';
}

function isMilitaryPatientCase(invoiceType, financialTreatment) {
  if (String(invoiceType || '').toLowerCase() === 'military') return true;
  const ft = String(financialTreatment || '').trim();
  return ft.includes('عسكري');
}

function calcMilitaryAuthDays(from, to) {
  const fromStr = fmtStayDate(from);
  const toStr = fmtStayDate(to);
  if (!fromStr || !toStr) return null;
  const start = new Date(`${fromStr}T00:00:00`);
  const end = new Date(`${toStr}T00:00:00`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
  const days = Math.round((end - start) / 86400000) + 1;
  return days >= 0 ? days : null;
}

function buildMilitaryAuthSummaryText(amount, from, to) {
  const parts = [`مبلغ التصديق: ${dailyFmt(dailyParseAmount(amount))}`];
  const fromStr = fmtStayDate(from);
  const toStr = fmtStayDate(to);
  const days = calcMilitaryAuthDays(from, to);
  if (fromStr && toStr) {
    const duration = days != null ? `${days} يوم` : '—';
    parts.push(`مدة التصديق: من ${fromStr} إلى ${toStr} (${duration})`);
  } else if (fromStr || toStr) {
    parts.push(`مدة التصديق: ${fromStr ? `من ${fromStr}` : ''}${toStr ? ` إلى ${toStr}` : ''}`);
  } else {
    parts.push('مدة التصديق: غير محددة');
  }
  return parts.join(' — ');
}

function updatePatientRegMilitarySummary() {
  const type = document.getElementById('patient-reg-invoice-type')?.value || 'civil';
  const wrap = document.getElementById('patient-reg-military-summary-wrap');
  const el = document.getElementById('patient-reg-military-summary');
  const show = type === 'military';
  if (wrap) wrap.style.display = show ? '' : 'none';
  if (!el || !show) return;
  const amount = document.getElementById('patient-reg-military-amount')?.value;
  const from = document.getElementById('patient-reg-military-from')?.value;
  const to = document.getElementById('patient-reg-military-to')?.value;
  el.textContent = `🪖 ${buildMilitaryAuthSummaryText(amount, from, to)}`;
}

function updateDailyMilitaryAuthBanner(ctx = dailyStayContext) {
  const banner = document.getElementById('daily-military-auth-banner');
  if (!banner) return;
  const inv = ctx?.invoice || {};
  const p = ctx?.patient || {};
  const invoiceType = inv.invoice_type || document.getElementById('daily-stay-invoice-type')?.value;
  const financial = inv.financial_treatment || p.financial_treatment || '';
  if (!isMilitaryPatientCase(invoiceType, financial)) {
    banner.classList.add('d-none');
    banner.textContent = '';
    return;
  }
  const amount =
    p.military_auth_amount ??
    dailyParseAmount(document.getElementById('daily-stay-military-amount')?.value);
  const from =
    p.military_auth_from ||
    inv.letter_from_date ||
    document.getElementById('daily-stay-military-from')?.value;
  const to =
    p.military_auth_to ||
    inv.letter_to_date ||
    document.getElementById('daily-stay-military-to')?.value;
  banner.textContent = `🪖 حالة عسكرية — ${buildMilitaryAuthSummaryText(amount, from, to)}`;
  banner.classList.remove('d-none');
}

function resolveInvoiceTypeFromFinancialTreatment(text) {
  const value = String(text || '').trim();
  if (!value) return 'civil';
  const normalized = value
    .replace(/[أإآ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .toLowerCase();
  if (/جهات?\s*غير\s*متعاقد/.test(normalized)) return 'non_contracted';
  if (/جهات?\s*متعاقد/.test(normalized)) return 'contracted';
  if (/عسكري/.test(normalized)) return 'military';
  if (/مستشف/.test(normalized)) return 'hospital';
  if (/عمليات/.test(normalized)) return 'operations';
  if (/حالة\s*خاص|مجاني/.test(normalized)) return 'special';
  if (/مدني|خاص|تامين/.test(normalized)) return 'civil';
  return 'civil';
}

function getAccommodationGradeOptions() {
  if (dailyStayGradesCache.length) return dailyStayGradesCache;
  return dailyStayTypesCache.map((st) => ({
    stay_type_id: st.id,
    name: st.name,
    daily_rate: Number(st.daily_rate) || 0,
    price_list_name: null,
  }));
}

function getRoomAssignmentGradeOptions() {
  const seen = new Set();
  return getAccommodationGradeOptions().filter((g) => {
    if (!g.stay_type_id) return false;
    if (seen.has(g.stay_type_id)) return false;
    seen.add(g.stay_type_id);
    return true;
  });
}

function stayGradeSelectValue(grade) {
  if (!grade) return '';
  if (grade.catalog_item_id) return `c:${grade.catalog_item_id}`;
  if (grade.service_id) return `s:${grade.service_id}`;
  if (grade.stay_type_id) return String(grade.stay_type_id);
  return '';
}

function findStayGradeFromSelectValue(rawVal) {
  if (!rawVal) return null;
  const val = String(rawVal);
  return (
    dailyStayGradesCache.find((g) => stayGradeSelectValue(g) === val) ||
    dailyStayGradesCache.find((g) => String(g.stay_type_id) === val) ||
    null
  );
}

function resolveStayTypeIdForSave(selectVal, tr = null) {
  const raw = String(
    selectVal ?? tr?.querySelector?.('.daily-row-stay-type')?.value ?? tr?.dataset?.stayTypeId ?? ''
  ).trim();
  if (!raw) return null;
  const grade = findStayGradeFromSelectValue(raw);
  if (grade?.stay_type_id) return Number(grade.stay_type_id);
  if (/^\d+$/.test(raw)) return Number(raw);
  const fromDataset = Number(tr?.dataset?.stayTypeId);
  if (fromDataset > 0) return fromDataset;
  return null;
}

function resolveStayGradeSelectValueFromEntry(entry = {}, accLine = {}) {
  if (accLine.catalog_item_id) return `c:${accLine.catalog_item_id}`;
  if (accLine.service_id) return `s:${accLine.service_id}`;
  const st = entry.stay_type_id || resolveStayTypeIdFromAccommodationLine(accLine) || '';
  return st ? String(st) : '';
}

function formatStayGradeOptionLabel(grade) {
  const rate =
    Number(grade.daily_rate) > 0
      ? ` — ${typeof dailyFmt === 'function' ? dailyFmt(grade.daily_rate) : grade.daily_rate} / يوم`
      : '';
  const source = grade.price_list_name ? ` (${grade.price_list_name})` : '';
  return `${dailyEscapeHtml(grade.name || '')}${rate}${dailyEscapeHtml(source)}`;
}

function getPatientRegEffectiveDiscount(entityId) {
  let current = patientRegEntitiesCache.find((e) => e.id === Number(entityId));
  while (current) {
    const rate = Number(current.discount_percent) || 0;
    if (rate > 0) return rate;
    if (!current.parent_id) break;
    current = patientRegEntitiesCache.find((e) => e.id === current.parent_id);
  }
  return 0;
}

function onPatientRegEntityChange() {
  const entityId = document.getElementById('patient-reg-entity')?.value || '';
  const discountEl = document.getElementById('patient-reg-discount-percent');
  const type = document.getElementById('patient-reg-invoice-type')?.value || 'civil';
  const discount = type === 'contracted' && entityId ? getPatientRegEffectiveDiscount(entityId) : 0;
  if (discountEl) discountEl.value = String(discount);
  const dailyEntity = document.getElementById('daily-stay-entity');
  const regEntity = document.getElementById('patient-reg-entity');
  if (dailyEntity && regEntity) dailyEntity.value = regEntity.value;
}

function togglePatientRegEntityFields() {
  const type = document.getElementById('patient-reg-invoice-type')?.value || 'civil';
  const showEntity = isEntityInvoiceType(type);
  const isContracted = type === 'contracted';
  const isMilitary = type === 'military';
  const entityWrap = document.getElementById('patient-reg-entity-wrap');
  const discountWrap = document.getElementById('patient-reg-discount-wrap');
  const letterWrap = document.getElementById('patient-reg-letter-wrap');
  const letterEnd = document.getElementById('patient-reg-letter-wrap-end');
  const letterDaysWrap = document.getElementById('patient-reg-letter-days-wrap');
  const milFrom = document.getElementById('patient-reg-military-wrap');
  const milTo = document.getElementById('patient-reg-military-wrap-end');
  const milAmount = document.getElementById('patient-reg-military-amount-wrap');
  if (entityWrap) entityWrap.style.display = showEntity ? '' : 'none';
  if (discountWrap) discountWrap.style.display = isContracted ? '' : 'none';
  if (letterWrap) letterWrap.style.display = showEntity ? '' : 'none';
  if (letterEnd) letterEnd.style.display = showEntity ? '' : 'none';
  if (letterDaysWrap) letterDaysWrap.style.display = showEntity ? '' : 'none';
  if (milFrom) milFrom.style.display = isMilitary ? '' : 'none';
  if (milTo) milTo.style.display = isMilitary ? '' : 'none';
  if (milAmount) milAmount.style.display = isMilitary ? '' : 'none';
  if (!showEntity) {
    const entityEl = document.getElementById('patient-reg-entity');
    if (entityEl) entityEl.value = '';
  }
  if (!isContracted) {
    const discountEl = document.getElementById('patient-reg-discount-percent');
    if (discountEl) discountEl.value = '0';
  }
  onPatientRegEntityChange();
  updatePatientRegMilitarySummary();
  updateLetterAuthorizedDaysDisplay();
}

function toggleDailyStayEntityFields() {
  const type = document.getElementById('daily-stay-invoice-type')?.value || 'civil';
  const showEntity = isEntityInvoiceType(type);
  const isMilitary = type === 'military';
  const entityWrap = document.getElementById('daily-stay-entity-wrap');
  const fromWrap = document.getElementById('daily-stay-letter-from-wrap');
  const toWrap = document.getElementById('daily-stay-letter-to-wrap');
  const milFrom = document.getElementById('daily-stay-military-from-wrap');
  const milTo = document.getElementById('daily-stay-military-to-wrap');
  if (entityWrap) entityWrap.style.display = showEntity ? '' : 'none';
  if (fromWrap) fromWrap.style.display = showEntity ? '' : 'none';
  if (toWrap) toWrap.style.display = showEntity ? '' : 'none';
  if (milFrom) milFrom.style.display = isMilitary ? '' : 'none';
  if (milTo) milTo.style.display = isMilitary ? '' : 'none';
}

function normalizeNationalitySelectValue(nationality) {
  const n = String(nationality || '')
    .trim()
    .toLowerCase()
    .replace(/[أإآ]/g, 'ا')
    .replace(/ى/g, 'ي');
  if (!n) return 'مصري';
  const egyptianHints = ['مصر', 'مصري', 'egypt', 'egyptian', 'eg'];
  if (egyptianHints.some((hint) => n.includes(hint))) return 'مصري';
  return 'أجنبي';
}

function setNationalityFieldValue(el, nationality) {
  if (!el) return;
  const value = normalizeNationalitySelectValue(nationality);
  if (el.tagName === 'SELECT') {
    el.value = value;
    if (!el.value) el.value = 'مصري';
  } else {
    el.value = value;
  }
  updateDailyForeignPricingHint();
  if (typeof updatePatientRegNationalityHint === 'function') updatePatientRegNationalityHint();
}

function dailyPatientNationality() {
  if (window.NationalityPricing) return NationalityPricing.getPatientNationality();
  return normalizeNationalitySelectValue(dailyStayContext?.patient?.nationality);
}

function dailyAmountForDisplay(listAmount) {
  const base = Number(listAmount) || 0;
  if (!window.NationalityPricing || base <= 0) return base;
  return NationalityPricing.toDisplayPrice(base, dailyPatientNationality());
}

function dailyAmountForSave(displayAmount) {
  const shown = Number(displayAmount) || 0;
  if (!window.NationalityPricing || shown <= 0) return shown;
  return NationalityPricing.toListPrice(shown, dailyPatientNationality());
}

function updateDailyForeignPricingHint() {
  const hint = document.getElementById('daily-foreign-pricing-hint');
  if (!hint || !window.NationalityPricing) return;
  const foreign = !NationalityPricing.isEgyptianNationality(dailyPatientNationality());
  hint.classList.toggle('d-none', !foreign);
  if (foreign) {
    hint.textContent = `تسعير أجنبي: أسعار اللائحة × ${NationalityPricing.FOREIGN_PRICE_MULTIPLIER}`;
  }
}

function updatePatientRegNationalityHint() {
  const hint = document.getElementById('patient-reg-nationality-hint');
  const val = document.getElementById('patient-reg-nationality')?.value;
  if (!hint) return;
  const foreign = window.NationalityPricing && !NationalityPricing.isEgyptianNationality(val);
  hint.classList.toggle('d-none', !foreign);
}

function collectPatientDemographics(mode = 'register') {
  const isDaily = mode === 'daily';
  const invoice_type = document.getElementById(
    isDaily ? 'daily-stay-invoice-type' : 'patient-reg-invoice-type'
  )?.value || 'civil';
  const payload = {
    age: document.getElementById(isDaily ? 'daily-stay-age' : 'patient-reg-age')?.value?.trim() || null,
    stay_grade_id:
      document.getElementById(isDaily ? 'daily-stay-room' : 'patient-reg-room')?.value || null,
    room_insurance_amount: dailyParseAmount(
      document.getElementById(isDaily ? 'daily-stay-room-insurance' : 'patient-reg-room-insurance')?.value
    ),
    invoice_type,
  };
  if (invoice_type === 'military') {
    payload.military_auth_from = document.getElementById(
      isDaily ? 'daily-stay-military-from' : 'patient-reg-military-from'
    )?.value || null;
    payload.military_auth_to = document.getElementById(
      isDaily ? 'daily-stay-military-to' : 'patient-reg-military-to'
    )?.value || null;
    payload.military_auth_amount = dailyParseAmount(
      document.getElementById(isDaily ? 'daily-stay-military-amount' : 'patient-reg-military-amount')?.value
    );
  }
  if (isDaily) {
    /* نظارات/بصريات — أُزيلت من شاشة المستلزمات */
  }
  return payload;
}

async function loadPatientEntitySelects(selectedId = null) {
  try {
    const entities = await apiJson('/api/settings/contracted-entities/tree');
    patientRegEntitiesCache = entities;
    const current = selectedId || document.getElementById('patient-reg-entity')?.value || '';
    const options =
      '<option value="">-- اختر الجهة --</option>' +
      entities
        .map((e) => {
          const indent = '— '.repeat(e.depth || 0);
          const effective = getPatientRegEffectiveDiscount(e.id);
          const discount = effective ? ` (${effective}%)` : '';
          return `<option value="${e.id}">${indent}${dailyEscapeHtml(e.name)}${discount}</option>`;
        })
        .join('');
    const reg = document.getElementById('patient-reg-entity');
    const daily = document.getElementById('daily-stay-entity');
    if (reg) {
      reg.innerHTML = options;
      if (current) reg.value = String(current);
    }
    if (daily) {
      daily.innerHTML = options;
      if (current) daily.value = String(current);
    }
    onPatientRegEntityChange();
  } catch (err) {
    console.error(err);
  }
}

function populateStayTypeSelects(selectedId = '') {
  const grades = getRoomAssignmentGradeOptions();
  const html =
    '<option value="">-- اختر من اللائحة --</option>' +
    grades
      .map((grade) => {
        const selected = String(selectedId) === String(grade.stay_type_id) ? ' selected' : '';
        return `<option value="${grade.stay_type_id}"${selected}>${formatStayGradeOptionLabel(grade)}</option>`;
      })
      .join('');
  ['patient-reg-room', 'daily-stay-room', 'change-room-stay-type'].forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    const cur = id === 'change-room-stay-type' ? '' : selectedId;
    el.innerHTML = html;
    if (cur) el.value = String(cur);
  });
}

async function loadDailyStayGrades() {
  try {
    dailyStayGradesCache = await apiJson(`${DAILY_API}/stay-grades`);
  } catch (err) {
    console.error(err);
    dailyStayGradesCache = [];
  }
}

function setDailySectionAmount(tr, sectionCode, amount) {
  const n = dailyAmountForDisplay(Number(amount) || 0);
  if (n <= 0) return;
  const input = tr.querySelector(`.daily-amount[data-section="${sectionCode}"]`);
  if (!input || dailyParseAmount(input.value) > 0) return;
  if (typeof setCommaAmountValue === 'function') setCommaAmountValue(input, n);
  else input.value = dailyFormatInput(n);
  input.dataset.manualAmount = '1';
}

function admissionCompanionAmount(assignment, roomInsuranceAmount = 0) {
  const base = Number(assignment?.companion_amount) || 0;
  const ins = Number(roomInsuranceAmount) || 0;
  return ins > 0 ? base + ins : base;
}

function syncRoomInsuranceOnAdmissionStayDom() {
  if (!canUseDailyStayCharges()) return;
  const admission = fmtStayDate(dailyStayContext?.invoice?.admission_date);
  if (!admission) return;
  const roomIns = Number(dailyStayContext?.patient?.room_insurance_amount) || 0;
  const assignment = dailyStayContext?.room_assignment;
  document.querySelectorAll('#daily-sections-body .daily-stay-row').forEach((tr) => {
    const rowDate = fmtStayDate(tr.querySelector('.daily-row-date')?.value);
    if (rowDate !== admission) return;
    if (assignment) {
      setDailySectionAmount(tr, 'companion', admissionCompanionAmount(assignment, roomIns));
    } else if (roomIns > 0) {
      const companionEl = tr.querySelector('.daily-amount[data-section="companion"]');
      const current = dailyParseAmount(companionEl?.value) || 0;
      const base = current >= roomIns ? current - roomIns : current;
      setDailySectionAmount(tr, 'companion', base + roomIns);
    }
    updateStayRowGroupTotal(tr);
  });
  refreshDailyStayLiveTotals();
}

async function applyRoomAssignmentToRow(tr, assignment) {
  if (!assignment || !tr) return;
  const staySel = tr.querySelector('.daily-row-stay-type');
  if (staySel && assignment.stay_type_id) {
    staySel.value = String(assignment.stay_type_id);
    await applyStayTypeRateToRow(tr);
    updateStayAccUnitPriceDisplay(tr);
  }
  const admission = fmtStayDate(dailyStayContext?.invoice?.admission_date);
  const rowDate = tr.querySelector('.daily-row-date')?.value;
  const roomIns = Number(dailyStayContext?.patient?.room_insurance_amount) || 0;
  const companionAmt =
    admission && rowDate === admission
      ? admissionCompanionAmount(assignment, roomIns)
      : Number(assignment.companion_amount) || 0;
  setDailySectionAmount(tr, 'companion', companionAmt);
  setDailySectionAmount(tr, 'nursing_point', assignment.nursing_point_amount);
  setDailySectionAmount(tr, 'patient_assistant', assignment.patient_assistant_amount);
  updateRowTotal(tr);
  updateDailyGrandTotal();
}

async function applyAutoRoomToTodayRows() {
  if (!canUseDailyStayCharges()) return;
  if (activeDailyTab !== 'stay') return;
  const assignment = dailyStayContext?.room_assignment;
  if (!assignment?.stay_type_id) return;
  const rows = document.querySelectorAll('#daily-sections-body .daily-stay-row');
  for (const tr of rows) {
    const rowDate = fmtStayDate(tr.querySelector('.daily-row-date')?.value);
    const today = getLocalDateString();
    if (rowDate && rowDate !== today) continue;
    if (isDailyStayDateSuppressed(rowDate)) continue;
    await applyRoomAssignmentToRow(tr, assignment);
  }
}

function fillInternalStayFormFromContext(ctx) {
  const assignment = ctx?.room_assignment;
  const inv = ctx?.invoice;
  const patient = ctx?.patient;
  if (patient?.floor) {
    const floorEl = document.getElementById('daily-stay-floor');
    if (floorEl) floorEl.value = patient.floor;
  }
  if (assignment) {
    populateStayTypeSelects(assignment.stay_type_id);
    const floorEl = document.getElementById('daily-stay-floor');
    if (floorEl && assignment.floor) floorEl.value = assignment.floor;
    const companionEl = document.getElementById('daily-stay-companion');
    const nursingEl = document.getElementById('daily-stay-nursing');
    const assistantEl = document.getElementById('daily-stay-assistant');
    if (companionEl && typeof setCommaAmountValue === 'function') {
      setCommaAmountValue(companionEl, assignment.companion_amount);
    }
    if (nursingEl && typeof setCommaAmountValue === 'function') {
      setCommaAmountValue(nursingEl, assignment.nursing_point_amount);
    }
    if (assistantEl && typeof setCommaAmountValue === 'function') {
      setCommaAmountValue(assistantEl, assignment.patient_assistant_amount);
    }
  }
  if (inv) {
    const typeEl = document.getElementById('daily-stay-invoice-type');
    if (typeEl) {
      typeEl.value =
        inv.invoice_type || resolveInvoiceTypeFromFinancialTreatment(inv.financial_treatment);
    }
    const regTypeEl = document.getElementById('patient-reg-invoice-type');
    if (regTypeEl && typeEl) regTypeEl.value = typeEl.value;
    toggleDailyStayEntityFields();
    togglePatientRegEntityFields();
    if (inv.contracted_entity_id) {
      void loadPatientEntitySelects(inv.contracted_entity_id);
    }
    const fromEl = document.getElementById('daily-stay-letter-from');
    const toEl = document.getElementById('daily-stay-letter-to');
    if (fromEl) fromEl.value = fmtStayDate(inv.letter_from_date) || '';
    if (toEl) toEl.value = fmtStayDate(inv.letter_to_date) || '';
    const regFrom = document.getElementById('patient-reg-letter-from');
    const regTo = document.getElementById('patient-reg-letter-to');
    if (regFrom) regFrom.value = fmtStayDate(inv.letter_from_date) || '';
    if (regTo) regTo.value = fmtStayDate(inv.letter_to_date) || '';
    updateLetterAuthorizedDaysDisplay();
  }
}

// Invoice-type / contracted-entity / جواب letter-date fields apply to BOTH internal and
// external patients (an external patient can belong to a contracted entity too) — only
// the room/companion/nursing/assistant stay fields are actually internal-only. Despite the
// name, this function collects both; it no longer bails out early for external patients.
function collectInternalStayPayload(patientType) {
  const invoice_type =
    document.getElementById('patient-reg-invoice-type')?.value ||
    document.getElementById('daily-stay-invoice-type')?.value ||
    'civil';
  const payload = { invoice_type };

  if (patientType === 'internal') {
    const stay_type_id = document.getElementById('patient-reg-room')?.value ||
      document.getElementById('daily-stay-room')?.value || '';
    payload.stay_type_id = stay_type_id || null;
    payload.floor = document.getElementById('patient-reg-floor')?.value.trim() ||
      document.getElementById('daily-stay-floor')?.value.trim() || '';
    payload.companion_amount = dailyParseAmount(
      document.getElementById('patient-reg-companion')?.value ||
        document.getElementById('daily-stay-companion')?.value
    );
    payload.nursing_point_amount = dailyParseAmount(
      document.getElementById('patient-reg-nursing')?.value ||
        document.getElementById('daily-stay-nursing')?.value
    );
    payload.patient_assistant_amount = dailyParseAmount(
      document.getElementById('patient-reg-assistant')?.value ||
        document.getElementById('daily-stay-assistant')?.value
    );
  }

  if (isEntityInvoiceType(invoice_type)) {
    payload.contracted_entity_id =
      document.getElementById('patient-reg-entity')?.value ||
      document.getElementById('daily-stay-entity')?.value ||
      null;
    payload.letter_from_date =
      document.getElementById('patient-reg-letter-from')?.value ||
      document.getElementById('daily-stay-letter-from')?.value ||
      null;
    payload.letter_to_date =
      document.getElementById('patient-reg-letter-to')?.value ||
      document.getElementById('daily-stay-letter-to')?.value ||
      null;
    if (invoice_type === 'contracted') {
      payload.discount_percent =
        Number(document.getElementById('patient-reg-discount-percent')?.value) || 0;
    }
  }
  return payload;
}

let changeRoomModal = null;
let batchStayModal = null;

function openChangeRoomModal() {
  const assignment = dailyStayContext?.room_assignment;
  populateStayTypeSelects(assignment?.stay_type_id || '');
  const floorEl = document.getElementById('change-room-floor');
  const fromEl = document.getElementById('change-room-from');
  const companionEl = document.getElementById('change-room-companion');
  const nursingEl = document.getElementById('change-room-nursing');
  const assistantEl = document.getElementById('change-room-assistant');
  if (floorEl) floorEl.value = assignment?.floor || dailyStayContext?.patient?.floor || '';
  const minFrom =
    fmtStayDate(assignment?.effective_from) ||
    fmtStayDate(dailyStayContext?.invoice?.admission_date) ||
    '';
  if (fromEl) {
    fromEl.min = minFrom || '';
    fromEl.value = getLocalDateString();
    if (minFrom && fromEl.value < minFrom) fromEl.value = minFrom;
  }
  if (companionEl && typeof setCommaAmountValue === 'function') {
    setCommaAmountValue(companionEl, assignment?.companion_amount || 0);
  }
  if (nursingEl && typeof setCommaAmountValue === 'function') {
    setCommaAmountValue(nursingEl, assignment?.nursing_point_amount || 0);
  }
  if (assistantEl && typeof setCommaAmountValue === 'function') {
    setCommaAmountValue(assistantEl, assignment?.patient_assistant_amount || 0);
  }
  if (typeof bindCommaAmountInputs === 'function') {
    bindCommaAmountInputs(document.getElementById('change-room-modal'));
  }
  const modalEl = document.getElementById('change-room-modal');
  if (!modalEl) return;
  if (!changeRoomModal) changeRoomModal = new bootstrap.Modal(modalEl);
  changeRoomModal.show();
}

async function submitChangeRoom() {
  const file_number = getStayFileNumber();
  if (!file_number) {
    showToast('رقم الملف مطلوب', 'warning');
    return;
  }
  const stay_type_id = document.getElementById('change-room-stay-type')?.value;
  const effective_from = document.getElementById('change-room-from')?.value;
  if (!stay_type_id || !effective_from) {
    showToast('اختر الغرفة وتاريخ البداية', 'warning');
    return;
  }
  try {
    const data = await apiJson(`${DAILY_API}/change-room`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        file_number,
        stay_type_id,
        floor: document.getElementById('change-room-floor')?.value.trim() || '',
        companion_amount: dailyParseAmount(document.getElementById('change-room-companion')?.value),
        nursing_point_amount: dailyParseAmount(document.getElementById('change-room-nursing')?.value),
        patient_assistant_amount: dailyParseAmount(document.getElementById('change-room-assistant')?.value),
        effective_from,
        backfill_stay: false,
      }),
    });
    dailyStayContext = data;
    applyDailyStayContext(data);
    if (changeRoomModal) changeRoomModal.hide();
    showToast('تم تغيير الغرفة', 'success');
    await loadDailyEntriesIntoSheet();
    await applyAutoRoomToTodayRows();
    if (data.backfill?.invoice_sync?.synced) {
      await refreshInvoiceFormAfterDailySave();
    }
  } catch (err) {
    showToast(sanitizeApiErrorMessage(err.message), 'danger');
  }
}

function openBatchStayModal() {
  const inv = dailyStayContext?.invoice;
  if (!inv?.id) {
    showToast('لا توجد فاتورة مفتوحة', 'warning');
    return;
  }
  const fromEl = document.getElementById('batch-stay-from');
  const toEl = document.getElementById('batch-stay-to');
  const admission = fmtStayDate(inv.admission_date);
  const letterFrom = fmtStayDate(inv.letter_from_date);
  const letterTo = fmtStayDate(inv.letter_to_date);
  const today = getLocalDateString();
  const yesterday = addLocalDays(today, -1);
  // Default the range to the جواب (authorization letter) window when present, so the whole
  // authorized period is posted by default instead of staff having to widen/narrow it by hand.
  let fromDefault = admission || today;
  if (letterFrom && (!admission || letterFrom > admission)) fromDefault = letterFrom;
  if (fromEl) fromEl.value = fromDefault;
  if (toEl) {
    const discharge = fmtStayDate(inv.discharge_date);
    let toDefault = discharge && discharge < today ? discharge : yesterday;
    if (letterTo && toDefault > letterTo) toDefault = letterTo;
    toEl.value = toDefault;
  }
  const modalEl = document.getElementById('batch-stay-modal');
  if (!modalEl) return;
  if (!batchStayModal) batchStayModal = new bootstrap.Modal(modalEl);
  batchStayModal.show();
}

function addLocalDays(dateStr, delta) {
  const d = new Date(`${dateStr}T12:00:00`);
  d.setDate(d.getDate() + delta);
  return d.toISOString().slice(0, 10);
}

async function submitBatchStayPost() {
  const file_number = getStayFileNumber();
  if (!file_number) {
    showToast('رقم الملف مطلوب', 'warning');
    return;
  }
  const from_date = document.getElementById('batch-stay-from')?.value;
  const to_date = document.getElementById('batch-stay-to')?.value;
  const include_today = document.getElementById('batch-stay-include-today')?.checked === true;
  if (!from_date) {
    showToast('اختر تاريخ البداية', 'warning');
    return;
  }
  const submitBtn = document.getElementById('batch-stay-submit-btn');
  if (submitBtn) submitBtn.disabled = true;
  try {
    const data = await apiJson(`${DAILY_API}/stay/batch-post`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        file_number,
        from_date,
        to_date: to_date || null,
        skip_existing: true,
        include_today,
      }),
    });
    if (batchStayModal) batchStayModal.hide();
    const posted = data.posted || 0;
    const skipped = (data.skipped_dates || []).length;
    if (posted === 0) {
      showToast(`لا توجد أيام جديدة للترحيل (تُخطّى ${skipped} يوم مسجّل)`, 'info');
    } else {
      showToast(`تم ترحيل ${posted} يوم إقامة على الفاتورة (تُخطّى ${skipped})`, 'success');
    }
    await loadDailyEntriesIntoSheet();
    await applyAutoRoomToTodayRows();
    if (data.invoice_sync?.synced) {
      await refreshInvoiceFormAfterDailySave();
    }
  } catch (err) {
    showToast(sanitizeApiErrorMessage(err.message), 'danger');
  } finally {
    if (submitBtn) submitBtn.disabled = false;
  }
}

function clearDailyStayFormFields() {
  const ids = [
    'daily-stay-file-number',
    'daily-stay-patient-name',
    'daily-stay-phone',
    'daily-stay-nationality',
    'daily-stay-admission',
    'daily-stay-discharge',
    'daily-stay-balance',
  ];
  ids.forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.value = '';
    el.setAttribute('autocomplete', 'off');
  });
  const genderEl = document.getElementById('daily-stay-gender');
  if (genderEl) genderEl.value = '';
  const financialEl = document.getElementById('daily-stay-financial');
  if (financialEl) financialEl.value = '';
  const typeDisplay = document.getElementById('daily-stay-type-display');
  if (typeDisplay) typeDisplay.textContent = '—';
  applyDailyPatientTypeUI('internal');
}

function bustFieldAutocomplete(root) {
  if (!root) return;
  root.querySelectorAll('input, select, textarea').forEach((el) => {
    el.setAttribute('autocomplete', 'off');
    if (el.tagName === 'INPUT' && el.type !== 'hidden') {
      el.setAttribute('name', `nf-${el.id || 'field'}-${Date.now()}`);
    }
  });
}

let patientRegSelectedType = null;
let patientRegEditMode = false;
let patientRegEditFileNumber = '';
let patientRegInvoiceId = null;
let patientRegEntitiesCache = [];

window.getDailyInvoiceId = () => dailyStayContext?.invoice?.id || null;
window.getPatientRegInvoiceId = () => patientRegInvoiceId || null;

function showPatientRegisterTypePicker() {
  patientRegEditMode = false;
  patientRegEditFileNumber = '';
  patientRegInvoiceId = null;
  if (typeof window.updateGlobalInvoicePrintButton === 'function') window.updateGlobalInvoicePrintButton();
  const fileInput = document.getElementById('patient-reg-file-number');
  if (fileInput) fileInput.readOnly = true;
  const saveBtn = document.getElementById('patient-reg-save-btn');
  if (saveBtn) saveBtn.textContent = '💾 حفظ تسجيل المريض';
  document.getElementById('patient-register-change-type')?.classList.remove('d-none');
  patientRegSelectedType = null;
  const picker = document.getElementById('patient-register-type-picker');
  const panel = document.getElementById('patient-register-form-panel');
  if (picker) picker.classList.remove('d-none');
  if (panel) panel.classList.add('d-none');
}

function showPatientRegisterForm(patientType, options = {}) {
  const type = String(patientType || '').toLowerCase() === 'external' ? 'external' : 'internal';
  const isEdit = options.edit === true;
  patientRegSelectedType = type;
  if (isEdit) patientRegEditMode = true;
  const picker = document.getElementById('patient-register-type-picker');
  const panel = document.getElementById('patient-register-form-panel');
  const typeInput = document.getElementById('patient-reg-type');
  const badge = document.getElementById('patient-register-type-badge');
  const balanceWrap = document.getElementById('patient-reg-balance-wrap');
  if (picker) picker.classList.add('d-none');
  if (panel) panel.classList.remove('d-none');
  if (typeInput) typeInput.value = type;
  if (badge) badge.textContent = isEdit ? `${patientTypeLabel(type)} — تعديل` : patientTypeLabel(type);
  if (balanceWrap) balanceWrap.style.display = type === 'external' ? 'none' : '';
  const regInternal = document.getElementById('patient-reg-internal-wrap');
  if (regInternal) regInternal.style.display = type === 'internal' ? '' : 'none';
  updatePatientRegNationalityHint();
  const saveBtn = document.getElementById('patient-reg-save-btn');
  if (saveBtn) saveBtn.textContent = isEdit ? '💾 حفظ التعديلات' : '💾 حفظ تسجيل المريض';
  document.getElementById('patient-register-change-type')?.classList.toggle('d-none', isEdit);
  if (!isEdit) {
    clearPatientRegisterForm({ keepType: true });
    const fileInput = document.getElementById('patient-reg-file-number');
    if (fileInput) {
      fileInput.readOnly = true;
      fileInput.value = '';
      fileInput.placeholder = 'جاري تخصيص رقم الملف...';
    }
    void suggestPatientRegisterFileNumber(type);
    document.getElementById('patient-reg-name')?.focus();
  }
  void loadDailyStayTypes().then(async () => {
    await loadDailyStayGrades();
    populateStayTypeSelects();
  });
  togglePatientRegEntityFields();
  void loadPatientEntitySelects();
  if (typeof bindCommaAmountInputs === 'function') {
    bindCommaAmountInputs(document.getElementById('patient-register-form-panel'));
  }
  const fileInput = document.getElementById('patient-reg-file-number');
  if (fileInput) {
    fileInput.readOnly = true;
  }
}

async function fillPatientRegisterFormFromContext(ctx) {
  const p = ctx?.patient || {};
  const inv = ctx?.invoice || {};
  patientRegInvoiceId = inv.id || null;
  if (typeof window.updateGlobalInvoicePrintButton === 'function') window.updateGlobalInvoicePrintButton();
  const assignment = ctx?.room_assignment;
  const fileInput = document.getElementById('patient-reg-file-number');
  if (fileInput) {
    fileInput.value = p.file_number || '';
    fileInput.readOnly = true;
  }
  patientRegEditFileNumber = p.file_number || '';
  document.getElementById('patient-reg-name').value = p.name || inv.patient_name || '';
  document.getElementById('patient-reg-phone').value = p.phone || '';
  document.getElementById('patient-reg-other-phone').value = p.other_phone || '';
  setNationalityFieldValue(document.getElementById('patient-reg-nationality'), p.nationality);
  const genderEl = document.getElementById('patient-reg-gender');
  if (genderEl) genderEl.value = p.gender || '';
  const ageEl = document.getElementById('patient-reg-age');
  if (ageEl && p.age != null) ageEl.value = String(p.age);
  const admissionEl = document.getElementById('patient-reg-admission');
  if (admissionEl) admissionEl.value = fmtStayDate(inv.admission_date) || '';
  const balanceEl = document.getElementById('patient-reg-balance');
  if (balanceEl && typeof setCommaAmountValue === 'function') {
    setCommaAmountValue(balanceEl, p.account_balance || 0);
  }
  const roomInsEl = document.getElementById('patient-reg-room-insurance');
  if (roomInsEl && typeof setCommaAmountValue === 'function') {
    setCommaAmountValue(roomInsEl, p.room_insurance_amount || 0);
  }
  const roomStayId = assignment?.stay_type_id || p.stay_grade_id || null;
  if (roomStayId) {
    populateStayTypeSelects(roomStayId);
    const roomEl = document.getElementById('patient-reg-room');
    if (roomEl) roomEl.value = String(roomStayId);
  }
  const floorEl = document.getElementById('patient-reg-floor');
  if (floorEl) floorEl.value = assignment?.floor || p.floor || '';
  const companionEl = document.getElementById('patient-reg-companion');
  const nursingEl = document.getElementById('patient-reg-nursing');
  const assistantEl = document.getElementById('patient-reg-assistant');
  if (companionEl && typeof setCommaAmountValue === 'function') {
    setCommaAmountValue(companionEl, assignment?.companion_amount || 0);
  }
  if (nursingEl && typeof setCommaAmountValue === 'function') {
    setCommaAmountValue(nursingEl, assignment?.nursing_point_amount || 0);
  }
  if (assistantEl && typeof setCommaAmountValue === 'function') {
    setCommaAmountValue(assistantEl, assignment?.patient_assistant_amount || 0);
  }
  const invoiceTypeEl = document.getElementById('patient-reg-invoice-type');
  if (invoiceTypeEl) {
    invoiceTypeEl.value =
      inv.invoice_type || resolveInvoiceTypeFromFinancialTreatment(inv.financial_treatment || p.financial_treatment);
  }
  togglePatientRegEntityFields();
  await loadPatientEntitySelects(inv.contracted_entity_id || null);
  const regDiscountEl = document.getElementById('patient-reg-discount-percent');
  if (regDiscountEl && inv.invoice_type === 'contracted') {
    regDiscountEl.value = String(
      inv.discount_percent ?? getPatientRegEffectiveDiscount(inv.contracted_entity_id) ?? 0
    );
  }
  const letterFrom = document.getElementById('patient-reg-letter-from');
  const letterTo = document.getElementById('patient-reg-letter-to');
  if (letterFrom) letterFrom.value = fmtStayDate(inv.letter_from_date) || '';
  if (letterTo) letterTo.value = fmtStayDate(inv.letter_to_date) || '';
  updateLetterAuthorizedDaysDisplay();
}

async function openPatientEditFromDaily() {
  const ctx = dailyStayContext;
  if (!ctx?.patient?.file_number) {
    showToast('اختر مريضًا أولًا', 'warning');
    return;
  }
  patientRegEditMode = true;
  patientRegEditFileNumber = ctx.patient.file_number;
  const type = ctx.patient.patient_type || 'internal';
  if (typeof switchView === 'function') switchView('patient-register', { skipPatientRegInit: true });
  showPatientRegisterForm(type, { edit: true });
  await fillPatientRegisterFormFromContext(ctx);
}

async function suggestPatientRegisterFileNumber(patientType) {
  const fileInput = document.getElementById('patient-reg-file-number');
  if (!fileInput || patientRegEditMode) return null;
  try {
    const data = await apiJson(
      `/api/patients/next-file-number?patient_type=${encodeURIComponent(patientType || 'internal')}`
    );
    if (data?.file_number) {
      fileInput.value = data.file_number;
      await checkPatientRegisterFileDuplicate();
      return data.file_number;
    }
  } catch (err) {
    showToast(sanitizeApiErrorMessage(err.message) || 'تعذّر توليد رقم ملف تلقائي', 'warning');
  }
  return fileInput.value.trim() || null;
}

async function resolvePatientRegisterFileNumber(patient_type) {
  if (patientRegEditMode) {
    const file_number = document.getElementById('patient-reg-file-number')?.value.trim() || '';
    if (!file_number) throw new Error('رقم الملف مطلوب');
    return file_number;
  }
  // New patient: server allocates the next sequential file number atomically for all users.
  return '';
}

async function checkPatientRegisterFileDuplicate() {
  const fileInput = document.getElementById('patient-reg-file-number');
  const warn = document.getElementById('patient-reg-file-duplicate');
  if (!fileInput || !warn) return;
  const file_number = fileInput.value.trim();
  if (!file_number) {
    warn.classList.add('d-none');
    warn.textContent = '';
    return;
  }
  try {
    const data = await apiJson(
      `/api/patients/check-file-number?file_number=${encodeURIComponent(file_number)}`
    );
    if (!data.available) {
      const who = data.existing?.name ? ` — مسجّل للمريض: ${data.existing.name}` : '';
      warn.textContent = `تحذير: رقم الملف مكرر${who}`;
      warn.classList.remove('d-none');
    } else {
      warn.classList.add('d-none');
      warn.textContent = '';
    }
  } catch {
    warn.classList.add('d-none');
  }
}

function clearPatientRegisterForm(options = {}) {
  const keepType = options.keepType && patientRegSelectedType;
  const ids = [
    'patient-reg-file-number',
    'patient-reg-name',
    'patient-reg-phone',
    'patient-reg-other-phone',
    'patient-reg-nationality',
    'patient-reg-admission',
    'patient-reg-balance',
    'patient-reg-age',
    'patient-reg-room-insurance',
    'patient-reg-military-from',
    'patient-reg-military-to',
    'patient-reg-military-amount',
  ];
  ids.forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    if (id === 'patient-reg-nationality') {
      el.value = 'مصري';
    } else {
      el.value = '';
    }
  });
  const genderEl = document.getElementById('patient-reg-gender');
  if (genderEl) genderEl.value = '';
  const invoiceTypeEl = document.getElementById('patient-reg-invoice-type');
  if (invoiceTypeEl) invoiceTypeEl.value = 'civil';
  if (!keepType) {
    patientRegSelectedType = null;
    const typeInput = document.getElementById('patient-reg-type');
    if (typeInput) typeInput.value = 'internal';
  }
  bustFieldAutocomplete(document.getElementById('patient-register-form'));
  togglePatientRegEntityFields();
  updatePatientRegMilitarySummary();
  updateLetterAuthorizedDaysDisplay();
  if (!options.keepInvoiceId) {
    patientRegInvoiceId = null;
    if (typeof window.updateGlobalInvoicePrintButton === 'function') window.updateGlobalInvoicePrintButton();
  }
}

async function savePatientRegistration(event) {
  if (event) event.preventDefault();
  if (!dailyCan('daily_charges.manage')) {
    showToast('ليس لديك صلاحية تسجيل المريض', 'warning');
    return;
  }
  const patient_type = document.getElementById('patient-reg-type')?.value || patientRegSelectedType || 'internal';
  let file_number = '';
  const patient_name = document.getElementById('patient-reg-name')?.value.trim() || '';
  const phone = document.getElementById('patient-reg-phone')?.value.trim() || '';
  const other_phone = document.getElementById('patient-reg-other-phone')?.value.trim() || '';
  const nationality = normalizeNationalitySelectValue(
    document.getElementById('patient-reg-nationality')?.value
  );
  const gender = document.getElementById('patient-reg-gender')?.value || '';
  const admission_date = document.getElementById('patient-reg-admission')?.value || '';
  const invoice_type = document.getElementById('patient-reg-invoice-type')?.value || 'civil';
  const financial_treatment = getDailyInvoiceTypeLabel(invoice_type);
  const balanceRaw = document.getElementById('patient-reg-balance')?.value;
  if (!patient_name || !admission_date) {
    showToast('اسم المريض وتاريخ الدخول مطلوبان', 'warning');
    return;
  }

  try {
    file_number = await resolvePatientRegisterFileNumber(patient_type);
  } catch (err) {
    showToast(sanitizeApiErrorMessage(err.message), 'danger');
    return;
  }

  const payload = {
    file_number,
    patient_name,
    phone,
    other_phone,
    nationality,
    gender,
    admission_date,
    discharge_date: null,
    financial_treatment,
    patient_type,
    ...collectPatientDemographics('register'),
    ...collectInternalStayPayload(patient_type),
  };
  if (patient_type !== 'external') {
    payload.account_balance = dailyParseAmount(balanceRaw);
    if (!patientRegEditMode && !document.getElementById('patient-reg-room')?.value) {
      showToast('اختر الغرفة / الجناح (درجة الإقامة) من اللائحة', 'warning');
      return;
    }
    if (patientRegEditMode && !payload.stay_type_id && dailyStayContext?.room_assignment?.stay_type_id) {
      payload.stay_type_id = dailyStayContext.room_assignment.stay_type_id;
    }
  }
  if (isEntityInvoiceType(payload.invoice_type) && !payload.contracted_entity_id) {
    showToast('اختر الجهة', 'warning');
    return;
  }

  try {
    const data = await apiJson(`${DAILY_API}/open-stay`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    sessionStorage.setItem('dailyStayFileNumber', file_number);
    applyDailyStayContext(data);
    const assignedFile = data?.patient?.file_number || file_number;
    const label = data.created ? 'تم تسجيل المريض وإنشاء فاتورة مسودة' : 'تم تحديث بيانات المريض';
    showToast(`${label} — ملف ${assignedFile} — ابدأ بإدخال البنود`, 'success');
    if (data?.invoice?.id) {
      await refreshInvoiceFormAfterDailySave(file_number, data.invoice.id);
    }
    patientRegEditMode = false;
    patientRegEditFileNumber = '';
    const fileInput = document.getElementById('patient-reg-file-number');
    if (fileInput) fileInput.readOnly = false;
    clearPatientRegisterForm();
    if (typeof switchView === 'function') {
      switchView('daily', { openFileNumber: file_number });
    } else {
      showPatientRegisterTypePicker();
    }
  } catch (err) {
    showToast(sanitizeApiErrorMessage(err.message), 'danger');
  }
}

let patientRegListenersBound = false;

function initPatientRegistration(options = {}) {
  if (options.editMode) return;
  showPatientRegisterTypePicker();
  clearPatientRegisterForm();
  if (!patientRegListenersBound) {
    patientRegListenersBound = true;
    document.getElementById('patient-reg-file-number')?.addEventListener('blur', () => {
      void checkPatientRegisterFileDuplicate();
    });
    document.getElementById('patient-reg-nationality')?.addEventListener('change', updatePatientRegNationalityHint);
  }
  updatePatientRegNationalityHint();
  void loadDailyStayTypes().then(async () => {
    await loadDailyStayGrades();
    populateStayTypeSelects();
  });
  void loadPatientEntitySelects();
  if (typeof loadFinancialTreatments === 'function') loadFinancialTreatments();
}

function applyStayExcludedDatesFromContext(ctx) {
  const fileNumber = ctx?.patient?.file_number || ctx?.invoice?.file_number || getStayFileNumber();
  resetDailyStaySuppression(fileNumber);
  for (const date of ctx?.stay_excluded_dates || []) {
    suppressDailyStayDate(date);
  }
}

function applyDailyStayContext(ctx) {
  dailyStayContext = ctx;
  applyStayExcludedDatesFromContext(ctx);
  const hasOpenInvoice = Boolean(ctx?.invoice?.id);
  setDailyWorkflowSteps(hasOpenInvoice);

  if (ctx?.patient) {
    document.getElementById('daily-stay-file-number').value = ctx.patient.file_number || '';
    document.getElementById('daily-stay-patient-name').value = ctx.patient.name || ctx.invoice?.patient_name || '';
    const phoneEl = document.getElementById('daily-stay-phone');
    if (phoneEl) phoneEl.value = ctx.patient.phone || '';
    const regPhone = document.getElementById('patient-reg-phone');
    if (regPhone && ctx.patient.phone) regPhone.value = ctx.patient.phone;
    const regOtherPhone = document.getElementById('patient-reg-other-phone');
    if (regOtherPhone && ctx.patient.other_phone) regOtherPhone.value = ctx.patient.other_phone;
    const nationalityEl = document.getElementById('daily-stay-nationality');
    setNationalityFieldValue(nationalityEl, ctx.patient.nationality);
    const genderEl = document.getElementById('daily-stay-gender');
    if (genderEl) genderEl.value = ctx.patient.gender || '';
    const ageEl = document.getElementById('daily-stay-age');
    if (ageEl && ctx.patient.age != null) ageEl.value = String(ctx.patient.age);
    const roomIns = document.getElementById('daily-stay-room-insurance');
    if (roomIns && typeof setCommaAmountValue === 'function') {
      setCommaAmountValue(roomIns, ctx.patient.room_insurance_amount || 0);
    }
    const milFrom = document.getElementById('daily-stay-military-from');
    const milTo = document.getElementById('daily-stay-military-to');
    const milAmount = document.getElementById('daily-stay-military-amount');
    if (milFrom) milFrom.value = fmtStayDate(ctx.patient.military_auth_from) || '';
    if (milTo) milTo.value = fmtStayDate(ctx.patient.military_auth_to) || '';
    if (milAmount) milAmount.value = String(ctx.patient.military_auth_amount ?? '');
    applyDailyPatientTypeUI(ctx.patient.patient_type || 'internal');
    if (ctx.patient.account_balance != null) {
      const balanceEl = document.getElementById('daily-stay-balance');
      if (balanceEl) {
        if (typeof setCommaAmountValue === 'function') {
          setCommaAmountValue(balanceEl, ctx.patient.account_balance);
        } else {
          balanceEl.value = dailyFormatInput(ctx.patient.account_balance);
        }
      }
    }
  } else {
    applyDailyPatientTypeUI('internal');
  }
  if (ctx?.patient) {
    // fillInternalStayFormFromContext also pre-fills invoice_type/contracted_entity/جواب
    // letter dates, which apply to external patients too — it already no-ops the
    // room-assignment-only fields when ctx.room_assignment is absent (external patients).
    fillInternalStayFormFromContext(ctx);
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
    statusEl.textContent = hasOpenInvoice ? 'جاهز للتسجيل' : 'لا توجد فاتورة مفتوحة';
  }

  updateDailyInvoicePanel(ctx);
  updateDailyPatientHeader(ctx);
  renderDailySectionTabs();
  if (!canUseDailyStayCharges(ctx) && activeDailyTab === 'stay') {
    showDailySection(defaultDailyTabForPatient(ctx));
  }
  updateDailyMilitaryAuthBanner(ctx);
  updateDailyClinicalContextBar();
  const reviewPanel = document.getElementById('daily-invoice-review-panel');
  if (reviewPanel) reviewPanel.classList.add('d-none');
  if (ctx?.patient?.file_number && ctx?.patient?.name) {
    const workspaceOpen = !document.getElementById('daily-patient-workspace')?.classList.contains('d-none');
    showDailyPatientWorkspace(ctx, { preserveTab: workspaceOpen });
  } else {
    showDailyPatientPicker();
  }
  if (typeof bindCommaAmountInputs === 'function') {
    bindCommaAmountInputs(document.getElementById('view-daily'));
  }
  if (hasOpenInvoice) {
    sessionStorage.setItem('dailyStayFileNumber', getStayFileNumber());
  }
}

async function refreshDailyStaySummary(fileNumber) {
  const fn = (fileNumber || getStayFileNumber()).trim();
  if (!fn) return null;
  try {
    let data = await apiJson(`${DAILY_API}/open-stay?file_number=${encodeURIComponent(fn)}`);
    if (Number(data?.patient?.room_insurance_amount) > 0 && dailyCan('daily_charges.manage')) {
      try {
        data = await apiJson(`${DAILY_API}/sync-room-insurance`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ file_number: fn }),
        });
      } catch {
        /* keep open-stay payload */
      }
    }
    dailyStayContext = data;
    updateDailyPatientHeader(data);
    updateDailyPatientSummaryTable(data);
    updateDailyInvoicePanel(data);
    updateDailyMilitaryAuthBanner(data);
    updateDailyClinicalContextBar();
    return data;
  } catch {
    return null;
  }
}

async function ensurePatientDataReconciled(fileNumber) {
  if (!dailyCan('daily_charges.manage')) return;
  const fn = String(fileNumber || '').trim();
  if (!fn) return;
  try {
    await apiJson(`${DAILY_API}/reconcile-patient`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        file_number: fn,
        skip_existing: true,
        include_today: true,
        post_stay: canUseDailyStayCharges(dailyStayContext),
      }),
    });
  } catch {
    /* optional reconcile */
  }
}

const DAILY_BULK_RECONCILE_KEY = 'dailyBulkReconcile_v1';

async function reconcileAllRegisteredPatientsOnce() {
  if (!dailyCan('daily_charges.manage')) return;
  if (sessionStorage.getItem(DAILY_BULK_RECONCILE_KEY)) return;
  sessionStorage.setItem(DAILY_BULK_RECONCILE_KEY, '1');
  try {
    const data = await apiJson(`${DAILY_API}/reconcile-all`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ skip_existing: true, include_today: false }),
    });
    const total = Number(data?.total) || 0;
    const synced = Number(data?.invoices_synced) || 0;
    const posted = Number(data?.stay_days_posted) || 0;
    if (total > 0 && (synced > 0 || posted > 0)) {
      showToast(
        `تمت مزامنة ${synced} فاتورة وترحيل ${posted} يوم إقامة للمرضى المسجلين (${total} مريض)`,
        'success'
      );
    }
  } catch {
    sessionStorage.removeItem(DAILY_BULK_RECONCILE_KEY);
  }
}

async function loadOpenPatientStay(fileNumber) {
  const fn = (fileNumber || getStayFileNumber()).trim();
  if (!fn) {
    resetDailyStaySuppression();
    applyDailyStayContext(null);
    showDailyPatientPicker();
    return null;
  }
  try {
    let data = await apiJson(`${DAILY_API}/open-stay?file_number=${encodeURIComponent(fn)}`);
    if (!data?.invoice?.id && data?.patient?.name) {
      data = await ensureOpenStayInvoice(data);
    }
    dailyStayContext = data;
    await ensurePatientDataReconciled(fn);
    data = await apiJson(`${DAILY_API}/open-stay?file_number=${encodeURIComponent(fn)}`);
    applyDailyStayContext(data);
    await loadDailyStayTypes();
    await loadDailyStayGrades();
    populateStayTypeSelects(dailyStayContext?.room_assignment?.stay_type_id || '');
    await reloadDailyServiceCaches();
    await refreshOperationsTotalsCache();
    if (dailySectionsCache.length) await loadDailyEntriesIntoSheet();
    await loadOperationsForToday();
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
  const patient_type =
    dailyStayContext?.patient?.patient_type ||
    (document.getElementById('daily-stay-type-display')?.textContent?.includes('خارجي') ? 'external' : 'internal');
  if (!file_number || !patient_name || !admission_date) {
    showToast('رقم الملف واسم المريض وتاريخ الدخول مطلوبان', 'warning');
    return;
  }

  try {
    const payload = {
      file_number,
      patient_name,
      phone: document.getElementById('daily-stay-phone')?.value.trim() || '',
      other_phone: dailyStayContext?.patient?.other_phone || '',
      nationality: normalizeNationalitySelectValue(
        document.getElementById('daily-stay-nationality')?.value
      ),
      gender: document.getElementById('daily-stay-gender')?.value || '',
      admission_date,
      discharge_date,
      financial_treatment: document.getElementById('daily-stay-financial')?.value || '',
      patient_type,
      ...collectPatientDemographics('daily'),
      ...collectInternalStayPayload(patient_type),
    };
    if (patient_type !== 'external') {
      payload.account_balance = dailyParseAmount(document.getElementById('daily-stay-balance')?.value);
    }
    if (isEntityInvoiceType(payload.invoice_type) && !payload.contracted_entity_id) {
      showToast('اختر الجهة', 'warning');
      return;
    }
    const data = await apiJson(`${DAILY_API}/open-stay`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    applyDailyStayContext(data);
    await loadDailyStayTypes();
    if (dailySectionsCache.length) await loadDailyEntriesIntoSheet();
    await loadOperationsForToday();
    await loadDailyPatientHistory();
    if (canUseDailyStayCharges(data)) await applyAutoRoomToTodayRows();
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
    format: 'excel',
  });
  if (from_date) params.set('from_date', from_date);
  if (to_date) params.set('to_date', to_date);
  try {
    const res = await apiFetch(`${DAILY_API}/daily-items/print?${params}`);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || 'فشل تصدير التقرير');
    }
    const blob = await res.blob();
    const safeFile = file_number.replace(/[^\w\-]+/g, '_');
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `daily-report-${kind}-${safeFile}.xlsx`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(link.href);
    showToast('تم تنزيل التقرير Excel', 'success');
  } catch (err) {
    showToast(sanitizeApiErrorMessage(err.message), 'danger');
  }
}

function renderDailyInvoiceReviewPanel() {
  const body = document.getElementById('daily-invoice-review-body');
  if (!body) return;
  const ctx = dailyStayContext;
  const p = ctx?.patient || {};
  const inv = ctx?.invoice || {};
  const typeLabel = p.patient_type === 'external' ? 'مريض خارجي' : 'مريض داخلي';
  const genderLabel =
    p.gender === 'male' ? 'ذكر' : p.gender === 'female' ? 'أنثى' : p.gender || '—';
  const statusClass =
    inv.status === 'pending_review'
      ? 'bg-warning text-dark'
      : inv.status === 'approved'
        ? 'bg-success'
        : 'bg-secondary';
  const militaryBlock = isMilitaryPatientCase(inv.invoice_type, inv.financial_treatment || p.financial_treatment)
    ? `
      <div class="col-12 mt-2"><h6 class="fw-black text-warning mb-2">تصديق عسكري</h6></div>
      <div class="col-12">
        <div class="alert alert-warning py-2 mb-0 fw-bold">
          ${dailyEscapeHtml(
            buildMilitaryAuthSummaryText(
              p.military_auth_amount,
              p.military_auth_from || inv.letter_from_date,
              p.military_auth_to || inv.letter_to_date
            )
          )}
        </div>
      </div>`
    : '';
  body.innerHTML = `
    <div class="row g-3 daily-review-readonly-grid small">
      <div class="col-12"><h6 class="fw-black text-primary mb-2">بيانات المريض</h6></div>
      <div class="col-md-3"><span class="text-muted d-block mb-1">الاسم</span><div class="review-field fw-bold">${dailyEscapeHtml(p.name || inv.patient_name || '—')}</div></div>
      <div class="col-md-3"><span class="text-muted d-block mb-1">رقم الملف</span><div class="review-field fw-bold">${dailyEscapeHtml(p.file_number || inv.file_number || '—')}</div></div>
      <div class="col-md-3"><span class="text-muted d-block mb-1">النوع</span><div class="review-field">${dailyEscapeHtml(typeLabel)}</div></div>
      <div class="col-md-3"><span class="text-muted d-block mb-1">الجنس</span><div class="review-field">${dailyEscapeHtml(genderLabel)}</div></div>
      <div class="col-md-3"><span class="text-muted d-block mb-1">الهاتف</span><div class="review-field">${dailyEscapeHtml(p.phone || '—')}</div></div>
      <div class="col-md-3"><span class="text-muted d-block mb-1">الجنسية</span><div class="review-field">${dailyEscapeHtml(p.nationality || '—')}</div></div>
      <div class="col-md-3"><span class="text-muted d-block mb-1">رصيد الحساب</span><div class="review-field fw-bold text-success">${dailyFmt(p.account_balance ?? 0)}</div></div>
      <div class="col-md-3"><span class="text-muted d-block mb-1">المعاملة المالية</span><div class="review-field">${dailyEscapeHtml(inv.financial_treatment || p.financial_treatment || '—')}</div></div>
      ${
        isEntityInvoiceType(inv.invoice_type) && inv.contracted_entity_name
          ? `<div class="col-md-3"><span class="text-muted d-block mb-1">${inv.invoice_type === 'non_contracted' ? 'الجهة غير المتعاقدة' : 'الجهة المتعاقدة'}</span><div class="review-field fw-bold text-primary">${dailyEscapeHtml(inv.contracted_entity_name)}</div></div>`
          : ''
      }
      <div class="col-md-3"><span class="text-muted d-block mb-1">تاريخ الدخول</span><div class="review-field">${dailyEscapeHtml(fmtStayDate(inv.admission_date) || '—')}</div></div>
      <div class="col-md-3"><span class="text-muted d-block mb-1">تاريخ الخروج</span><div class="review-field">${dailyEscapeHtml(fmtStayDate(inv.discharge_date) || '—')}</div></div>
      <div class="col-12 mt-2"><h6 class="fw-black text-primary mb-2">ملخص الفاتورة</h6></div>
      <div class="col-md-3"><span class="text-muted d-block mb-1">رقم الفاتورة</span><div class="review-field fw-bold">${dailyEscapeHtml(inv.serial_number ? inv.serial_number : `#${inv.id}`)}</div></div>
      <div class="col-md-3"><span class="text-muted d-block mb-1">الحالة</span><div class="review-field"><span class="badge ${statusClass}">${dailyEscapeHtml(inv.status_label || inv.status || '—')}</span></div></div>
      <div class="col-md-3"><span class="text-muted d-block mb-1">إجمالي الفاتورة</span><div class="review-field fw-bold text-primary">${dailyFmt(inv.final_total ?? 0)}</div></div>
      <div class="col-md-3"><span class="text-muted d-block mb-1">المحصل</span><div class="review-field fw-bold">${dailyFmt(inv.total_collected ?? 0)}</div></div>
      <div class="col-md-3"><span class="text-muted d-block mb-1">المتبقي</span><div class="review-field fw-bold text-danger">${dailyFmt(inv.remaining ?? inv.outstanding_amount ?? 0)}</div></div>
      ${militaryBlock}
    </div>
    <p class="small text-muted mt-3 mb-0">لتعديل بيانات المريض استخدم تسجيل المريض أو الحركة اليومية. للمدفوعات والاعتماد استخدم قائمة الفواتير.</p>
  `;
}

function toggleDailyInvoiceReview() {
  const panel = document.getElementById('daily-invoice-review-panel');
  if (!dailyStayContext?.invoice?.id) {
    showToast('لا توجد فاتورة مفتوحة لهذا المريض', 'warning');
    return;
  }
  if (!panel) return;
  const opening = panel.classList.contains('d-none');
  if (opening) renderDailyInvoiceReviewPanel();
  panel.classList.toggle('d-none', !opening);
}

function closeDailyInvoiceReview() {
  const panel = document.getElementById('daily-invoice-review-panel');
  if (panel) panel.classList.add('d-none');
}

async function openDailyStayInvoice() {
  toggleDailyInvoiceReview();
}

function openDailyInvoicePdf() {
  const inv = dailyStayContext?.invoice;
  if (!inv?.id) {
    showToast('لا توجد فاتورة', 'warning');
    return;
  }
  if (inv.status !== 'approved') {
    showToast('الفاتورة غير معتمدة بعد', 'info');
    return;
  }
  window.open(`/api/invoices/${inv.id}/pdf`, '_blank');
}

function dailyCan(view) {
  return typeof can === 'function' && (can(view) || can('daily_charges.view') || can('daily_charges.manage'));
}

function dailyFormatNumber(n, decimals = 2) {
  if (typeof formatPlainNumber === 'function') return formatPlainNumber(n, decimals);
  const num = Number(n) || 0;
  return num.toLocaleString('ar-EG-u-nu-latn', {
    useGrouping: true,
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
let dailyBusinessDate = null;
let activeDailyTab = '';

function isManualDailyAmountSection(section) {
  return ['accommodation', 'companion', 'nursing_point', 'patient_assistant'].includes(String(section?.code || '').trim());
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
      if (payload.default_supplies_markup_percent != null) {
        dailySuppliesMarkupPercent = Number(payload.default_supplies_markup_percent) || 20;
      }
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
  void loadCompanionServicesCache();
  void loadExamServicesCache();

  const priceSections = dailySectionsCache.filter((s) => s.picker_kind === 'service' || s.service_count > 0);
  const statusEl = document.getElementById('daily-entry-status');
  if (dailyPriceListMeta?.name && statusEl && dailyStayContext?.invoice?.id) {
    const listTotal = dailySectionsCache.reduce((sum, s) => sum + (s.service_count || 0), 0);
    statusEl.title = `اللائحة: ${dailyPriceListMeta.name} | ${listTotal} بند في الشيت — بحث عند الاختيار`;
  }
  if (dailyStayContext?.invoice?.id && priceSections.length && !dailyPriceListMeta?.id) {
    showToast('لم تُحمَّل خدمات من اللائحة — تأكد من استيراد اللائحة في الإعدادات', 'warning');
  }
}

function buildDailyStayTypeOptions(selectedId = '') {
  const grades = getAccommodationGradeOptions();
  if (!grades.length) return '<option value="">—</option>';
  const selectedVal = String(selectedId || '');
  return (
    '<option value="">— اختر نوع الإقامة —</option>' +
    grades
      .map((g) => {
        const id = stayGradeSelectValue(g);
        if (!id) return '';
        const rate = Number(g.daily_rate) || 0;
        const rateLabel = rate > 0 ? ` — ${dailyFmt(dailyAmountForDisplay(rate))} / يوم` : '';
        const catalogId = g.catalog_item_id ? ` data-catalog-item-id="${g.catalog_item_id}"` : '';
        const serviceId = g.service_id ? ` data-service-id="${g.service_id}"` : '';
        const stayTypeAttr = g.stay_type_id ? ` data-stay-type-id="${g.stay_type_id}"` : '';
        return `<option value="${dailyEscapeAttr(id)}" data-rate="${rate}"${catalogId}${serviceId}${stayTypeAttr}${selectedVal === id ? ' selected' : ''}>${dailyEscapeHtml(g.name)}${rateLabel}</option>`;
      })
      .filter(Boolean)
      .join('')
  );
}

function getDefaultStayTypeIdForRow() {
  const assignment = dailyStayContext?.room_assignment;
  if (assignment?.stay_type_id) return String(assignment.stay_type_id);
  const patientGrade = dailyStayContext?.patient?.stay_grade_id;
  if (patientGrade) return String(patientGrade);
  return '';
}

async function loadCompanionKindOptionsCache() {
  try {
    dailyCompanionKindOptionsCache = await apiJson('/api/settings/companion-kinds');
  } catch {
    dailyCompanionKindOptionsCache = [
      { code: 'none', name: 'بدون', amount: 0, section_code: '' },
      { code: 'nursing_point', name: 'نقطة تمريض', amount: 0, section_code: 'nursing_point' },
    ];
  }
}

async function loadCompanionServicesCache() {
  if (!window.DailyEntryPicker) return;
  try {
    const result = await DailyEntryPicker.searchPicker('companion', 'مرافق', 30);
    dailyCompanionServicesCache = result.rows || [];
  } catch {
    dailyCompanionServicesCache = [];
  }
}

async function loadExamServicesCache() {
  try {
    const res = await apiFetch(`${DAILY_API}/picker/list?category_code=MEDICAL_EXAMS&limit=500`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    dailyExamServicesCache = (data.rows || []).map((r) => ({
      ...r,
      section_code: inferExamSectionCodeFromServiceName(r.name),
    }));
  } catch {
    dailyExamServicesCache = [];
  }
}

async function loadExamSpecialtiesCache() {
  try {
    dailyExamSpecialtiesCache = await apiJson('/api/settings/exam-specialties');
  } catch {
    dailyExamSpecialtiesCache = [
      {
        code: 'outpatient_clinic',
        name: 'كشف العيادات الخارجية',
        section_code: 'consultant_exam',
        price: 500,
        is_active: true,
      },
      {
        code: 'specialist_round',
        name: 'مرور أخصائي',
        section_code: 'specialist_exam',
        price: 450,
        is_active: true,
      },
    ];
  }
}

function priceFromExamServiceRow(svc) {
  return Number(svc?.price ?? svc?.list_price) || 0;
}

function getExamCaseServiceRow(serviceId) {
  const id = Number(serviceId);
  if (!id) return null;
  return dailyExamServicesCache.find((svc) => Number(svc.id) === id) || null;
}

function examSectionCodeForServiceRow(svc) {
  if (!svc) return '';
  return svc.section_code || inferExamSectionCodeFromServiceName(svc.name);
}

function resolveExamServiceIdForSave(tr) {
  if (!tr) return null;
  const caseSel = tr.querySelector('.daily-exam-case');
  let serviceId = Number(caseSel?.value) || Number(tr.dataset.examCaseServiceId) || 0;
  if (serviceId > 0) return serviceId;
  const sectionCode =
    caseSel?.selectedOptions[0]?.dataset.section ||
    tr.dataset.examSectionCode ||
    examSectionCodeForSpecialty(tr.querySelector('.daily-exam-specialty')?.value || '');
  if (!sectionCode) return null;
  const matches = dailyExamServicesCache.filter((svc) => examSectionCodeForServiceRow(svc) === sectionCode);
  if (!matches.length) return null;
  const amount = dailyAmountForSave(dailyParseAmount(tr.querySelector('.daily-exam-unit-price')?.value));
  if (amount > 0) {
    const byPrice = matches.find(
      (svc) => dailyAmountForSave(priceFromExamServiceRow(svc)) === amount
    );
    if (byPrice) return Number(byPrice.id);
  }
  const caseLabel = caseSel?.selectedOptions[0]?.textContent?.trim();
  if (caseLabel) {
    const byName = matches.find((svc) => String(svc.name || '').trim() === caseLabel);
    if (byName) return Number(byName.id);
  }
  if (matches.length === 1) return Number(matches[0].id);
  return null;
}

function examStampLinkRef(tr) {
  const examLineId = Number(tr.dataset.examLineId) || 0;
  if (examLineId > 0) return `stamp_for:${examLineId}`;
  const caseId = tr.querySelector('.daily-exam-case')?.value || '';
  const spec = tr.querySelector('.daily-exam-specialty')?.value || '';
  const doctor = tr.querySelector('.daily-exam-doctor')?.value || tr.dataset.doctorId || '';
  const entryId = tr.dataset.entryId || '';
  return `stamp_for:dom:${entryId}:${caseId}:${spec}:${doctor}`;
}

function resolveConsultationStampForExamEntry(entry, examLine, stampPoolState) {
  const lines = entry?.lines || [];
  const stamps = lines.filter((l) => l.section_code === 'consultation_stamp');
  if (!stamps.length) return {};
  const examId = Number(examLine?.id) || 0;
  if (examId > 0) {
    const linked = stamps.find((s) => String(s.extra_text || '').trim() === `stamp_for:${examId}`);
    if (linked) return linked;
  }
  const entryKey = String(entry?.id || 'new');
  if (!stampPoolState.has(entryKey)) {
    const legacy = stamps.filter((s) => !String(s.extra_text || '').startsWith('stamp_for:'));
    stampPoolState.set(entryKey, { pool: legacy, index: 0 });
  }
  const state = stampPoolState.get(entryKey);
  if (state.index < state.pool.length) {
    return state.pool[state.index++];
  }
  return {};
}

function resolveExamCaseServiceIdFromLine(line = {}) {
  const serviceId = Number(line.service_id);
  if (serviceId) {
    if (getExamCaseServiceRow(serviceId)) return String(serviceId);
    return String(serviceId);
  }
  if (line.section_code) {
    const matches = dailyExamServicesCache.filter(
      (svc) => examSectionCodeForServiceRow(svc) === line.section_code
    );
    if (!matches.length) return '';
    const savedAmount = dailyAmountForSave(dailyParseAmount(line.amount));
    if (savedAmount > 0) {
      const byPrice = matches.find(
        (svc) => dailyAmountForSave(priceFromExamServiceRow(svc)) === savedAmount
      );
      if (byPrice) return String(byPrice.id);
    }
    if (matches.length === 1) return String(matches[0].id);
    const nameHint = String(line.description || line.extra_text || '').trim();
    if (nameHint) {
      const byName = matches.find((svc) => String(svc.name || '').trim() === nameHint);
      if (byName) return String(byName.id);
    }
    return String(matches[0].id);
  }
  return '';
}

function syncExamRowUnitPriceFromSelections(tr) {
  if (!tr?.classList.contains('daily-exam-row')) return;
  const caseSel = tr.querySelector('.daily-exam-case');
  const caseOpt = caseSel?.selectedOptions[0];
  const casePrice = Number(caseOpt?.dataset.price) || 0;
  const specialtySel = tr.querySelector('.daily-exam-specialty');
  const specialtyOpt = specialtySel?.selectedOptions[0];
  const specialtyCode = specialtySel?.value || tr.dataset.examSpecialtyCode || '';
  const specialty = getExamSpecialtyByCode(specialtyCode);
  const specialtyPrice =
    Number(specialtyOpt?.dataset.price ?? specialty?.price) || 0;
  const price = specialtyPrice > 0 ? specialtyPrice : casePrice;
  const unitEl = tr.querySelector('.daily-exam-unit-price');
  if (!unitEl || price <= 0) return;
  unitEl.value = formatAmountFieldValue(dailyAmountForDisplay(price));
}

function getExamSpecialtyByCode(code) {
  const key = String(code || '').trim();
  if (!key) return null;
  return (dailyExamSpecialtiesCache || []).find((s) => s.code === key && s.is_active !== false) || null;
}

function resolveExamSpecialtyCodeFromLine(line = {}) {
  const fromExtra = String(line.extra_text || '').trim();
  if (fromExtra) {
    const byCode = getExamSpecialtyByCode(fromExtra);
    if (byCode) return byCode.code;
    const byName = (dailyExamSpecialtiesCache || []).find((s) => s.name === fromExtra);
    if (byName) return byName.code;
  }
  if (line.description) {
    const byDesc = (dailyExamSpecialtiesCache || []).find((s) => s.name === line.description);
    if (byDesc) return byDesc.code;
  }
  return '';
}

function examSectionCodeForSpecialty(specialtyCode) {
  const specialty = getExamSpecialtyByCode(specialtyCode);
  return specialty?.section_code || '';
}

function inferExamSectionCodeFromServiceName(name) {
  const text = String(name || '');
  const norm = text
    .replace(/\u0640/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .toLowerCase();
  if (/استشار/.test(text) || norm.includes('استشار')) return 'consultant_exam';
  if (/أخصائي|اخصائ/i.test(text) || norm.includes('اخصائ')) return 'specialist_exam';
  if (/خبير/.test(text) || norm.includes('خبير')) return 'consultant_exam';
  return 'specialist_exam';
}

function refreshExamRowsDropdowns() {
  document.querySelectorAll('.daily-exam-row').forEach((tr) => {
    const caseSel = tr.querySelector('.daily-exam-case');
    const caseServiceId = tr.dataset.examCaseServiceId || caseSel?.value || '';
    const sectionCode =
      tr.dataset.examSectionCode || caseSel?.selectedOptions[0]?.dataset.section || '';
    const specialtyCode =
      tr.dataset.examSpecialtyCode || tr.querySelector('.daily-exam-specialty')?.value || '';
    if (caseSel) {
      caseSel.innerHTML = buildExamCaseOptions(caseServiceId);
      if (caseServiceId && caseSel.querySelector(`option[value="${CSS.escape(caseServiceId)}"]`)) {
        caseSel.value = caseServiceId;
      }
    }
    const specialtySel = tr.querySelector('.daily-exam-specialty');
    if (specialtySel) {
      specialtySel.innerHTML = buildExamSpecialtyOptions(sectionCode, specialtyCode);
      if (specialtyCode && specialtySel.querySelector(`option[value="${CSS.escape(specialtyCode)}"]`)) {
        specialtySel.value = specialtyCode;
      }
    }
    if (sectionCode) tr.dataset.examSectionCode = sectionCode;
  });
}

async function reloadDailyServiceCaches() {
  await loadExamSpecialtiesCache();
  await loadExamServicesCache();
  await loadCompanionKindOptionsCache();
  await loadCompanionServicesCache();
  refreshExamRowsDropdowns();
  document.querySelectorAll('.daily-companion-kind').forEach((sel) => {
    const prev = sel.value;
    sel.innerHTML = buildCompanionKindOptions(prev);
    if (prev && sel.querySelector(`option[value="${CSS.escape(prev)}"]`)) sel.value = prev;
  });
}

function buildCompanionKindOptions(selectedValue = '') {
  const parts = [];
  const kinds = dailyCompanionKindOptionsCache.length
    ? dailyCompanionKindOptionsCache
    : [
        { code: 'none', name: 'بدون', amount: 0, section_code: '' },
        { code: 'nursing_point', name: 'نقطة تمريض', amount: 0, section_code: 'nursing_point' },
      ];
  kinds.forEach((opt) => {
    const value = opt.code === 'none' ? '' : opt.code;
    const selected =
      String(selectedValue) === String(value) ||
      (opt.service_id && String(selectedValue) === String(opt.service_id))
        ? ' selected'
        : '';
    parts.push(
      `<option value="${dailyEscapeAttr(value)}" data-kind="${dailyEscapeAttr(opt.code)}" data-section="${dailyEscapeAttr(opt.section_code || 'companion')}" data-price="${Number(opt.amount) || 0}"${selected}>${dailyEscapeHtml(opt.name)}</option>`
    );
  });
  dailyCompanionServicesCache.forEach((s) => {
    const price = Number(s.price ?? s.list_price) || 0;
    const selected = String(selectedValue) === String(s.id) ? ' selected' : '';
    parts.push(
      `<option value="${s.id}" data-kind="service" data-section="companion" data-price="${price}"${selected}>${dailyEscapeHtml(s.name)} — ${dailyFmt(price)}</option>`
    );
  });
  return parts.join('');
}

function buildExamCaseOptions(selectedServiceId = '') {
  if (!dailyExamServicesCache.length) {
    return '<option value="">— حالة الكشف (ارفع الكشوفات أو اللائحة) —</option>';
  }
  return (
    '<option value="">— حالة الكشف —</option>' +
    dailyExamServicesCache
      .map((svc) => {
        const price = priceFromExamServiceRow(svc);
        const sectionCode = examSectionCodeForServiceRow(svc);
        const selected = String(selectedServiceId) === String(svc.id) ? ' selected' : '';
        return `<option value="${svc.id}" data-section="${dailyEscapeAttr(sectionCode)}" data-price="${price}"${selected}>${dailyEscapeHtml(svc.name)}</option>`;
      })
      .join('')
  );
}

function buildExamSpecialtyOptions(sectionCode = '', selectedSpecialtyCode = '') {
  const allItems = (dailyExamSpecialtiesCache || []).filter((s) => s.is_active !== false);
  let items = sectionCode ? allItems.filter((s) => s.section_code === sectionCode) : allItems;
  if (!items.length && allItems.length) items = allItems;
  if (!items.length) {
    return '<option value="">— التخصص (أضفه من الإعدادات → تخصصات الكشوفات) —</option>';
  }
  return (
    '<option value="">— التخصص —</option>' +
    items
      .map((s) => {
        const selected = selectedSpecialtyCode === s.code ? ' selected' : '';
        const price = Number(s.price) || 0;
        return `<option value="${dailyEscapeAttr(s.code)}" data-section="${dailyEscapeAttr(s.section_code)}" data-price="${price}"${selected}>${dailyEscapeHtml(s.name)}</option>`;
      })
      .join('')
  );
}

function companionServiceIdFromLine(line = {}) {
  if (line.service_id) return String(line.service_id);
  const hint = String(line.extra_text || line.description || '').trim();
  if (!hint || !dailyCompanionServicesCache.length) return '';
  const lower = hint.toLowerCase();
  const match =
    dailyCompanionServicesCache.find((s) => String(s.name).trim() === hint) ||
    dailyCompanionServicesCache.find((s) => String(s.name).includes(hint)) ||
    dailyCompanionServicesCache.find((s) => lower.includes('غرف') && String(s.name).includes('غرف')) ||
    dailyCompanionServicesCache.find((s) => lower.includes('جناح') && String(s.name).includes('جناح'));
  return match ? String(match.id) : '';
}

function formatAmountFieldValue(n) {
  if (n == null || n === '') return '';
  if (typeof formatAmountInput === 'function') return formatAmountInput(n);
  return dailyFormatInput(n);
}

function updateStayAccUnitPriceDisplay(tr) {
  const display = tr?.querySelector('.daily-stay-acc-unit-price');
  if (!display) return;
  const accInput = tr.querySelector('.daily-amount[data-section="accommodation"]');
  let unit = Number(accInput?.dataset.unitPrice) || 0;
  if (!unit && accInput) unit = dailyParseAmount(accInput.value);
  if (!unit) {
    const staySel = tr.querySelector('.daily-row-stay-type');
    const rate = Number(staySel?.selectedOptions[0]?.dataset.rate) || 0;
    if (rate > 0) unit = rate;
  }
  const displayUnit = dailyAmountForDisplay(unit);
  if (displayUnit > 0 && accInput && dailyParseAmount(accInput.value) <= 0) {
    accInput.value = String(displayUnit);
    accInput.dataset.unitPrice = String(displayUnit);
  }
  display.value = displayUnit > 0 ? formatAmountFieldValue(displayUnit) : '';
}

function onCompanionKindChange(selectEl) {
  const tr = selectEl.closest('.daily-entry-row');
  if (!tr) return;
  const opt = selectEl.selectedOptions[0];
  const kind = opt?.dataset.kind || '';
  const sectionCode = opt?.dataset.section || 'companion';
  const price = Number(opt?.dataset.price) || 0;
  const serviceId = opt?.value && kind === 'service' ? opt.value : '';

  setDailySectionAmount(tr, 'companion', 0);
  setDailySectionAmount(tr, 'nursing_point', 0);
  const companionInput = tr.querySelector('.daily-amount[data-section="companion"]');
  if (companionInput) {
    companionInput.dataset.serviceId = serviceId || '';
    companionInput.dataset.companionKind = kind || '';
  }

  if (!kind || kind === 'none') {
    updateRowTotal(tr);
    updateDailyGrandTotal();
    updateSectionTabTotal();
    return;
  }

  if (sectionCode === 'nursing_point') {
    setDailySectionAmount(tr, 'nursing_point', price);
  } else {
    setDailySectionAmount(tr, 'companion', price);
  }
  if (tr.classList.contains('daily-stay-row') || tr.classList.contains('daily-stay-addon-row')) {
    refreshDailyStayLiveTotals();
    return;
  }
  updateRowTotal(tr);
  updateDailyGrandTotal();
  updateSectionTabTotal();
}

async function onStayTypeChangeForRow(selectEl) {
  const tr = selectEl.closest('.daily-stay-row, .daily-stay-addon-row');
  if (!tr) return;
  await applyStayTypeRateToRow(tr, { force: true });
  updateStayAccUnitPriceDisplay(tr);
  updateRowTotal(tr);
  const primary = findStayPrimaryRow(tr) || tr;
  if (primary.classList.contains('daily-stay-row')) updateStayRowGroupTotal(primary);
  refreshDailyStayLiveTotals();
}

function onExamCaseChange(selectEl) {
  const tr = selectEl?.closest('.daily-entry-row');
  if (!tr) return;
  const opt = selectEl.selectedOptions[0];
  const sectionCode = opt?.dataset.section || '';
  tr.dataset.examSectionCode = sectionCode;
  tr.dataset.examCaseServiceId = selectEl.value || '';
  const specialtySel = tr.querySelector('.daily-exam-specialty');
  const prevSpecialty = specialtySel?.value || tr.dataset.examSpecialtyCode || '';
  if (specialtySel) {
    specialtySel.innerHTML = buildExamSpecialtyOptions(sectionCode, prevSpecialty);
    if (prevSpecialty && specialtySel.querySelector(`option[value="${CSS.escape(prevSpecialty)}"]`)) {
      specialtySel.value = prevSpecialty;
    } else {
      specialtySel.value = '';
      tr.dataset.examSpecialtyCode = '';
    }
  }
  syncExamRowUnitPriceFromSelections(tr);
  updateRowTotal(tr);
  updateDailyGrandTotal();
  updateSectionTabTotal();
}

function onExamSpecialtyChange(selectEl) {
  const tr = selectEl?.closest('.daily-entry-row');
  if (!tr) return;
  const specialtyCode = selectEl.value || '';
  const opt = selectEl.selectedOptions[0];
  const specialty = getExamSpecialtyByCode(specialtyCode);
  tr.dataset.examSpecialtyCode = specialtyCode;
  const caseSel = tr.querySelector('.daily-exam-case');
  const sectionCode = opt?.dataset.section || specialty?.section_code || '';
  if (sectionCode) tr.dataset.examSectionCode = sectionCode;
  if (sectionCode && caseSel) {
    const currentSection = caseSel.selectedOptions[0]?.dataset.section || '';
    if (!caseSel.value || (currentSection && currentSection !== sectionCode)) {
      const match = dailyExamServicesCache.find((svc) => examSectionCodeForServiceRow(svc) === sectionCode);
      if (match) {
        caseSel.value = String(match.id);
        tr.dataset.examCaseServiceId = String(match.id);
      }
    }
  }
  syncExamRowUnitPriceFromSelections(tr);
  updateRowTotal(tr);
  updateDailyGrandTotal();
  updateSectionTabTotal();
}

const STAY_CHARGE_SECTIONS = ['accommodation', 'companion', 'nursing_point', 'patient_assistant'];

function entryHasStayChargeData(entry) {
  const stayCodes = new Set(STAY_CHARGE_SECTIONS);
  return (entry?.lines || []).some((line) => stayCodes.has(line.section_code) && lineHasChargeData(line));
}

function collectLineIdsForRowRemoval(tr) {
  const ids = new Set();
  ['examLineId', 'stampLineId', 'lineId', 'dateLineId', 'detailLineId'].forEach((attr) => {
    if (tr.dataset[attr]) ids.add(Number(tr.dataset[attr]));
  });
  tr.querySelectorAll('[data-line-id]').forEach((el) => {
    const id = Number(el.dataset.lineId);
    if (id) ids.add(id);
  });
  const stampVal =
    dailyParseAmount(tr.querySelector('.daily-exam-stamp')?.value) ||
    dailyParseAmount(tr.querySelector('.daily-lab-stamp')?.value) ||
    dailyParseAmount(tr.querySelector('.daily-rad-stamp')?.value);
  if (tr.dataset.stampLineId && stampVal > 0) ids.add(Number(tr.dataset.stampLineId));
  if (tr.classList.contains('daily-stay-row')) {
    const stayCodes = new Set(STAY_CHARGE_SECTIONS);
    (tr._entryLinesSnapshot || []).forEach((line) => {
      if (line.id && stayCodes.has(line.section_code)) ids.add(line.id);
    });
  }
  return ids;
}

function bindDailyAmountRecalc(tr) {
  const onAmountChange = () => {
    if (
      tr.classList.contains('daily-stay-row') ||
      tr.classList.contains('daily-stay-addon-row') ||
      tr.closest('.daily-stay-row, .daily-stay-addon-row')
    ) {
      refreshDailyStayLiveTotals();
      return;
    }
    updateRowTotal(tr);
    updateDailyGrandTotal();
    updateSectionTabTotal();
  };
  tr.querySelectorAll(
    '.daily-amount, .daily-session-morning, .daily-session-evening, .daily-session-qty, .daily-lab-stamp, .daily-rad-stamp, .daily-exam-stamp, .daily-exam-unit-price'
  ).forEach((el) => {
    if (el.dataset.dailyRecalcBound === '1') return;
    el.dataset.dailyRecalcBound = '1';
    el.addEventListener('input', onAmountChange);
    el.addEventListener('change', onAmountChange);
  });
}

function getStayAccommodationAmount(primaryTr) {
  const hidden = primaryTr?.querySelector('.daily-amount[data-section="accommodation"]');
  const display = primaryTr?.querySelector('.daily-stay-acc-unit-price');
  return dailyParseAmount(hidden?.value) || dailyParseAmount(display?.value);
}

function bindStayRowEvents(tr) {
  const staySel = tr.querySelector('.daily-row-stay-type');
  if (staySel) staySel.addEventListener('change', () => onStayTypeChangeForRow(staySel));
  const companionSel = tr.querySelector('.daily-companion-kind');
  if (companionSel) companionSel.addEventListener('change', () => onCompanionKindChange(companionSel));
  const dateInput = tr.querySelector('.daily-row-date');
  if (dateInput && dateInput.dataset.stayDateBound !== '1') {
    dateInput.dataset.stayDateBound = '1';
    dateInput.addEventListener('change', () => {
      pruneDuplicateStayDomRows();
      updateDailyGrandTotal();
      updateSectionTabTotal();
    });
  }
  bindDailyAmountRecalc(tr);
}

function bindExamRowEvents(tr) {
  const caseSel = tr.querySelector('.daily-exam-case');
  if (caseSel) caseSel.addEventListener('change', () => onExamCaseChange(caseSel));
  const specialtySel = tr.querySelector('.daily-exam-specialty');
  if (specialtySel) specialtySel.addEventListener('change', () => onExamSpecialtyChange(specialtySel));
  bindDailyDoctorSuggestWrap(tr);
  bindDailyAmountRecalc(tr);
}

function resolveStayTypeIdFromAccommodationLine(line = {}) {
  const fromExtra = String(line.extra_text || '').match(/^stay_type:(\d+)$/);
  if (fromExtra) return fromExtra[1];
  const catId = Number(line.catalog_item_id) || 0;
  if (catId && dailyStayGradesCache.length) {
    const grade = dailyStayGradesCache.find((g) => Number(g.catalog_item_id) === catId);
    if (grade?.stay_type_id) return String(grade.stay_type_id);
  }
  return '';
}

function collectAccommodationLineFromRow(rowTr) {
  if (!rowTr) return null;
  updateStayAccUnitPriceDisplay(rowTr);
  const accHidden = rowTr.querySelector('.daily-amount[data-section="accommodation"]');
  const amount = dailyAmountForSave(getStayAccommodationAmount(rowTr));
  if (amount <= 0) return null;
  const selectVal = rowTr.querySelector('.daily-row-stay-type')?.value || '';
  const grade = findStayGradeFromSelectValue(selectVal);
  const stayTypeId =
    grade?.stay_type_id || rowTr.dataset.stayTypeId || (/^\d+$/.test(selectVal) ? selectVal : '');
  const line = {
    section_code: 'accommodation',
    amount,
    quantity: 1,
    unit_price: amount,
  };
  if (stayTypeId) line.extra_text = `stay_type:${stayTypeId}`;
  const serviceId = accHidden?.dataset.serviceId || grade?.service_id;
  if (serviceId) line.service_id = Number(serviceId);
  const catalogItemId = accHidden?.dataset.catalogItemId || grade?.catalog_item_id;
  if (catalogItemId) line.catalog_item_id = Number(catalogItemId);
  if (accHidden?.dataset.lineId) line.id = Number(accHidden.dataset.lineId);
  else if (rowTr.dataset.lineId && rowTr.dataset.addonSection === 'accommodation') {
    line.id = Number(rowTr.dataset.lineId);
  }
  return line;
}

function collectStayLinesFromRow(tr) {
  const primaryTr = tr.classList.contains('daily-stay-addon-row') ? findStayPrimaryRow(tr) : tr;
  if (!primaryTr) return [];
  const viewCodes = new Set(['accommodation', 'companion', 'nursing_point', 'patient_assistant']);
  const lines = [];
  getStayDayGroupRows(primaryTr).forEach((rowTr) => {
    const accLine = collectAccommodationLineFromRow(rowTr);
    if (accLine && lineHasChargeData(accLine)) lines.push(accLine);
    if (rowTr.querySelector('.daily-companion-kind')) collectCompanionLineFromRow(rowTr, lines);
    collectAmountLineFromRow(rowTr, 'patient_assistant', lines);
    collectAmountLineFromRow(rowTr, 'nursing_point', lines);
  });
  const snapshot = primaryTr._entryLinesSnapshot || [];
  const preserved = snapshot.filter((line) => !viewCodes.has(line.section_code) && lineHasChargeData(line));
  return [...preserved, ...lines];
}

function collectExamLinesFromRow(tr) {
  const viewCodes = new Set(DAILY_EXAM_CODES);
  const doctorId =
    tr.querySelector('.daily-exam-doctor')?.value || tr.dataset.doctorId || '';
  if (doctorId) tr.dataset.doctorId = String(doctorId);
  const caseSel = tr.querySelector('.daily-exam-case');
  const caseOpt = caseSel?.selectedOptions[0];
  const specialtySel = tr.querySelector('.daily-exam-specialty');
  const caseServiceId = resolveExamServiceIdForSave(tr);
  const svcRow = caseServiceId ? getExamCaseServiceRow(caseServiceId) : null;
  const specialtyCode = specialtySel?.value || tr.dataset.examSpecialtyCode || '';
  const specialty = getExamSpecialtyByCode(specialtyCode);
  const amount = dailyAmountForSave(dailyParseAmount(tr.querySelector('.daily-exam-unit-price')?.value));
  const sectionCode =
    (svcRow ? examSectionCodeForServiceRow(svcRow) : '') ||
    caseOpt?.dataset.section ||
    tr.dataset.examSectionCode ||
    examSectionCodeForSpecialty(specialtyCode) ||
    specialty?.section_code ||
    '';
  const resolvedSection =
    sectionCode ||
    (caseServiceId || specialtyCode || amount > 0
      ? inferExamSectionCodeFromServiceName(caseOpt?.textContent || '') || 'specialist_exam'
      : '');
  const lines = [];
  if (resolvedSection && (caseServiceId || specialtyCode || amount > 0)) {
    const line = {
      section_code: resolvedSection,
      amount,
      quantity: 1,
    };
    if (caseServiceId) line.service_id = caseServiceId;
    if (specialty?.name) line.description = specialty.name;
    if (tr.dataset.examLineId) line.id = Number(tr.dataset.examLineId);
    if (specialtyCode) line.extra_text = specialtyCode;
    const dateEl = tr.querySelector('.daily-exam-date');
    if (dateEl?.value) line.extra_date = dateEl.value;
    lines.push(line);
  }
  const stampCell = tr.querySelector('[data-stamp-cell="1"]');
  const stamp = stampCell ? dailyAmountForSave(dailyParseAmount(tr.querySelector('.daily-exam-stamp')?.value)) : 0;
  if (stamp > 0) {
    const stampLine = {
      section_code: 'consultation_stamp',
      amount: stamp,
      quantity: 1,
      extra_text: examStampLinkRef(tr),
    };
    if (tr.dataset.stampLineId) stampLine.id = Number(tr.dataset.stampLineId);
    lines.push(stampLine);
  }
  const snapshot = tr._entryLinesSnapshot || [];
  const preserved = snapshot.filter((line) => !viewCodes.has(line.section_code) && lineHasChargeData(line));
  return [...preserved, ...lines];
}

function createStayDailyEntryRow(entry = {}) {
  const tr = document.createElement('tr');
  tr.className = 'daily-entry-row daily-stay-row';
  assignStayRowKey(tr);
  if (entry.id) tr.dataset.entryId = entry.id;
  if (entry.notes) tr.dataset.entryNotes = entry.notes;
  if (entry.stay_type_id) tr.dataset.stayTypeId = String(entry.stay_type_id);
  tr._entryLinesSnapshot = (entry.lines || []).map((line) => ({ ...line }));

  const dateVal = fmtStayDate(entry.entry_date) || getLocalDateString();
  const accLines = getLinesForSection(entry, 'accommodation');
  const accLine = accLines[0] || {};
  const stayTypeSelectVal =
    resolveStayGradeSelectValueFromEntry(entry, accLine) || getDefaultStayTypeIdForRow();
  const companionLines = getLinesForSection(entry, 'companion');
  const companionLine = companionLines[0] || {};
  const assistantLines = getLinesForSection(entry, 'patient_assistant');
  const assistantLine = assistantLines[0] || {};
  const nursingLines = getLinesForSection(entry, 'nursing_point');
  const nursingLine = nursingLines[0] || {};
  const companionServiceId = companionServiceIdFromLine(companionLine);
  const accSection = dailySectionsCache.find((s) => s.code === 'accommodation');
  const accPickerHtml = accSection
    ? `<span class="d-none daily-acc-picker-wrap">${buildCatalogPickerCell(accSection)}</span>`
    : '';

  tr.innerHTML = `
    ${dailyRowSerialCellHtml(resolveDailyRowSerial(entry))}
    <td class="daily-col-date"><input type="date" class="form-control form-control-sm daily-row-date fw-bold" value="${dateVal}" title="يوم الإقامة"></td>
    <td class="daily-col-stay-type"><select class="form-select form-select-sm daily-row-stay-type">${buildDailyStayTypeOptions(stayTypeSelectVal)}</select></td>
    <td class="daily-col-amount">
      <div class="input-group input-group-sm">
        <input type="text" class="form-control form-control-sm daily-stay-acc-unit-price bg-light" readonly tabindex="-1">
        <button type="button" class="btn btn-outline-primary daily-stay-addon-add px-2 fw-bold" data-section="accommodation" title="إقامة إضافية لنفس اليوم">+ إقامة</button>
      </div>
      ${accPickerHtml}
      <input type="hidden" class="daily-amount" data-section="accommodation" data-type="amount">
    </td>
    <td class="daily-col-companion-kind"><select class="form-select form-select-sm daily-companion-kind">${buildCompanionKindOptions(companionServiceId)}</select></td>
    <td class="daily-col-amount">
      <div class="input-group input-group-sm">
        <input type="text" inputmode="decimal" class="form-control form-control-sm daily-amount comma-amount" data-section="companion" data-type="amount" autocomplete="off">
        <button type="button" class="btn btn-outline-secondary daily-stay-addon-add px-1" data-section="companion" title="مرافق إضافي">+</button>
      </div>
    </td>
    <td class="daily-col-amount">
      <div class="input-group input-group-sm">
        <input type="text" inputmode="decimal" class="form-control form-control-sm daily-amount comma-amount" data-section="patient_assistant" data-type="amount" autocomplete="off">
        <button type="button" class="btn btn-outline-secondary daily-stay-addon-add px-1" data-section="patient_assistant" title="مساعد تمريض إضافي">+</button>
      </div>
    </td>
    <td class="daily-col-amount">
      <div class="input-group input-group-sm">
        <input type="text" inputmode="decimal" class="form-control form-control-sm daily-amount comma-amount" data-section="nursing_point" data-type="amount" autocomplete="off">
        <button type="button" class="btn btn-outline-secondary daily-stay-addon-add px-1" data-section="nursing_point" title="نقطة تمريض إضافية">+</button>
      </div>
    </td>
    <td class="daily-col-total daily-row-total fw-bold text-nowrap"></td>
    <td class="daily-col-action text-center"><button type="button" class="btn btn-sm btn-outline-danger daily-row-delete" title="حذف اليوم">×</button></td>`;

  const accHidden = tr.querySelector('.daily-amount[data-section="accommodation"]');
  if (accHidden && accLine.amount > 0) {
    const displayAmount = dailyAmountForDisplay(accLine.amount);
    accHidden.value = String(displayAmount);
    accHidden.dataset.unitPrice = String(displayAmount);
    if (accLine.id) accHidden.dataset.lineId = String(accLine.id);
  }

  const companionInput = tr.querySelector('.daily-amount[data-section="companion"]');
  if (companionInput && companionLine.amount > 0) {
    const companionDisplay = dailyAmountForDisplay(companionLine.amount);
    if (typeof setCommaAmountValue === 'function') setCommaAmountValue(companionInput, companionDisplay);
    else companionInput.value = formatAmountFieldValue(companionDisplay);
    if (companionLine.id) companionInput.dataset.lineId = String(companionLine.id);
  }
  const assistantInput = tr.querySelector('.daily-amount[data-section="patient_assistant"]');
  if (assistantInput && assistantLine.amount > 0) {
    const assistantDisplay = dailyAmountForDisplay(assistantLine.amount);
    if (typeof setCommaAmountValue === 'function') setCommaAmountValue(assistantInput, assistantDisplay);
    else assistantInput.value = formatAmountFieldValue(assistantDisplay);
    if (assistantLine.id) assistantInput.dataset.lineId = String(assistantLine.id);
  }
  const nursingInput = tr.querySelector('.daily-amount[data-section="nursing_point"]');
  if (nursingInput && nursingLine.amount > 0) {
    const nursingDisplay = dailyAmountForDisplay(nursingLine.amount);
    if (typeof setCommaAmountValue === 'function') setCommaAmountValue(nursingInput, nursingDisplay);
    else nursingInput.value = formatAmountFieldValue(nursingDisplay);
    if (nursingLine.id) nursingInput.dataset.lineId = String(nursingLine.id);
  }

  tr._pendingStayAddons = {
    accommodation: accLines.slice(1),
    companion: companionLines.slice(1),
    patient_assistant: assistantLines.slice(1),
    nursing_point: nursingLines.slice(1),
  };

  bindDailyRowEvents(tr);
  bindStayRowEvents(tr);
  bindStayAddonButtons(tr);
  if (accSection && window.DailyEntryPicker) {
    DailyEntryPicker.bindRow(tr);
    DailyEntryPicker.hydratePicker(tr, accSection, accLine);
  }
  if (typeof bindCommaAmountInputs === 'function') bindCommaAmountInputs(tr);
  if (!entry.id) {
    void onStayTypeChangeForRow(tr.querySelector('.daily-row-stay-type'));
  } else {
    updateStayAccUnitPriceDisplay(tr);
  }
  updateRowTotal(tr);
  return tr;
}

function createExamDailyEntryRow(entry = {}, examLine = null, options = {}) {
  const line =
    examLine ||
    (entry.lines || []).find(
      (l) => ['consultant_exam', 'specialist_exam'].includes(l.section_code) && lineHasChargeData(l)
    ) ||
    {};
  const stampLine =
    options.stampLine ||
    (options.loadStampValue === true ? getLineForSection(entry, 'consultation_stamp') : {});
  const tr = document.createElement('tr');
  tr.className = 'daily-entry-row daily-exam-row';
  if (entry.id) tr.dataset.entryId = entry.id;
  if (entry.notes) tr.dataset.entryNotes = entry.notes;
  if (entry.doctor_id) tr.dataset.doctorId = String(entry.doctor_id);
  if (line.section_code) tr.dataset.examSectionCode = line.section_code;
  if (line.id) tr.dataset.examLineId = String(line.id);
  if (stampLine.id) tr.dataset.stampLineId = String(stampLine.id);
  tr._entryLinesSnapshot = (entry.lines || [])
    .filter((l) => {
      if (line.id && l.id === line.id) return false;
      if (['consultant_exam', 'specialist_exam', 'consultation_stamp'].includes(l.section_code)) {
        return false;
      }
      return true;
    })
    .map((l) => ({ ...l }));

  const specialtyCode = resolveExamSpecialtyCodeFromLine(line);
  const caseServiceId = resolveExamCaseServiceIdFromLine(line);
  const sectionCode =
    line.section_code || examSectionCodeForSpecialty(specialtyCode) || '';
  if (sectionCode) tr.dataset.examSectionCode = sectionCode;
  if (caseServiceId) tr.dataset.examCaseServiceId = caseServiceId;
  if (specialtyCode) tr.dataset.examSpecialtyCode = specialtyCode;
  const dateVal = line.extra_date
    ? String(line.extra_date).slice(0, 10)
    : entry.entry_date
      ? String(entry.entry_date).slice(0, 10)
      : getLocalDateString();
  const patientName = getDailyPatientDisplayName();
  const priceVal = line.amount > 0 ? formatAmountFieldValue(dailyAmountForDisplay(line.amount)) : '';
  const stampVal =
    stampLine.amount > 0 ? formatAmountFieldValue(dailyAmountForDisplay(stampLine.amount)) : '';

  tr.innerHTML = `
    ${dailyRowSerialCellHtml(resolveDailyRowSerial(entry, line))}
    <td><select class="form-select form-select-sm daily-exam-case">${buildExamCaseOptions(caseServiceId)}</select></td>
    <td><select class="form-select form-select-sm daily-exam-specialty">${buildExamSpecialtyOptions(sectionCode, specialtyCode)}</select></td>
    <td class="daily-exam-doctor-cell">${buildDailyDoctorSuggestHtml('', entry.doctor_id || '')}</td>
    <td><input type="text" inputmode="decimal" class="form-control form-control-sm daily-exam-unit-price comma-amount" value="${dailyEscapeAttr(priceVal)}" autocomplete="off" title="يمكن تعديل السعر قبل الحفظ"></td>
    <td><input type="date" class="form-control form-control-sm daily-exam-date" value="${dailyEscapeAttr(dateVal)}" autocomplete="off"></td>
    <td><input type="text" class="form-control form-control-sm daily-exam-patient bg-light" readonly value="${dailyEscapeAttr(patientName)}"></td>
    <td data-stamp-cell="1"><input type="text" inputmode="decimal" class="form-control form-control-sm daily-exam-stamp comma-amount" value="${dailyEscapeAttr(stampVal)}" autocomplete="off" title="دمغة الكشف"></td>
    <td class="daily-row-total fw-bold text-nowrap text-center"></td>
    <td class="daily-col-action text-center"><button type="button" class="btn btn-sm btn-outline-danger daily-row-delete" title="حذف">×</button></td>`;

  bindExamRowEvents(tr);
  tr.querySelector('.daily-row-delete')?.addEventListener('click', () => deleteDailyEntryRow(tr));
  if (typeof bindCommaAmountInputs === 'function') bindCommaAmountInputs(tr);
  const rowDoctorId =
    tr.dataset.doctorId || entry.doctor_id || line.doctor_id || '';
  void hydrateDailyDoctorSuggest(tr, rowDoctorId || null);
  const caseSel = tr.querySelector('.daily-exam-case');
  if (caseSel && caseServiceId) caseSel.value = caseServiceId;
  if (!priceVal) syncExamRowUnitPriceFromSelections(tr);
  updateRowTotal(tr);
  return tr;
}

function getDailyInvoiceDisplayLabel() {
  const inv = dailyStayContext?.invoice;
  if (!inv) return '—';
  return inv.serial_number || `#${inv.id}`;
}

function getDailyPatientDisplayName() {
  return dailyStayContext?.patient?.name || dailyStayContext?.invoice?.patient_name || '—';
}

function calcInclusiveDaysBetween(fromStr, toStr) {
  if (!fromStr || !toStr) return 0;
  const from = new Date(`${fromStr}T00:00:00`);
  const to = new Date(`${toStr}T00:00:00`);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to < from) return 0;
  return Math.floor((to - from) / 86400000) + 1;
}

function updateLetterAuthorizedDaysDisplay() {
  const out = document.getElementById('patient-reg-letter-days');
  if (!out) return;
  const from = document.getElementById('patient-reg-letter-from')?.value || '';
  const to = document.getElementById('patient-reg-letter-to')?.value || '';
  const days = calcInclusiveDaysBetween(from, to);
  out.value = days > 0 ? String(days) : '';
}

function getDailyInvoiceTypeLabel(code) {
  const key = String(code || '').trim();
  return DAILY_INVOICE_TYPE_LABELS[key] || key || '—';
}

function isGenericEntityFinancialLabel(text) {
  const t = String(text || '').trim();
  return /جهات?\s*(متعاقد|غير\s*متعاقد)/i.test(t);
}

function formatFinancialTreatmentDisplay(inv = {}, patient = {}) {
  const financial = String(inv.financial_treatment || patient.financial_treatment || '—').trim() || '—';
  const entityName = String(inv.contracted_entity_name || '').trim();
  const invoiceType = String(inv.invoice_type || '').trim();
  if (!entityName || !isEntityInvoiceType(invoiceType)) return financial;
  if (financial.includes(entityName)) return financial;
  const typeLabel = getDailyInvoiceTypeLabel(invoiceType);
  if (isGenericEntityFinancialLabel(financial) || financial === typeLabel || financial === '—') {
    return `${typeLabel} — ${entityName}`;
  }
  return financial;
}

function updateDailyClinicalContextBar() {
  const bar = document.getElementById('daily-clinical-context-bar');
  if (!bar) return;
  if (!DAILY_CLINICAL_TABS.includes(activeDailyTab) || !dailyStayContext?.invoice?.id) {
    bar.classList.add('d-none');
    bar.textContent = '';
    return;
  }
  const inv = dailyStayContext.invoice || {};
  const p = dailyStayContext.patient || {};
  const patientType = p.patient_type === 'external' ? 'خارجي' : 'داخلي';
  const invoiceType = getDailyInvoiceTypeLabel(inv.invoice_type);
  const entity =
    inv.contracted_entity_name ||
    document.getElementById('patient-reg-entity')?.selectedOptions?.[0]?.text?.trim() ||
    document.getElementById('daily-stay-entity')?.selectedOptions?.[0]?.text?.trim() ||
    '';
  const financial = inv.financial_treatment || p.financial_treatment || '';
  const parts = [`نوع المريض: ${patientType}`];
  const entityInvoice = isEntityInvoiceType(inv.invoice_type);
  const hasEntity = entity && entity !== '-- اختر الجهة --';
  if (entityInvoice && hasEntity) {
    const entityLabel =
      inv.invoice_type === 'non_contracted' ? 'الجهة غير المتعاقدة' : 'الجهة المتعاقدة';
    parts.push(`${entityLabel}: ${entity}`);
  } else {
    parts.push(`التعامل: ${invoiceType}`);
  }
  const showFinancial =
    financial &&
    !(entityInvoice && (isGenericEntityFinancialLabel(financial) || financial === invoiceType));
  if (showFinancial) parts.push(`المعاملة المالية: ${financial}`);
  bar.textContent = parts.join(' · ');
  bar.classList.remove('d-none');
}

function parseSessionsDetail(extraText) {
  if (!extraText) return { morning: 0, evening: 0 };
  const s = String(extraText).trim();
  try {
    const parsed = JSON.parse(s);
    if (parsed && typeof parsed === 'object') {
      return {
        morning: Number(parsed.morning) || 0,
        evening: Number(parsed.evening) || 0,
      };
    }
  } catch (_) {
    /* legacy text */
  }
  const pipe = s.match(/^(\d+)\s*[|،,/]\s*(\d+)$/);
  if (pipe) {
    return { morning: Number(pipe[1]) || 0, evening: Number(pipe[2]) || 0 };
  }
  return { morning: 0, evening: 0 };
}

function formatSessionsDetail(morning, evening) {
  return JSON.stringify({
    morning: Number(morning) || 0,
    evening: Number(evening) || 0,
  });
}

function parseSessionsShiftForRow(line = {}, detailLine = {}) {
  const fromLine = parseSessionsDetail(line.extra_text);
  if (fromLine.morning > 0 || fromLine.evening > 0) return fromLine;
  return parseSessionsDetail(detailLine.extra_text);
}

function syncSessionsRowDisplay(tr, item, unitPrice, opts = {}) {
  if (!tr) return;
  const qtyEl = tr.querySelector('.daily-session-qty');
  let qty = dailyParseAmount(qtyEl?.value);
  if (!opts.skipQtyAuto) {
    const morning = dailyParseAmount(tr.querySelector('.daily-session-morning')?.value);
    const evening = dailyParseAmount(tr.querySelector('.daily-session-evening')?.value);
    if (morning > 0 || evening > 0) {
      qty = morning + evening;
      if (qtyEl) qtyEl.value = formatAmountFieldValue(qty, 0);
    }
  }
  const unit =
    Number(unitPrice) ||
    (item?.price != null ? Number(item.price) : 0) ||
    getCatalogRowUnitPrice(tr, 'sessions') ||
    0;
  if (!qty && unit > 0) qty = 1;
  const total = unit > 0 && qty > 0 ? Math.round(unit * qty * 100) / 100 : 0;
  const unitEl = tr.querySelector('.daily-session-unit');
  if (unitEl) unitEl.value = unit > 0 ? formatAmountFieldValue(unit) : '';
  const totalEl = tr.querySelector('.daily-session-total');
  if (totalEl) totalEl.value = total > 0 ? formatAmountFieldValue(total) : '';
  const hidden = tr.querySelector('.daily-field.daily-amount[data-section="sessions"]');
  if (hidden) {
    hidden.value = String(total);
    hidden.dataset.unitPrice = String(unit);
    hidden.dataset.manualAmount = '0';
  }
  updateRowTotal(tr);
  updateDailyGrandTotal();
  updateSectionTabTotal();
}

function bindSessionsRowEvents(tr) {
  const onShiftChange = () => {
    const picker = tr.querySelector('.daily-picker[data-section="sessions"]');
    syncSessionsRowDisplay(tr, picker?._selectedItem);
  };
  tr.querySelector('.daily-session-morning')?.addEventListener('input', onShiftChange);
  tr.querySelector('.daily-session-evening')?.addEventListener('input', onShiftChange);
  tr.querySelector('.daily-session-qty')?.addEventListener('input', () => {
    const picker = tr.querySelector('.daily-picker[data-section="sessions"]');
    syncSessionsRowDisplay(tr, picker?._selectedItem, null, { skipQtyAuto: true });
  });
  bindDailyAmountRecalc(tr);
}

function createSessionsRow(entry = {}, sessionsLine = null) {
  const line = sessionsLine || serviceLinesFromEntry(entry, 'sessions')[0] || {};
  const dateLine = getLineForSection(entry, 'sessions_date');
  const detailLine = getLineForSection(entry, 'sessions_detail');
  const section = dailySectionsCache.find((s) => s.code === 'sessions');
  const tr = document.createElement('tr');
  tr.className = 'daily-entry-row daily-session-row';
  if (entry.id) tr.dataset.entryId = entry.id;
  if (entry.notes) tr.dataset.entryNotes = entry.notes;
  if (line.service_id) tr.dataset.serviceId = String(line.service_id);
  if (line.id) tr.dataset.lineId = String(line.id);
  if (dateLine.id) tr.dataset.dateLineId = String(dateLine.id);
  if (detailLine.id) tr.dataset.detailLineId = String(detailLine.id);
  tr._entryLinesSnapshot = dailyRowSnapshotExcluding(entry, line, [
    'sessions',
    'sessions_date',
    'sessions_detail',
  ]);

  const { morning, evening } = parseSessionsShiftForRow(line, detailLine);
  const morningVal = morning > 0 ? formatAmountFieldValue(morning, 0) : '';
  const eveningVal = evening > 0 ? formatAmountFieldValue(evening, 0) : '';
  const qtyVal =
    line.quantity != null && line.quantity !== ''
      ? formatAmountFieldValue(line.quantity, 0)
      : morning + evening > 0
        ? formatAmountFieldValue(morning + evening, 0)
        : '';
  const dateVal = dateLine.extra_date
    ? String(dateLine.extra_date).slice(0, 10)
    : entry.entry_date
      ? String(entry.entry_date).slice(0, 10)
      : getLocalDateString();
  const patientName = getDailyPatientDisplayName();
  const unitVal =
    line.unit_price > 0
      ? formatAmountFieldValue(line.unit_price)
      : line.quantity && line.amount
        ? formatAmountFieldValue(Number(line.amount) / Number(line.quantity))
        : '';
  const totalVal = line.amount > 0 ? formatAmountFieldValue(line.amount) : '';

  tr.innerHTML = `
    ${dailyRowSerialCellHtml(resolveDailyRowSerial(entry, line))}
    <td><input type="date" class="form-control form-control-sm daily-session-date" value="${dailyEscapeAttr(dateVal)}" autocomplete="off"></td>
    <td><input type="text" class="form-control form-control-sm daily-session-patient bg-light" readonly value="${dailyEscapeAttr(patientName)}"></td>
    <td class="daily-session-type-cell">${section ? buildCatalogPickerCell(section) : ''}
      <input type="hidden" class="daily-field daily-amount" data-section="sessions" data-type="amount"></td>
    <td><input type="text" inputmode="decimal" class="form-control form-control-sm daily-session-morning comma-amount" data-decimals="0" value="${dailyEscapeAttr(morningVal)}" autocomplete="off"></td>
    <td><input type="text" inputmode="decimal" class="form-control form-control-sm daily-session-evening comma-amount" data-decimals="0" value="${dailyEscapeAttr(eveningVal)}" autocomplete="off"></td>
    <td><input type="text" inputmode="decimal" class="form-control form-control-sm daily-session-qty comma-amount" data-decimals="0" value="${dailyEscapeAttr(qtyVal)}" autocomplete="off"></td>
    <td><input type="text" class="form-control form-control-sm daily-session-unit bg-light" readonly value="${dailyEscapeAttr(unitVal)}"></td>
    <td><input type="text" class="form-control form-control-sm daily-session-total bg-light" readonly value="${dailyEscapeAttr(totalVal)}"></td>
    <td class="daily-col-action text-center"><button type="button" class="btn btn-sm btn-outline-danger daily-row-delete" title="حذف">×</button></td>`;

  bindSessionsRowEvents(tr);
  tr.querySelector('.daily-row-delete')?.addEventListener('click', () => deleteDailyEntryRow(tr));
  if (section && window.DailyEntryPicker) {
    DailyEntryPicker.bindRow(tr);
    DailyEntryPicker.hydratePicker(tr, section, line);
    if (!totalVal) {
      syncSessionsRowDisplay(
        tr,
        null,
        Number(line.unit_price) ||
          (line.quantity ? Number(line.amount) / Number(line.quantity) : 0)
      );
    }
  }
  if (typeof bindCommaAmountInputs === 'function') bindCommaAmountInputs(tr);
  return tr;
}

function collectSessionsLinesFromRow(tr) {
  const tabCodes = new Set(['sessions_date', 'sessions_detail', 'sessions']);
  const snapshot = tr._entryLinesSnapshot || [];
  const preserved = snapshot.filter((l) => !tabCodes.has(l.section_code) && lineHasChargeData(l));
  const lines = [...preserved];

  const dateEl = tr.querySelector('.daily-session-date');
  if (dateEl?.value) {
    const dateLineOut = { section_code: 'sessions_date', extra_date: dateEl.value };
    if (tr.dataset.dateLineId) dateLineOut.id = Number(tr.dataset.dateLineId);
    lines.push(dateLineOut);
  }

  const morning = dailyParseAmount(tr.querySelector('.daily-session-morning')?.value);
  const evening = dailyParseAmount(tr.querySelector('.daily-session-evening')?.value);

  const section = dailySectionsCache.find((s) => s.code === 'sessions');
  if (section) {
    const pickerFields = window.DailyEntryPicker ? DailyEntryPicker.readPickerFields(tr, section) : {};
    let qty = dailyParseAmount(tr.querySelector('.daily-session-qty')?.value);
    if (!(qty > 0)) qty = morning + evening;
    if (!(qty > 0)) qty = 1;
    const amount = dailyParseAmount(tr.querySelector('.daily-session-total')?.value);
    const unit = dailyParseAmount(tr.querySelector('.daily-session-unit')?.value);
    const chargeLine = {
      section_code: 'sessions',
      catalog_item_id: pickerFields.catalog_item_id ?? null,
      service_id: pickerFields.service_id ?? null,
      amount,
      quantity: qty,
    };
    if (morning > 0 || evening > 0) {
      chargeLine.extra_text = formatSessionsDetail(morning, evening);
    }
    if (tr.dataset.lineId) chargeLine.id = Number(tr.dataset.lineId);
    if (unit > 0) chargeLine.unit_price = unit;
    if (lineHasChargeData(chargeLine)) lines.push(chargeLine);
  }
  return lines;
}

function catalogLinesFromEntry(entry, sectionCodes) {
  const codes = Array.isArray(sectionCodes) ? sectionCodes : [sectionCodes];
  return dedupeLinesByMergeKey(
    (entry.lines || []).filter((l) => codes.includes(l.section_code) && lineHasChargeData(l))
  );
}

function getCatalogRowUnitPrice(tr, sectionCode) {
  if (window.DailyEntryPicker?.getUnitPriceForSection) {
    return DailyEntryPicker.getUnitPriceForSection(tr, sectionCode);
  }
  const amountInput = tr.querySelector(`.daily-amount[data-section="${sectionCode}"]`);
  return Number(amountInput?.dataset.unitPrice) || 0;
}

function syncMedicineRowDisplay(tr, item, unitPrice) {
  if (!tr) return;
  const qty = dailyParseAmount(tr.querySelector('.daily-catalog-qty[data-section="medicines"]')?.value) || 1;
  const unit = Number(unitPrice) || getCatalogRowUnitPrice(tr, 'medicines') || 0;
  const total = Math.round(unit * qty * 100) / 100;
  const unitEl = tr.querySelector('.daily-med-unit-price');
  if (unitEl) {
    unitEl.value = unit > 0 ? formatAmountFieldValue(unit) : '';
    unitEl.dataset.raw = String(unit);
  }
  const totalEl = tr.querySelector('.daily-med-total');
  if (totalEl) totalEl.value = total > 0 ? formatAmountFieldValue(total) : '';
  const hidden = tr.querySelector('.daily-field.daily-amount[data-section="medicines"]');
  if (hidden) {
    hidden.value = String(total);
    hidden.dataset.unitPrice = String(unit);
    hidden.dataset.manualAmount = '0';
  }
  updateRowTotal(tr);
  updateDailyGrandTotal();
  updateSectionTabTotal();
}

function calcSupplyMarkupPercent(costUnit, sellUnit, fallback = 0) {
  const fb = Number(fallback) || 0;
  if (fb > 0) return Math.round(fb * 100) / 100;
  const cost = Number(costUnit) || 0;
  const sell = Number(sellUnit) || 0;
  if (cost <= 0 || sell <= 0) return 0;
  return Math.round(((sell - cost) / cost) * 10000) / 100;
}

function calcSupplySellUnit(costUnit, fallbackSell = 0) {
  const cost = Number(costUnit) || 0;
  const markup = Number(dailySuppliesMarkupPercent) || 0;
  if (cost > 0 && markup >= 0) {
    return Math.round(cost * (1 + markup / 100) * 100) / 100;
  }
  return Number(fallbackSell) || 0;
}

function syncSupplyRowDisplay(tr, item, unitPrice) {
  if (!tr) return;
  const sectionCode = tr.dataset.sectionCode || 'supplies';
  const qty =
    dailyParseAmount(tr.querySelector(`.daily-catalog-qty[data-section="${sectionCode}"]`)?.value) || 1;
  const costUnit = Number(item?.cost_price) || Number(tr.dataset.costPrice) || 0;
  const catalogSell = Number(unitPrice) || Number(tr.dataset.sellUnit) || getCatalogRowUnitPrice(tr, sectionCode) || 0;
  const sellUnit = calcSupplySellUnit(costUnit, catalogSell);
  const costTotal = Math.round(costUnit * qty * 100) / 100;
  const sellTotal = Math.round(sellUnit * qty * 100) / 100;
  const markupPct = Number(dailySuppliesMarkupPercent) || 0;
  tr.dataset.costPrice = String(costUnit);
  tr.dataset.sellUnit = String(sellUnit);
  tr.dataset.markupPercent = String(markupPct);
  if (item?.code) tr.dataset.catalogCode = item.code;
  const costUnitEl = tr.querySelector('.daily-sup-cost-unit');
  if (costUnitEl) costUnitEl.value = costUnit > 0 ? formatAmountFieldValue(costUnit) : '';
  const costTotalEl = tr.querySelector('.daily-sup-cost-total');
  if (costTotalEl) costTotalEl.value = costTotal > 0 ? formatAmountFieldValue(costTotal) : '';
  const sellUnitEl = tr.querySelector('.daily-sup-sell-unit');
  if (sellUnitEl) sellUnitEl.value = sellUnit > 0 ? formatAmountFieldValue(sellUnit) : '';
  const sellTotalEl = tr.querySelector('.daily-sup-sell-total');
  if (sellTotalEl) sellTotalEl.value = sellTotal > 0 ? formatAmountFieldValue(sellTotal) : '';
  const hidden = tr.querySelector(`.daily-field.daily-amount[data-section="${sectionCode}"]`);
  if (hidden) {
    hidden.value = String(sellTotal);
    hidden.dataset.unitPrice = String(sellUnit);
    hidden.dataset.manualAmount = '0';
  }
  updateRowTotal(tr);
  updateDailyGrandTotal();
  updateSectionTabTotal();
}

function clearMedicineRowDisplay(tr) {
  ['.daily-med-unit-price', '.daily-med-total'].forEach((sel) => {
    const el = tr.querySelector(sel);
    if (el) el.value = '';
  });
  tr.dataset.catalogCode = '';
}

function clearSupplyRowDisplay(tr) {
  const sectionCode = tr.dataset.sectionCode || 'supplies';
  const dateEl = tr.querySelector('.daily-sup-date');
  if (dateEl) dateEl.value = getLocalDateString();
  ['.daily-sup-cost-unit', '.daily-sup-cost-total', '.daily-sup-sell-unit', '.daily-sup-sell-total'].forEach(
    (sel) => {
      const el = tr.querySelector(sel);
      if (el) el.value = '';
    }
  );
  tr.dataset.costPrice = '';
  tr.dataset.sellUnit = '';
  tr.dataset.markupPercent = '';
  tr.dataset.catalogCode = '';
  const hidden = tr.querySelector(`.daily-field.daily-amount[data-section="${sectionCode}"]`);
  if (hidden) {
    hidden.value = '';
    hidden.dataset.unitPrice = '';
  }
}

function bindMedicineRowEvents(tr) {
  const qtyInput = tr.querySelector('.daily-catalog-qty[data-section="medicines"]');
  if (qtyInput) {
    qtyInput.addEventListener('input', () => {
      const picker = tr.querySelector('.daily-picker[data-section="medicines"]');
      syncMedicineRowDisplay(tr, picker?._selectedItem, getCatalogRowUnitPrice(tr, 'medicines'));
    });
  }
  bindDailyAmountRecalc(tr);
}

function bindSupplyRowEvents(tr) {
  const sectionCode = tr.dataset.sectionCode || 'supplies';
  const qtyInput = tr.querySelector(`.daily-catalog-qty[data-section="${sectionCode}"]`);
  if (qtyInput) {
    qtyInput.addEventListener('input', () => {
      const picker = tr.querySelector(`.daily-picker[data-section="${sectionCode}"]`);
      syncSupplyRowDisplay(tr, picker?._selectedItem, getCatalogRowUnitPrice(tr, sectionCode));
    });
  }
  bindDailyAmountRecalc(tr);
}

function buildCatalogPickerCell(section) {
  if (!window.DailyEntryPicker) return '<small class="text-muted">البحث غير متاح</small>';
  const line = {};
  return DailyEntryPicker.buildCellHtml(section, line);
}

function createMedicineCatalogRow(entry = {}, catalogLine = null) {
  const line =
    catalogLine ||
    (entry.lines || []).find((l) => l.section_code === 'medicines' && lineHasChargeData(l)) ||
    {};
  const section = dailySectionsCache.find((s) => s.code === 'medicines');
  const tr = document.createElement('tr');
  tr.className = 'daily-entry-row daily-med-row';
  if (entry.id) tr.dataset.entryId = entry.id;
  if (entry.notes) tr.dataset.entryNotes = entry.notes;
  if (line.catalog_item_code) tr.dataset.catalogCode = line.catalog_item_code;
  if (line.id) tr.dataset.lineId = String(line.id);
  tr._entryLinesSnapshot = dailyRowSnapshotExcluding(entry, line, ['medicines']);

  const qtyVal = line.quantity != null && line.quantity !== '' ? formatAmountFieldValue(line.quantity, 0) : '1';
  const invoiceLabel = getDailyInvoiceDisplayLabel();
  const serialVal = line.catalog_item_code || '';
  const weightVal = line.weight != null && line.weight !== '' ? formatAmountFieldValue(line.weight) : '';
  const dateVal = line.extra_date
    ? String(line.extra_date).slice(0, 10)
    : entry.entry_date
      ? String(entry.entry_date).slice(0, 10)
      : getLocalDateString();

  tr.innerHTML = `
    ${dailyRowSerialCellHtml(resolveDailyRowSerial(entry, line))}
    <td><input type="text" class="form-control form-control-sm daily-med-invoice bg-light" readonly value="${dailyEscapeAttr(invoiceLabel)}"></td>
    <td><input type="date" class="form-control form-control-sm daily-med-date" value="${dailyEscapeAttr(dateVal)}" autocomplete="off"></td>
    <td class="daily-med-name-cell">${section ? buildCatalogPickerCell(section) : ''}
      <input type="hidden" class="daily-field daily-amount" data-section="medicines" data-type="amount"></td>
    <td><input type="text" inputmode="decimal" class="form-control form-control-sm daily-catalog-qty comma-amount" data-section="medicines" data-decimals="0" value="${dailyEscapeAttr(qtyVal)}" autocomplete="off"></td>
    <td class="daily-med-unit-cell">
      <select class="form-select form-select-sm daily-catalog-unit" data-section="medicines">
        <option value="">— اختر الوحدة —</option>
      </select>
    </td>
    <td><input type="text" inputmode="decimal" class="form-control form-control-sm daily-weight comma-amount" data-section="medicines" value="${dailyEscapeAttr(weightVal)}" autocomplete="off"></td>
    <td><input type="text" class="form-control form-control-sm daily-med-unit-price bg-light" readonly></td>
    <td><input type="text" class="form-control form-control-sm daily-med-total bg-light" readonly></td>
    <td class="daily-col-action text-center"><button type="button" class="btn btn-sm btn-outline-danger daily-row-delete" title="حذف">×</button></td>`;

  bindMedicineRowEvents(tr);
  tr.querySelector('.daily-row-delete')?.addEventListener('click', () => deleteDailyEntryRow(tr));
  if (section && window.DailyEntryPicker) {
    DailyEntryPicker.bindRow(tr);
    DailyEntryPicker.hydratePicker(tr, section, line);
    if (line.unit_price || line.amount) {
      syncMedicineRowDisplay(
        tr,
        null,
        Number(line.unit_price) || (line.quantity ? Number(line.amount) / Number(line.quantity) : 0)
      );
    }
  }
  if (typeof bindCommaAmountInputs === 'function') bindCommaAmountInputs(tr);
  return tr;
}

function createSupplyCatalogRow(entry = {}, catalogLine = null, defaultSectionCode = 'supplies') {
  const line =
    catalogLine ||
    catalogLinesFromEntry(entry, ['supplies', 'cosmetics'])[0] ||
    {};
  const sectionCode = line.section_code || defaultSectionCode;
  const section = dailySectionsCache.find((s) => s.code === sectionCode);
  const tr = document.createElement('tr');
  tr.className = 'daily-entry-row daily-sup-row';
  tr.dataset.sectionCode = sectionCode;
  if (entry.id) tr.dataset.entryId = entry.id;
  if (entry.notes) tr.dataset.entryNotes = entry.notes;
  if (line.catalog_item_code) tr.dataset.catalogCode = line.catalog_item_code;
  if (line.cost_price != null) tr.dataset.costPrice = String(line.cost_price);
  if (line.markup_percent != null) tr.dataset.markupPercent = String(line.markup_percent);
  if (line.id) tr.dataset.lineId = String(line.id);
  tr._entryLinesSnapshot = dailyRowSnapshotExcluding(entry, line, ['supplies', 'cosmetics']);

  const qtyVal = line.quantity != null && line.quantity !== '' ? formatAmountFieldValue(line.quantity, 0) : '1';
  const invoiceLabel = getDailyInvoiceDisplayLabel();
  const serialVal = line.catalog_item_code || '';
  const dateVal = line.extra_date
    ? String(line.extra_date).slice(0, 10)
    : entry.entry_date
      ? String(entry.entry_date).slice(0, 10)
      : getLocalDateString();

  tr.innerHTML = `
    ${dailyRowSerialCellHtml(resolveDailyRowSerial(entry, line))}
    <td><input type="date" class="form-control form-control-sm daily-sup-date" value="${dailyEscapeAttr(dateVal)}" autocomplete="off"></td>
    <td><input type="text" class="form-control form-control-sm daily-sup-invoice bg-light" readonly value="${dailyEscapeAttr(invoiceLabel)}"></td>
    <td class="daily-sup-name-cell">
      <div class="daily-sup-name-unit-row d-flex flex-wrap align-items-center gap-1">
        <div class="flex-grow-1 min-w-0">${section ? buildCatalogPickerCell(section) : ''}</div>
        <select class="form-select form-select-sm daily-catalog-unit daily-sup-unit-select" data-section="${dailyEscapeAttr(sectionCode)}" style="display:none">
          <option value="">— الوحدة —</option>
        </select>
      </div>
      <input type="hidden" class="daily-field daily-amount" data-section="${dailyEscapeAttr(sectionCode)}" data-type="amount"></td>
    <td><input type="text" inputmode="decimal" class="form-control form-control-sm daily-catalog-qty comma-amount" data-section="${dailyEscapeAttr(sectionCode)}" data-decimals="0" value="${dailyEscapeAttr(qtyVal)}" autocomplete="off"></td>
    <td><input type="text" class="form-control form-control-sm daily-sup-sell-unit bg-light" readonly></td>
    <td><input type="text" class="form-control form-control-sm daily-sup-sell-total bg-light" readonly></td>
    <td><input type="text" class="form-control form-control-sm daily-sup-cost-unit bg-light" readonly></td>
    <td><input type="text" class="form-control form-control-sm daily-sup-cost-total bg-light" readonly></td>
    <td class="daily-col-action text-center"><button type="button" class="btn btn-sm btn-outline-danger daily-row-delete" title="حذف">×</button></td>`;

  bindSupplyRowEvents(tr);
  tr.querySelector('.daily-row-delete')?.addEventListener('click', () => deleteDailyEntryRow(tr));
  if (section && window.DailyEntryPicker) {
    DailyEntryPicker.bindRow(tr);
    DailyEntryPicker.hydratePicker(tr, section, line);
    syncSupplyRowDisplay(
      tr,
      {
        code: line.catalog_item_code,
        cost_price: line.cost_price,
        markup_percent: line.markup_percent,
      },
      Number(line.unit_price) || (line.quantity ? Number(line.amount) / Number(line.quantity) : 0)
    );
  }
  if (typeof bindCommaAmountInputs === 'function') bindCommaAmountInputs(tr);
  return tr;
}

function collectMedicineLinesFromRow(tr) {
  const section = dailySectionsCache.find((s) => s.code === 'medicines');
  if (!section) return [];
  const line = collectLineForSection(tr, section);
  const dateEl = tr.querySelector('.daily-med-date');
  if (dateEl?.value) line.extra_date = dateEl.value;
  const snapshot = tr._entryLinesSnapshot || [];
  const preserved = snapshot.filter((l) => l.section_code !== 'medicines' && lineHasChargeData(l));
  if (!lineHasChargeData(line)) return preserved;
  return [...preserved, line];
}

function collectSupplyLinesFromRow(tr) {
  const sectionCode = tr.dataset.sectionCode || 'supplies';
  const section = dailySectionsCache.find((s) => s.code === sectionCode);
  if (!section) return [];
  const line = collectLineForSection(tr, section);
  const costUnit = dailyParseAmount(tr.querySelector('.daily-sup-cost-unit')?.value);
  const sellUnit = dailyParseAmount(tr.querySelector('.daily-sup-sell-unit')?.value);
  if (costUnit > 0) line.cost_price = costUnit;
  if (dailySuppliesMarkupPercent > 0) line.markup_percent = dailySuppliesMarkupPercent;
  if (sellUnit > 0) line.unit_price = sellUnit;
  const dateEl = tr.querySelector('.daily-sup-date');
  if (dateEl?.value) line.extra_date = dateEl.value;
  const snapshot = tr._entryLinesSnapshot || [];
  const preserved = snapshot.filter(
    (l) => !['supplies', 'cosmetics'].includes(l.section_code) && lineHasChargeData(l)
  );
  if (!lineHasChargeData(line)) return preserved;
  return [...preserved, line];
}

function serviceLinesFromEntry(entry, mainSectionCode) {
  return dedupeLinesByMergeKey(
    (entry.lines || []).filter((l) => l.section_code === mainSectionCode && lineHasChargeData(l))
  );
}

function syncSimpleServiceRow(tr, item, unitPrice, mainSection, ui) {
  if (!tr) return;
  const qty = dailyParseAmount(tr.querySelector(`.daily-catalog-qty[data-section="${mainSection}"]`)?.value) || 1;
  const unit = Number(unitPrice) || getCatalogRowUnitPrice(tr, mainSection) || 0;
  const total = Math.round(unit * qty * 100) / 100;
  if (item?.code) tr.dataset.serviceCode = item.code;
  const unitEl = tr.querySelector(ui.unit);
  if (unitEl) {
    unitEl.value = unit > 0 ? formatAmountFieldValue(unit) : '';
    unitEl.dataset.raw = String(unit);
  }
  const totalEl = tr.querySelector(ui.total);
  if (totalEl) totalEl.value = total > 0 ? formatAmountFieldValue(total) : '';
  const hidden = tr.querySelector(`.daily-field.daily-amount[data-section="${mainSection}"]`);
  if (hidden) {
    hidden.value = String(total);
    hidden.dataset.unitPrice = String(unit);
    hidden.dataset.manualAmount = '0';
  }
  refreshServiceRowTotals(tr);
}

function refreshServiceRowTotals(tr) {
  if (tr?.classList?.contains('daily-exam-row')) {
    updateRowTotal(tr);
    updateDailyGrandTotal();
    updateSectionTabTotal();
    return;
  }
  updateRowTotal(tr);
  updateDailyGrandTotal();
  updateSectionTabTotal();
}

function getLabRowGrandTotal(tr) {
  return (
    dailyParseAmount(tr.querySelector('.daily-lab-total')?.value) +
    dailyParseAmount(tr.querySelector('.daily-lab-stamp')?.value)
  );
}

function getRadRowGrandTotal(tr) {
  return (
    dailyParseAmount(tr.querySelector('.daily-rad-total')?.value) +
    dailyParseAmount(tr.querySelector('.daily-rad-stamp')?.value)
  );
}

function getExamRowGrandTotal(tr) {
  return (
    dailyParseAmount(tr.querySelector('.daily-exam-unit-price')?.value) +
    dailyParseAmount(tr.querySelector('.daily-exam-stamp')?.value)
  );
}

function bindLabRowEvents(tr) {
  tr.querySelector('.daily-lab-stamp')?.addEventListener('input', refreshServiceRowTotals);
  tr.querySelector('.daily-lab-date')?.addEventListener('change', refreshServiceRowTotals);
  bindDailyAmountRecalc(tr);
}

function bindRadRowEvents(tr) {
  tr.querySelector('.daily-rad-stamp')?.addEventListener('input', refreshServiceRowTotals);
  tr.querySelector('.daily-rad-date')?.addEventListener('change', refreshServiceRowTotals);
  bindDailyAmountRecalc(tr);
}

function bindMiscRowEvents(tr) {
  const sectionCode = tr.dataset.sectionCode || 'other';
  tr.querySelector(`.daily-catalog-qty[data-section="${sectionCode}"]`)?.addEventListener('input', () => {
    const picker = tr.querySelector(`.daily-picker[data-section="${sectionCode}"]`);
    syncSimpleServiceRow(tr, picker?._selectedItem, getCatalogRowUnitPrice(tr, sectionCode), sectionCode, {
      unit: '.daily-misc-unit-price',
      total: '.daily-misc-total',
    });
  });
  bindDailyAmountRecalc(tr);
}

function createLabRow(entry = {}, analysisLine = null) {
  const line = analysisLine || serviceLinesFromEntry(entry, 'analyses')[0] || {};
  const stampLine = getLineForSection(entry, 'analyses_stamp');
  const section = dailySectionsCache.find((s) => s.code === 'analyses');
  const tr = document.createElement('tr');
  tr.className = 'daily-entry-row daily-lab-row';
  if (entry.id) tr.dataset.entryId = entry.id;
  if (entry.notes) tr.dataset.entryNotes = entry.notes;
  if (line.service_id) tr.dataset.serviceCode = String(line.service_id);
  if (line.id) tr.dataset.lineId = String(line.id);
  if (stampLine.id) tr.dataset.stampLineId = String(stampLine.id);
  tr._entryLinesSnapshot = dailyRowSnapshotExcluding(entry, line, ['analyses', 'analyses_stamp']);

  const qtyVal = line.quantity != null && line.quantity !== '' ? formatAmountFieldValue(line.quantity, 0) : '1';
  const stampVal = stampLine.amount > 0 ? formatAmountFieldValue(stampLine.amount) : '';
  const dateVal = line.extra_date
    ? String(line.extra_date).slice(0, 10)
    : entry.entry_date
      ? String(entry.entry_date).slice(0, 10)
      : getLocalDateString();

  tr.innerHTML = `
    ${dailyRowSerialCellHtml(resolveDailyRowSerial(entry, line))}
    <td><input type="date" class="form-control form-control-sm daily-lab-date" value="${dailyEscapeAttr(dateVal)}" autocomplete="off"></td>
    <td class="daily-lab-name-cell">${section ? buildCatalogPickerCell(section) : ''}
      <input type="hidden" class="daily-catalog-qty" data-section="analyses" value="${dailyEscapeAttr(qtyVal)}">
      <input type="hidden" class="daily-field daily-amount" data-section="analyses" data-type="amount"></td>
    <td><input type="text" class="form-control form-control-sm daily-lab-unit-price bg-light" readonly></td>
    <td><input type="text" class="form-control form-control-sm daily-lab-total bg-light" readonly></td>
    <td><input type="text" inputmode="decimal" class="form-control form-control-sm daily-lab-stamp comma-amount" value="${dailyEscapeAttr(stampVal)}" autocomplete="off"></td>
    <td class="daily-col-action text-center"><button type="button" class="btn btn-sm btn-outline-danger daily-row-delete" title="حذف">×</button></td>`;

  bindLabRowEvents(tr);
  tr.querySelector('.daily-row-delete')?.addEventListener('click', () => deleteDailyEntryRow(tr));
  if (section && window.DailyEntryPicker) {
    DailyEntryPicker.bindRow(tr);
    DailyEntryPicker.hydratePicker(tr, section, line);
    syncSimpleServiceRow(
      tr,
      null,
      Number(line.unit_price) || (line.quantity ? Number(line.amount) / Number(line.quantity) : 0),
      'analyses',
      { unit: '.daily-lab-unit-price', total: '.daily-lab-total' }
    );
  }
  if (typeof bindCommaAmountInputs === 'function') bindCommaAmountInputs(tr);
  return tr;
}

function createRadiologyRow(entry = {}, xrayLine = null) {
  const line = xrayLine || serviceLinesFromEntry(entry, 'xray_total')[0] || {};
  const stampLine = getLineForSection(entry, 'xray_stamp');
  const typeLine = getLineForSection(entry, 'xray_type');
  const section = dailySectionsCache.find((s) => s.code === 'xray_total');
  const tr = document.createElement('tr');
  tr.className = 'daily-entry-row daily-rad-row';
  if (entry.id) tr.dataset.entryId = entry.id;
  if (entry.notes) tr.dataset.entryNotes = entry.notes;
  if (line.id) tr.dataset.lineId = String(line.id);
  if (stampLine.id) tr.dataset.stampLineId = String(stampLine.id);
  if (typeLine.id) tr.dataset.typeLineId = String(typeLine.id);
  tr._entryLinesSnapshot = dailyRowSnapshotExcluding(entry, line, [
    'xray_total',
    'xray_stamp',
    'xray_type',
  ]);

  const qtyVal = line.quantity != null && line.quantity !== '' ? formatAmountFieldValue(line.quantity, 0) : '1';
  const stampVal = stampLine.amount > 0 ? formatAmountFieldValue(stampLine.amount) : '';
  const dateVal = line.extra_date
    ? String(line.extra_date).slice(0, 10)
    : typeLine.extra_date
      ? String(typeLine.extra_date).slice(0, 10)
      : entry.entry_date
        ? String(entry.entry_date).slice(0, 10)
        : getLocalDateString();
  const unitVal =
    line.unit_price > 0
      ? formatAmountFieldValue(line.unit_price)
      : line.quantity && line.amount
        ? formatAmountFieldValue(Number(line.amount) / Number(line.quantity))
        : '';
  const totalVal = line.amount > 0 ? formatAmountFieldValue(line.amount) : '';

  tr.innerHTML = `
    ${dailyRowSerialCellHtml(resolveDailyRowSerial(entry, line))}
    <td class="daily-rad-name-cell">${section ? buildCatalogPickerCell(section) : ''}
      <input type="hidden" class="daily-catalog-qty" data-section="xray_total" value="${dailyEscapeAttr(qtyVal)}">
      <input type="hidden" class="daily-field daily-amount" data-section="xray_total" data-type="amount"></td>
    <td><input type="text" class="form-control form-control-sm daily-rad-unit-price bg-light" readonly value="${dailyEscapeAttr(unitVal)}"></td>
    <td><input type="text" class="form-control form-control-sm daily-rad-total bg-light" readonly value="${dailyEscapeAttr(totalVal)}"></td>
    <td><input type="date" class="form-control form-control-sm daily-rad-date" value="${dailyEscapeAttr(dateVal)}" autocomplete="off"></td>
    <td><input type="text" inputmode="decimal" class="form-control form-control-sm daily-rad-stamp comma-amount" value="${dailyEscapeAttr(stampVal)}" autocomplete="off"></td>
    <td class="daily-col-action text-center"><button type="button" class="btn btn-sm btn-outline-danger daily-row-delete" title="حذف">×</button></td>`;

  bindRadRowEvents(tr);
  tr.querySelector('.daily-row-delete')?.addEventListener('click', () => deleteDailyEntryRow(tr));
  if (section && window.DailyEntryPicker) {
    DailyEntryPicker.bindRow(tr);
    DailyEntryPicker.hydratePicker(tr, section, line);
    if (!totalVal) {
      syncSimpleServiceRow(
        tr,
        null,
        Number(line.unit_price) || (line.quantity ? Number(line.amount) / Number(line.quantity) : 0),
        'xray_total',
        { unit: '.daily-rad-unit-price', total: '.daily-rad-total' }
      );
    }
  }
  if (typeof bindCommaAmountInputs === 'function') bindCommaAmountInputs(tr);
  return tr;
}

function createMiscServiceRow(entry = {}, serviceLine = null, defaultSectionCode = 'other') {
  const line =
    serviceLine ||
    catalogLinesFromEntry(entry, ['other', 'prosthetics']).find((l) => l.section_code === defaultSectionCode) ||
    catalogLinesFromEntry(entry, ['other', 'prosthetics'])[0] ||
    {};
  const sectionCode = line.section_code || defaultSectionCode;
  const pickerSection = dailySectionsCache.find((s) => s.code === 'other');
  const tr = document.createElement('tr');
  tr.className = 'daily-entry-row daily-misc-row';
  tr.dataset.sectionCode = sectionCode;
  if (entry.id) tr.dataset.entryId = entry.id;
  if (entry.notes) tr.dataset.entryNotes = entry.notes;
  if (line.id) tr.dataset.lineId = String(line.id);
  tr._entryLinesSnapshot = dailyRowSnapshotExcluding(entry, line, ['other', 'prosthetics']);

  const qtyVal = line.quantity != null && line.quantity !== '' ? formatAmountFieldValue(line.quantity, 0) : '1';

  tr.innerHTML = `
    ${dailyRowSerialCellHtml(resolveDailyRowSerial(entry, line))}
    <td class="daily-misc-name-cell">${pickerSection ? buildCatalogPickerCell(pickerSection) : ''}
      <input type="hidden" class="daily-field daily-amount" data-section="other" data-type="amount"></td>
    <td><input type="text" inputmode="decimal" class="form-control form-control-sm daily-catalog-qty comma-amount" data-section="other" data-decimals="0" value="${dailyEscapeAttr(qtyVal)}" autocomplete="off"></td>
    <td><input type="text" class="form-control form-control-sm daily-misc-unit-price bg-light" readonly></td>
    <td><input type="text" class="form-control form-control-sm daily-misc-total bg-light" readonly></td>
    <td class="daily-col-action text-center"><button type="button" class="btn btn-sm btn-outline-danger daily-row-delete" title="حذف">×</button></td>`;

  bindMiscRowEvents(tr);
  tr.querySelector('.daily-row-delete')?.addEventListener('click', () => deleteDailyEntryRow(tr));
  if (pickerSection && window.DailyEntryPicker) {
    DailyEntryPicker.bindRow(tr);
    DailyEntryPicker.hydratePicker(tr, pickerSection, line);
    syncSimpleServiceRow(
      tr,
      null,
      Number(line.unit_price) || (line.quantity ? Number(line.amount) / Number(line.quantity) : 0),
      'other',
      { unit: '.daily-misc-unit-price', total: '.daily-misc-total' }
    );
  }
  if (typeof bindCommaAmountInputs === 'function') bindCommaAmountInputs(tr);
  return tr;
}

function collectLabLinesFromRow(tr) {
  const tabCodes = ['analyses', 'analyses_stamp'];
  const snapshot = tr._entryLinesSnapshot || [];
  const lines = snapshot.filter((l) => !tabCodes.includes(l.section_code) && lineHasChargeData(l));
  const section = dailySectionsCache.find((s) => s.code === 'analyses');
  if (section) {
    const mainLine = collectLineForSection(tr, section);
    const dateEl = tr.querySelector('.daily-lab-date');
    if (dateEl?.value) mainLine.extra_date = dateEl.value;
    if (lineHasChargeData(mainLine)) lines.push(mainLine);
  }
  const stamp = dailyParseAmount(tr.querySelector('.daily-lab-stamp')?.value);
  if (stamp > 0) {
    const stampLine = { section_code: 'analyses_stamp', amount: stamp, quantity: 1 };
    if (tr.dataset.stampLineId) stampLine.id = Number(tr.dataset.stampLineId);
    lines.push(stampLine);
  }
  return lines;
}

function collectRadiologyLinesFromRow(tr) {
  const tabCodes = ['xray_total', 'xray_stamp', 'xray_type'];
  const snapshot = tr._entryLinesSnapshot || [];
  const lines = snapshot.filter((l) => !tabCodes.includes(l.section_code) && lineHasChargeData(l));
  const section = dailySectionsCache.find((s) => s.code === 'xray_total');
  if (section) {
    const mainLine = collectLineForSection(tr, section);
    const dateEl = tr.querySelector('.daily-rad-date');
    if (dateEl?.value) mainLine.extra_date = dateEl.value;
    const picker = tr.querySelector('.daily-picker[data-section="xray_total"]');
    const typeName = picker?._selectedItem?.name || mainLine.extra_text || '';
    if (typeName) mainLine.extra_text = typeName;
    if (lineHasChargeData(mainLine)) lines.push(mainLine);
    if (typeName) {
      const typeLineOut = { section_code: 'xray_type', extra_text: typeName };
      if (tr.dataset.typeLineId) typeLineOut.id = Number(tr.dataset.typeLineId);
      lines.push(typeLineOut);
    }
  }
  const stamp = dailyParseAmount(tr.querySelector('.daily-rad-stamp')?.value);
  if (stamp > 0) {
    const stampLine = { section_code: 'xray_stamp', amount: stamp, quantity: 1 };
    if (tr.dataset.stampLineId) stampLine.id = Number(tr.dataset.stampLineId);
    lines.push(stampLine);
  }
  return lines;
}

function resolveMiscSectionCodeFromItem(item, fallback = 'other') {
  const cat = String(item?.category_name || item?.category || '').trim();
  if (cat === 'Prosthetics') return 'prosthetics';
  return fallback || 'other';
}

function collectMiscLinesFromRow(tr) {
  const tabCodes = ['other', 'prosthetics'];
  const pickerSection = dailySectionsCache.find((s) => s.code === 'other');
  if (!pickerSection) return tr._entryLinesSnapshot || [];
  const line = collectLineForSection(tr, pickerSection);
  const picker = tr.querySelector('.daily-picker[data-section="other"]');
  line.section_code = resolveMiscSectionCodeFromItem(picker?._selectedItem, 'other');
  const snapshot = tr._entryLinesSnapshot || [];
  const preserved = snapshot.filter((l) => !tabCodes.includes(l.section_code) && lineHasChargeData(l));
  if (!lineHasChargeData(line)) return preserved;
  return [...preserved, line];
}

function onDailyCatalogPickerApplied(tr, section, item) {
  if (!tr || !section) return;
  if (tr.classList.contains('daily-med-row')) {
    syncMedicineRowDisplay(tr, item, getCatalogRowUnitPrice(tr, 'medicines'));
  } else if (tr.classList.contains('daily-sup-row')) {
    syncSupplyRowDisplay(tr, item, getCatalogRowUnitPrice(tr, tr.dataset.sectionCode || section.code));
  } else if (tr.classList.contains('daily-session-row') && section.code === 'sessions') {
    syncSessionsRowDisplay(tr, item, getCatalogRowUnitPrice(tr, 'sessions'));
  } else if (tr.classList.contains('daily-lab-row') && section.code === 'analyses') {
    syncSimpleServiceRow(tr, item, getCatalogRowUnitPrice(tr, 'analyses'), 'analyses', {
      unit: '.daily-lab-unit-price',
      total: '.daily-lab-total',
    });
  } else if (tr.classList.contains('daily-rad-row') && section.code === 'xray_total') {
    syncSimpleServiceRow(tr, item, getCatalogRowUnitPrice(tr, 'xray_total'), 'xray_total', {
      unit: '.daily-rad-unit-price',
      total: '.daily-rad-total',
    });
  } else if (tr.classList.contains('daily-misc-row') && section.code === 'other') {
    const sectionCode = resolveMiscSectionCodeFromItem(item, 'other');
    tr.dataset.sectionCode = sectionCode;
    syncSimpleServiceRow(tr, item, getCatalogRowUnitPrice(tr, 'other'), 'other', {
      unit: '.daily-misc-unit-price',
      total: '.daily-misc-total',
    });
  }
}

function onDailyCatalogPickerCleared(tr, sectionCode) {
  if (!tr) return;
  if (tr.classList.contains('daily-med-row') && sectionCode === 'medicines') {
    clearMedicineRowDisplay(tr);
    updateRowTotal(tr);
    updateDailyGrandTotal();
    updateSectionTabTotal();
  } else if (tr.classList.contains('daily-sup-row') && sectionCode === tr.dataset.sectionCode) {
    clearSupplyRowDisplay(tr);
    updateRowTotal(tr);
    updateDailyGrandTotal();
    updateSectionTabTotal();
  } else if (tr.classList.contains('daily-session-row') && sectionCode === 'sessions') {
    const unitEl = tr.querySelector('.daily-session-unit');
    const totalEl = tr.querySelector('.daily-session-total');
    if (unitEl) unitEl.value = '';
    if (totalEl) totalEl.value = '';
    const hidden = tr.querySelector('.daily-field.daily-amount[data-section="sessions"]');
    if (hidden) {
      hidden.value = '';
      hidden.dataset.unitPrice = '';
    }
    updateRowTotal(tr);
    updateDailyGrandTotal();
    updateSectionTabTotal();
  }
}

window.onDailyCatalogPickerApplied = onDailyCatalogPickerApplied;
window.onDailyCatalogPickerCleared = onDailyCatalogPickerCleared;

function dailyEscapeAttr(text) {
  return String(text || '').replace(/"/g, '&quot;');
}

function getLineForSection(entry, sectionCode) {
  return (entry?.lines || []).find((line) => line.section_code === sectionCode) || {};
}

function getLinesForSection(entry, sectionCode) {
  return (entry?.lines || []).filter((line) => line.section_code === sectionCode);
}

function assignStayRowKey(tr) {
  if (!tr.dataset.stayRowKey) {
    tr.dataset.stayRowKey = `stay-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }
}

function findStayPrimaryRow(tr) {
  if (!tr) return null;
  if (tr.classList.contains('daily-stay-row')) return tr;
  const key = tr.dataset.stayParentKey;
  if (!key) return null;
  return document.querySelector(`.daily-stay-row[data-stay-row-key="${key}"]`);
}

function getStayDayGroupRows(primaryTr) {
  if (!primaryTr) return [];
  const rows = [primaryTr];
  const key = primaryTr.dataset.stayRowKey;
  if (!key) return rows;
  let next = primaryTr.nextElementSibling;
  while (
    next?.classList.contains('daily-stay-addon-row') &&
    next.dataset.stayParentKey === key
  ) {
    rows.push(next);
    next = next.nextElementSibling;
  }
  return rows;
}

function insertStayAddonRow(primaryTr, addonTr) {
  const group = getStayDayGroupRows(primaryTr);
  const last = group[group.length - 1];
  last.after(addonTr);
}

function stayAddonSpacerCell(className = '') {
  return `<td class="daily-stay-addon-spacer ${className}"></td>`;
}

function bindStayAddonRemove(tr) {
  tr.querySelector('.daily-stay-addon-remove')?.addEventListener('click', () => deleteStayAddonRow(tr));
}

function deleteStayAddonRow(tr) {
  const primary = findStayPrimaryRow(tr);
  tr.remove();
  if (primary) refreshDailyStayLiveTotals();
}

function bindStayAddonButtons(primaryTr) {
  primaryTr.querySelectorAll('.daily-stay-addon-add').forEach((btn) => {
    btn.addEventListener('click', () => {
      const section = btn.dataset.section;
      if (!section) return;
      const addon = createStayAddonRow(primaryTr, section);
      insertStayAddonRow(primaryTr, addon);
      if (typeof bindCommaAmountInputs === 'function') bindCommaAmountInputs(addon);
      refreshDailyStayLiveTotals();
    });
  });
}

function mountStayAddonRows(primaryTr) {
  const pending = primaryTr._pendingStayAddons;
  if (!pending) return;
  for (const line of pending.accommodation || []) {
    insertStayAddonRow(primaryTr, createStayAddonRow(primaryTr, 'accommodation', line));
  }
  for (const line of pending.companion || []) {
    insertStayAddonRow(primaryTr, createStayAddonRow(primaryTr, 'companion', line));
  }
  for (const line of pending.patient_assistant || []) {
    insertStayAddonRow(primaryTr, createStayAddonRow(primaryTr, 'patient_assistant', line));
  }
  for (const line of pending.nursing_point || []) {
    insertStayAddonRow(primaryTr, createStayAddonRow(primaryTr, 'nursing_point', line));
  }
  delete primaryTr._pendingStayAddons;
  refreshDailyStayLiveTotals();
}

function createStayAddonRow(parentTr, sectionCode, line = {}) {
  assignStayRowKey(parentTr);
  const tr = document.createElement('tr');
  tr.className = 'daily-entry-row daily-stay-addon-row';
  tr.dataset.stayParentKey = parentTr.dataset.stayRowKey;
  tr.dataset.addonSection = sectionCode;
  if (line.id) tr.dataset.lineId = String(line.id);

  let companionKind = stayAddonSpacerCell('daily-col-companion-kind');
  let companionAmt = stayAddonSpacerCell('daily-col-amount');
  let assistantAmt = stayAddonSpacerCell('daily-col-amount');
  let nursingAmt = stayAddonSpacerCell('daily-col-amount');

  let stayTypeCol = stayAddonSpacerCell('daily-col-stay-type');
  let accAmtCol = stayAddonSpacerCell('daily-col-amount');

  if (sectionCode === 'accommodation') {
    const stayTypeSelectVal =
      resolveStayGradeSelectValueFromEntry({}, line) || getDefaultStayTypeIdForRow();
    stayTypeCol = `<td class="daily-col-stay-type"><select class="form-select form-select-sm daily-row-stay-type">${buildDailyStayTypeOptions(stayTypeSelectVal)}</select></td>`;
    accAmtCol = `<td class="daily-col-amount">
      <input type="text" class="form-control form-control-sm daily-stay-acc-unit-price bg-light" readonly tabindex="-1">
      <input type="hidden" class="daily-amount" data-section="accommodation" data-type="amount">
    </td>`;
  } else if (sectionCode === 'companion') {
    const serviceId = companionServiceIdFromLine(line);
    companionKind = `<td class="daily-col-companion-kind"><select class="form-select form-select-sm daily-companion-kind">${buildCompanionKindOptions(serviceId)}</select></td>`;
    companionAmt = `<td class="daily-col-amount"><input type="text" inputmode="decimal" class="form-control form-control-sm daily-amount comma-amount" data-section="companion" data-type="amount" autocomplete="off"></td>`;
  } else if (sectionCode === 'patient_assistant') {
    assistantAmt = `<td class="daily-col-amount"><input type="text" inputmode="decimal" class="form-control form-control-sm daily-amount comma-amount" data-section="patient_assistant" data-type="amount" autocomplete="off"></td>`;
  } else if (sectionCode === 'nursing_point') {
    nursingAmt = `<td class="daily-col-amount"><input type="text" inputmode="decimal" class="form-control form-control-sm daily-amount comma-amount" data-section="nursing_point" data-type="amount" autocomplete="off"></td>`;
  }

  tr.innerHTML =
    stayAddonSpacerCell('daily-col-date') +
    stayTypeCol +
    accAmtCol +
    companionKind +
    companionAmt +
    assistantAmt +
    nursingAmt +
    '<td class="daily-col-total"></td>' +
    '<td class="daily-col-action text-center"><button type="button" class="btn btn-sm btn-outline-secondary daily-stay-addon-remove" title="إزالة">×</button></td>';

  if (sectionCode === 'accommodation') {
    const accHidden = tr.querySelector('.daily-amount[data-section="accommodation"]');
    if (accHidden && line.amount > 0) {
      const displayAmount = dailyAmountForDisplay(line.amount);
      accHidden.value = String(displayAmount);
      accHidden.dataset.unitPrice = String(displayAmount);
      if (line.id) {
        accHidden.dataset.lineId = String(line.id);
        tr.dataset.lineId = String(line.id);
      }
      if (line.service_id) accHidden.dataset.serviceId = String(line.service_id);
      if (line.catalog_item_id) accHidden.dataset.catalogItemId = String(line.catalog_item_id);
    }
    const staySel = tr.querySelector('.daily-row-stay-type');
    if (staySel) {
      staySel.addEventListener('change', () => onStayTypeChangeForRow(staySel));
      if (!line.amount) void onStayTypeChangeForRow(staySel);
      else updateStayAccUnitPriceDisplay(tr);
    }
  } else if (sectionCode === 'companion' && line.amount > 0) {
    const companionInput = tr.querySelector('.daily-amount[data-section="companion"]');
    if (companionInput) {
      if (typeof setCommaAmountValue === 'function') setCommaAmountValue(companionInput, line.amount);
      else companionInput.value = formatAmountFieldValue(line.amount);
    }
  } else if (sectionCode === 'patient_assistant' && line.amount > 0) {
    const input = tr.querySelector('.daily-amount[data-section="patient_assistant"]');
    if (input) {
      if (typeof setCommaAmountValue === 'function') setCommaAmountValue(input, line.amount);
      else input.value = formatAmountFieldValue(line.amount);
    }
  } else if (sectionCode === 'nursing_point' && line.amount > 0) {
    const input = tr.querySelector('.daily-amount[data-section="nursing_point"]');
    if (input) {
      if (typeof setCommaAmountValue === 'function') setCommaAmountValue(input, line.amount);
      else input.value = formatAmountFieldValue(line.amount);
    }
  }

  tr.querySelectorAll('.daily-amount, .daily-companion-kind').forEach((el) => {
    el.addEventListener('input', () => {
      if (el.classList.contains('daily-amount')) el.dataset.manualAmount = '1';
      updateRowTotal(tr);
      updateDailyGrandTotal();
      updateSectionTabTotal();
    });
    el.addEventListener('change', () => {
      updateRowTotal(tr);
      updateDailyGrandTotal();
      updateSectionTabTotal();
    });
  });
  const companionSel = tr.querySelector('.daily-companion-kind');
  if (companionSel) companionSel.addEventListener('change', () => onCompanionKindChange(companionSel));
  bindStayAddonRemove(tr);
  if (typeof bindCommaAmountInputs === 'function') bindCommaAmountInputs(tr);
  bindDailyAmountRecalc(tr);
  return tr;
}

function updateStayRowGroupTotal(primaryTr) {
  let total = 0;
  getStayDayGroupRows(primaryTr).forEach((rowTr) => {
    total += getStayAccommodationAmount(rowTr);
    for (const code of STAY_CHARGE_SECTIONS) {
      if (code === 'accommodation') continue;
      const input = rowTr.querySelector(`.daily-amount[data-section="${code}"]`);
      if (input) total += dailyParseAmount(input.value);
    }
  });
  const cell = primaryTr.querySelector('.daily-row-total');
  if (cell) {
    const rounded = Math.round(total * 100) / 100;
    cell.textContent = rounded > 0 ? dailyFmt(rounded) : '';
  }
}

function stayRowGroupHasChargeData(primaryTr) {
  const group = getStayDayGroupRows(primaryTr);
  if (group.some((tr) => getStayAccommodationAmount(tr) > 0)) return true;
  return group.some((tr) => rowHasChargeData(tr));
}

function collectCompanionLineFromRow(rowTr, lines) {
  const kindSel = rowTr.querySelector('.daily-companion-kind');
  const companionInput = rowTr.querySelector('.daily-amount[data-section="companion"]');
  const amount = dailyAmountForSave(dailyParseAmount(companionInput?.value));
  if (!kindSel) {
    if (amount > 0) collectAmountLineFromRow(rowTr, 'companion', lines);
    return;
  }
  const opt = kindSel.selectedOptions[0];
  const kind = opt?.dataset.kind || '';
  if (kind === 'nursing_point') return;
  if (!kind || kind === 'none') {
    if (amount <= 0) return;
    const manualLine = {
      section_code: 'companion',
      amount,
      quantity: 1,
      extra_text: 'مرافق',
    };
    if (companionInput?.dataset.lineId) manualLine.id = Number(companionInput.dataset.lineId);
    lines.push(manualLine);
    return;
  }
  const catalogItemId = kind === 'service' && kindSel?.value ? Number(kindSel.value) : null;
  if (!catalogItemId && amount <= 0) return;
  const line = {
    section_code: 'companion',
    catalog_item_id: catalogItemId,
    amount,
    quantity: 1,
    extra_text: kindSel?.selectedOptions[0]?.text?.trim() || '',
  };
  if (rowTr.dataset.lineId && (rowTr.classList.contains('daily-stay-row') || rowTr.dataset.addonSection === 'companion')) {
    line.id = Number(rowTr.dataset.lineId);
  }
  lines.push(line);
}

function collectAmountLineFromRow(rowTr, sectionCode, lines) {
  const input = rowTr.querySelector(`.daily-amount[data-section="${sectionCode}"]`);
  const amount = dailyAmountForSave(dailyParseAmount(input?.value));
  if (amount <= 0) return;
  const line = { section_code: sectionCode, amount, quantity: 1 };
  if (input?.dataset.lineId) line.id = Number(input.dataset.lineId);
  else if (rowTr.dataset.lineId && rowTr.dataset.addonSection === sectionCode) {
    line.id = Number(rowTr.dataset.lineId);
  } else if (rowTr.classList.contains('daily-stay-row') && rowTr.dataset.lineId && sectionCode === 'companion') {
    line.id = Number(rowTr.dataset.lineId);
  }
  lines.push(line);
}

function dailyLineMergeKey(line) {
  const lineId = Number(line.id || line.line_id);
  if (lineId) return `id:${lineId}`;
  const code = String(line.section_code || '');
  const text = String(line.extra_text || '').trim();
  if (code === 'consultation_stamp' && text.startsWith('stamp_for:')) {
    return `stamp:${text}:${line.amount || 0}`;
  }
  const svc = line.service_id || '';
  const cat = line.catalog_item_id || '';
  // catalog_item_id was missing here — two different catalog-picked items in the same
  // section with the same amount and no notes collapsed onto the same key and one
  // silently overwrote the other before either reached the server.
  return `new:${code}:${svc}:${cat}:${text}:${line.amount || 0}`;
}

function dedupeLinesByMergeKey(lines = []) {
  const map = new Map();
  for (const line of lines || []) {
    map.set(dailyLineMergeKey(line), line);
  }
  return [...map.values()];
}

function dailyRowSnapshotExcluding(entry, primaryLine, sectionCodes = []) {
  const codes = new Set(sectionCodes);
  const primaryId = Number(primaryLine?.id) || 0;
  return (entry?.lines || [])
    .filter((line) => {
      if (primaryId && Number(line.id) === primaryId) return false;
      if (codes.has(line.section_code)) return false;
      return true;
    })
    .map((line) => ({ ...line }));
}

function buildClientLinesFingerprint(lines = []) {
  return dedupeLinesByMergeKey(lines)
    .map((line) => dailyLineMergeKey(line))
    .sort()
    .join(';');
}

function resolveTodayDailyEntryId() {
  const today = getLocalDateString();
  for (const entry of dailySheetEntriesCache || []) {
    if (fmtStayDate(entry.entry_date) === today && entry.id) return Number(entry.id);
  }
  for (const tr of document.querySelectorAll(
    '#daily-sections-body .daily-entry-row[data-entry-id]'
  )) {
    const id = Number(tr.dataset.entryId) || 0;
    if (id > 0) return id;
  }
  return 0;
}

function sectionCodesOwnedByTab(tabId) {
  const codes = new Set();
  const group = DAILY_TAB_GROUPS.find((g) => g.id === tabId);
  (group?.codes || []).forEach((c) => codes.add(c));
  return codes;
}

function preservedLinesFromEntryForOtherTabs(entryDate, entryId = null) {
  if (!activeDailyTab || activeDailyTab === 'operations' || activeDailyTab === 'free-items') {
    return [];
  }
  const owned = sectionCodesOwnedByTab(activeDailyTab);
  const dateKey = fmtStayDate(entryDate);
  if (!dateKey) return [];
  const id = Number(entryId) || 0;
  const entry =
    id > 0
      ? (dailySheetEntriesCache || []).find((e) => Number(e.id) === id)
      : (dailySheetEntriesCache || []).find(
          (e) => fmtStayDate(e.entry_date) === dateKey && Number(e.id) > 0
        );
  if (!entry?.lines?.length) return [];
  return entry.lines.filter((line) => lineHasChargeData(line) && !owned.has(line.section_code));
}

function mergePreservedLinesIntoSaveRow(row) {
  // الكشوفات: حركة مستقلة — لا تُلحق بنود إقامة/أدوية من أول entry لنفس اليوم
  if (activeDailyTab === 'exams') return row;
  const preserved = preservedLinesFromEntryForOtherTabs(row.entry_date, row.entry_id);
  if (!preserved.length) return row;
  const lineMap = new Map((row.lines || []).map((line) => [dailyLineMergeKey(line), line]));
  for (const line of preserved) {
    lineMap.set(dailyLineMergeKey(line), { ...line });
  }
  return { ...row, lines: [...lineMap.values()] };
}

function enrichSaveEntriesWithPreservedLines(entries = []) {
  if (!entries.length) return entries;
  return entries.map((row) => mergePreservedLinesIntoSaveRow(row));
}

function mergeTodayTabSaveRows(rows = []) {
  if (!rows.length) return rows;
  const today = getLocalDateString();
  let entryId = 0;
  for (const row of rows) {
    const id = Number(row.entry_id) || 0;
    if (id > 0) entryId = id;
  }
  if (!entryId) entryId = resolveTodayDailyEntryId();

  const lineMap = new Map();
  let notes = '';
  let stayTypeId = null;
  for (const row of rows) {
    if (row.notes) notes = row.notes;
    if (row.stay_type_id) stayTypeId = row.stay_type_id;
    for (const line of row.lines || []) {
      lineMap.set(dailyLineMergeKey(line), line);
    }
  }
  const merged = {
    entry_date: today,
    lines: [...lineMap.values()],
    notes,
  };
  if (entryId > 0) merged.entry_id = entryId;
  if (stayTypeId) merged.stay_type_id = stayTypeId;
  if (!merged.lines.length) return [];
  return [mergePreservedLinesIntoSaveRow(merged)];
}

function catalogRowDedupeKey(tr, sectionCode) {
  const lineId = Number(tr.dataset.lineId) || 0;
  if (lineId > 0) return `line:${lineId}`;
  const picker = tr.querySelector(`.daily-picker[data-section="${sectionCode}"]`);
  const catId =
    Number(picker?.dataset?.catalogItemId) ||
    Number(picker?._selectedItem?.id) ||
    Number(tr.dataset.catalogCode) ||
    0;
  if (catId > 0) return `cat:${sectionCode}:${catId}`;
  return buildClientLinesFingerprint(collectDailyLinesFromRow(tr));
}

function serviceRowDedupeKey(tr, sectionCode) {
  const lineId = Number(tr.dataset.lineId) || Number(tr.dataset.examLineId) || 0;
  if (lineId > 0) return `line:${lineId}`;
  const picker = tr.querySelector(`.daily-picker[data-section="${sectionCode}"]`);
  const svcId =
    Number(picker?.dataset?.serviceId) ||
    Number(tr.dataset.serviceCode) ||
    Number(picker?._selectedItem?.service_id) ||
    0;
  const catId =
    Number(picker?.dataset?.catalogItemId) ||
    Number(picker?._selectedItem?.id) ||
    Number(tr.dataset.catalogCode) ||
    0;
  if (svcId > 0) return `svc:${sectionCode}:${svcId}`;
  if (catId > 0) return `cat:${sectionCode}:${catId}`;
  return buildClientLinesFingerprint(collectDailyLinesFromRow(tr));
}

function sheetRowDedupeKey(tr, tab = activeDailyTab) {
  if (tab === 'exams') {
    const examLineId = Number(tr.dataset.examLineId) || 0;
    if (examLineId > 0) return `line:${examLineId}`;
    const doctorId =
      tr.querySelector('.daily-exam-doctor')?.value || tr.dataset.doctorId || '';
    const entryId = tr.dataset.entryId || '';
    const linesFp = buildClientLinesFingerprint(collectDailyLinesFromRow(tr));
    // A genuinely blank row (no saved entry, no doctor, no line content — the
    // fresh template row addDailyEntryRow appends) must never enter the dedupe
    // map: it has nothing distinguishing it from any other blank row, so it
    // could collide with (and remove) another blank row or, worse, itself be
    // picked as the "winner" over a real saved row that briefly shares an
    // empty fingerprint while mid-edit.
    if (!entryId && !doctorId && !linesFp) return null;
    return `exam:${entryId}:${doctorId}:${linesFp}`;
  }
  if (tab === 'lab') return serviceRowDedupeKey(tr, 'analyses');
  if (tab === 'radiology') return serviceRowDedupeKey(tr, 'xray_total');
  if (tab === 'sessions') return serviceRowDedupeKey(tr, 'sessions');
  if (tab === 'medicines') return catalogRowDedupeKey(tr, 'medicines');
  if (tab === 'supplies') return catalogRowDedupeKey(tr, tr.dataset.sectionCode || 'supplies');
  if (tab === 'other') return catalogRowDedupeKey(tr, tr.dataset.sectionCode || 'other');
  return buildClientLinesFingerprint(collectDailyLinesFromRow(tr));
}

function pruneDuplicateSheetDomRows(tab = activeDailyTab) {
  const rowClass = DAILY_SHEET_ROW_CLASS_BY_TAB[tab];
  if (!rowClass) return;
  const byKey = new Map();
  for (const row of [...document.querySelectorAll(`#daily-sections-body .${rowClass}`)]) {
    const key = sheetRowDedupeKey(row, tab);
    if (!key) continue;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, row);
      continue;
    }
    const existingScore =
      (Number(existing.dataset.lineId) || Number(existing.dataset.examLineId) || 0) * 1000 +
      (Number(existing.dataset.entryId) || 0);
    const rowScore =
      (Number(row.dataset.lineId) || Number(row.dataset.examLineId) || 0) * 1000 +
      (Number(row.dataset.entryId) || 0);
    if (rowScore > existingScore) {
      removeDailyEntryRowFromDom(existing);
      byKey.set(key, row);
    } else {
      removeDailyEntryRowFromDom(row);
    }
  }
  renumberSheetRowSerials();
  updateDailyGrandTotal();
  updateSectionTabTotal();
}

function dedupeTodayLineRows(entries = [], linePicker) {
  const byLineKey = new Map();
  for (const entry of entries) {
    const lines = typeof linePicker === 'function' ? linePicker(entry) : [];
    for (const line of lines) {
      const key = dailyLineMergeKey(line);
      const score = (Number(entry.id) || 0) * 1000 + (Number(line.id) || 0);
      const prev = byLineKey.get(key);
      if (!prev || score > prev.score) {
        byLineKey.set(key, { entry, line, score });
      }
    }
  }
  return [...byLineKey.values()].sort(
    (a, b) => (Number(a.line?.id) || 0) - (Number(b.line?.id) || 0)
  );
}

function dedupeTodayCatalogRows(entries = [], sectionCodes) {
  const codes = Array.isArray(sectionCodes) ? sectionCodes : [sectionCodes];
  return dedupeTodayLineRows(entries, (entry) => catalogLinesFromEntry(entry, codes));
}

function dedupeTodayServiceRows(entries = [], sectionCode) {
  return dedupeTodayLineRows(entries, (entry) => serviceLinesFromEntry(entry, sectionCode));
}

function dedupeTodayExamRows(entries = []) {
  const rows = dedupeTodayLineRows(entries, (entry) =>
    (entry.lines || []).filter(
      (line) =>
        ['consultant_exam', 'specialist_exam'].includes(line.section_code) && lineHasChargeData(line)
    )
  );
  // A saved entry whose only exam-tab content is a consultation_stamp (no exam
  // case picked) has no consultant_exam/specialist_exam line, so the filter
  // above skips it entirely — render it too, or a stamp-only save looks like
  // it never persisted after the sheet reloads.
  const seenEntryIds = new Set(rows.map((row) => row.entry?.id).filter(Boolean));
  for (const entry of entries) {
    if (entry.id && seenEntryIds.has(entry.id)) continue;
    const stampLine = (entry.lines || []).find(
      (line) => line.section_code === 'consultation_stamp' && lineHasChargeData(line)
    );
    if (!stampLine) continue;
    rows.push({ entry, line: null, score: Number(entry.id) || 0 });
    if (entry.id) seenEntryIds.add(entry.id);
  }
  return rows;
}

function dedupeTodaySessionRows(entries = []) {
  const rows = dedupeTodayServiceRows(entries, 'sessions');
  const seenEntryIds = new Set(rows.map((row) => row.entry?.id).filter(Boolean));
  for (const entry of entries) {
    if (entry.id && seenEntryIds.has(entry.id)) continue;
    const hasSessionMeta =
      lineHasChargeData(getLineForSection(entry, 'sessions_date')) ||
      lineHasChargeData(getLineForSection(entry, 'sessions_detail'));
    if (!hasSessionMeta) continue;
    rows.push({ entry, line: null, score: Number(entry.id) || 0 });
    if (entry.id) seenEntryIds.add(entry.id);
  }
  return rows;
}

function buildDailySaveRowFingerprint(row = {}) {
  const doctor = row.doctor_id ? String(row.doctor_id) : '';
  return `${doctor}|${buildClientLinesFingerprint(row.lines || [])}`;
}

function mergeFreshDailySaveRows(rows = []) {
  const withEntryId = [];
  const freshByFingerprint = new Map();
  for (const row of rows) {
    const entryId = Number(row.entry_id) || 0;
    if (entryId) {
      withEntryId.push(row);
      continue;
    }
    const fingerprint = buildDailySaveRowFingerprint(row);
    if (!fingerprint) {
      withEntryId.push(row);
      continue;
    }
    if (!freshByFingerprint.has(fingerprint)) {
      freshByFingerprint.set(fingerprint, { ...row, lines: [...(row.lines || [])] });
      continue;
    }
    const merged = freshByFingerprint.get(fingerprint);
    const lineMap = new Map((merged.lines || []).map((line) => [dailyLineMergeKey(line), line]));
    for (const line of row.lines || []) {
      lineMap.set(dailyLineMergeKey(line), line);
    }
    merged.lines = [...lineMap.values()];
  }
  return [...withEntryId, ...freshByFingerprint.values()];
}

function renderDailyCellHtml(section, line = {}) {
  if (section.input_type === 'date') {
    const val = line.extra_date ? String(line.extra_date).slice(0, 10) : '';
    return `<td class="daily-section-cell" data-section="${section.code}"><label class="form-label small fw-bold text-primary mb-1">${dailyEscapeHtml(section.name)}</label><input type="date" class="form-control form-control-sm daily-field" data-section="${section.code}" data-type="date" value="${val}"></td>`;
  }
  if (section.input_type === 'text') {
    return `<td class="daily-section-cell" data-section="${section.code}"><label class="form-label small fw-bold text-primary mb-1">${dailyEscapeHtml(section.name)}</label><input type="text" class="form-control form-control-sm daily-field" data-section="${section.code}" data-type="text" value="${dailyEscapeAttr(line.extra_text || '')}"></td>`;
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

  const qtyVal =
    line.quantity != null && line.quantity !== ''
      ? typeof formatAmountInput === 'function'
        ? formatAmountInput(line.quantity, 0)
        : String(line.quantity)
      : '1';
  const weightVal =
    line.weight != null && line.weight !== '' ? String(line.weight) : '';
  const weightHtml =
    section.code === 'medicines'
      ? `<input type="text" inputmode="decimal" class="form-control form-control-sm daily-weight mb-1" data-section="${section.code}" value="${dailyEscapeAttr(weightVal)}" autocomplete="off">`
      : '';

  const qtySections = new Set([
    'medicines',
    'supplies',
    'cosmetics',
    'prosthetics',
    'other',
    'analyses',
    'analyses_stamp',
    'xray_total',
    'xray_type',
    'xray_stamp',
    'consultant_exam',
    'specialist_exam',
    'consultation_stamp',
    'sessions',
  ]);
  const showLineDetails = usesCatalog || qtySections.has(section.code);

  if (!showLineDetails) {
    return `<td class="daily-section-cell" data-section="${section.code}"><label class="form-label small fw-bold text-primary mb-1">${dailyEscapeHtml(section.name)}</label>${pickerHtml}<input type="text" inputmode="decimal" class="form-control form-control-sm daily-field daily-amount comma-amount" data-section="${section.code}" data-type="amount" data-manual-amount="${amountVal ? '1' : '0'}" value="${amountVal}"></td>`;
  }

  return `<td class="daily-section-cell" data-section="${section.code}"><label class="form-label small fw-bold text-primary mb-1">${dailyEscapeHtml(section.name)}</label>${pickerHtml}${weightHtml}<div class="input-group input-group-sm mb-1"><span class="input-group-text">كمية</span><input type="text" inputmode="decimal" class="form-control daily-catalog-qty comma-amount" data-section="${section.code}" data-decimals="0" value="${qtyVal}" autocomplete="off"></div><input type="text" inputmode="decimal" class="form-control form-control-sm daily-field daily-amount comma-amount" data-section="${section.code}" data-type="amount" data-manual-amount="${amountVal ? '1' : '0'}" value="${amountVal}"></td>`;
}

function configureDailyTableFooter(colCount, labelText = 'إجمالي الكل') {
  const footLabel = document.getElementById('daily-total-foot-label');
  const footSpacer = document.getElementById('daily-total-foot-spacer');
  if (footLabel) {
    footLabel.colSpan = Math.max(colCount - 2, 1);
    footLabel.setAttribute('data-base-label', labelText);
    footLabel.textContent = labelText;
    footLabel.className = 'fw-black text-end daily-total-foot-label';
  }
  if (footSpacer) {
    footSpacer.colSpan = 1;
    footSpacer.textContent = '';
    footSpacer.className = 'daily-total-foot-action';
  }
}

function syncDailySheetTableLayout() {
  const table = document.getElementById('daily-sections-table');
  if (!table) return;
  const tabClass = `daily-sheet-table--${activeDailyTab || 'sections'}`;
  table.className = `table table-sm daily-sheet-table ${tabClass}`;
}

function renderDailySectionsTable() {
  const head = document.getElementById('daily-sections-head');
  const subhead = document.getElementById('daily-sections-subhead');
  if (!head) return;

  if (activeDailyTab === 'operations' || activeDailyTab === 'free-items') {
    syncDailySheetTableLayout();
    applyDailyTabColumnVisibility();
    return;
  }

  if (activeDailyTab === 'stay') {
    head.innerHTML =
      '<th class="daily-meta-th daily-col-serial">مسلسل</th>' +
      '<th class="daily-meta-th daily-col-date">التاريخ</th>' +
      '<th class="daily-meta-th daily-col-stay-type">نوع الإقامة</th>' +
      '<th class="daily-meta-th daily-col-amount">سعر الإقامة <span class="text-muted fw-normal small">(ج.م — + إقامة)</span></th>' +
      '<th class="daily-meta-th daily-col-companion-kind">مرافق (غرفة/جناح)</th>' +
      '<th class="daily-meta-th daily-col-amount">سعر المرافق <span class="text-muted fw-normal small">(ج.م)</span></th>' +
      '<th class="daily-meta-th daily-col-amount">مساعد تمريض <span class="text-muted fw-normal small">(ج.م)</span></th>' +
      '<th class="daily-meta-th daily-col-amount">نقطة تمريض <span class="text-muted fw-normal small">(ج.م)</span></th>' +
      '<th class="daily-meta-th daily-col-total">إجمالي <span class="text-muted fw-normal small">(ج.م)</span></th>' +
      '<th class="daily-meta-th daily-col-action"></th>';
    if (subhead) {
      subhead.innerHTML = '';
      subhead.style.display = 'none';
    }
    configureDailyTableFooter(10, 'إجمالي الإقامة (كل الأيام)');
    syncDailySheetTableLayout();
    applyDailyTabColumnVisibility();
    return;
  }

  if (activeDailyTab === 'sessions') {
    head.innerHTML =
      '<th class="daily-meta-th daily-col-serial">مسلسل</th>' +
      '<th class="daily-meta-th">تاريخ الجلسة</th>' +
      '<th class="daily-meta-th">اسم المريض</th>' +
      '<th class="daily-meta-th">نوع الجلسة</th>' +
      '<th class="daily-meta-th">جلسة صباحي <span class="text-muted fw-normal small">(عدد)</span></th>' +
      '<th class="daily-meta-th">جلسة مسائي <span class="text-muted fw-normal small">(عدد)</span></th>' +
      '<th class="daily-meta-th">عدد الجلسات <span class="text-muted fw-normal small">(عدد)</span></th>' +
      '<th class="daily-meta-th">سعر الجلسة <span class="text-muted fw-normal small">(ج.م)</span></th>' +
      '<th class="daily-meta-th">الإجمالي <span class="text-muted fw-normal small">(ج.م)</span></th>' +
      '<th class="daily-meta-th daily-col-action"></th>';
    if (subhead) {
      subhead.innerHTML = '';
      subhead.style.display = 'none';
    }
    configureDailyTableFooter(10, 'إجمالي الجلسات (كل الأيام)');
    syncDailySheetTableLayout();
    applyDailyTabColumnVisibility();
    return;
  }

  if (activeDailyTab === 'exams') {
    head.innerHTML =
      '<th class="daily-meta-th daily-col-serial">مسلسل</th>' +
      '<th class="daily-meta-th">حالة الكشف</th>' +
      '<th class="daily-meta-th">التخصص</th>' +
      '<th class="daily-meta-th">اسم الطبيب</th>' +
      '<th class="daily-meta-th">سعر الكشف <span class="text-muted fw-normal small">(ج.م)</span></th>' +
      '<th class="daily-meta-th">تاريخ الكشف</th>' +
      '<th class="daily-meta-th">اسم المريض</th>' +
      '<th class="daily-meta-th">الدمغة <span class="text-muted fw-normal small">(ج.م)</span></th>' +
      '<th class="daily-meta-th">الإجمالي <span class="text-muted fw-normal small">(ج.م)</span></th>' +
      '<th class="daily-meta-th daily-col-action"></th>';
    if (subhead) {
      subhead.innerHTML = '';
      subhead.style.display = 'none';
    }
    configureDailyTableFooter(10, 'إجمالي الكشوفات (كل الأيام)');
    syncDailySheetTableLayout();
    applyDailyTabColumnVisibility();
    return;
  }

  if (activeDailyTab === 'medicines') {
    head.innerHTML =
      '<th class="daily-meta-th daily-col-serial">مسلسل</th>' +
      '<th class="daily-meta-th">رقم الفاتورة</th>' +
      '<th class="daily-meta-th">تاريخ</th>' +
      '<th class="daily-meta-th">اسم الصنف</th>' +
      '<th class="daily-meta-th">الكمية <span class="text-muted fw-normal small">(عدد)</span></th>' +
      '<th class="daily-meta-th">الوحدة</th>' +
      '<th class="daily-meta-th">الوزن</th>' +
      '<th class="daily-meta-th">سعر الوحدة <span class="text-muted fw-normal small">(ج.م)</span></th>' +
      '<th class="daily-meta-th">الإجمالي <span class="text-muted fw-normal small">(ج.م)</span></th>' +
      '<th class="daily-meta-th daily-col-action"></th>';
    if (subhead) {
      subhead.innerHTML = '';
      subhead.style.display = 'none';
    }
    configureDailyTableFooter(10, 'إجمالي الأدوية (كل الأيام)');
    syncDailySheetTableLayout();
    applyDailyTabColumnVisibility();
    return;
  }

  if (activeDailyTab === 'supplies') {
    head.innerHTML =
      '<th class="daily-meta-th daily-col-serial">مسلسل</th>' +
      '<th class="daily-meta-th">تاريخ</th>' +
      '<th class="daily-meta-th">رقم فاتورة</th>' +
      '<th class="daily-meta-th">اسم الصنف</th>' +
      '<th class="daily-meta-th">عدد <span class="text-muted fw-normal small">(عدد)</span></th>' +
      '<th class="daily-meta-th">السعر <span class="text-muted fw-normal small">(ج.م)</span></th>' +
      '<th class="daily-meta-th">الإجمالي <span class="text-muted fw-normal small">(ج.م)</span></th>' +
      '<th class="daily-meta-th">سعر المستلزم <span class="text-muted fw-normal small">(ج.م)</span></th>' +
      '<th class="daily-meta-th">إجمالي المستلزم <span class="text-muted fw-normal small">(ج.م)</span></th>' +
      '<th class="daily-meta-th daily-col-action"></th>';
    if (subhead) {
      subhead.innerHTML = '';
      subhead.style.display = 'none';
    }
    configureDailyTableFooter(11, 'إجمالي المستلزمات (كل الأيام)');
    syncDailySheetTableLayout();
    applyDailyTabColumnVisibility();
    return;
  }

  if (activeDailyTab === 'lab') {
    head.innerHTML =
      '<th class="daily-meta-th daily-col-serial">مسلسل</th>' +
      '<th class="daily-meta-th">تاريخ التحليل</th>' +
      '<th class="daily-meta-th">نوع التحليل</th>' +
      '<th class="daily-meta-th">سعر التحليل <span class="text-muted fw-normal small">(ج.م)</span></th>' +
      '<th class="daily-meta-th">الإجمالي <span class="text-muted fw-normal small">(ج.م)</span></th>' +
      '<th class="daily-meta-th">الدمغة <span class="text-muted fw-normal small">(ج.م)</span></th>' +
      '<th class="daily-meta-th daily-col-action"></th>';
    if (subhead) {
      subhead.innerHTML = '';
      subhead.style.display = 'none';
    }
    configureDailyTableFooter(7, 'إجمالي التحاليل (كل الأيام)');
    syncDailySheetTableLayout();
    applyDailyTabColumnVisibility();
    return;
  }

  if (activeDailyTab === 'radiology') {
    head.innerHTML =
      '<th class="daily-meta-th daily-col-serial">مسلسل</th>' +
      '<th class="daily-meta-th">نوع الأشعة</th>' +
      '<th class="daily-meta-th">سعر الأشعة <span class="text-muted fw-normal small">(ج.م)</span></th>' +
      '<th class="daily-meta-th">الإجمالي <span class="text-muted fw-normal small">(ج.م)</span></th>' +
      '<th class="daily-meta-th">تاريخ الأشعة</th>' +
      '<th class="daily-meta-th">الدمغة <span class="text-muted fw-normal small">(ج.م)</span></th>' +
      '<th class="daily-meta-th daily-col-action"></th>';
    if (subhead) {
      subhead.innerHTML = '';
      subhead.style.display = 'none';
    }
    configureDailyTableFooter(7, 'إجمالي الأشعة (كل الأيام)');
    syncDailySheetTableLayout();
    applyDailyTabColumnVisibility();
    return;
  }

  if (activeDailyTab === 'other') {
    head.innerHTML =
      '<th class="daily-meta-th daily-col-serial">مسلسل</th>' +
      '<th class="daily-meta-th">اسم الخدمة</th>' +
      '<th class="daily-meta-th">العدد <span class="text-muted fw-normal small">(عدد)</span></th>' +
      '<th class="daily-meta-th">السعر <span class="text-muted fw-normal small">(ج.م)</span></th>' +
      '<th class="daily-meta-th">الإجمالي <span class="text-muted fw-normal small">(ج.م)</span></th>' +
      '<th class="daily-meta-th daily-col-action"></th>';
    if (subhead) {
      subhead.innerHTML = '';
      subhead.style.display = 'none';
    }
    configureDailyTableFooter(6, 'إجمالي الخدمات المتنوعة (كل الأيام)');
    syncDailySheetTableLayout();
    applyDailyTabColumnVisibility();
    return;
  }

  const viewSections = sectionsForActiveView();
  const showMeta = shouldShowDailyMetaInView();
  const consultationCodes = ['consultant_exam', 'specialist_exam', 'consultation_stamp'];
  const consultationSections = viewSections.filter((s) => consultationCodes.includes(s.code));
  let consultInserted = false;
  const blocks = [];

  for (const section of viewSections) {
    if (consultationCodes.includes(section.code)) {
      if (!consultInserted) {
        blocks.push({ type: 'consultations', sections: consultationSections });
        consultInserted = true;
      }
      continue;
    }
    blocks.push({ type: 'single', section });
  }

  const metaHead = showMeta
    ? '<th rowspan="2" class="daily-meta-th">التاريخ</th><th rowspan="2" class="daily-meta-th">نوع الإقامة</th>' +
      '<th rowspan="2" class="daily-meta-th">التخصص</th><th rowspan="2" class="daily-meta-th">الطبيب</th>'
    : '';

  head.innerHTML =
    metaHead +
    blocks
      .map((block) => {
        if (block.type === 'consultations') {
          return '<th colspan="3" class="text-center daily-group-th" data-section-group="exams">الكشوفات</th>';
        }
        return `<th rowspan="2" class="daily-section-th" data-section="${block.section.code}" title="${block.section.category_code || block.section.catalog_category || ''}">${block.section.name}</th>`;
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

  const colCount = viewSections.length + (showMeta ? 4 : 0) + 2;
  configureDailyTableFooter(colCount, 'إجمالي الكل');
  syncDailySheetTableLayout();
  applyDailyTabColumnVisibility();
}

function bindDailyRowEvents(tr) {
  tr.querySelectorAll('.daily-field, .daily-catalog-unit, .daily-row-date, .daily-row-stay-type, .daily-catalog-qty, .daily-weight').forEach((el) => {
    el.addEventListener('input', () => {
      if (el.classList.contains('daily-amount')) el.dataset.manualAmount = '1';
      if (el.classList.contains('daily-catalog-qty')) {
        const sectionCode = el.dataset.section;
        if (window.DailyEntryPicker?.recalcSectionLineTotal) {
          DailyEntryPicker.recalcSectionLineTotal(tr, sectionCode);
        }
      }
      updateRowTotal(tr);
      updateDailyGrandTotal();
      updateSectionTabTotal();
    });
    el.addEventListener('change', () => {
      updateRowTotal(tr);
      updateDailyGrandTotal();
      updateSectionTabTotal();
    });
  });

  if (window.DailyEntryPicker) DailyEntryPicker.bindRow(tr);

  tr.querySelector('.daily-row-delete')?.addEventListener('click', () => deleteDailyEntryRow(tr));

  if (typeof bindCommaAmountInputs === 'function') bindCommaAmountInputs(tr);
  bindDailyAmountRecalc(tr);
}

function applyDefaultPricesForRow(tr) {
  for (const section of sectionsForActiveView()) {
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

function setStayAccommodationUnitPrice(tr, rate) {
  const accInput = tr.querySelector('.daily-amount[data-section="accommodation"]');
  const display = tr.querySelector('.daily-stay-acc-unit-price');
  if (!accInput) return false;
  const displayRate = dailyAmountForDisplay(Number(rate) || 0);
  if (displayRate <= 0) return false;
  accInput.value = String(displayRate);
  accInput.dataset.unitPrice = String(displayRate);
  accInput.dataset.manualAmount = '0';
  if (display) {
    if (typeof setCommaAmountValue === 'function') setCommaAmountValue(display, displayRate);
    else display.value = formatAmountFieldValue(displayRate);
  }
  return true;
}

async function applyStayTypeRateToRow(tr, options = {}) {
  const force = options.force === true;
  if (!canUseDailyStayCharges()) return;
  const select = tr.querySelector('.daily-row-stay-type');
  const selectVal = select?.value;
  if (!selectVal) return;
  const grade = findStayGradeFromSelectValue(selectVal);
  const stayTypeId = grade?.stay_type_id || (/^\d+$/.test(selectVal) ? selectVal : '');
  if (stayTypeId) tr.dataset.stayTypeId = String(stayTypeId);
  else delete tr.dataset.stayTypeId;
  const stayType = stayTypeId
    ? dailyStayTypesCache.find((t) => String(t.id) === String(stayTypeId))
    : null;
  const accInput = tr.querySelector('.daily-amount[data-section="accommodation"]');
  const accPicker = tr.querySelector('.daily-picker[data-section="accommodation"]');
  if (!accInput) return;
  const gradeRate =
    Number(grade?.daily_rate) ||
    Number(stayType?.daily_rate) ||
    Number(select.selectedOptions[0]?.dataset.rate) ||
    0;
  const hasAmount = dailyParseAmount(accInput.value) > 0;

  if (gradeRate > 0 && (force || !hasAmount)) {
    if (grade?.catalog_item_id) accInput.dataset.catalogItemId = String(grade.catalog_item_id);
    else delete accInput.dataset.catalogItemId;
    if (grade?.service_id) accInput.dataset.serviceId = String(grade.service_id);
    else delete accInput.dataset.serviceId;
    setStayAccommodationUnitPrice(tr, gradeRate);
    return;
  }

  if (!force && hasAmount) return;

  const match = await findAccommodationServiceForStayType(stayType);
  if (!match || !accPicker) {
    if (force && gradeRate > 0) setStayAccommodationUnitPrice(tr, gradeRate);
    return;
  }

  const section = dailySectionsCache.find((s) => s.code === 'accommodation');
  if (section && window.DailyEntryPicker) {
    DailyEntryPicker.applyPickerSelection(tr, section, accPicker, match);
    updateStayAccUnitPriceDisplay(tr);
  }
}

function createDailyEntryRow(entry = {}) {
  if (activeDailyTab === 'stay') return createStayDailyEntryRow(entry);
  if (activeDailyTab === 'sessions') return createSessionsRow(entry);
  if (activeDailyTab === 'exams') return createExamDailyEntryRow(entry);
  if (activeDailyTab === 'medicines') return createMedicineCatalogRow(entry);
  if (activeDailyTab === 'supplies') return createSupplyCatalogRow(entry);
  if (activeDailyTab === 'lab') return createLabRow(entry);
  if (activeDailyTab === 'radiology') return createRadiologyRow(entry);
  if (activeDailyTab === 'other') return createMiscServiceRow(entry);
  const tr = document.createElement('tr');
  tr.className = 'daily-entry-row';
  if (entry.id) tr.dataset.entryId = entry.id;
  if (entry.notes) tr.dataset.entryNotes = entry.notes;
  if (entry.stay_type_id) tr.dataset.stayTypeId = String(entry.stay_type_id);
  if (entry.doctor_specialty) tr.dataset.doctorSpecialty = entry.doctor_specialty;
  if (entry.doctor_id) tr.dataset.doctorId = String(entry.doctor_id);
  tr._entryLinesSnapshot = (entry.lines || []).map((line) => ({ ...line }));

  const dateVal = getLocalDateString();
  const viewSections = sectionsForActiveView();
  const metaHtml = shouldShowDailyMetaInView()
    ? `<td><input type="date" class="form-control form-control-sm daily-row-date fw-bold bg-light" value="${dateVal}" readonly tabindex="-1"></td>
    <td><select class="form-select form-select-sm daily-row-stay-type">${buildDailyStayTypeOptions(entry.stay_type_id)}</select></td>
    <td><select class="form-select form-select-sm daily-row-specialty">${buildDailySpecialtyOptions(entry.doctor_specialty || '')}</select></td>
    <td>
      <input type="search" class="form-control form-control-sm daily-doctor-search mb-1" autocomplete="off">
      <select class="form-select form-select-sm daily-row-doctor"><option value="">— الطبيب —</option></select>
    </td>`
    : '';

  tr.innerHTML = `
    ${metaHtml}
    ${viewSections.map((section) => renderDailyCellHtml(section, getLineForSection(entry, section.code))).join('')}
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
    for (const section of viewSections) {
      DailyEntryPicker.hydratePicker(tr, section, getLineForSection(entry, section.code));
    }
  }
  applyDailyTabColumnVisibility();
  updateRowTotal(tr);
  applyDefaultPricesForRow(tr);
  return tr;
}

function addDailyEntryRow(preset = {}) {
  const body = document.getElementById('daily-sections-body');
  if (!body) return;
  if (activeDailyTab === 'stay' && !canUseDailyStayCharges()) {
    showToast('المريض الخارجي لا يُسجَّل عليه إقامة', 'warning');
    return;
  }
  if (isDailyEntryPresetEmpty(preset)) {
    const blank = findBlankDailyEntryRow();
    if (blank) {
      focusDailyEntryRow(blank);
      return;
    }
  }
  let entryDate = fmtStayDate(preset.entry_date) || '';
  if (activeDailyTab === 'stay') {
    if (!entryDate) entryDate = suggestNextStayEntryDate() || '';
    if (!entryDate) {
      const { from, to } = getDailyInvoicePeriodBounds();
      const used = collectStayDatesInDom();
      let msg =
        'لا يوجد يوم متاح في فترة الإقامة — عدّل تاريخ الخروج أو احذف يوماً مسجّلاً';
      if (from && to && from === to && used.has(from)) {
        msg = `يوم ${from} مسجّل بالفعل — لتسجيل يوم جديد حدّد تاريخ خروج بعد الدخول أو انتظر اليوم التالي`;
      } else if (from && to && from < to && used.size > 0) {
        msg = `كل الأيام من ${from} إلى ${to} مسجّلة — وسّع تاريخ الخروج لإضافة أيام`;
      }
      showToast(msg, 'warning');
      return;
    }
    if (isDailyEntryPresetEmpty(preset)) {
      const existingStay = [...document.querySelectorAll('#daily-sections-body .daily-stay-row')].find(
        (tr) =>
          fmtStayDate(tr.querySelector('.daily-row-date')?.value) === entryDate &&
          stayRowGroupHasChargeData(tr)
      );
      if (existingStay) {
        focusDailyEntryRow(existingStay);
        showToast(
          `يوجد صف إقامة لتاريخ ${entryDate} — استخدم زر + بجانب سعر الإقامة لإضافة إقامة ثانية لنفس اليوم`,
          'info'
        );
        return;
      }
    }
  } else {
    entryDate = getLocalDateString();
  }
  if (activeDailyTab === 'stay' && !preset.stay_type_id) {
    preset.stay_type_id = getDefaultStayTypeIdForRow() || preset.stay_type_id;
  }
  const row = createDailyEntryRow({ ...preset, entry_date: entryDate });
  body.appendChild(row);
  renumberSheetRowSerials();
  if (!row.dataset.dailySerial) stampDailyRowSerial(row, allocateDailyRowSerial());
  if (activeDailyTab === 'stay') mountStayAddonRows(row);
  setDailyTodayDate();
  if (activeDailyTab === 'stay') pruneDuplicateStayDomRows();
  updateDailyGrandTotal();
  if (activeDailyTab === 'stay') void applyAutoRoomToTodayRows();
  if (isDailyEntryPresetEmpty(preset)) focusDailyEntryRow(row);
}

function sessionRowHasChargeData(tr) {
  if (dailyParseAmount(tr.querySelector('.daily-session-total')?.value) > 0) return true;
  const pickerVal = tr.querySelector('.daily-picker[data-section="sessions"] .daily-picker-value')?.value;
  if (String(pickerVal || '').trim()) return true;
  const hidden = tr.querySelector('.daily-field.daily-amount[data-section="sessions"]');
  if (dailyParseAmount(hidden?.value) > 0) return true;
  return false;
}

function rowHasChargeData(tr) {
  if (tr.classList.contains('daily-session-row')) {
    return sessionRowHasChargeData(tr);
  }
  if (tr._entryLinesSnapshot?.some((line) => lineHasChargeData(line))) return true;
  if (dailyParseAmount(tr.querySelector('.daily-exam-unit-price')?.value) > 0) return true;
  if (tr.querySelector('.daily-exam-case')?.value) return true;
  if (tr.querySelector('.daily-exam-specialty')?.value) return true;
  if (dailyParseAmount(tr.querySelector('.daily-exam-stamp')?.value) > 0) return true;
  if (dailyParseAmount(tr.querySelector('.daily-med-total')?.value) > 0) return true;
  if (tr.querySelector('.daily-picker[data-section="medicines"] .daily-picker-value')?.value) return true;
  if (dailyParseAmount(tr.querySelector('.daily-sup-sell-total')?.value) > 0) return true;
  const supSection = tr.dataset.sectionCode || 'supplies';
  if (tr.querySelector(`.daily-picker[data-section="${supSection}"] .daily-picker-value`)?.value) return true;
  if (dailyParseAmount(tr.querySelector('.daily-lab-total')?.value) > 0) return true;
  if (dailyParseAmount(tr.querySelector('.daily-lab-stamp')?.value) > 0) return true;
  if (tr.querySelector('.daily-picker[data-section="analyses"] .daily-picker-value')?.value) return true;
  if (dailyParseAmount(tr.querySelector('.daily-rad-total')?.value) > 0) return true;
  if (dailyParseAmount(tr.querySelector('.daily-rad-stamp')?.value) > 0) return true;
  if (tr.querySelector('.daily-picker[data-section="xray_total"] .daily-picker-value')?.value) return true;
  if (dailyParseAmount(tr.querySelector('.daily-misc-total')?.value) > 0) return true;
  const miscSection = tr.dataset.sectionCode || 'other';
  if (tr.querySelector(`.daily-picker[data-section="${miscSection}"] .daily-picker-value`)?.value) return true;
  if (tr.classList.contains('daily-stay-row') && getStayAccommodationAmount(tr) > 0) return true;
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

function collectLineForSection(tr, section) {
  const field = tr.querySelector(
    `.daily-field[data-section="${section.code}"], .daily-amount[data-section="${section.code}"]`
  );
  const pickerFields = window.DailyEntryPicker ? DailyEntryPicker.readPickerFields(tr, section) : {};
  if (section.input_type === 'date') {
    return { section_code: section.code, extra_date: field?.value || null };
  }
  if (section.input_type === 'text') {
    return { section_code: section.code, extra_text: field?.value || '' };
  }
  const qtyInput = tr.querySelector(`.daily-catalog-qty[data-section="${section.code}"]`);
  const qty = dailyParseAmount(qtyInput?.value) || 1;
  const weightInput = tr.querySelector(`.daily-weight[data-section="${section.code}"]`);
  const weightRaw = weightInput?.value?.trim();
  const weight = weightRaw ? Number(weightRaw.replace(/,/g, '')) : null;
  const line = {
    section_code: section.code,
    catalog_item_id: pickerFields.catalog_item_id ?? null,
    catalog_unit_level: pickerFields.catalog_unit_level ?? null,
    catalog_unit: pickerFields.catalog_unit ?? null,
    service_id: pickerFields.service_id ?? null,
    amount: dailyAmountForSave(dailyParseAmount(field?.value)),
    quantity: qty,
    weight: Number.isFinite(weight) ? weight : null,
  };
  // Preserve the existing DB row id (set on the <tr> when the row was hydrated from a
  // saved entry) so a re-save UPDATEs the line instead of deleting + reinserting it.
  if (tr.dataset.lineId) line.id = Number(tr.dataset.lineId);
  return line;
}

function lineHasChargeData(line) {
  if (!line) return false;
  if (line.extra_date) return true;
  if (String(line.extra_text || '').trim()) return true;
  if (Number(line.amount) > 0) return true;
  if (line.catalog_item_id || line.service_id) return true;
  return false;
}

function collectDailyLinesFromRow(tr) {
  if (activeDailyTab === 'stay') return collectStayLinesFromRow(tr);
  if (activeDailyTab === 'sessions') return collectSessionsLinesFromRow(tr);
  if (activeDailyTab === 'exams') return collectExamLinesFromRow(tr);
  if (activeDailyTab === 'medicines') return collectMedicineLinesFromRow(tr);
  if (activeDailyTab === 'supplies') return collectSupplyLinesFromRow(tr);
  if (activeDailyTab === 'lab') return collectLabLinesFromRow(tr);
  if (activeDailyTab === 'radiology') return collectRadiologyLinesFromRow(tr);
  if (activeDailyTab === 'other') return collectMiscLinesFromRow(tr);
  const viewSections = sectionsForActiveView();
  const viewCodes = new Set(viewSections.map((s) => s.code));
  const domLines = viewSections.map((section) => collectLineForSection(tr, section));
  const snapshot = tr._entryLinesSnapshot || [];
  const preserved = snapshot.filter((line) => !viewCodes.has(line.section_code) && lineHasChargeData(line));
  return [...preserved, ...domLines];
}

function updateRowTotal(tr) {
  if (tr.classList.contains('daily-med-row')) {
    const total = dailyParseAmount(tr.querySelector('.daily-med-total')?.value);
    const cell = tr.querySelector('.daily-row-total');
    if (cell) cell.textContent = total > 0 ? dailyFmt(total) : '';
    return;
  }
  if (tr.classList.contains('daily-sup-row')) {
    const total = dailyParseAmount(tr.querySelector('.daily-sup-sell-total')?.value);
    const cell = tr.querySelector('.daily-row-total');
    if (cell) cell.textContent = total > 0 ? dailyFmt(total) : '';
    return;
  }
  if (tr.classList.contains('daily-lab-row')) {
    const total = getLabRowGrandTotal(tr);
    const cell = tr.querySelector('.daily-row-total');
    if (cell) cell.textContent = total > 0 ? dailyFmt(total) : '';
    return;
  }
  if (tr.classList.contains('daily-rad-row')) {
    const total = getRadRowGrandTotal(tr);
    const cell = tr.querySelector('.daily-row-total');
    if (cell) cell.textContent = total > 0 ? dailyFmt(total) : '';
    return;
  }
  if (tr.classList.contains('daily-misc-row')) {
    const total = dailyParseAmount(tr.querySelector('.daily-misc-total')?.value);
    const cell = tr.querySelector('.daily-row-total');
    if (cell) cell.textContent = total > 0 ? dailyFmt(total) : '';
    return;
  }
  if (tr.classList.contains('daily-session-row')) {
    const total = dailyParseAmount(tr.querySelector('.daily-session-total')?.value);
    const cell = tr.querySelector('.daily-row-total');
    if (cell) cell.textContent = total > 0 ? dailyFmt(total) : '';
    return;
  }
  if (tr.classList.contains('daily-exam-row')) {
    const total = getExamRowGrandTotal(tr);
    const cell = tr.querySelector('.daily-row-total');
    if (cell) cell.textContent = total > 0 ? dailyFmt(total) : '';
    return;
  }
  if (tr.classList.contains('daily-stay-addon-row')) {
    const primary = findStayPrimaryRow(tr);
    if (primary) updateStayRowGroupTotal(primary);
    return;
  }
  if (tr.classList.contains('daily-stay-row')) {
    updateStayRowGroupTotal(tr);
    return;
  }
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
  updateSectionTabTotal();
}

async function loadDailyEntriesIntoSheet(options = {}) {
  const skipAutoRoom = options.skipAutoRoom === true;
  const body = document.getElementById('daily-sections-body');
  if (!body) return;
  const loadId = ++dailyEntriesLoadSeq;
  body.innerHTML = '';

  const fileNumber = getStayFileNumber();
  if (!fileNumber || !dailyStayContext?.invoice?.id) {
    if (loadId !== dailyEntriesLoadSeq) return;
    dailySheetEntriesCache = [];
    addDailyEntryRow();
    setDailyTodayDate();
    renumberSheetRowSerials();
    updateSectionTabTotal();
    if (!skipAutoRoom) await applyAutoRoomToTodayRows();
    return;
  }

  try {
    const entries = await apiJson(
      `${DAILY_API}/entries?file_number=${encodeURIComponent(fileNumber)}&include_lines=1&limit=120`
    );
    if (loadId !== dailyEntriesLoadSeq) return;
    dailySheetEntriesCache = entries || [];
    rebuildDailySheetSerialState(entries);
    dailySheetSerialNext = 1;
    const today = getLocalDateString();
    const todayEntries = entries.filter((entry) => fmtStayDate(entry.entry_date) === today);
    const sheetEntries =
      activeDailyTab === 'stay' ? todayEntries : getClinicalSheetEntries(entries);
    if (!sheetEntries.length && activeDailyTab !== 'stay') {
      addDailyEntryRow();
      setDailyTodayDate();
      renumberSheetRowSerials();
      markDailySheetRowsByEntryDate();
      updateSectionTabTotal();
      return;
    }
    const seenEntryIds = new Set();
    if (activeDailyTab === 'exams') {
      const examRows = dedupeTodayExamRows(sheetEntries);
      const stampPoolState = new Map();
      for (const { entry, line } of examRows) {
        const stampLine = resolveConsultationStampForExamEntry(entry, line, stampPoolState);
        body.appendChild(createExamDailyEntryRow(entry, line, { stampLine }));
      }
      pruneDuplicateSheetDomRows('exams');
      addDailyEntryRow();
      renumberSheetRowSerials();
    } else if (activeDailyTab === 'lab') {
      for (const { entry, line } of dedupeTodayServiceRows(sheetEntries, 'analyses')) {
        body.appendChild(createLabRow(entry, line));
      }
      pruneDuplicateSheetDomRows('lab');
      addDailyEntryRow();
    } else if (activeDailyTab === 'radiology') {
      for (const { entry, line } of dedupeTodayServiceRows(sheetEntries, 'xray_total')) {
        body.appendChild(createRadiologyRow(entry, line));
      }
      pruneDuplicateSheetDomRows('radiology');
      addDailyEntryRow();
    } else if (activeDailyTab === 'other') {
      for (const { entry, line } of dedupeTodayCatalogRows(sheetEntries, ['other', 'prosthetics'])) {
        body.appendChild(createMiscServiceRow(entry, line, line.section_code));
      }
      pruneDuplicateSheetDomRows('other');
      addDailyEntryRow();
    } else if (activeDailyTab === 'medicines') {
      for (const { entry, line } of dedupeTodayCatalogRows(sheetEntries, 'medicines')) {
        body.appendChild(createMedicineCatalogRow(entry, line));
      }
      pruneDuplicateSheetDomRows('medicines');
      addDailyEntryRow();
    } else if (activeDailyTab === 'supplies') {
      for (const { entry, line } of dedupeTodayCatalogRows(sheetEntries, ['supplies', 'cosmetics'])) {
        body.appendChild(createSupplyCatalogRow(entry, line, line.section_code));
      }
      pruneDuplicateSheetDomRows('supplies');
      addDailyEntryRow();
    } else if (activeDailyTab === 'sessions') {
      for (const { entry, line } of dedupeTodaySessionRows(sheetEntries)) {
        body.appendChild(line ? createSessionsRow(entry, line) : createSessionsRow(entry));
      }
      pruneDuplicateSheetDomRows('sessions');
      addDailyEntryRow();
    } else if (activeDailyTab === 'stay') {
      if (!canUseDailyStayCharges()) {
        body.innerHTML = '';
      } else {
        const periodBounds = getDailyInvoicePeriodBounds();
        const stayEntriesForSheet = (entry) =>
          entryHasStayChargeData(entry) && !isDailyStayDateSuppressed(entry.entry_date);
        const periodEntries = dedupeStayEntriesByDate(
          entries
            .filter((entry) => entryInInvoicePeriod(entry, periodBounds) && stayEntriesForSheet(entry))
            .sort((a, b) => fmtStayDate(a.entry_date).localeCompare(fmtStayDate(b.entry_date)))
        );
        const rowsToRender = periodEntries.length
          ? periodEntries
          : dedupeStayEntriesByDate(todayEntries.filter(stayEntriesForSheet));
        for (const entry of rowsToRender) {
          if (!entryHasStayChargeData(entry)) continue;
          if (entry.id) {
            if (seenEntryIds.has(entry.id)) continue;
            seenEntryIds.add(entry.id);
          }
          const row = createStayDailyEntryRow(entry);
          body.appendChild(row);
          mountStayAddonRows(row);
        }
        pruneDuplicateStayDomRows();
        if (!body.querySelector('.daily-stay-row')) addDailyEntryRow();
      }
    } else {
      for (const entry of todayEntries) {
        if (entry.id) {
          if (seenEntryIds.has(entry.id)) continue;
          seenEntryIds.add(entry.id);
        }
        body.appendChild(createDailyEntryRow(entry));
      }
      addDailyEntryRow();
    }
    setDailyTodayDate();
    if (activeDailyTab === 'stay') pruneDuplicateStayDomRows();
    renumberSheetRowSerials();
    markDailySheetRowsByEntryDate();
    updateDailyGrandTotal();
    updateSectionTabTotal();
    if (activeDailyTab === 'stay' && !skipAutoRoom) {
      await applyAutoRoomToTodayRows();
      syncRoomInsuranceOnAdmissionStayDom();
    }
    await awaitDailySheetPickerHydration();
    captureDailySheetBaseline();
  } catch (err) {
    if (loadId !== dailyEntriesLoadSeq) return;
    console.error(err);
    if (!dailySectionsLoadFailed) {
      showToast(sanitizeApiErrorMessage(err.message), 'danger');
    }
    addDailyEntryRow();
    setDailyTodayDate();
    renumberSheetRowSerials();
    updateSectionTabTotal();
  }
}

async function reloadDailyCatalogSectionsFromSettings() {
  await loadDailySections();
}

function countDailyRowsForEntryId(entryId) {
  if (!entryId) return 0;
  const id = String(entryId);
  return document.querySelectorAll(
    `#daily-sheet-body tr.daily-entry-row[data-entry-id="${CSS.escape(id)}"]`
  ).length;
}

function shouldDeleteEntireDailyEntryForRow(tr) {
  if (activeDailyTab === 'stay' || tr.classList.contains('daily-stay-row')) return true;
  if (['lab', 'radiology'].includes(activeDailyTab)) return true;
  const entryId = tr.dataset.entryId;
  if (entryId && countDailyRowsForEntryId(entryId) <= 1) return true;
  return false;
}

function removeDailyEntryRowFromDom(tr) {
  if (tr.classList.contains('daily-stay-addon-row')) {
    deleteStayAddonRow(tr);
  } else if (tr.classList.contains('daily-stay-row')) {
    getStayDayGroupRows(tr).forEach((row) => row.remove());
  } else {
    tr.remove();
  }
  if (activeDailyTab !== 'stay' && !document.querySelector('.daily-entry-row')) addDailyEntryRow();
  renumberSheetRowSerials();
  updateDailyGrandTotal();
}

async function removeRowLinesFromEntry(tr, entryId) {
  if (!dailyCan('daily_charges.manage')) {
    showToast('ليس لديك صلاحية الحذف', 'warning');
    return false;
  }
  if (!confirm('حذف هذا السطر؟')) return false;

  const snapshot = tr._entryLinesSnapshot || [];
  const removeIds = collectLineIdsForRowRemoval(tr);
  let remaining = snapshot;
  if (removeIds.size > 0) {
    remaining = snapshot.filter((line) => !line.id || !removeIds.has(line.id));
  } else {
    const rowKeys = new Set(collectDailyLinesFromRow(tr).map((line) => dailyLineMergeKey(line)));
    remaining = snapshot.filter((line) => !rowKeys.has(dailyLineMergeKey(line)));
  }

  if (remaining.length === snapshot.length) {
    const orphanPersistedRow = entryId && removeIds.size > 0 && !snapshot.length;
    if (entryId && (shouldDeleteEntireDailyEntryForRow(tr) || orphanPersistedRow)) {
      return deleteDailyEntryById(entryId, { skipConfirm: true });
    }
    removeDailyEntryRowFromDom(tr);
    return true;
  }

  if (!remaining.length) return deleteDailyEntryById(entryId, { skipConfirm: true });

  try {
    const data = await apiJson(`${DAILY_API}/entries/batch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        file_number: getStayFileNumber(),
        patient_name: getStayPatientName(),
        entries: [
          {
            entry_id: entryId,
            entry_date: getLocalDateString(),
            stay_type_id: resolveStayTypeIdForSave(null, tr),
            notes: tr.dataset.entryNotes || '',
            lines: remaining,
          },
        ],
      }),
    });
    applyDailyInvoiceSync(data);
    showToast('تم حذف السطر', 'success');
    await loadDailyEntriesIntoSheet();
    await loadDailyPatientHistory();
    const fileNumber = getStayFileNumber();
    if (data.invoice_sync?.invoice_id && fileNumber) {
      await refreshInvoiceFormAfterDailySave(fileNumber, data.invoice_sync.invoice_id);
    }
    await refreshDailyStaySummary(fileNumber);
    if (window.AutoSave) {
      AutoSave.noteSaved('daily', getDailyAutosaveFingerprint());
    }
    return true;
  } catch (err) {
    showToast(sanitizeApiErrorMessage(err.message), 'danger');
    return false;
  }
}

function pauseDailyAutosave() {
  if (window.AutoSave?.cancel) window.AutoSave.cancel('daily');
  if (window.AutoSave?.setDisabled) window.AutoSave.setDisabled('daily', true);
}

function resumeDailyAutosave() {
  if (window.AutoSave?.setDisabled) window.AutoSave.setDisabled('daily', false);
}

async function withDailyAutosavePaused(fn) {
  dailyChargesDeleteInProgress = true;
  pauseDailyAutosave();
  if (dailyAutosaveInFlight || dailySaveInFlight) {
    try {
      await Promise.allSettled([dailyAutosaveInFlight, dailySaveInFlight]);
    } catch {
      /* ignore autosave errors while deleting */
    }
  }
  try {
    return await fn();
  } finally {
    dailyChargesDeleteInProgress = false;
    resumeDailyAutosave();
  }
}

function dedupeStayEntriesByDate(entries = []) {
  const byDate = new Map();
  for (const entry of entries) {
    const dateKey = fmtStayDate(entry.entry_date);
    if (!dateKey) continue;
    const existing = byDate.get(dateKey);
    if (!existing) {
      byDate.set(dateKey, { ...entry, lines: [...(entry.lines || [])] });
      continue;
    }
    const lineMap = new Map();
    for (const line of [...(existing.lines || []), ...(entry.lines || [])]) {
      lineMap.set(dailyLineMergeKey(line), line);
    }
    const keepId =
      Number(existing.id) > Number(entry.id) ? Number(existing.id) : Number(entry.id) || Number(existing.id);
    byDate.set(dateKey, {
      ...existing,
      id: keepId || existing.id || entry.id,
      stay_type_id: existing.stay_type_id || entry.stay_type_id,
      lines: [...lineMap.values()],
    });
  }
  return [...byDate.values()].sort((a, b) => fmtStayDate(a.entry_date).localeCompare(fmtStayDate(b.entry_date)));
}

function collectStayEntryIdsForDate(date) {
  const normalized = fmtStayDate(date);
  if (!normalized) return [];
  const ids = new Set();
  for (const entry of dailySheetEntriesCache || []) {
    if (fmtStayDate(entry.entry_date) !== normalized) continue;
    if (!entryHasStayChargeData(entry)) continue;
    if (entry.id) ids.add(Number(entry.id));
  }
  for (const tr of document.querySelectorAll('#daily-sections-body .daily-stay-row')) {
    const rowDate = fmtStayDate(tr.querySelector('.daily-row-date')?.value);
    if (rowDate !== normalized) continue;
    const entryId = Number(tr.dataset.entryId) || 0;
    if (entryId > 0) ids.add(entryId);
  }
  return [...ids].filter((id) => id > 0);
}

function removeStayRowsForDate(date) {
  const normalized = fmtStayDate(date);
  if (!normalized) return;
  [...document.querySelectorAll('#daily-sections-body .daily-stay-row')].forEach((tr) => {
    const rowDate = fmtStayDate(tr.querySelector('.daily-row-date')?.value);
    if (rowDate === normalized) removeDailyEntryRowFromDom(tr);
  });
}

function pruneDuplicateStayDomRows() {
  const byDate = new Map();
  for (const row of [...document.querySelectorAll('#daily-sections-body .daily-stay-row')]) {
    const date = fmtStayDate(row.querySelector('.daily-row-date')?.value);
    if (!date) continue;
    const existing = byDate.get(date);
    if (!existing) {
      byDate.set(date, row);
      continue;
    }
    const existingScore = Number(existing.dataset.entryId) || 0;
    const rowScore = Number(row.dataset.entryId) || 0;
    if (rowScore > existingScore) {
      removeDailyEntryRowFromDom(existing);
      byDate.set(date, row);
    } else {
      removeDailyEntryRowFromDom(row);
    }
  }
  renumberSheetRowSerials();
  updateDailyGrandTotal();
}

async function deleteDailyEntryById(entryId, options = {}) {
  if (!dailyCan('daily_charges.manage')) {
    showToast('ليس لديك صلاحية الحذف', 'warning');
    return false;
  }
  if (!entryId) return false;
  if (!options.skipConfirm && !confirm('حذف حركة هذا اليوم؟')) return false;

  try {
    const data = await apiJson(`${DAILY_API}/entries/${entryId}`, { method: 'DELETE' });
    applyDailyInvoiceSync(data);
    showToast('تم حذف الحركة', 'success');

    dailySheetEntriesCache = (dailySheetEntriesCache || []).filter(
      (entry) => Number(entry.id) !== Number(entryId)
    );
    await loadDailyEntriesIntoSheet();
    if (activeDailyTab === 'stay') pruneDuplicateStayDomRows();
    await loadDailyPatientHistory();
    const fileNumber = getStayFileNumber();
    if (data.invoice_sync?.invoice_id && fileNumber) {
      await refreshInvoiceFormAfterDailySave(fileNumber, data.invoice_sync.invoice_id);
    }
    if (fileNumber) await refreshDailyStaySummary(fileNumber);
    if (window.AutoSave) {
      AutoSave.noteSaved('daily', getDailyAutosaveFingerprint());
    }
    return true;
  } catch (err) {
    showToast(sanitizeApiErrorMessage(err.message), 'danger');
    return false;
  }
}

async function deleteStayRowGroup(tr) {
  if (!dailyCan('daily_charges.manage')) {
    showToast('ليس لديك صلاحية الحذف', 'warning');
    return;
  }
  const date = fmtStayDate(tr.querySelector('.daily-row-date')?.value || getLocalDateString());
  const idsToDelete = collectStayEntryIdsForDate(date);
  const domRowsForDate = [...document.querySelectorAll('#daily-sections-body .daily-stay-row')].filter(
    (row) => fmtStayDate(row.querySelector('.daily-row-date')?.value) === date
  );
  const message =
    domRowsForDate.length > 1 || idsToDelete.length > 1
      ? `يوجد ${Math.max(domRowsForDate.length, idsToDelete.length)} حركات إقامة لتاريخ ${date}. حذفها كلها؟`
      : idsToDelete.length === 1
        ? 'حذف حركة إقامة هذا اليوم؟'
        : 'حذف صف الإقامة؟';
  if (!confirm(message)) return;

  suppressDailyStayDate(date);
  removeStayRowsForDate(date);

  const fileNumber = getStayFileNumber();
  if (!fileNumber) {
    dailySheetEntriesCache = (dailySheetEntriesCache || []).filter(
      (entry) =>
        fmtStayDate(entry.entry_date) !== date || !entryHasStayChargeData(entry)
    );
    if (!document.querySelector('.daily-stay-row')) addDailyEntryRow();
    updateDailyGrandTotal();
    if (window.AutoSave) {
      AutoSave.noteSaved('daily', getDailyAutosaveFingerprint());
    }
    return;
  }

  try {
    const data = await apiJson(
      `${DAILY_API}/entries/stay-by-date?file_number=${encodeURIComponent(fileNumber)}&entry_date=${encodeURIComponent(date)}`,
      { method: 'DELETE' }
    );
    dailySheetEntriesCache = (dailySheetEntriesCache || []).filter(
      (entry) =>
        fmtStayDate(entry.entry_date) !== date || !entryHasStayChargeData(entry)
    );
    if (data?.invoice_sync) applyDailyInvoiceSync(data);
    if (!Number(data?.count) && idsToDelete.length) {
      for (const entryId of idsToDelete) {
        try {
          await apiJson(`${DAILY_API}/entries/${entryId}`, { method: 'DELETE' });
        } catch {
          /* fallback per-entry delete */
        }
      }
    }
    await loadDailyEntriesIntoSheet({ skipAutoRoom: true });
    pruneDuplicateStayDomRows();
    removeStayRowsForDate(date);
    if (!document.querySelector('.daily-stay-row')) addDailyEntryRow();
    updateDailyGrandTotal();
    await loadDailyPatientHistory();
    if (data?.invoice_sync?.invoice_id) {
      await refreshInvoiceFormAfterDailySave(fileNumber, data.invoice_sync.invoice_id);
    }
    await refreshDailyStaySummary(fileNumber);
    const deletedCount = Number(data?.count) || idsToDelete.length || 0;
    showToast(
      deletedCount > 1
        ? `تم حذف ${deletedCount} حركات إقامة`
        : deletedCount === 1
          ? 'تم حذف الحركة'
          : 'تم إزالة الإقامة من الشاشة والفاتورة',
      'success'
    );
    if (window.AutoSave) {
      AutoSave.noteSaved('daily', getDailyAutosaveFingerprint());
    }
  } catch (err) {
    showToast(sanitizeApiErrorMessage(err.message), 'danger');
    await loadDailyEntriesIntoSheet();
  }
}

async function deleteDailyEntryRow(tr) {
  return withDailyAutosavePaused(async () => {
    if (tr.classList.contains('daily-stay-row')) {
      await deleteStayRowGroup(tr);
      return;
    }
    const entryId = tr.dataset.entryId;
    if (entryId && shouldDeleteEntireDailyEntryForRow(tr)) {
      await deleteDailyEntryById(entryId);
      return;
    }
    if (entryId) {
      const removed = await removeRowLinesFromEntry(tr, Number(entryId));
      if (removed) return;
    }
    if (!entryId) {
      removeDailyEntryRowFromDom(tr);
      if (window.AutoSave) {
        AutoSave.noteSaved('daily', getDailyAutosaveFingerprint());
      }
      return;
    }
    await deleteDailyEntryById(entryId);
  });
}

function mergeStaySaveRows(rows) {
  if (!rows.length) return rows;
  const byDate = new Map();
  for (const row of rows) {
    const dateKey = fmtStayDate(row.entry_date) || getLocalDateString();
    if (!byDate.has(dateKey)) {
      byDate.set(dateKey, { ...row, entry_date: dateKey, lines: [...(row.lines || [])] });
      continue;
    }
    const merged = byDate.get(dateKey);
    if (row.entry_id && !merged.entry_id) merged.entry_id = row.entry_id;
    const rowStayTypeId = resolveStayTypeIdForSave(row.stay_type_id);
    if (rowStayTypeId) merged.stay_type_id = rowStayTypeId;
    if (row.notes) merged.notes = row.notes;
    const lineMap = new Map((merged.lines || []).map((line) => [dailyLineMergeKey(line), line]));
    for (const line of row.lines || []) {
      lineMap.set(dailyLineMergeKey(line), line);
    }
    merged.lines = [...lineMap.values()];
  }
  return [...byDate.values()];
}

function getDailyChargeDomRows() {
  const rowSelector =
    activeDailyTab === 'stay'
      ? '#daily-sections-body .daily-stay-row'
      : '#daily-sections-body .daily-entry-row:not(.daily-stay-addon-row)';
  return [...document.querySelectorAll(rowSelector)].filter((tr) => {
    if (activeDailyTab === 'stay') return stayRowGroupHasChargeData(tr);
    return rowHasChargeData(tr);
  });
}

function applySavedLineIdsToRow(tr, entry) {
  const lines = entry?.lines || [];
  if (tr.classList.contains('daily-lab-row')) {
    const lineId = Number(tr.dataset.lineId) || 0;
    const main =
      (lineId && lines.find((line) => Number(line.id) === lineId)) ||
      lines.find((line) => {
        if (line.section_code !== 'analyses') return false;
        const picker = tr.querySelector('.daily-picker[data-section="analyses"]');
        const svcId =
          Number(picker?.dataset?.serviceId) ||
          Number(tr.dataset.serviceCode) ||
          Number(picker?._selectedItem?.service_id) ||
          0;
        if (svcId > 0) return Number(line.service_id) === svcId;
        return true;
      });
    const stamp = lines.find((line) => line.section_code === 'analyses_stamp');
    if (main?.id) tr.dataset.lineId = String(main.id);
    if (stamp?.id) tr.dataset.stampLineId = String(stamp.id);
    const hidden = tr.querySelector('.daily-field.daily-amount[data-section="analyses"]');
    if (main?.id && hidden) hidden.dataset.lineId = String(main.id);
    return;
  }
  if (tr.classList.contains('daily-rad-row')) {
    const lineId = Number(tr.dataset.lineId) || 0;
    const main =
      (lineId && lines.find((line) => Number(line.id) === lineId)) ||
      lines.find((line) => {
        if (line.section_code !== 'xray_total') return false;
        const picker = tr.querySelector('.daily-picker[data-section="xray_total"]');
        const svcId = Number(picker?.dataset?.serviceId) || Number(picker?._selectedItem?.service_id) || 0;
        if (svcId > 0) return Number(line.service_id) === svcId;
        return true;
      });
    const stamp = lines.find((line) => line.section_code === 'xray_stamp');
    const type = lines.find((line) => line.section_code === 'xray_type');
    if (main?.id) tr.dataset.lineId = String(main.id);
    if (stamp?.id) tr.dataset.stampLineId = String(stamp.id);
    if (type?.id) tr.dataset.typeLineId = String(type.id);
    return;
  }
  if (tr.classList.contains('daily-exam-row')) {
    const examLineId = Number(tr.dataset.examLineId) || 0;
    const exam =
      (examLineId && lines.find((line) => Number(line.id) === examLineId)) ||
      lines.find((line) => ['consultant_exam', 'specialist_exam'].includes(line.section_code));
    const examId = exam?.id ? Number(exam.id) : 0;
    const stamp =
      (examId &&
        lines.find(
          (line) =>
            line.section_code === 'consultation_stamp' &&
            String(line.extra_text || '').trim() === `stamp_for:${examId}`
        )) ||
      lines.find((line) => line.section_code === 'consultation_stamp');
    if (exam?.id) tr.dataset.examLineId = String(exam.id);
    if (stamp?.id) tr.dataset.stampLineId = String(stamp.id);
    return;
  }
  if (tr.classList.contains('daily-session-row')) {
    const lineId = Number(tr.dataset.lineId) || 0;
    const session =
      (lineId && lines.find((line) => Number(line.id) === lineId)) ||
      lines.find((line) => line.section_code === 'sessions');
    if (session?.id) tr.dataset.lineId = String(session.id);
    return;
  }
  const primary =
    lines.find((line) => line.id && String(line.id) === String(tr.dataset.lineId)) ||
    lines.find((line) => {
      if (tr.classList.contains('daily-med-row')) {
        if (line.section_code !== 'medicines') return false;
        const picker = tr.querySelector('.daily-picker[data-section="medicines"]');
        const catId =
          Number(picker?.dataset?.catalogItemId) ||
          Number(picker?._selectedItem?.id) ||
          Number(tr.dataset.catalogCode) ||
          0;
        if (catId > 0) return Number(line.catalog_item_id) === catId;
        return true;
      }
      if (tr.classList.contains('daily-sup-row')) {
        const code = tr.dataset.sectionCode || 'supplies';
        if (line.section_code !== code) return false;
        const picker = tr.querySelector(`.daily-picker[data-section="${code}"]`);
        const catId =
          Number(picker?.dataset?.catalogItemId) ||
          Number(picker?._selectedItem?.id) ||
          Number(tr.dataset.catalogCode) ||
          0;
        if (catId > 0) return Number(line.catalog_item_id) === catId;
        return true;
      }
      if (tr.classList.contains('daily-misc-row')) {
        const code = tr.dataset.sectionCode || 'other';
        return line.section_code === code;
      }
      return false;
    });
  if (primary?.id) tr.dataset.lineId = String(primary.id);
}

function applySavedEntriesToDomRows(savedEntries = []) {
  const domRows = getDailyChargeDomRows();
  if (!domRows.length || !savedEntries.length) return;

  const savedById = new Map(
    savedEntries.filter((entry) => entry?.id).map((entry) => [String(entry.id), entry])
  );
  const savedByFingerprint = new Map();
  const savedByLineKey = new Map();
  for (const entry of savedEntries) {
    if (!entry?.id) continue;
    const fingerprint = buildClientLinesFingerprint(entry.lines || []);
    if (fingerprint) savedByFingerprint.set(fingerprint, entry);
    for (const line of entry.lines || []) {
      savedByLineKey.set(dailyLineMergeKey(line), entry);
    }
  }

  for (const tr of domRows) {
    let entry = null;
    const existingId = tr.dataset.entryId;
    if (existingId && savedById.has(String(existingId))) {
      entry = savedById.get(String(existingId));
    } else if (tr.classList.contains('daily-stay-row')) {
      const rowDate = fmtStayDate(tr.querySelector('.daily-row-date')?.value);
      entry = savedEntries.find(
        (candidate) =>
          candidate?.id &&
          fmtStayDate(candidate.entry_date) === rowDate &&
          entryHasStayChargeData(candidate)
      );
    } else {
      const rowLines = collectDailyLinesFromRow(tr);
      for (const line of rowLines) {
        const match = savedByLineKey.get(dailyLineMergeKey(line));
        if (match) {
          entry = match;
          break;
        }
      }
      if (!entry) {
        const fingerprint = buildClientLinesFingerprint(rowLines);
        entry = fingerprint ? savedByFingerprint.get(fingerprint) : null;
      }
    }
    if (!entry?.id) continue;
    tr.dataset.entryId = String(entry.id);
    if (tr.classList.contains('daily-stay-row')) {
      tr._entryLinesSnapshot = (entry.lines || []).map((line) => ({ ...line }));
      if (entry.stay_type_id) tr.dataset.stayTypeId = String(entry.stay_type_id);
    }
    applySavedLineIdsToRow(tr, entry);
    if (tr.classList.contains('daily-lab-row')) {
      tr._entryLinesSnapshot = dailyRowSnapshotExcluding(
        entry,
        entry.lines?.find((line) => line.section_code === 'analyses'),
        ['analyses', 'analyses_stamp']
      );
    } else if (tr.classList.contains('daily-rad-row')) {
      tr._entryLinesSnapshot = dailyRowSnapshotExcluding(
        entry,
        entry.lines?.find((line) => line.section_code === 'xray_total'),
        ['xray_total', 'xray_stamp', 'xray_type']
      );
    } else if (tr.classList.contains('daily-med-row')) {
      tr._entryLinesSnapshot = dailyRowSnapshotExcluding(
        entry,
        entry.lines?.find((line) => line.section_code === 'medicines'),
        ['medicines']
      );
    } else if (tr.classList.contains('daily-sup-row')) {
      const code = tr.dataset.sectionCode || 'supplies';
      tr._entryLinesSnapshot = dailyRowSnapshotExcluding(
        entry,
        entry.lines?.find((line) => line.section_code === code),
        ['supplies', 'cosmetics']
      );
    } else if (tr.classList.contains('daily-misc-row')) {
      const code = tr.dataset.sectionCode || 'other';
      tr._entryLinesSnapshot = dailyRowSnapshotExcluding(
        entry,
        entry.lines?.find((line) => line.section_code === code),
        ['other', 'prosthetics']
      );
    } else if (tr.classList.contains('daily-exam-row')) {
      const examLineId = Number(tr.dataset.examLineId) || 0;
      const examLine =
        entry.lines?.find((line) => examLineId && Number(line.id) === examLineId) ||
        entry.lines?.find((line) => ['consultant_exam', 'specialist_exam'].includes(line.section_code));
      tr._entryLinesSnapshot = dailyRowSnapshotExcluding(entry, examLine, [
        'consultant_exam',
        'specialist_exam',
        'consultation_stamp',
      ]);
      if (entry.doctor_id) {
        tr.dataset.doctorId = String(entry.doctor_id);
        void hydrateDailyDoctorSuggest(tr, entry.doctor_id);
      }
    } else if (tr.classList.contains('daily-session-row')) {
      const lineId = Number(tr.dataset.lineId) || 0;
      const sessionLine =
        entry.lines?.find((line) => lineId && Number(line.id) === lineId) ||
        entry.lines?.find((line) => line.section_code === 'sessions');
      tr._entryLinesSnapshot = dailyRowSnapshotExcluding(entry, sessionLine, [
        'sessions',
        'sessions_date',
        'sessions_detail',
      ]);
    }
  }
}

function collectDailyRowsForSave() {
  const notes = document.getElementById('daily-notes')?.value || '';
  const today = getLocalDateString();
  const rows = [];
  const rowSelector =
    activeDailyTab === 'stay'
      ? '#daily-sections-body .daily-stay-row'
      : '#daily-sections-body .daily-entry-row:not(.daily-stay-addon-row)';
  document.querySelectorAll(rowSelector).forEach((tr) => {
    if (activeDailyTab === 'stay' && !stayRowGroupHasChargeData(tr)) return;
    if (activeDailyTab !== 'stay' && !rowHasChargeData(tr)) return;
    const entryId = tr.dataset.entryId ? Number(tr.dataset.entryId) : null;
    const rowDate = tr.querySelector('.daily-row-date')?.value || today;
    if (activeDailyTab === 'stay' && isDailyStayDateSuppressed(rowDate)) return;
    const examDoctorId =
      tr.querySelector('.daily-exam-doctor')?.value || tr.dataset.doctorId || null;
    // entry_date must always be business-today (the server rejects anything else —
    // resolveAllowedDailyEntryDate); the clinical exam date the user can edit is
    // preserved separately on the line's extra_date by collectExamLinesFromRow.
    rows.push({
      entry_id: entryId,
      entry_date: activeDailyTab === 'stay' ? rowDate : today,
      stay_type_id: resolveStayTypeIdForSave(null, tr),
      doctor_specialty:
        tr.querySelector('.daily-row-specialty')?.value || tr.dataset.doctorSpecialty || '',
      doctor_id:
        activeDailyTab === 'exams'
          ? examDoctorId
          : tr.querySelector('.daily-row-doctor')?.value || tr.dataset.doctorId || null,
      notes: tr.dataset.entryNotes || notes,
      lines: collectDailyLinesFromRow(tr),
    });
  });
  const merged = mergeDailySaveEntries(rows);
  if (activeDailyTab === 'stay') {
    return mergeStaySaveRows(merged);
  }
  // كل صف كشف = حركة مستقلة (طبيب + بند) — لا تدمج في entry واحد لأن doctor_id يُفقد
  if (activeDailyTab === 'exams') {
    return merged;
  }
  if (DAILY_TODAY_MERGE_TABS.includes(activeDailyTab)) {
    return mergeTodayTabSaveRows(merged);
  }
  return merged;
}

function examRowDoctorEntryConflict(tr, doctorId) {
  const entryId = tr?.dataset?.entryId;
  if (!entryId || !doctorId) return false;
  return [...document.querySelectorAll(`.daily-exam-row[data-entry-id="${CSS.escape(entryId)}"]`)].some(
    (other) =>
      other !== tr &&
      other.dataset.doctorId &&
      Number(other.dataset.doctorId) !== Number(doctorId)
  );
}

function splitExamSaveRowsByEntry(rows = []) {
  const seenEntryIds = new Set();
  return rows.map((row) => {
    const id = Number(row.entry_id) || 0;
    const copy = { ...row, lines: [...(row.lines || [])] };
    if (!id) return copy;
    if (seenEntryIds.has(id)) {
      copy.entry_id = null;
      return copy;
    }
    seenEntryIds.add(id);
    return copy;
  });
}

function mergeExamSaveEntries(rows) {
  if (!rows.length) return rows;
  return mergeFreshDailySaveRows(splitExamSaveRowsByEntry(rows));
}

function mergeDailySaveEntries(rows) {
  if (activeDailyTab === 'exams') return mergeExamSaveEntries(rows);
  if (!rows.length) return rows;
  const byEntryId = new Map();
  const freshRows = [];

  for (const row of rows) {
    const entryId = Number(row.entry_id) || 0;
    if (!entryId) {
      freshRows.push(row);
      continue;
    }
    const key = String(entryId);
    if (!byEntryId.has(key)) {
      byEntryId.set(key, { ...row, lines: [...(row.lines || [])] });
      continue;
    }
    const merged = byEntryId.get(key);
    const lineMap = new Map((merged.lines || []).map((line) => [dailyLineMergeKey(line), line]));
    for (const line of row.lines || []) {
      lineMap.set(dailyLineMergeKey(line), line);
    }
    merged.lines = [...lineMap.values()];
    if (row.doctor_id) merged.doctor_id = row.doctor_id;
    if (row.doctor_specialty) merged.doctor_specialty = row.doctor_specialty;
    if (row.stay_type_id) merged.stay_type_id = row.stay_type_id;
    if (row.notes) merged.notes = row.notes;
  }

  return mergeFreshDailySaveRows([...byEntryId.values(), ...freshRows]);
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

async function saveAllDailyCharges() {
  if (activeDailyTab === 'free-items') return saveFreeItems();
  if (!dailyStayContext?.invoice?.id) {
    showToast('لا توجد فاتورة مفتوحة — افتح المريض أولًا', 'warning');
    return;
  }
  if (!dailyCan('daily_charges.manage')) {
    showToast('ليس لديك صلاحية تسجيل الحركة اليومية', 'warning');
    return;
  }

  const homeTab = activeDailyTab;
  const tabs = DAILY_TAB_GROUPS.map((g) => g.id).filter((id) => id !== 'free-items');
  let savedTabs = 0;

  for (const tab of tabs) {
    if (tab === 'stay' && !canUseDailyStayCharges()) continue;
    await showDailySection(tab, { skipUnsavedPrompt: true });
    if (tab === 'operations') {
      const ops = collectOperationsFromTable();
      if (ops.length && (await saveOperationsPanel({ silent: true }))) savedTabs += 1;
      continue;
    }
    const rows = collectDailyRowsForSave();
    if (!rows.length) continue;
    if (await saveDailyEntryNow({ silent: true })) savedTabs += 1;
  }

  if (homeTab && homeTab !== activeDailyTab) {
    await showDailySection(homeTab, { skipUnsavedPrompt: true });
  }

  const freeItems = collectFreeItemsFromTable();
  const hasFree = freeItems.some((item) => item.description || item.amount > 0);
  if (hasFree) await saveFreeItems();

  if (savedTabs > 0) {
    showToast(
      `تم حفظ ${savedTabs} شاشة/تبويب — البيانات محفوظة في قاعدة البيانات`,
      'success'
    );
  } else {
    showToast('لا توجد بيانات جديدة للحفظ في الشاشات', 'info');
  }
}

async function saveDailyEntry(options = {}) {
  const { silent = false } = options;
  if (activeDailyTab === 'free-items') {
    return saveFreeItems(options);
  }
  if (activeDailyTab === 'operations') {
    return saveOperationsPanel(options);
  }
  if (!dailyCan('daily_charges.manage')) {
    if (!silent) showToast('ليس لديك صلاحية تسجيل الحركة اليومية', 'warning');
    return false;
  }
  if (!dailyStayContext?.invoice?.id) {
    if (!silent) showToast('لا توجد فاتورة مفتوحة — سجّل المريض من تسجيل مريض جديد أولًا', 'warning');
    return false;
  }
  if (dailySaveInFlight) {
    try {
      return await dailySaveInFlight;
    } catch {
      /* retry below */
    }
  }

  dailySaveInFlight = saveDailyEntryNow({ silent });
  try {
    return await dailySaveInFlight;
  } finally {
    dailySaveInFlight = null;
  }
}

function validateExamSaveEntries(entries = []) {
  for (const row of entries) {
    // A doctor is only required when the row actually carries an exam charge
    // (consultant_exam/specialist_exam) — a row with only a consultation_stamp
    // line (no exam picked) isn't doctor-attributed and shouldn't be blocked.
    const hasExamLine = (row.lines || []).some((line) =>
      ['consultant_exam', 'specialist_exam'].includes(line.section_code)
    );
    if (!hasExamLine) continue;
    const doctorId = Number(row.doctor_id) || 0;
    if (!doctorId) {
      throw new Error('اختر الطبيب من القائمة لكل كشف (انقر على الاسم) ثم احفظ');
    }
  }
}

async function saveDailyEntryNow(options = {}) {
  const { silent = false, previewFlush = false } = options;
  const file_number = getStayFileNumber();
  const entries = enrichSaveEntriesWithPreservedLines(collectDailyRowsForSave());
  if (!file_number || !entries.length) {
    if (!silent) showToast('أضف صفًا واحدًا على الأقل مع بيانات', 'warning');
    return false;
  }

  try {
    if (activeDailyTab === 'exams') validateExamSaveEntries(entries);
    const data = await apiJson(`${DAILY_API}/entries/batch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        file_number,
        patient_name: getStayPatientName(),
        entries,
        operations: activeDailyTab === 'operations' ? [] : collectOperationsFromTable(),
        glasses_total: getGlassesFinalAmount(),
        patient_fields: {
          ...collectPatientDemographics('daily'),
          phone: document.getElementById('daily-stay-phone')?.value?.trim() || '',
          nationality: normalizeNationalitySelectValue(
            document.getElementById('daily-stay-nationality')?.value
          ),
          gender: document.getElementById('daily-stay-gender')?.value || '',
          age: document.getElementById('daily-stay-age')?.value?.trim() || null,
        },
      }),
    });

    dailyCurrentEntryId = data.saved?.[data.saved.length - 1]?.id || null;

    const prevTab = activeDailyTab;
    const tabLabel = dailyTabLabel(prevTab);
    const toastMsg = `تم حفظ «${tabLabel}» على الفاتورة #${data.invoice_sync.invoice_id} — للشاشات الأخرى استخدم «حفظ الكل» أو احفظ كل تبويب قبل الانتقال`;
    await refreshInvoiceFormAfterDailySave(file_number, data.invoice_sync.invoice_id);
    await refreshDailyStaySummary(file_number);
    applySavedEntriesToDomRows(data.saved || []);
    if (activeDailyTab === 'stay') pruneDuplicateStayDomRows();
    if (DAILY_SHEET_ROW_CLASS_BY_TAB[activeDailyTab]) pruneDuplicateSheetDomRows(activeDailyTab);
    const shouldReloadSheet = !silent || previewFlush;
    if (shouldReloadSheet) {
      await loadDailyEntriesIntoSheet();
      await loadDailyPatientHistory();
      if (prevTab && activeDailyTab !== prevTab) {
        showDailySection(prevTab, { skipUnsavedPrompt: true });
      }
      updateSectionTabTotal();
    }
    if (silent && !previewFlush) {
      if (window.AutoSave?.isEnabled?.()) {
        AutoSave.noteSaved('daily', getDailyAutosaveFingerprint());
      }
    }

    const statusEl = document.getElementById('daily-entry-status');
    if (!silent || previewFlush) {
      if (statusEl) statusEl.textContent = `محفوظ — ${data.count} صف`;
      if (!silent) showToast(toastMsg, 'success');
    }
    captureDailySheetBaseline();
    return true;
  } catch (err) {
    if (!silent) {
      showToast(sanitizeApiErrorMessage(err.message), 'danger');
    } else if (window.AutoSave) {
      AutoSave.setStatus('daily', 'error', sanitizeApiErrorMessage(err.message));
    }
    return false;
  }
}

function isDailyPanelFocused() {
  const el = document.activeElement;
  return Boolean(
    el &&
      el.closest('#daily-tabs-sheet-panel, #daily-operations-panel, #daily-free-items-panel')
  );
}

function getDailyAutosaveFingerprint() {
  if (activeDailyTab === 'free-items') return JSON.stringify(collectFreeItemsFromTable());
  if (activeDailyTab === 'operations') return JSON.stringify(collectOperationsFromTable());
  return JSON.stringify({
    tab: activeDailyTab,
    entries: collectDailyRowsForSave(),
    notes: document.getElementById('daily-notes')?.value || '',
  });
}

function canAutoSaveDailyCharges() {
  if (dailyChargesDeleteInProgress) return false;
  if (!dailyCan('daily_charges.manage')) return false;
  if (!dailyStayContext?.invoice?.id) return false;
  const view = document.getElementById('view-daily');
  if (view && view.style.display === 'none') return false;
  if (activeDailyTab === 'free-items') return collectFreeItemsFromTable().length > 0;
  if (activeDailyTab === 'operations') return collectOperationsFromTable().length > 0;
  return collectDailyRowsForSave().length > 0;
}

async function autoSaveDailyCharges() {
  if (dailyChargesDeleteInProgress) return false;
  if (dailyAutosaveInFlight) return dailyAutosaveInFlight;
  dailyAutosaveInFlight = saveDailyEntry({ silent: true, auto: true }).finally(() => {
    dailyAutosaveInFlight = null;
  });
  return dailyAutosaveInFlight;
}

function initDailyAutosaveAndEnterRow() {
  if (window.AutoSave && !window.__dailyAutosaveReady) {
    window.__dailyAutosaveReady = true;
    AutoSave.register('daily', {
      statusEl: 'daily-entry-status',
      debounceMs: 6000,
      canSave: canAutoSaveDailyCharges,
      getFingerprint: getDailyAutosaveFingerprint,
      save: autoSaveDailyCharges,
    });
    const panel = document.getElementById('view-daily');
    if (panel && AutoSave.isEnabled?.()) {
      AutoSave.installChangeListeners(panel, 'daily');
    } else {
      const statusEl = document.getElementById('daily-entry-status');
      if (statusEl) statusEl.textContent = 'حفظ يدوي — اضغط حفظ أو حفظ الكل';
    }
  }

  if (window.EnterAddRow && !window.__dailyEnterRowReady) {
    window.__dailyEnterRowReady = true;
    EnterAddRow.register({
      rowSelector: '.daily-entry-row',
      container: '#daily-sections-body',
      canHandle: () => dailyCan('daily_charges.manage') && Boolean(dailyStayContext?.invoice?.id),
      rowHasData: (row) => rowHasChargeData(row),
      addRow: () => handleDailySheetAddRow(),
    });
    EnterAddRow.register({
      rowSelector: '.daily-operation-row',
      container: '#daily-operations-tbody',
      canHandle: () => dailyCan('daily_charges.manage') && Boolean(dailyStayContext?.invoice?.id),
      rowHasData: (row) => !operationRowIsBlank(row),
      addRow: () => addOperationRow(),
    });
    EnterAddRow.register({
      rowSelector: '.daily-free-item-row',
      container: '#daily-free-items-tbody',
      canHandle: () => dailyCan('daily_charges.manage') && Boolean(dailyStayContext?.invoice?.id),
      rowHasData: (row) => !freeItemRowIsBlank(row),
      addRow: () => addFreeItemRow(),
    });
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

function openNewPatientRegistration() {
  patientRegEditMode = false;
  patientRegEditFileNumber = '';
  if (typeof switchView === 'function') {
    switchView('patient-register');
    initPatientRegistration();
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
  const opsBody = document.getElementById('daily-operations-tbody');
  if (opsBody) {
    opsBody.innerHTML = '';
    ensureOperationRows();
  }
  updateDailyGrandTotal();
}

async function showDailyBuildBadge() {
  const el = document.getElementById('daily-build-badge');
  if (el) el.textContent = '';
}

async function initDailyChargesView(options = {}) {
  if (!dailyCan('daily_charges.view')) return;
  try {
    if (typeof loadFinancialTreatments === 'function') await loadFinancialTreatments();
    await loadDailyDoctorSpecialties();
    await loadDailyStayTypes();
    await loadDailyStayGrades();
    populateStayTypeSelects();
    void loadPatientEntitySelects();
    if (!dailySectionsCache.length) await loadDailySections();
    if (dailySectionsLoadFailed) return;
    await reloadDailyServiceCaches();
    renderDailySectionTabs();
    setDailyTodayDate();
    void showDailyBuildBadge();
    if (typeof bindCommaAmountInputs === 'function') {
      bindCommaAmountInputs(document.getElementById('view-daily'));
    }
    const openFile = String(options.openFileNumber || '').trim();
    void reconcileAllRegisteredPatientsOnce();
    if (openFile) {
      await selectDailyPatient(openFile, { preserveTab: options.preserveTab !== false });
    } else if (dailyStayContext?.patient?.file_number && dailyStayContext?.invoice?.id) {
      applyDailyStayContext(dailyStayContext);
      const workspaceOpen = !document.getElementById('daily-patient-workspace')?.classList.contains('d-none');
      showDailyPatientWorkspace(dailyStayContext, { preserveTab: workspaceOpen });
      const tab = activeDailyTab || sessionStorage.getItem('dailyActiveTab');
      if (tab) await showDailySection(tab, { skipUnsavedPrompt: true });
    } else {
      showDailyPatientPicker();
    }
  } catch (err) {
    showToast(sanitizeApiErrorMessage(err.message), 'danger');
  }
}

function appendInvoiceItemRow(item) {
  let targetRow = null;
  document.querySelectorAll('#items-tbody tr').forEach((row) => {
    if (row.dataset.staySync || row.dataset.sectionHeader || row.dataset.sectionAggregate) return;
    const descEl = row.querySelector('[data-field="description"]');
    if (!descEl) return;
    const desc = descEl.value?.trim();
    if (!desc && !targetRow) targetRow = row;
  });
  if (!targetRow) {
    document.getElementById('add-row-btn')?.click();
    const rows = document.querySelectorAll('#items-tbody tr');
    targetRow = rows[rows.length - 1];
  }
  if (!targetRow) return;
  const descEl = targetRow.querySelector('[data-field="description"]');
  const qtyEl = targetRow.querySelector('[data-field="quantity"]');
  const amtEl = targetRow.querySelector('[data-field="amount"]');
  if (!descEl || !qtyEl || !amtEl) return;
  descEl.value = item.description || '';
  const serviceIdEl = targetRow.querySelector('[data-field="service_id"]');
  if (serviceIdEl) serviceIdEl.value = item.service_id || '';
  qtyEl.value =
    item.quantity != null && item.quantity !== ''
      ? typeof formatAmountInput === 'function'
        ? formatAmountInput(item.quantity, 0)
        : item.quantity
      : typeof formatAmountInput === 'function'
        ? formatAmountInput(1, 0)
        : 1;
  amtEl.value =
    item.amount != null && item.amount !== ''
      ? typeof formatAmountInput === 'function'
        ? formatAmountInput(item.amount)
        : item.amount
      : '';
  if (item.daily_entry_line_id) targetRow.dataset.dailyLineId = item.daily_entry_line_id;
  if (item.daily_entry_id) targetRow.dataset.dailyEntryId = item.daily_entry_id;
}

function syncDailyChargeRowsFromTotals(totalsItems = []) {
  if (document.querySelector('#items-tbody .invoice-section-aggregate-row')) return 0;
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

    const added = syncDailyChargeRowsFromTotals(
      data.items.map((item) => ({
        ...item,
        daily_entry_line_id: item.daily_entry_line_id,
        description: item.description,
        quantity: item.quantity,
        amount: item.unit_price ?? item.amount,
        total: item.total ?? item.amount,
      }))
    );
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

function clearDailyStayRegistrationOnly() {
  sessionStorage.removeItem('dailyStayFileNumber');
  clearDailyStayFormFields();
  applyDailyStayContext(null);
  clearDailyForm();
}

document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.patient-type-tile').forEach((btn) => {
    btn.addEventListener('click', () => showPatientRegisterForm(btn.dataset.patientType));
  });
  document.getElementById('patient-register-change-type')?.addEventListener('click', () => {
    showPatientRegisterTypePicker();
    clearPatientRegisterForm();
  });
  document.getElementById('patient-register-form')?.addEventListener('submit', savePatientRegistration);
  document.getElementById('patient-reg-invoice-type')?.addEventListener('change', () => {
    togglePatientRegEntityFields();
    const dailyType = document.getElementById('daily-stay-invoice-type');
    const regType = document.getElementById('patient-reg-invoice-type');
    if (dailyType && regType) dailyType.value = regType.value;
    toggleDailyStayEntityFields();
  });
  document.getElementById('patient-reg-entity')?.addEventListener('change', onPatientRegEntityChange);
  document.getElementById('patient-reg-letter-from')?.addEventListener('change', updateLetterAuthorizedDaysDisplay);
  document.getElementById('patient-reg-letter-to')?.addEventListener('change', updateLetterAuthorizedDaysDisplay);
  document.getElementById('patient-reg-military-from')?.addEventListener('change', updatePatientRegMilitarySummary);
  document.getElementById('patient-reg-military-to')?.addEventListener('change', updatePatientRegMilitarySummary);
  document.getElementById('patient-reg-military-amount')?.addEventListener('input', updatePatientRegMilitarySummary);
  document.getElementById('daily-stay-invoice-type')?.addEventListener('change', () => {
    toggleDailyStayEntityFields();
    updateDailyMilitaryAuthBanner();
  });
  document.getElementById('daily-edit-patient-btn')?.addEventListener('click', () => {
    void openPatientEditFromDaily();
  });
  document.getElementById('daily-change-room-btn')?.addEventListener('click', openChangeRoomModal);
  document.getElementById('change-room-submit-btn')?.addEventListener('click', submitChangeRoom);
  document.getElementById('batch-stay-submit-btn')?.addEventListener('click', submitBatchStayPost);
  document.getElementById('daily-stay-open-btn')?.addEventListener('click', saveOpenPatientStay);
  document.getElementById('daily-stay-lookup-btn')?.addEventListener('click', () => loadOpenPatientStay());
  document.getElementById('daily-invoice-pdf-btn')?.addEventListener('click', openDailyInvoicePdf);
  document.getElementById('daily-patient-search-btn')?.addEventListener('click', () => {
    const q = document.getElementById('daily-patient-search')?.value || '';
    void loadDailyPatientGrid(q);
  });
  document.getElementById('daily-patient-search')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const q = document.getElementById('daily-patient-search')?.value || '';
      void loadDailyPatientGrid(q);
    }
  });
  document.getElementById('daily-patient-list')?.addEventListener('click', (e) => {
    const row = e.target.closest('.daily-patient-row');
    if (!row) return;
    if (e.target.closest('.daily-patient-row')) {
      void selectDailyPatient(row.dataset.fileNumber);
    }
  });
  document.getElementById('daily-open-invoice-btn')?.addEventListener('click', openDailyInvoiceFromDaily);
  document.getElementById('daily-entry-tabs')?.addEventListener('click', (e) => {
    const tab = e.target.closest('.daily-section-tab');
    if (!tab) return;
    if (!dailyStayContext?.invoice?.id) {
      showToast('لا توجد فاتورة مفتوحة لهذا المريض', 'warning');
      return;
    }
    void showDailySection(tab.dataset.dailyTab).then((ok) => {
      if (ok === false) renderDailySectionTabs();
    });
  });
  document.getElementById('daily-change-patient-btn')?.addEventListener('click', () => {
    showDailyPatientPicker();
    void loadDailyPatientGrid();
  });
  document.getElementById('daily-convert-internal-btn')?.addEventListener('click', () => {
    void convertExternalPatientToInternal();
  });
  document.getElementById('daily-goto-register-btn')?.addEventListener('click', () => {
    if (typeof switchView === 'function') switchView('patient-register');
  });
  document.getElementById('daily-print-medicines-btn')?.addEventListener('click', () =>
    openDailyItemsPrint('medicines')
  );
  document.getElementById('daily-print-supplies-btn')?.addEventListener('click', () =>
    openDailyItemsPrint('supplies')
  );
  document.getElementById('daily-print-both-btn')?.addEventListener('click', () =>
    openDailyItemsPrint('medicines_supplies')
  );
  document.getElementById('daily-print-stay-btn')?.addEventListener('click', () => openDailyItemsPrint('stay'));
  document.getElementById('daily-print-sessions-btn')?.addEventListener('click', () =>
    openDailyItemsPrint('sessions')
  );
  document.getElementById('daily-print-other-btn')?.addEventListener('click', () => openDailyItemsPrint('other'));
  document.getElementById('daily-print-free-items-btn')?.addEventListener('click', () =>
    openDailyItemsPrint('free_items')
  );
  document.getElementById('daily-print-radiology-btn')?.addEventListener('click', () =>
    openDailyItemsPrint('radiology')
  );
  document.getElementById('daily-print-laboratory-btn')?.addEventListener('click', () =>
    openDailyItemsPrint('laboratory')
  );
  document.getElementById('daily-print-exams-btn')?.addEventListener('click', () =>
    openDailyItemsPrint('exams')
  );
  document.getElementById('daily-print-operations-btn')?.addEventListener('click', () =>
    openDailyItemsPrint('operations')
  );
  document.getElementById('daily-print-all-btn')?.addEventListener('click', () =>
    openDailyItemsPrint('all_sections')
  );
  document.getElementById('daily-save-btn')?.addEventListener('click', saveDailyEntry);
  document.getElementById('daily-save-all-btn')?.addEventListener('click', () => {
    void saveAllDailyCharges();
  });
  document.getElementById('daily-add-row-btn')?.addEventListener('click', handleDailySheetAddRow);
  document.getElementById('daily-sheet-add-row-btn')?.addEventListener('click', handleDailySheetAddRow);
  document.getElementById('daily-stay-extra-acc-btn')?.addEventListener('click', addStayAccommodationAddonForDay);
  document.getElementById('daily-sheet-scope')?.addEventListener('change', (e) => {
    dailySheetDateScope = e.target.value === 'period' ? 'period' : 'today';
    void loadDailyEntriesIntoSheet();
  });
  document.getElementById('daily-sheet-scope-jump')?.addEventListener('click', () => {
    dailySheetDateScope = 'period';
    const sel = document.getElementById('daily-sheet-scope');
    if (sel) sel.value = 'period';
    void loadDailyEntriesIntoSheet();
  });
  document.getElementById('daily-tab-import-btn')?.addEventListener('click', () => {
    document.getElementById('daily-tab-import-input')?.click();
  });
  document.getElementById('daily-tab-import-input')?.addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    if (file) void handleDailyTabImport(file);
  });
  document.getElementById('daily-op-add-row')?.addEventListener('click', () => addOperationRow());
  document.getElementById('daily-free-add-row')?.addEventListener('click', () => addFreeItemRow());
  document.getElementById('daily-free-save-btn')?.addEventListener('click', () => {
    void saveFreeItems();
  });
  document.getElementById('import-daily-charges-btn')?.addEventListener('click', importDailyChargesToInvoice);
  initDailyAutosaveAndEnterRow();
});

function clearDailyChargesSession() {
  dailyStayContext = null;
  dailySavedSheetFingerprint = '';
  activeDailyTab = '';
  dailySheetDateScope = 'today';
  sessionStorage.removeItem('dailyStayFileNumber');
  sessionStorage.removeItem('dailyActiveTab');
}

window.initDailyChargesView = initDailyChargesView;
window.clearDailyChargesSession = clearDailyChargesSession;
window.initPatientRegistration = initPatientRegistration;
window.openNewPatientRegistration = openNewPatientRegistration;
window.loadDailyDoctorSpecialties = loadDailyDoctorSpecialties;
window.importDailyChargesToInvoice = importDailyChargesToInvoice;
window.syncDailyChargeRowsFromTotals = syncDailyChargeRowsFromTotals;
window.reloadDailyCatalogSectionsFromSettings = reloadDailyCatalogSectionsFromSettings;
window.reloadDailyServiceCaches = reloadDailyServiceCaches;
