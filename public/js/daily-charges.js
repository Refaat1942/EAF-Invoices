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
  civil: 'خاص',
  contracted: 'جهة متعاقدة',
  non_contracted: 'جهة غير متعاقدة',
  military: 'عسكري',
  hospital: 'حالة مستشفى',
  special: 'حالة خاصة',
};

const DAILY_CLINICAL_TABS = ['exams', 'lab', 'radiology', 'sessions', 'medicines', 'supplies'];

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
  sessions: { kind: 'excel', template_key: 'physio', label: 'رفع العلاج الطبيعي' },
  exams: { kind: 'excel', template_key: 'medical_exams', label: 'رفع الكشوفات' },
  lab: { kind: 'excel', template_key: 'lab', label: 'رفع التحاليل' },
  radiology: { kind: 'excel', template_key: 'radiology', label: 'رفع الأشعة' },
  other: { kind: 'excel', label: 'رفع ملف خدمات', detect_from_filename: true },
  stay: { kind: 'excel', template_key: 'accommodation', label: 'رفع الإقامات' },
  operations: { kind: 'excel', template_key: 'spine_operations', label: 'رفع العمليات الجراحية' },
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
    } else if (cfg.kind === 'excel') {
      const form = new FormData();
      form.append('file', file);
      form.append('replace_existing', 'false');
      if (cfg.template_key && !cfg.detect_from_filename) {
        form.append('template_key', cfg.template_key);
      }
      const res = await apiFetch(`${DAILY_PRICING_API}/import-excel`, { method: 'POST', body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      const label = data.template_label || cfg.label;
      const msg = `تم تحديث «${label}»: ${data.imported || 0} جديد، ${data.updated || 0} محدّث`;
      showToast(msg, 'success');
      if (typeof loadCatalogCache === 'function') await loadCatalogCache();
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
let dailyEntriesLoadSeq = 0;
let dailyStayTypesCache = [];
let dailyStayGradesCache = [];
let dailySpecialtiesCache = [];
let dailyCompanionServicesCache = [];
let dailyExamServicesCache = [];

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

let dailySheetSerialNext = 1;
const dailySheetSerialMap = new Map();
let dailySheetEntriesCache = [];
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

function getOperationsAllDaysTotal() {
  let todayDom = 0;
  document.querySelectorAll('#daily-operations-tbody .daily-op-amount').forEach((input) => {
    todayDom += dailyParseAmount(input.value);
  });
  const otherDays = Math.max(0, dailyOperationsAllTotalCache - dailyOperationsTodaySavedTotal);
  return otherDays + todayDom;
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

async function fetchDailyDoctorSuggestions(search = '', selectedId = null) {
  const params = new URLSearchParams();
  if (search) params.set('search', search);
  if (selectedId) params.set('include_doctor_id', selectedId);
  params.set('limit', '25');
  return await apiJson(`/api/doctors/for-daily?${params}`);
}

function buildDailyDoctorSuggestHtml(name = '', doctorId = '') {
  return `
    <div class="daily-doctor-suggest-wrap position-relative">
      <input type="search" class="form-control form-control-sm daily-exam-doctor-search" value="${dailyEscapeAttr(name)}" autocomplete="off">
      <input type="hidden" class="daily-exam-doctor" value="${dailyEscapeAttr(doctorId ? String(doctorId) : '')}">
      <div class="daily-doctor-suggest-menu list-group shadow-sm d-none"></div>
    </div>`;
}

function bindDailyDoctorSuggestWrap(tr) {
  const wrap = tr.querySelector('.daily-doctor-suggest-wrap');
  if (!wrap || wrap.dataset.bound === '1') return;
  wrap.dataset.bound = '1';
  const input = wrap.querySelector('.daily-exam-doctor-search');
  const hidden = wrap.querySelector('.daily-exam-doctor');
  const menu = wrap.querySelector('.daily-doctor-suggest-menu');
  if (!input || !hidden || !menu) return;

  const hideMenu = () => menu.classList.add('d-none');
  const pickDoctor = (id, name) => {
    hidden.value = id ? String(id) : '';
    input.value = name || '';
    tr.dataset.doctorId = hidden.value;
    hideMenu();
  };

  menu.addEventListener('click', (e) => {
    const btn = e.target.closest('.daily-doctor-suggest-opt');
    if (!btn) return;
    pickDoctor(btn.dataset.id, btn.textContent.trim());
  });

  input.addEventListener('input', () => {
    clearTimeout(wrap._doctorTimer);
    wrap._doctorTimer = setTimeout(async () => {
      const q = input.value.trim();
      if (!q) {
        hidden.value = '';
        tr.dataset.doctorId = '';
        hideMenu();
        return;
      }
      try {
        const doctors = await fetchDailyDoctorSuggestions(q, hidden.value || null);
        if (!doctors.length) {
          menu.innerHTML = '<div class="list-group-item small text-muted py-2">لا نتائج</div>';
          menu.classList.remove('d-none');
          return;
        }
        menu.innerHTML = doctors
          .map(
            (d) =>
              `<button type="button" class="list-group-item list-group-item-action py-2 daily-doctor-suggest-opt" data-id="${d.id}">${dailyEscapeHtml(d.name)}</button>`
          )
          .join('');
        menu.classList.remove('d-none');
      } catch {
        hideMenu();
      }
    }, 280);
  });

  input.addEventListener('focus', () => {
    if (input.value.trim()) input.dispatchEvent(new Event('input'));
  });

  document.addEventListener('click', (e) => {
    if (!wrap.contains(e.target)) hideMenu();
  });
}

async function hydrateDailyDoctorSuggest(tr, doctorId) {
  if (!doctorId) return;
  try {
    const doctors = await fetchDailyDoctorSuggestions('', doctorId);
    if (!doctors[0]) return;
    const input = tr.querySelector('.daily-exam-doctor-search');
    const hidden = tr.querySelector('.daily-exam-doctor');
    if (hidden) hidden.value = String(doctors[0].id);
    if (input) input.value = doctors[0].name;
    tr.dataset.doctorId = String(doctors[0].id);
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
  const panelTabs = ['operations', 'free-items'];
  if (mainSheet) mainSheet.style.display = panelTabs.includes(activeDailyTab) ? 'none' : '';
  if (opsPanel) opsPanel.style.display = activeDailyTab === 'operations' ? '' : 'none';
  if (freePanel) freePanel.style.display = activeDailyTab === 'free-items' ? '' : 'none';

  const addRowBtn = document.getElementById('daily-add-row-btn');
  const saveBtn = document.getElementById('daily-save-btn');
  if (addRowBtn) addRowBtn.classList.toggle('d-none', activeDailyTab === 'free-items');
  if (saveBtn) saveBtn.classList.toggle('d-none', activeDailyTab === 'free-items');

  updateDailyTabImportButton();

  if (activeDailyTab === 'operations') ensureOperationRows();

  updateSectionTabTotal();

  const hint = document.getElementById('daily-tab-hint');
  if (hint && activeDailyTab === 'free-items') {
    hint.textContent = 'بنود حرة — أي وصف وسعر ثم احفظ لتُضاف على الفاتورة الكبيرة مع الحركة اليومية.';
  } else if (hint && activeDailyTab === 'exams') {
    hint.textContent =
      'كشوفات — حالة الكشف، النوع، الطبيب، السعر، تاريخ الكشف، واسم المريض.';
  } else if (hint && activeDailyTab === 'medicines') {
    hint.textContent = 'أدوية — ابحث عن الصنف، السعر من الكتالوج. الإجمالي في أسفل الجدول.';
  } else if (hint && activeDailyTab === 'supplies') {
    hint.textContent =
      'مستلزمات — م، تاريخ، رقم الفاتورة، الصنف، العدد، السعر والإجمالي، سعر/إجمالي المستلزم، ونسبة هامش الربح.';
  } else if (hint && activeDailyTab === 'sessions') {
    hint.textContent =
      'جلسات — تاريخ الجلسة، اسم المريض، نوع الجلسة، صباحي/مسائي، العدد، السعر، والإجمالي.';
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
      'عمليات — أدخل اسم العملية، الأوقات، الجراح، التخدير، تصنيف الحالة والمبلغ ثم احفظ.';
  } else if (hint && activeDailyTab === 'stay') {
    hint.textContent = '';
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

function computeSectionFooterTotal(tab) {
  const today = getLocalDateString();
  const otherEntries = (dailySheetEntriesCache || []).filter(
    (entry) => fmtStayDate(entry.entry_date) !== today
  );
  let total = computeAllDaysTabTotal(otherEntries, tab);
  if (tab === 'medicines') {
    document.querySelectorAll('.daily-med-row').forEach((tr) => {
      total += dailyParseAmount(tr.querySelector('.daily-med-total')?.value);
    });
  } else if (tab === 'supplies') {
    document.querySelectorAll('.daily-sup-row').forEach((tr) => {
      total += dailyParseAmount(tr.querySelector('.daily-sup-sell-total')?.value);
    });
  } else if (tab === 'lab') {
    document.querySelectorAll('.daily-lab-row').forEach((tr) => {
      total += getLabRowGrandTotal(tr);
    });
  } else if (tab === 'radiology') {
    document.querySelectorAll('.daily-rad-row').forEach((tr) => {
      total += getRadRowGrandTotal(tr);
    });
  } else if (tab === 'other') {
    document.querySelectorAll('.daily-misc-row').forEach((tr) => {
      total += dailyParseAmount(tr.querySelector('.daily-misc-total')?.value);
    });
  } else if (tab === 'sessions') {
    document.querySelectorAll('.daily-session-row').forEach((tr) => {
      total += dailyParseAmount(tr.querySelector('.daily-session-total')?.value);
    });
  } else if (tab === 'stay') {
    document.querySelectorAll('.daily-stay-row').forEach((tr) => {
      total += dailyParseAmount(tr.querySelector('.daily-row-total')?.textContent);
    });
  } else if (tab === 'exams') {
    document.querySelectorAll('.daily-exam-row').forEach((tr) => {
      total += getExamRowGrandTotal(tr);
    });
  }
  return total;
}

function updateSectionTabTotal() {
  const display = document.getElementById('daily-total-display');
  if (!display) return;
  let total = 0;
  if (activeDailyTab === 'operations') {
    total = getOperationsAllDaysTotal();
  } else if (activeDailyTab === 'free-items') {
    document.querySelectorAll('#daily-free-items-tbody .daily-free-item-row').forEach((tr) => {
      const qty = dailyParseAmount(tr.querySelector('.daily-free-qty')?.value) || 1;
      const amt = dailyParseAmount(tr.querySelector('.daily-free-amount')?.value);
      total += qty * amt;
    });
  } else if (activeDailyTab) {
    total = computeSectionFooterTotal(activeDailyTab);
  }
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
    const today = getLocalDateString();
    dailyOperationsAllTotalCache = (allOps || []).reduce(
      (sum, op) => sum + dailyParseAmount(op.amount),
      0
    );
    dailyOperationsTodaySavedTotal = (allOps || [])
      .filter((op) => fmtStayDate(op.entry_date) === today)
      .reduce((sum, op) => sum + dailyParseAmount(op.amount), 0);
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

function createOperationRowHtml(op = {}) {
  const amountVal =
    op.amount != null && Number(op.amount) > 0
      ? typeof formatAmountInput === 'function'
        ? formatAmountInput(op.amount)
        : dailyFormatInput(op.amount)
      : '';
  const startTimeVal = formatOperationTimeForInput(op.operation_start_time);
  const endTimeVal = formatOperationTimeForInput(op.operation_end_time);
  return `
    <td class="daily-col-serial"><input type="text" class="form-control form-control-sm daily-row-serial bg-light text-center fw-bold" readonly tabindex="-1"></td>
    <td><input type="text" class="form-control form-control-sm daily-op-name" value="${dailyEscapeAttr(op.operation_name || '')}" autocomplete="off"></td>
    <td><input type="time" class="form-control form-control-sm daily-op-start-time" value="${dailyEscapeAttr(startTimeVal)}" autocomplete="off"></td>
    <td><input type="time" class="form-control form-control-sm daily-op-end-time" value="${dailyEscapeAttr(endTimeVal)}" autocomplete="off"></td>
    <td><input type="text" class="form-control form-control-sm daily-op-surgeon" value="${dailyEscapeAttr(op.surgeon_name || '')}" autocomplete="off"></td>
    <td><input type="text" class="form-control form-control-sm daily-op-anesthesia" value="${dailyEscapeAttr(op.anesthesia_doctor || '')}" autocomplete="off"></td>
    <td><input type="text" class="form-control form-control-sm daily-op-assistant" value="${dailyEscapeAttr(op.assistant_surgeon || '')}" autocomplete="off"></td>
    <td><select class="form-select form-select-sm daily-op-case-type fw-bold">${buildOperationCaseTypeOptions(op.case_type || 'special')}</select></td>
    <td><input type="text" inputmode="decimal" class="form-control form-control-sm daily-op-amount comma-amount" value="${dailyEscapeAttr(amountVal)}" autocomplete="off"></td>
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
  tr.querySelectorAll('.daily-op-amount').forEach((el) => {
    el.addEventListener('input', updateOperationsTotal);
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
  const tr = document.createElement('tr');
  tr.className = 'daily-operation-row';
  tr.innerHTML = createOperationRowHtml(op);
  tbody.appendChild(tr);
  bindOperationRowEvents(tr);
  renumberPanelRowSerials('#daily-operations-tbody .daily-operation-row');
  updateOperationsTotal();
}

function collectOperationsFromTable() {
  const rows = [];
  document.querySelectorAll('#daily-operations-tbody .daily-operation-row').forEach((tr) => {
    const operation_name = tr.querySelector('.daily-op-name')?.value?.trim() || '';
    const amount = dailyParseAmount(tr.querySelector('.daily-op-amount')?.value);
    const operation_start_time = tr.querySelector('.daily-op-start-time')?.value || '';
    const operation_end_time = tr.querySelector('.daily-op-end-time')?.value || '';
    const duration_hours = computeOperationDurationHours(operation_start_time, operation_end_time);
    if (!operation_name && amount <= 0) return;
    rows.push({
      operation_name,
      operation_start_time,
      operation_end_time,
      duration_hours,
      surgeon_name: tr.querySelector('.daily-op-surgeon')?.value?.trim() || '',
      anesthesia_doctor: tr.querySelector('.daily-op-anesthesia')?.value?.trim() || '',
      assistant_surgeon: tr.querySelector('.daily-op-assistant')?.value?.trim() || '',
      case_type: tr.querySelector('.daily-op-case-type')?.value || 'special',
      amount,
    });
  });
  return rows;
}

async function loadOperationsForToday() {
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
    const today = getLocalDateString();
    const ops = await apiJson(
      `${DAILY_API}/operations?file_number=${encodeURIComponent(fileNumber)}&entry_date=${encodeURIComponent(today)}`
    );
    tbody.innerHTML = '';
    if (ops.length) {
      ops.forEach((op) => addOperationRow(op));
      renumberPanelRowSerials('#daily-operations-tbody .daily-operation-row');
    } else {
      ensureOperationRows();
    }
    updateOperationsTotal();
  } catch (err) {
    console.error(err);
    tbody.innerHTML = '';
    ensureOperationRows();
    updateOperationsTotal();
  }
}

async function saveOperationsPanel() {
  if (!dailyCan('daily_charges.manage')) {
    showToast('ليس لديك صلاحية', 'warning');
    return;
  }
  const file_number = getStayFileNumber();
  if (!file_number || !dailyStayContext?.invoice?.id) {
    showToast('لا توجد فاتورة مفتوحة', 'warning');
    return;
  }
  const operations = collectOperationsFromTable();
  if (!operations.length) {
    showToast('أضف عملية واحدة على الأقل (اسم أو مبلغ)', 'warning');
    return;
  }
  const entry_date =
    document.getElementById('daily-entry-date')?.value?.trim() || getLocalDateString();
  try {
    dailySaveInFlight = true;
    const saveBtn = document.getElementById('daily-save-btn');
    if (saveBtn) saveBtn.disabled = true;
    const data = await apiJson(`${DAILY_API}/operations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ file_number, entry_date, operations }),
    });
    await refreshInvoiceFormAfterDailySave(file_number, data.invoice_id);
    await refreshOperationsTotalsCache();
    await loadOpenPatientStay(file_number);
    const totalLabel =
      data.final_total != null ? dailyFmt(data.final_total) : dailyFmt(operations.reduce((s, o) => s + o.amount, 0));
    showToast(`تم الحفظ — أُضيف على الفاتورة الكبيرة (${totalLabel})`, 'success');
  } catch (err) {
    showToast(sanitizeApiErrorMessage(err.message), 'danger');
  } finally {
    dailySaveInFlight = false;
    const saveBtn = document.getElementById('daily-save-btn');
    if (saveBtn) saveBtn.disabled = false;
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

function addFreeItemRow(item = {}) {
  const tbody = document.getElementById('daily-free-items-tbody');
  if (!tbody) return;
  const tr = document.createElement('tr');
  tr.className = 'daily-free-item-row';
  if (item.id) tr.dataset.itemId = String(item.id);
  tr.innerHTML = createFreeItemRowHtml(item);
  tbody.appendChild(tr);
  bindFreeItemRowEvents(tr);
  renumberPanelRowSerials('#daily-free-items-tbody .daily-free-item-row');
  updateFreeItemsTotal();
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
  } catch (err) {
    showToast(sanitizeApiErrorMessage(err.message), 'danger');
    tbody.innerHTML = '';
    addFreeItemRow();
  }
}

async function saveFreeItems() {
  if (!dailyCan('daily_charges.manage')) {
    showToast('ليس لديك صلاحية', 'warning');
    return;
  }
  const file_number = getStayFileNumber();
  if (!file_number || !dailyStayContext?.invoice?.id) {
    showToast('لا توجد فاتورة مفتوحة', 'warning');
    return;
  }
  const items = collectFreeItemsFromTable();
  if (!items.length) {
    showToast('أضف بندًا واحدًا على الأقل', 'warning');
    return;
  }
  const btn = document.getElementById('daily-free-save-btn');
  try {
    if (btn) btn.disabled = true;
    const data = await apiJson(`${DAILY_API}/free-items`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ file_number, items }),
    });
    await loadOpenPatientStay(file_number);
    await loadFreeItemsPanel();
    showToast(`تم الحفظ — أُضيف على الفاتورة الكبيرة (${dailyFmt(data.final_total)})`, 'success');
  } catch (err) {
    showToast(sanitizeApiErrorMessage(err.message), 'danger');
  } finally {
    if (btn) btn.disabled = false;
  }
}

function renderDailySectionTabs() {
  const tabsEl = document.getElementById('daily-entry-tabs');
  if (!tabsEl) return;
  tabsEl.innerHTML = DAILY_TAB_GROUPS
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

function showDailySection(sectionId) {
  if (sectionId) activeDailyTab = sectionId;
  if (!activeDailyTab) activeDailyTab = 'medicines';
  const sectionWorkspace = document.getElementById('daily-section-workspace');
  if (sectionWorkspace) sectionWorkspace.classList.remove('d-none');
  updateFocusedSectionTitle();
  renderDailySectionsTable();
  applyDailyTabColumnVisibility();
  if (sectionId === 'free-items') void loadFreeItemsPanel();
  if (sectionId === 'operations') ensureOperationRows();
  if (
    activeDailyTab &&
    dailyStayContext?.invoice?.id &&
    !['operations', 'free-items'].includes(activeDailyTab)
  ) {
    void loadDailyEntriesIntoSheet();
  }
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
  activeDailyTab = '';
  dailySheetSerialNext = 1;
  dailySheetSerialMap.clear();
  dailySheetEntriesCache = [];
  updateDailyMilitaryAuthBanner(null);
}

function resetDailyPatientPickerList() {
  const list = document.getElementById('daily-patient-list');
  if (list) list.innerHTML = '';
}

function showDailyPatientResults() {
  document.getElementById('daily-patient-results-wrap')?.classList.remove('d-none');
}

function showDailyPatientWorkspace(ctx = dailyStayContext) {
  document.getElementById('daily-patient-picker-wrap')?.classList.add('d-none');
  document.getElementById('daily-patient-workspace')?.classList.remove('d-none');
  document.getElementById('daily-change-patient-btn')?.classList.remove('d-none');
  const tab = defaultDailyTabForPatient(ctx);
  showDailySection(tab);
  renderDailySectionTabs();
}

function updateDailyPatientHeader(ctx) {
  const changeRoomBtn = document.getElementById('daily-change-room-btn');
  const batchStayBtn = document.getElementById('daily-batch-stay-btn');
  const p = ctx?.patient;
  const showRoom = Boolean(ctx?.invoice?.id) && p?.patient_type !== 'external';
  if (changeRoomBtn) changeRoomBtn.classList.toggle('d-none', !showRoom);
  if (batchStayBtn) batchStayBtn.classList.toggle('d-none', !showRoom);
  updateDailyPatientSummaryTable(ctx);
}

function updateDailyPatientSummaryTable(ctx) {
  const body = document.getElementById('daily-patient-summary-body');
  if (!body) return;
  const p = ctx?.patient || {};
  const inv = ctx?.invoice || {};
  const typeLabel = p.patient_type === 'external' ? 'خارجي' : 'داخلي';
  const genderLabel =
    p.gender === 'male' ? 'ذكر' : p.gender === 'female' ? 'أنثى' : p.gender || '—';
  const balance = p.account_balance ?? 0;
  const remaining = inv.remaining ?? inv.outstanding_amount ?? 0;
  const collected = inv.total_collected ?? 0;
  const finalTotal = inv.final_total ?? 0;
  const dailyTotal = ctx?.daily_summary?.daily_total_sum ?? 0;
  const invLabel = inv.serial_number ? inv.serial_number : inv.id ? `#${inv.id}` : '—';
  const statusLabel = inv.status_label || inv.status || '—';
  const statusClass =
    inv.status === 'pending_review'
      ? 'bg-warning text-dark'
      : inv.status === 'approved'
        ? 'bg-success'
        : 'bg-secondary';
  const period =
    inv.admission_date
      ? `${fmtStayDate(inv.admission_date) || '—'} → ${fmtStayDate(inv.discharge_date) || '—'}`
      : '—';
  const financial = inv.financial_treatment || p.financial_treatment || '—';

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
      <td>${dailyEscapeHtml(financial)}</td>
      <th class="daily-summary-label text-nowrap">فترة الفاتورة</th>
      <td>${dailyEscapeHtml(period)}</td>
    </tr>
    <tr>
      <th class="daily-summary-label text-nowrap">إجمالي الحركة</th>
      <td class="fw-bold amount-total">${dailyFmt(dailyTotal)}</td>
      <th class="daily-summary-label text-nowrap">إجمالي الفاتورة</th>
      <td class="fw-bold text-primary amount-total">${dailyFmt(finalTotal)}</td>
    </tr>
    <tr class="table-warning">
      <th class="daily-summary-label text-nowrap">رصيد الحساب</th>
      <td class="fw-bold text-success amount-total">${dailyFmt(balance)}</td>
      <th class="daily-summary-label text-nowrap">المحصل</th>
      <td class="fw-bold amount-total">${dailyFmt(collected)}</td>
    </tr>
    <tr class="table-warning">
      <th class="daily-summary-label text-nowrap">المتبقي</th>
      <td class="fw-bold text-danger amount-total">${dailyFmt(remaining)}</td>
      <th class="daily-summary-label text-nowrap"></th>
      <td></td>
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

async function selectDailyPatient(fileNumber) {
  const fn = String(fileNumber || '').trim();
  if (!fn) return;
  const fileInput = document.getElementById('daily-stay-file-number');
  if (fileInput) fileInput.value = fn;
  sessionStorage.setItem('dailyStayFileNumber', fn);
  await loadOpenPatientStay(fn);
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

function togglePatientRegEntityFields() {
  const type = document.getElementById('patient-reg-invoice-type')?.value || 'civil';
  const showEntity = isEntityInvoiceType(type);
  const isMilitary = type === 'military';
  const entityWrap = document.getElementById('patient-reg-entity-wrap');
  const letterWrap = document.getElementById('patient-reg-letter-wrap');
  const letterEnd = document.getElementById('patient-reg-letter-wrap-end');
  const letterDaysWrap = document.getElementById('patient-reg-letter-days-wrap');
  const milFrom = document.getElementById('patient-reg-military-wrap');
  const milTo = document.getElementById('patient-reg-military-wrap-end');
  const milAmount = document.getElementById('patient-reg-military-amount-wrap');
  if (entityWrap) entityWrap.style.display = showEntity ? '' : 'none';
  if (letterWrap) letterWrap.style.display = showEntity ? '' : 'none';
  if (letterEnd) letterEnd.style.display = showEntity ? '' : 'none';
  if (letterDaysWrap) letterDaysWrap.style.display = showEntity ? '' : 'none';
  if (milFrom) milFrom.style.display = isMilitary ? '' : 'none';
  if (milTo) milTo.style.display = isMilitary ? '' : 'none';
  if (milAmount) milAmount.style.display = isMilitary ? '' : 'none';
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
}

function collectPatientDemographics(mode = 'register') {
  const isDaily = mode === 'daily';
  const invoice_type = document.getElementById(
    isDaily ? 'daily-stay-invoice-type' : 'patient-reg-invoice-type'
  )?.value || 'civil';
  const payload = {
    age: document.getElementById(isDaily ? 'daily-stay-age' : 'patient-reg-age')?.value?.trim() || null,
    stay_grade_id:
      document.getElementById(isDaily ? 'daily-stay-stay-grade-id' : 'patient-reg-stay-grade')?.value || null,
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

async function loadPatientEntitySelects() {
  try {
    const entities = await apiJson('/api/settings/contracted-entities');
    const options =
      '<option value="">-- اختر الجهة --</option>' +
      entities
        .map((e) => `<option value="${e.id}">${dailyEscapeHtml(e.name)}</option>`)
        .join('');
    const reg = document.getElementById('patient-reg-entity');
    const daily = document.getElementById('daily-stay-entity');
    if (reg) reg.innerHTML = options;
    if (daily) daily.innerHTML = options;
  } catch (err) {
    console.error(err);
  }
}

function populateStayTypeSelects(selectedId = '') {
  const html =
    '<option value="">-- اختر الغرفة أو الجناح --</option>' +
    dailyStayTypesCache
      .map(
        (t) =>
          `<option value="${t.id}"${String(selectedId) === String(t.id) ? ' selected' : ''}>${dailyEscapeHtml(t.name)}</option>`
      )
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

function populateStayGradeSelect(selectedId = '') {
  const el = document.getElementById('patient-reg-stay-grade');
  if (!el) return;
  const fallback = dailyStayTypesCache.map((st) => ({
    stay_type_id: st.id,
    name: st.name,
    daily_rate: Number(st.daily_rate) || 0,
  }));
  const grades = dailyStayGradesCache.length ? dailyStayGradesCache : fallback;
  el.innerHTML =
    '<option value="">-- اختر من اللائحة --</option>' +
    grades
      .filter((g) => g.stay_type_id)
      .map((g) => {
        const rate =
          Number(g.daily_rate) > 0
            ? ` — ${typeof dailyFmt === 'function' ? dailyFmt(g.daily_rate) : g.daily_rate} / يوم`
            : '';
        return `<option value="${g.stay_type_id}"${String(selectedId) === String(g.stay_type_id) ? ' selected' : ''}>${dailyEscapeHtml(g.name)}${rate}</option>`;
      })
      .join('');
  if (selectedId) el.value = String(selectedId);
}

function syncStayGradeToRoom() {
  const gradeSel = document.getElementById('patient-reg-stay-grade');
  const roomSel = document.getElementById('patient-reg-room');
  if (gradeSel?.value && roomSel) roomSel.value = gradeSel.value;
}

function setDailySectionAmount(tr, sectionCode, amount) {
  const n = Number(amount) || 0;
  if (n <= 0) return;
  const input = tr.querySelector(`.daily-amount[data-section="${sectionCode}"]`);
  if (!input || dailyParseAmount(input.value) > 0) return;
  if (typeof setCommaAmountValue === 'function') setCommaAmountValue(input, n);
  else input.value = dailyFormatInput(n);
  input.dataset.manualAmount = '1';
}

async function applyRoomAssignmentToRow(tr, assignment) {
  if (!assignment || !tr) return;
  const staySel = tr.querySelector('.daily-row-stay-type');
  if (staySel && assignment.stay_type_id) {
    staySel.value = String(assignment.stay_type_id);
    await applyStayTypeRateToRow(tr);
    updateStayAccUnitPriceDisplay(tr);
  }
  setDailySectionAmount(tr, 'companion', assignment.companion_amount);
  setDailySectionAmount(tr, 'nursing_point', assignment.nursing_point_amount);
  setDailySectionAmount(tr, 'patient_assistant', assignment.patient_assistant_amount);
  const admission = fmtStayDate(dailyStayContext?.invoice?.admission_date);
  const rowDate = tr.querySelector('.daily-row-date')?.value;
  const roomIns = Number(dailyStayContext?.patient?.room_insurance_amount) || 0;
  if (roomIns > 0 && admission && rowDate === admission) {
    const companionEl = tr.querySelector('.daily-amount[data-section="companion"]');
    const base = dailyParseAmount(companionEl?.value) || Number(assignment.companion_amount) || 0;
    setDailySectionAmount(tr, 'companion', base + roomIns);
  }
  updateRowTotal(tr);
  updateDailyGrandTotal();
}

async function applyAutoRoomToTodayRows() {
  const assignment = dailyStayContext?.room_assignment;
  if (!assignment?.stay_type_id) return;
  const rows = document.querySelectorAll('#daily-sections-body .daily-entry-row:not(.daily-stay-addon-row)');
  const today = getLocalDateString();
  for (const tr of rows) {
    const rowDate = tr.querySelector('.daily-row-date')?.value;
    if (rowDate && rowDate !== today) continue;
    if (tr.classList.contains('daily-stay-row')) {
      await applyRoomAssignmentToRow(tr, assignment);
      continue;
    }
    if (!rowHasChargeData(tr)) {
      await applyRoomAssignmentToRow(tr, assignment);
    }
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
    if (typeEl && inv.invoice_type) typeEl.value = inv.invoice_type;
    toggleDailyStayEntityFields();
    if (inv.contracted_entity_id) {
      const entityEl = document.getElementById('daily-stay-entity');
      if (entityEl) entityEl.value = String(inv.contracted_entity_id);
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

function collectInternalStayPayload(patientType) {
  if (patientType !== 'internal') return {};
  const stay_type_id = document.getElementById('patient-reg-room')?.value ||
    document.getElementById('daily-stay-room')?.value || '';
  const invoice_type =
    document.getElementById('patient-reg-invoice-type')?.value ||
    document.getElementById('daily-stay-invoice-type')?.value ||
    'civil';
  const payload = {
    stay_type_id: stay_type_id || null,
    floor: document.getElementById('patient-reg-floor')?.value.trim() ||
      document.getElementById('daily-stay-floor')?.value.trim() || '',
    companion_amount: dailyParseAmount(
      document.getElementById('patient-reg-companion')?.value ||
        document.getElementById('daily-stay-companion')?.value
    ),
    nursing_point_amount: dailyParseAmount(
      document.getElementById('patient-reg-nursing')?.value ||
        document.getElementById('daily-stay-nursing')?.value
    ),
    patient_assistant_amount: dailyParseAmount(
      document.getElementById('patient-reg-assistant')?.value ||
        document.getElementById('daily-stay-assistant')?.value
    ),
    invoice_type,
  };
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
  if (fromEl) fromEl.value = getLocalDateString();
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
  const backfill_stay = document.getElementById('change-room-backfill')?.checked === true;
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
        backfill_stay,
      }),
    });
    dailyStayContext = data;
    applyDailyStayContext(data);
    if (changeRoomModal) changeRoomModal.hide();
    const posted = data.backfill?.posted || 0;
    const skipped = (data.backfill?.skipped_dates || []).length;
    if (backfill_stay && posted > 0) {
      showToast(`تم تغيير الغرفة وترحيل ${posted} يوم إقامة (تُخطّى ${skipped})`, 'success');
    } else {
      showToast('تم تغيير الغرفة', 'success');
    }
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
  const today = getLocalDateString();
  const yesterday = addLocalDays(today, -1);
  if (fromEl) fromEl.value = admission || today;
  if (toEl) {
    const discharge = fmtStayDate(inv.discharge_date);
    toEl.value = discharge && discharge < today ? discharge : yesterday;
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

function showPatientRegisterTypePicker() {
  patientRegSelectedType = null;
  const picker = document.getElementById('patient-register-type-picker');
  const panel = document.getElementById('patient-register-form-panel');
  if (picker) picker.classList.remove('d-none');
  if (panel) panel.classList.add('d-none');
}

function showPatientRegisterForm(patientType) {
  const type = String(patientType || '').toLowerCase() === 'external' ? 'external' : 'internal';
  patientRegSelectedType = type;
  const picker = document.getElementById('patient-register-type-picker');
  const panel = document.getElementById('patient-register-form-panel');
  const typeInput = document.getElementById('patient-reg-type');
  const badge = document.getElementById('patient-register-type-badge');
  const balanceWrap = document.getElementById('patient-reg-balance-wrap');
  if (picker) picker.classList.add('d-none');
  if (panel) panel.classList.remove('d-none');
  if (typeInput) typeInput.value = type;
  if (badge) badge.textContent = patientTypeLabel(type);
  if (balanceWrap) balanceWrap.style.display = type === 'external' ? 'none' : '';
  const regInternal = document.getElementById('patient-reg-internal-wrap');
  if (regInternal) regInternal.style.display = type === 'internal' ? '' : 'none';
  const stayGradeWrap = document.getElementById('patient-reg-stay-grade-wrap');
  if (stayGradeWrap) stayGradeWrap.style.display = type === 'external' ? 'none' : '';
  const nationalityHint = document.getElementById('patient-reg-nationality-hint');
  if (nationalityHint) nationalityHint.classList.toggle('d-none', type === 'external');
  clearPatientRegisterForm({ keepType: true });
  void loadDailyStayTypes().then(async () => {
    await loadDailyStayGrades();
    populateStayTypeSelects();
    populateStayGradeSelect();
  });
  togglePatientRegEntityFields();
  void loadPatientEntitySelects();
  if (typeof loadFinancialTreatments === 'function') loadFinancialTreatments();
  if (typeof bindCommaAmountInputs === 'function') {
    bindCommaAmountInputs(document.getElementById('patient-register-form-panel'));
  }
  const fileInput = document.getElementById('patient-reg-file-number');
  if (fileInput) fileInput.focus();
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
  const financialEl = document.getElementById('patient-reg-financial');
  if (financialEl) financialEl.value = '';
  const stayGradeEl = document.getElementById('patient-reg-stay-grade');
  if (stayGradeEl) stayGradeEl.value = '';
  if (!keepType) {
    patientRegSelectedType = null;
    const typeInput = document.getElementById('patient-reg-type');
    if (typeInput) typeInput.value = 'internal';
  }
  bustFieldAutocomplete(document.getElementById('patient-register-form'));
  updatePatientRegMilitarySummary();
  updateLetterAuthorizedDaysDisplay();
}

async function savePatientRegistration(event) {
  if (event) event.preventDefault();
  if (!dailyCan('daily_charges.manage')) {
    showToast('ليس لديك صلاحية تسجيل المريض', 'warning');
    return;
  }
  const patient_type = document.getElementById('patient-reg-type')?.value || patientRegSelectedType || 'internal';
  const file_number = document.getElementById('patient-reg-file-number')?.value.trim() || '';
  const patient_name = document.getElementById('patient-reg-name')?.value.trim() || '';
  const phone = document.getElementById('patient-reg-phone')?.value.trim() || '';
  const other_phone = document.getElementById('patient-reg-other-phone')?.value.trim() || '';
  const nationality = normalizeNationalitySelectValue(
    document.getElementById('patient-reg-nationality')?.value
  );
  const gender = document.getElementById('patient-reg-gender')?.value || '';
  const admission_date = document.getElementById('patient-reg-admission')?.value || '';
  const financial_treatment = document.getElementById('patient-reg-financial')?.value || '';
  const balanceRaw = document.getElementById('patient-reg-balance')?.value;
  if (!file_number || !patient_name || !admission_date) {
    showToast('رقم الملف واسم المريض وتاريخ الدخول مطلوبان', 'warning');
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
  };
  if (patient_type !== 'external') {
    payload.account_balance = dailyParseAmount(balanceRaw);
    if (!document.getElementById('patient-reg-stay-grade')?.value) {
      showToast('اختر درجة الإقامة من اللائحة', 'warning');
      return;
    }
    if (!document.getElementById('patient-reg-room')?.value) {
      showToast('اختر الغرفة أو الجناح للمريض الداخلي', 'warning');
      return;
    }
    Object.assign(payload, collectInternalStayPayload('internal'));
    if (isEntityInvoiceType(payload.invoice_type) && !payload.contracted_entity_id) {
      showToast('اختر الجهة', 'warning');
      return;
    }
  }

  try {
    const data = await apiJson(`${DAILY_API}/open-stay`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    sessionStorage.setItem('dailyStayFileNumber', file_number);
    dailyStayContext = data;
    const label = data.created ? 'تم تسجيل المريض وإنشاء فاتورة مسودة' : 'تم تحديث بيانات المريض';
    showToast(`${label} — ملف ${file_number} — ابدأ بإدخال البنود`, 'success');
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

function initPatientRegistration() {
  showPatientRegisterTypePicker();
  clearPatientRegisterForm();
  void loadDailyStayTypes().then(async () => {
    await loadDailyStayGrades();
    populateStayTypeSelects();
    populateStayGradeSelect();
  });
  void loadPatientEntitySelects();
  if (typeof loadFinancialTreatments === 'function') loadFinancialTreatments();
}

function applyDailyStayContext(ctx) {
  dailyStayContext = ctx;
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
    const stayGradeEl = document.getElementById('daily-stay-stay-grade-id');
    if (stayGradeEl) {
      stayGradeEl.value =
        ctx.patient.stay_grade_id != null && ctx.patient.stay_grade_id !== ''
          ? String(ctx.patient.stay_grade_id)
          : '';
    }
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
  if (ctx?.patient?.patient_type === 'internal' || (!ctx?.patient?.patient_type && ctx?.patient)) {
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
  updateDailyMilitaryAuthBanner(ctx);
  updateDailyClinicalContextBar();
  const reviewPanel = document.getElementById('daily-invoice-review-panel');
  if (reviewPanel) reviewPanel.classList.add('d-none');
  if (ctx?.patient?.file_number && ctx?.patient?.name) {
    showDailyPatientWorkspace(ctx);
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

async function loadOpenPatientStay(fileNumber) {
  const fn = (fileNumber || getStayFileNumber()).trim();
  if (!fn) {
    applyDailyStayContext(null);
    showDailyPatientPicker();
    return null;
  }
  try {
    let data = await apiJson(`${DAILY_API}/open-stay?file_number=${encodeURIComponent(fn)}`);
    if (!data?.invoice?.id && data?.patient?.name) {
      data = await ensureOpenStayInvoice(data);
    }
    applyDailyStayContext(data);
    await loadDailyStayTypes();
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
    };
    if (patient_type !== 'external') {
      payload.account_balance = dailyParseAmount(document.getElementById('daily-stay-balance')?.value);
      Object.assign(payload, collectInternalStayPayload('internal'));
      if (isEntityInvoiceType(payload.invoice_type) && !payload.contracted_entity_id) {
        showToast('اختر الجهة', 'warning');
        return;
      }
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
    await applyAutoRoomToTodayRows();
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
      <div class="col-md-3"><span class="text-muted d-block mb-1">تاريخ الدخول</span><div class="review-field">${dailyEscapeHtml(fmtStayDate(inv.admission_date) || '—')}</div></div>
      <div class="col-md-3"><span class="text-muted d-block mb-1">تاريخ الخروج</span><div class="review-field">${dailyEscapeHtml(fmtStayDate(inv.discharge_date) || '—')}</div></div>
      <div class="col-12 mt-2"><h6 class="fw-black text-primary mb-2">ملخص الفاتورة</h6></div>
      <div class="col-md-3"><span class="text-muted d-block mb-1">رقم الفاتورة</span><div class="review-field fw-bold">${dailyEscapeHtml(inv.serial_number ? inv.serial_number : `#${inv.id}`)}</div></div>
      <div class="col-md-3"><span class="text-muted d-block mb-1">الحالة</span><div class="review-field"><span class="badge ${statusClass}">${dailyEscapeHtml(inv.status_label || inv.status || '—')}</span></div></div>
      <div class="col-md-3"><span class="text-muted d-block mb-1">إجمالي الحركة</span><div class="review-field fw-bold">${dailyFmt(ctx.daily_summary?.daily_total_sum ?? 0)}</div></div>
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
let dailySaveInFlight = false;
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
  const grades = dailyStayGradesCache.length
    ? dailyStayGradesCache.filter((g) => g.stay_type_id)
    : dailyStayTypesCache.map((st) => ({
        stay_type_id: st.id,
        name: st.name,
        daily_rate: Number(st.daily_rate) || 0,
      }));
  if (!grades.length) return '<option value="">—</option>';
  return (
    '<option value="">— اختر نوع الإقامة —</option>' +
    grades
      .map((g) => {
        const id = g.stay_type_id;
        const rate = Number(g.daily_rate) || 0;
        const rateLabel = rate > 0 ? ` — ${dailyFmt(rate)} / يوم` : '';
        return `<option value="${id}" data-rate="${rate}"${String(selectedId) === String(id) ? ' selected' : ''}>${dailyEscapeHtml(g.name)}${rateLabel}</option>`;
      })
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
    const caseCode = tr.dataset.examSectionCode || tr.querySelector('.daily-exam-case')?.value || '';
    const typeSel = tr.querySelector('.daily-exam-type');
    const prev = typeSel?.value || '';
    if (typeSel) {
      typeSel.innerHTML = buildExamTypeOptions(prev, caseCode);
      if (prev && typeSel.querySelector(`option[value="${CSS.escape(prev)}"]`)) typeSel.value = prev;
    }
  });
}

async function reloadDailyServiceCaches() {
  await loadExamServicesCache();
  await loadCompanionServicesCache();
  refreshExamRowsDropdowns();
}

function buildCompanionKindOptions(selectedServiceId = '') {
  if (!dailyCompanionServicesCache.length) {
    return '<option value="">— غرفة / جناح —</option>';
  }
  return (
    '<option value="">— غرفة / جناح —</option>' +
    dailyCompanionServicesCache
      .map((s) => {
        const price = Number(s.price ?? s.list_price) || 0;
        return `<option value="${s.id}" data-price="${price}"${String(selectedServiceId) === String(s.id) ? ' selected' : ''}>${dailyEscapeHtml(s.name)} — ${dailyFmt(price)}</option>`;
      })
      .join('')
  );
}

function buildExamCaseOptions(selectedSectionCode = '') {
  const cases = [
    { code: 'consultant_exam', name: 'كشف استشاري' },
    { code: 'specialist_exam', name: 'كشف أخصائي' },
  ];
  return (
    '<option value="">— حالة الكشف —</option>' +
    cases
      .map(
        (c) =>
          `<option value="${c.code}"${selectedSectionCode === c.code ? ' selected' : ''}>${dailyEscapeHtml(c.name)}</option>`
      )
      .join('')
  );
}

function buildExamTypeOptions(selectedServiceId = '', sectionCode = '') {
  let pool = dailyExamServicesCache;
  if (sectionCode) {
    pool = pool.filter((s) => s.section_code === sectionCode);
    if (!pool.length) pool = dailyExamServicesCache;
  }
  if (!pool.length) {
    return '<option value="">— نوع الكشف (ارفع ملف الكشوفات) —</option>';
  }
  return (
    '<option value="">— نوع الكشف —</option>' +
    pool
      .map((s) => {
        const price = Number(s.price ?? s.list_price) || 0;
        const selected = String(selectedServiceId) === String(s.id) ? ' selected' : '';
        return `<option value="${s.id}" data-section="${s.section_code}" data-code="${dailyEscapeAttr(s.code || '')}" data-price="${price}"${selected}>${dailyEscapeHtml(s.name)}</option>`;
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
  display.value = unit > 0 ? formatAmountFieldValue(unit) : '';
}

function onCompanionKindChange(selectEl) {
  const tr = selectEl.closest('.daily-entry-row');
  if (!tr) return;
  const opt = selectEl.selectedOptions[0];
  const price = Number(opt?.dataset.price) || 0;
  const companionInput = tr.querySelector('.daily-amount[data-section="companion"]');
  if (companionInput && price > 0) {
    if (typeof setCommaAmountValue === 'function') setCommaAmountValue(companionInput, price);
    else companionInput.value = formatAmountFieldValue(price);
    companionInput.dataset.manualAmount = '0';
  }
  updateRowTotal(tr);
  updateDailyGrandTotal();
  updateSectionTabTotal();
}

async function onStayTypeChangeForRow(selectEl) {
  const tr = selectEl.closest('.daily-stay-row');
  if (!tr) return;
  await applyStayTypeRateToRow(tr);
  updateStayAccUnitPriceDisplay(tr);
  updateRowTotal(tr);
  updateDailyGrandTotal();
  updateSectionTabTotal();
}

function onExamCaseChange(selectEl) {
  const tr = selectEl?.closest('.daily-entry-row');
  if (!tr) return;
  const sectionCode = selectEl.value || '';
  tr.dataset.examSectionCode = sectionCode;
  const typeSel = tr.querySelector('.daily-exam-type');
  if (typeSel) {
    const prev = typeSel.value;
    typeSel.innerHTML = buildExamTypeOptions('', sectionCode);
    if (prev && typeSel.querySelector(`option[value="${prev}"]`)) typeSel.value = prev;
    else typeSel.value = '';
  }
  const unitEl = tr.querySelector('.daily-exam-unit-price');
  if (unitEl) unitEl.value = '';
  updateRowTotal(tr);
  updateDailyGrandTotal();
  updateSectionTabTotal();
}

function onExamTypeChange(selectEl) {
  const tr = selectEl?.closest('.daily-entry-row');
  if (!tr) return;
  const opt = selectEl.selectedOptions[0];
  const sectionCode = opt?.dataset.section || '';
  const price = Number(opt?.dataset.price) || 0;
  if (sectionCode) {
    tr.dataset.examSectionCode = sectionCode;
    const caseSel = tr.querySelector('.daily-exam-case');
    if (caseSel && caseSel.value !== sectionCode) caseSel.value = sectionCode;
  }
  const unitEl = tr.querySelector('.daily-exam-unit-price');
  if (unitEl) unitEl.value = price > 0 ? formatAmountFieldValue(price) : '';
  updateRowTotal(tr);
  updateDailyGrandTotal();
  updateSectionTabTotal();
}

const STAY_CHARGE_SECTIONS = ['accommodation', 'companion', 'nursing_point', 'patient_assistant'];

function bindDailyAmountRecalc(tr) {
  const onAmountChange = () => {
    updateRowTotal(tr);
    updateDailyGrandTotal();
    updateSectionTabTotal();
  };
  tr.querySelectorAll(
    '.daily-amount, .daily-session-morning, .daily-session-evening, .daily-session-qty, .daily-lab-stamp, .daily-rad-stamp, .daily-exam-stamp'
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
  bindDailyAmountRecalc(tr);
}

function bindExamRowEvents(tr) {
  const caseSel = tr.querySelector('.daily-exam-case');
  if (caseSel) caseSel.addEventListener('change', () => onExamCaseChange(caseSel));
  const typeSel = tr.querySelector('.daily-exam-type');
  if (typeSel) typeSel.addEventListener('change', () => onExamTypeChange(typeSel));
  bindDailyDoctorSuggestWrap(tr);
  tr.querySelector('.daily-exam-stamp')?.addEventListener('input', refreshServiceRowTotals);
}

function collectStayLinesFromRow(tr) {
  const primaryTr = tr.classList.contains('daily-stay-addon-row') ? findStayPrimaryRow(tr) : tr;
  if (!primaryTr) return [];
  const viewCodes = new Set(['accommodation', 'companion', 'nursing_point', 'patient_assistant']);
  const lines = [];
  const accSection = dailySectionsCache.find((s) => s.code === 'accommodation');
  if (accSection) {
    const accLine = collectLineForSection(primaryTr, accSection);
    const accHidden = primaryTr.querySelector('.daily-amount[data-section="accommodation"]');
    if (accHidden?.dataset.lineId) accLine.id = Number(accHidden.dataset.lineId);
    if (lineHasChargeData(accLine)) lines.push(accLine);
  }
  getStayDayGroupRows(primaryTr).forEach((rowTr) => {
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
  const caseSel = tr.querySelector('.daily-exam-case');
  const typeSel = tr.querySelector('.daily-exam-type');
  const opt = typeSel?.selectedOptions[0];
  const sectionCode = caseSel?.value || opt?.dataset.section || tr.dataset.examSectionCode || '';
  const serviceId = typeSel?.value || null;
  const amount = dailyParseAmount(tr.querySelector('.daily-exam-unit-price')?.value);
  const lines = [];
  if (sectionCode && (serviceId || amount > 0)) {
    const line = {
      section_code: sectionCode,
      service_id: serviceId ? Number(serviceId) : null,
      amount,
      quantity: 1,
    };
    if (tr.dataset.examLineId) line.id = Number(tr.dataset.examLineId);
    const dateEl = tr.querySelector('.daily-exam-date');
    if (dateEl?.value) line.extra_date = dateEl.value;
    lines.push(line);
  }
  const stamp = dailyParseAmount(tr.querySelector('.daily-exam-stamp')?.value);
  if (stamp > 0) {
    const stampLine = { section_code: 'consultation_stamp', amount: stamp, quantity: 1 };
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

  const dateVal = getLocalDateString();
  const stayTypeId = entry.stay_type_id || getDefaultStayTypeIdForRow();
  const accLine = getLineForSection(entry, 'accommodation');
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
    <td class="daily-col-date"><input type="date" class="form-control form-control-sm daily-row-date fw-bold bg-light" value="${dateVal}" readonly tabindex="-1"></td>
    <td class="daily-col-stay-type"><select class="form-select form-select-sm daily-row-stay-type">${buildDailyStayTypeOptions(stayTypeId)}</select></td>
    <td class="daily-col-amount">
      <input type="text" class="form-control form-control-sm daily-stay-acc-unit-price bg-light" readonly tabindex="-1">
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
    accHidden.value = String(accLine.amount);
    accHidden.dataset.unitPrice = String(accLine.unit_price || accLine.amount || '');
    if (accLine.id) accHidden.dataset.lineId = String(accLine.id);
  }

  const companionInput = tr.querySelector('.daily-amount[data-section="companion"]');
  if (companionInput && companionLine.amount > 0) {
    if (typeof setCommaAmountValue === 'function') setCommaAmountValue(companionInput, companionLine.amount);
    else companionInput.value = formatAmountFieldValue(companionLine.amount);
    if (companionLine.id) tr.dataset.lineId = String(companionLine.id);
  }
  const assistantInput = tr.querySelector('.daily-amount[data-section="patient_assistant"]');
  if (assistantInput && assistantLine.amount > 0) {
    if (typeof setCommaAmountValue === 'function') setCommaAmountValue(assistantInput, assistantLine.amount);
    else assistantInput.value = formatAmountFieldValue(assistantLine.amount);
    if (assistantLine.id) assistantInput.dataset.lineId = String(assistantLine.id);
  }
  const nursingInput = tr.querySelector('.daily-amount[data-section="nursing_point"]');
  if (nursingInput && nursingLine.amount > 0) {
    if (typeof setCommaAmountValue === 'function') setCommaAmountValue(nursingInput, nursingLine.amount);
    else nursingInput.value = formatAmountFieldValue(nursingLine.amount);
    if (nursingLine.id) nursingInput.dataset.lineId = String(nursingLine.id);
  }

  tr._pendingStayAddons = {
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
  void onStayTypeChangeForRow(tr.querySelector('.daily-row-stay-type'));
  updateStayAccUnitPriceDisplay(tr);
  updateRowTotal(tr);
  return tr;
}

function createExamDailyEntryRow(entry = {}, examLine = null) {
  const line =
    examLine ||
    (entry.lines || []).find(
      (l) => ['consultant_exam', 'specialist_exam'].includes(l.section_code) && lineHasChargeData(l)
    ) ||
    {};
  const stampLine = getLineForSection(entry, 'consultation_stamp');
  const tr = document.createElement('tr');
  tr.className = 'daily-entry-row daily-exam-row';
  if (entry.id) tr.dataset.entryId = entry.id;
  if (entry.notes) tr.dataset.entryNotes = entry.notes;
  if (entry.doctor_id) tr.dataset.doctorId = String(entry.doctor_id);
  if (line.section_code) tr.dataset.examSectionCode = line.section_code;
  if (line.id) tr.dataset.examLineId = String(line.id);
  if (stampLine.id) tr.dataset.stampLineId = String(stampLine.id);
  tr._entryLinesSnapshot = (entry.lines || []).map((l) => ({ ...l }));

  const caseCode = line.section_code || '';
  const dateVal = line.extra_date
    ? String(line.extra_date).slice(0, 10)
    : entry.entry_date
      ? String(entry.entry_date).slice(0, 10)
      : getLocalDateString();
  const patientName = getDailyPatientDisplayName();
  const priceVal = line.amount > 0 ? formatAmountFieldValue(line.amount) : '';
  const stampVal = stampLine.amount > 0 ? formatAmountFieldValue(stampLine.amount) : '';

  tr.innerHTML = `
    ${dailyRowSerialCellHtml(resolveDailyRowSerial(entry, line))}
    <td><select class="form-select form-select-sm daily-exam-case">${buildExamCaseOptions(caseCode)}</select></td>
    <td><select class="form-select form-select-sm daily-exam-type">${buildExamTypeOptions(line.service_id, caseCode)}</select></td>
    <td class="daily-exam-doctor-cell">${buildDailyDoctorSuggestHtml('', entry.doctor_id || '')}</td>
    <td><input type="text" class="form-control form-control-sm daily-exam-unit-price bg-light" readonly value="${dailyEscapeAttr(priceVal)}"></td>
    <td><input type="date" class="form-control form-control-sm daily-exam-date" value="${dailyEscapeAttr(dateVal)}" autocomplete="off"></td>
    <td><input type="text" class="form-control form-control-sm daily-exam-patient bg-light" readonly value="${dailyEscapeAttr(patientName)}"></td>
    <td><input type="text" inputmode="decimal" class="form-control form-control-sm daily-exam-stamp comma-amount" value="${dailyEscapeAttr(stampVal)}" autocomplete="off"></td>
    <td class="daily-col-action text-center"><button type="button" class="btn btn-sm btn-outline-danger daily-row-delete" title="حذف">×</button></td>`;

  bindExamRowEvents(tr);
  tr.querySelector('.daily-row-delete')?.addEventListener('click', () => deleteDailyEntryRow(tr));
  if (typeof bindCommaAmountInputs === 'function') bindCommaAmountInputs(tr);
  void hydrateDailyDoctorSuggest(tr, entry.doctor_id || null);
  const typeSel = tr.querySelector('.daily-exam-type');
  if (typeSel?.value) onExamTypeChange(typeSel);
  else if (priceVal) updateRowTotal(tr);
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
  const parts = [
    `نوع المريض: ${patientType}`,
    `التعامل: ${invoiceType}`,
  ];
  if (entity && entity !== '-- اختر الجهة --') parts.push(`الجهة: ${entity}`);
  if (financial) parts.push(`المعاملة: ${financial}`);
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
  if (!qty) qty = 1;
  const unit =
    Number(unitPrice) ||
    (item?.price != null ? Number(item.price) : 0) ||
    getCatalogRowUnitPrice(tr, 'sessions') ||
    0;
  const total = Math.round(unit * qty * 100) / 100;
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
  tr._entryLinesSnapshot = (entry.lines || []).map((l) => ({ ...l }));

  const { morning, evening } = parseSessionsDetail(detailLine.extra_text);
  const morningVal = morning > 0 ? formatAmountFieldValue(morning, 0) : '';
  const eveningVal = evening > 0 ? formatAmountFieldValue(evening, 0) : '';
  const qtyVal =
    line.quantity != null && line.quantity !== ''
      ? formatAmountFieldValue(line.quantity, 0)
      : morning + evening > 0
        ? formatAmountFieldValue(morning + evening, 0)
        : '1';
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
  if (morning > 0 || evening > 0) {
    const detailLineOut = {
      section_code: 'sessions_detail',
      extra_text: formatSessionsDetail(morning, evening),
    };
    if (tr.dataset.detailLineId) detailLineOut.id = Number(tr.dataset.detailLineId);
    lines.push(detailLineOut);
  }

  const section = dailySectionsCache.find((s) => s.code === 'sessions');
  if (section) {
    const pickerFields = window.DailyEntryPicker ? DailyEntryPicker.readPickerFields(tr, section) : {};
    const qty = dailyParseAmount(tr.querySelector('.daily-session-qty')?.value) || 1;
    const amount = dailyParseAmount(tr.querySelector('.daily-session-total')?.value);
    const unit = dailyParseAmount(tr.querySelector('.daily-session-unit')?.value);
    const chargeLine = {
      section_code: 'sessions',
      service_id: pickerFields.service_id ?? null,
      amount,
      quantity: qty,
    };
    if (tr.dataset.lineId) chargeLine.id = Number(tr.dataset.lineId);
    if (unit > 0) chargeLine.unit_price = unit;
    if (lineHasChargeData(chargeLine)) lines.push(chargeLine);
  }
  return lines;
}

function catalogLinesFromEntry(entry, sectionCodes) {
  const codes = Array.isArray(sectionCodes) ? sectionCodes : [sectionCodes];
  return (entry.lines || []).filter((l) => codes.includes(l.section_code) && lineHasChargeData(l));
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

function syncSupplyRowDisplay(tr, item, unitPrice) {
  if (!tr) return;
  const sectionCode = tr.dataset.sectionCode || 'supplies';
  const qty =
    dailyParseAmount(tr.querySelector(`.daily-catalog-qty[data-section="${sectionCode}"]`)?.value) || 1;
  const costUnit = Number(item?.cost_price) || Number(tr.dataset.costPrice) || 0;
  const sellUnit = Number(unitPrice) || Number(tr.dataset.sellUnit) || getCatalogRowUnitPrice(tr, sectionCode) || 0;
  const costTotal = Math.round(costUnit * qty * 100) / 100;
  const sellTotal = Math.round(sellUnit * qty * 100) / 100;
  const markupPct = calcSupplyMarkupPercent(
    costUnit,
    sellUnit,
    item?.markup_percent ?? tr.dataset.markupPercent
  );
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
  const markupEl = tr.querySelector('.daily-sup-markup');
  if (markupEl) {
    markupEl.value = markupPct > 0 ? formatAmountFieldValue(markupPct, 0) : '';
  }
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
  ['.daily-sup-cost-unit', '.daily-sup-cost-total', '.daily-sup-sell-unit', '.daily-sup-sell-total', '.daily-sup-markup'].forEach(
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
      const sellUnit =
        Number(tr.dataset.sellUnit) || getCatalogRowUnitPrice(tr, sectionCode);
      syncSupplyRowDisplay(tr, picker?._selectedItem, sellUnit);
    });
  }
  const markupInput = tr.querySelector('.daily-sup-markup');
  if (markupInput) {
    markupInput.addEventListener('input', () => {
      const costUnit = dailyParseAmount(tr.querySelector('.daily-sup-cost-unit')?.value);
      const markup = dailyParseAmount(markupInput.value);
      if (costUnit <= 0) return;
      const sellUnit = Math.round(costUnit * (1 + markup / 100) * 100) / 100;
      tr.dataset.markupPercent = String(markup);
      syncSupplyRowDisplay(tr, { cost_price: costUnit, markup_percent: markup }, sellUnit);
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
  tr._entryLinesSnapshot = (entry.lines || []).map((l) => ({ ...l }));

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
  tr._entryLinesSnapshot = (entry.lines || []).map((l) => ({ ...l }));

  const qtyVal = line.quantity != null && line.quantity !== '' ? formatAmountFieldValue(line.quantity, 0) : '1';
  const invoiceLabel = getDailyInvoiceDisplayLabel();
  const serialVal = line.catalog_item_code || '';
  const dateVal = line.extra_date
    ? String(line.extra_date).slice(0, 10)
    : entry.entry_date
      ? String(entry.entry_date).slice(0, 10)
      : getLocalDateString();
  const markupVal =
    line.markup_percent != null && Number(line.markup_percent) > 0
      ? formatAmountFieldValue(line.markup_percent, 0)
      : '';

  tr.innerHTML = `
    ${dailyRowSerialCellHtml(resolveDailyRowSerial(entry, line))}
    <td><input type="date" class="form-control form-control-sm daily-sup-date" value="${dailyEscapeAttr(dateVal)}" autocomplete="off"></td>
    <td><input type="text" class="form-control form-control-sm daily-sup-invoice bg-light" readonly value="${dailyEscapeAttr(invoiceLabel)}"></td>
    <td class="daily-sup-name-cell">${section ? buildCatalogPickerCell(section) : ''}
      <input type="hidden" class="daily-field daily-amount" data-section="${dailyEscapeAttr(sectionCode)}" data-type="amount"></td>
    <td><input type="text" inputmode="decimal" class="form-control form-control-sm daily-catalog-qty comma-amount" data-section="${dailyEscapeAttr(sectionCode)}" data-decimals="0" value="${dailyEscapeAttr(qtyVal)}" autocomplete="off"></td>
    <td><input type="text" class="form-control form-control-sm daily-sup-sell-unit bg-light" readonly></td>
    <td><input type="text" class="form-control form-control-sm daily-sup-sell-total bg-light" readonly></td>
    <td><input type="text" class="form-control form-control-sm daily-sup-cost-unit bg-light" readonly></td>
    <td><input type="text" class="form-control form-control-sm daily-sup-cost-total bg-light" readonly></td>
    <td><input type="text" inputmode="decimal" class="form-control form-control-sm daily-sup-markup comma-amount bg-light" data-decimals="0" value="${dailyEscapeAttr(markupVal)}" autocomplete="off"></td>
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
  const markup = dailyParseAmount(tr.querySelector('.daily-sup-markup')?.value);
  if (costUnit > 0) line.cost_price = costUnit;
  if (markup > 0) line.markup_percent = markup;
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
  return (entry.lines || []).filter((l) => l.section_code === mainSectionCode && lineHasChargeData(l));
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
  tr._entryLinesSnapshot = (entry.lines || []).map((l) => ({ ...l }));

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
  tr._entryLinesSnapshot = (entry.lines || []).map((l) => ({ ...l }));

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
  const section = dailySectionsCache.find((s) => s.code === sectionCode);
  const tr = document.createElement('tr');
  tr.className = 'daily-entry-row daily-misc-row';
  tr.dataset.sectionCode = sectionCode;
  if (entry.id) tr.dataset.entryId = entry.id;
  if (entry.notes) tr.dataset.entryNotes = entry.notes;
  if (line.id) tr.dataset.lineId = String(line.id);
  tr._entryLinesSnapshot = (entry.lines || []).map((l) => ({ ...l }));

  const qtyVal = line.quantity != null && line.quantity !== '' ? formatAmountFieldValue(line.quantity, 0) : '1';

  tr.innerHTML = `
    ${dailyRowSerialCellHtml(resolveDailyRowSerial(entry, line))}
    <td class="daily-misc-name-cell">${section ? buildCatalogPickerCell(section) : ''}
      <input type="hidden" class="daily-field daily-amount" data-section="${dailyEscapeAttr(sectionCode)}" data-type="amount"></td>
    <td><input type="text" inputmode="decimal" class="form-control form-control-sm daily-catalog-qty comma-amount" data-section="${dailyEscapeAttr(sectionCode)}" data-decimals="0" value="${dailyEscapeAttr(qtyVal)}" autocomplete="off"></td>
    <td><input type="text" class="form-control form-control-sm daily-misc-unit-price bg-light" readonly></td>
    <td><input type="text" class="form-control form-control-sm daily-misc-total bg-light" readonly></td>
    <td class="daily-col-action text-center"><button type="button" class="btn btn-sm btn-outline-danger daily-row-delete" title="حذف">×</button></td>`;

  bindMiscRowEvents(tr);
  tr.querySelector('.daily-row-delete')?.addEventListener('click', () => deleteDailyEntryRow(tr));
  if (section && window.DailyEntryPicker) {
    DailyEntryPicker.bindRow(tr);
    DailyEntryPicker.hydratePicker(tr, section, line);
    syncSimpleServiceRow(
      tr,
      null,
      Number(line.unit_price) || (line.quantity ? Number(line.amount) / Number(line.quantity) : 0),
      sectionCode,
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

function collectMiscLinesFromRow(tr) {
  const sectionCode = tr.dataset.sectionCode || 'other';
  const tabCodes = ['other', 'prosthetics'];
  const section = dailySectionsCache.find((s) => s.code === sectionCode);
  if (!section) return tr._entryLinesSnapshot || [];
  const line = collectLineForSection(tr, section);
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
  } else if (tr.classList.contains('daily-misc-row') && section.code === tr.dataset.sectionCode) {
    const sectionCode = tr.dataset.sectionCode || section.code;
    syncSimpleServiceRow(tr, item, getCatalogRowUnitPrice(tr, sectionCode), sectionCode, {
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
  if (primary) {
    updateStayRowGroupTotal(primary);
    updateDailyGrandTotal();
    updateSectionTabTotal();
  }
}

function bindStayAddonButtons(primaryTr) {
  primaryTr.querySelectorAll('.daily-stay-addon-add').forEach((btn) => {
    btn.addEventListener('click', () => {
      const section = btn.dataset.section;
      if (!section) return;
      const addon = createStayAddonRow(primaryTr, section);
      insertStayAddonRow(primaryTr, addon);
      if (typeof bindCommaAmountInputs === 'function') bindCommaAmountInputs(addon);
      updateStayRowGroupTotal(primaryTr);
      updateDailyGrandTotal();
      updateSectionTabTotal();
    });
  });
}

function mountStayAddonRows(primaryTr) {
  const pending = primaryTr._pendingStayAddons;
  if (!pending) return;
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

  if (sectionCode === 'companion') {
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
    stayAddonSpacerCell('daily-col-stay-type') +
    stayAddonSpacerCell('daily-col-amount') +
    companionKind +
    companionAmt +
    assistantAmt +
    nursingAmt +
    '<td class="daily-col-total"></td>' +
    '<td class="daily-col-action text-center"><button type="button" class="btn btn-sm btn-outline-secondary daily-stay-addon-remove" title="إزالة">×</button></td>';

  if (sectionCode === 'companion' && line.amount > 0) {
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
    if (rowTr.classList.contains('daily-stay-row')) {
      total += getStayAccommodationAmount(rowTr);
    }
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
  return getStayDayGroupRows(primaryTr).some((tr) => rowHasChargeData(tr));
}

function collectCompanionLineFromRow(rowTr, lines) {
  const kindSel = rowTr.querySelector('.daily-companion-kind');
  if (!kindSel) return;
  const serviceId = kindSel?.value || null;
  const amount = dailyParseAmount(rowTr.querySelector('.daily-amount[data-section="companion"]')?.value);
  if (!serviceId && amount <= 0) return;
  const line = {
    section_code: 'companion',
    service_id: serviceId ? Number(serviceId) : null,
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
  const amount = dailyParseAmount(input?.value);
  if (amount <= 0) return;
  const line = { section_code: sectionCode, amount, quantity: 1 };
  if (input?.dataset.lineId) line.id = Number(input.dataset.lineId);
  else if (rowTr.dataset.lineId && rowTr.dataset.addonSection === sectionCode) {
    line.id = Number(rowTr.dataset.lineId);
  }
  lines.push(line);
}

function dailyLineMergeKey(line) {
  const lineId = Number(line.id || line.line_id);
  if (lineId) return `id:${lineId}`;
  const code = String(line.section_code || '');
  const svc = line.service_id || '';
  const text = String(line.extra_text || '').trim();
  return `new:${code}:${svc}:${text}:${line.amount || 0}`;
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
      '<th class="daily-meta-th daily-col-amount">سعر الإقامة</th>' +
      '<th class="daily-meta-th daily-col-companion-kind">مرافق (غرفة/جناح)</th>' +
      '<th class="daily-meta-th daily-col-amount">سعر المرافق</th>' +
      '<th class="daily-meta-th daily-col-amount">مساعد تمريض</th>' +
      '<th class="daily-meta-th daily-col-amount">نقطة تمريض</th>' +
      '<th class="daily-meta-th daily-col-total">إجمالي</th>' +
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
      '<th class="daily-meta-th">جلسة صباحي</th>' +
      '<th class="daily-meta-th">جلسة مسائي</th>' +
      '<th class="daily-meta-th">عدد الجلسات</th>' +
      '<th class="daily-meta-th">سعر الجلسة</th>' +
      '<th class="daily-meta-th">الإجمالي</th>' +
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
      '<th class="daily-meta-th">نوع الكشف</th>' +
      '<th class="daily-meta-th">اسم الطبيب</th>' +
      '<th class="daily-meta-th">سعر الكشف</th>' +
      '<th class="daily-meta-th">تاريخ الكشف</th>' +
      '<th class="daily-meta-th">اسم المريض</th>' +
      '<th class="daily-meta-th">الدمغة</th>' +
      '<th class="daily-meta-th daily-col-action"></th>';
    if (subhead) {
      subhead.innerHTML = '';
      subhead.style.display = 'none';
    }
    configureDailyTableFooter(9, 'إجمالي الكشوفات (كل الأيام)');
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
      '<th class="daily-meta-th">الكمية</th>' +
      '<th class="daily-meta-th">الوحدة</th>' +
      '<th class="daily-meta-th">الوزن</th>' +
      '<th class="daily-meta-th">سعر الوحدة</th>' +
      '<th class="daily-meta-th">الإجمالي</th>' +
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
      '<th class="daily-meta-th">عدد</th>' +
      '<th class="daily-meta-th">السعر</th>' +
      '<th class="daily-meta-th">الإجمالي</th>' +
      '<th class="daily-meta-th">سعر المستلزم</th>' +
      '<th class="daily-meta-th">إجمالي المستلزم</th>' +
      '<th class="daily-meta-th">هامش الربح %</th>' +
      '<th class="daily-meta-th daily-col-action"></th>';
    if (subhead) {
      subhead.innerHTML = '';
      subhead.style.display = 'none';
    }
    configureDailyTableFooter(12, 'إجمالي المستلزمات (كل الأيام)');
    syncDailySheetTableLayout();
    applyDailyTabColumnVisibility();
    return;
  }

  if (activeDailyTab === 'lab') {
    head.innerHTML =
      '<th class="daily-meta-th daily-col-serial">مسلسل</th>' +
      '<th class="daily-meta-th">تاريخ التحليل</th>' +
      '<th class="daily-meta-th">نوع التحليل</th>' +
      '<th class="daily-meta-th">سعر التحليل</th>' +
      '<th class="daily-meta-th">الإجمالي</th>' +
      '<th class="daily-meta-th">الدمغة</th>' +
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
      '<th class="daily-meta-th">سعر الأشعة</th>' +
      '<th class="daily-meta-th">الإجمالي</th>' +
      '<th class="daily-meta-th">تاريخ الأشعة</th>' +
      '<th class="daily-meta-th">الدمغة</th>' +
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
      '<th class="daily-meta-th">العدد</th>' +
      '<th class="daily-meta-th">السعر</th>' +
      '<th class="daily-meta-th">الإجمالي</th>' +
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

async function applyStayTypeRateToRow(tr) {
  const select = tr.querySelector('.daily-row-stay-type');
  const stayTypeId = select?.value;
  if (!stayTypeId) return;
  const stayType = dailyStayTypesCache.find((t) => String(t.id) === String(stayTypeId));
  const accInput = tr.querySelector('.daily-amount[data-section="accommodation"]');
  const accPicker = tr.querySelector('.daily-picker[data-section="accommodation"]');
  if (!accInput) return;

  const grade = dailyStayGradesCache.find((g) => String(g.stay_type_id) === String(stayTypeId));
  const gradeRate = Number(grade?.daily_rate) || Number(stayType?.daily_rate) || 0;
  if (gradeRate > 0 && dailyParseAmount(accInput.value) <= 0) {
    accInput.value = String(gradeRate);
    accInput.dataset.unitPrice = String(gradeRate);
    accInput.dataset.manualAmount = '0';
    updateStayAccUnitPriceDisplay(tr);
    return;
  }

  if (dailyParseAmount(accInput.value) > 0) return;

  const match = await findAccommodationServiceForStayType(stayType);
  if (!match || !accPicker) return;

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
  const entryDate = getLocalDateString();
  if (activeDailyTab === 'stay' && !preset.stay_type_id) {
    preset.stay_type_id = getDefaultStayTypeIdForRow() || preset.stay_type_id;
  }
  const row = createDailyEntryRow({ ...preset, entry_date: entryDate });
  body.appendChild(row);
  renumberSheetRowSerials();
  if (!row.dataset.dailySerial) stampDailyRowSerial(row, allocateDailyRowSerial());
  if (activeDailyTab === 'stay') mountStayAddonRows(row);
  setDailyTodayDate();
  updateDailyGrandTotal();
  void applyAutoRoomToTodayRows();
}

function rowHasChargeData(tr) {
  if (tr._entryLinesSnapshot?.some((line) => lineHasChargeData(line))) return true;
  if (dailyParseAmount(tr.querySelector('.daily-exam-unit-price')?.value) > 0) return true;
  if (tr.querySelector('.daily-exam-type')?.value) return true;
  if (tr.querySelector('.daily-exam-case')?.value) return true;
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
  if (dailyParseAmount(tr.querySelector('.daily-session-total')?.value) > 0) return true;
  if (tr.querySelector('.daily-picker[data-section="sessions"] .daily-picker-value')?.value) return true;
  if (dailyParseAmount(tr.querySelector('.daily-session-morning')?.value) > 0) return true;
  if (dailyParseAmount(tr.querySelector('.daily-session-evening')?.value) > 0) return true;
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
  const field = tr.querySelector(`.daily-field[data-section="${section.code}"]`);
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
    amount: dailyParseAmount(field?.value),
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

async function loadDailyEntriesIntoSheet() {
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
    await applyAutoRoomToTodayRows();
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
    if (!todayEntries.length) {
      addDailyEntryRow();
      setDailyTodayDate();
      renumberSheetRowSerials();
      updateSectionTabTotal();
      return;
    }
    const seenEntryIds = new Set();
    if (activeDailyTab === 'exams') {
      for (const entry of todayEntries) {
        const examLines = (entry.lines || []).filter(
          (l) => ['consultant_exam', 'specialist_exam'].includes(l.section_code) && lineHasChargeData(l)
        );
        if (examLines.length) {
          for (const line of examLines) {
            body.appendChild(createExamDailyEntryRow(entry, line));
          }
        }
      }
      addDailyEntryRow();
    } else if (activeDailyTab === 'lab') {
      for (const entry of todayEntries) {
        const labLines = serviceLinesFromEntry(entry, 'analyses');
        if (labLines.length) {
          for (const line of labLines) {
            body.appendChild(createLabRow(entry, line));
          }
        }
      }
      addDailyEntryRow();
    } else if (activeDailyTab === 'radiology') {
      for (const entry of todayEntries) {
        const radLines = serviceLinesFromEntry(entry, 'xray_total');
        if (radLines.length) {
          for (const line of radLines) {
            body.appendChild(createRadiologyRow(entry, line));
          }
        }
      }
      addDailyEntryRow();
    } else if (activeDailyTab === 'other') {
      for (const entry of todayEntries) {
        const miscLines = catalogLinesFromEntry(entry, ['other', 'prosthetics']);
        if (miscLines.length) {
          for (const line of miscLines) {
            body.appendChild(createMiscServiceRow(entry, line, line.section_code));
          }
        }
      }
      addDailyEntryRow();
    } else if (activeDailyTab === 'medicines') {
      for (const entry of todayEntries) {
        const medLines = catalogLinesFromEntry(entry, 'medicines');
        if (medLines.length) {
          for (const line of medLines) {
            body.appendChild(createMedicineCatalogRow(entry, line));
          }
        }
      }
      addDailyEntryRow();
    } else if (activeDailyTab === 'supplies') {
      for (const entry of todayEntries) {
        const supLines = catalogLinesFromEntry(entry, ['supplies', 'cosmetics']);
        if (supLines.length) {
          for (const line of supLines) {
            body.appendChild(createSupplyCatalogRow(entry, line, line.section_code));
          }
        }
      }
      addDailyEntryRow();
    } else if (activeDailyTab === 'sessions') {
      for (const entry of todayEntries) {
        const sessionLines = serviceLinesFromEntry(entry, 'sessions');
        const hasSessionMeta =
          lineHasChargeData(getLineForSection(entry, 'sessions_date')) ||
          lineHasChargeData(getLineForSection(entry, 'sessions_detail'));
        if (sessionLines.length) {
          for (const line of sessionLines) {
            body.appendChild(createSessionsRow(entry, line));
          }
        } else if (hasSessionMeta) {
          body.appendChild(createSessionsRow(entry));
        }
      }
      addDailyEntryRow();
    } else if (activeDailyTab === 'stay') {
      for (const entry of todayEntries) {
        if (entry.id) {
          if (seenEntryIds.has(entry.id)) continue;
          seenEntryIds.add(entry.id);
        }
        const row = createStayDailyEntryRow(entry);
        body.appendChild(row);
        mountStayAddonRows(row);
      }
      if (!body.querySelector('.daily-entry-row')) addDailyEntryRow();
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
    renumberSheetRowSerials();
    updateDailyGrandTotal();
    updateSectionTabTotal();
    await applyAutoRoomToTodayRows();
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
    if (tr.classList.contains('daily-stay-addon-row')) {
      deleteStayAddonRow(tr);
      return;
    }
    if (tr.classList.contains('daily-stay-row')) {
      getStayDayGroupRows(tr).forEach((row) => row.remove());
    } else {
      tr.remove();
    }
    if (!document.querySelector('.daily-entry-row')) addDailyEntryRow();
    renumberSheetRowSerials();
    updateDailyGrandTotal();
    return;
  }
  await deleteDailyEntryById(entryId);
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
    rows.push({
      entry_id: entryId,
      entry_date: today,
      stay_type_id:
        tr.querySelector('.daily-row-stay-type')?.value || tr.dataset.stayTypeId || null,
      doctor_specialty:
        tr.querySelector('.daily-row-specialty')?.value || tr.dataset.doctorSpecialty || '',
      doctor_id:
        tr.querySelector('.daily-exam-doctor')?.value ||
        tr.querySelector('.daily-row-doctor')?.value ||
        tr.dataset.doctorId ||
        null,
      notes: tr.dataset.entryNotes || notes,
      lines: collectDailyLinesFromRow(tr),
    });
  });
  return mergeDailySaveEntries(rows);
}

function mergeDailySaveEntries(rows) {
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

  return [...byEntryId.values(), ...freshRows];
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
  if (activeDailyTab === 'free-items') {
    return saveFreeItems();
  }
  if (activeDailyTab === 'operations') {
    return saveOperationsPanel();
  }
  if (!dailyCan('daily_charges.manage')) {
    showToast('ليس لديك صلاحية تسجيل الحركة اليومية', 'warning');
    return;
  }
  if (!dailyStayContext?.invoice?.id) {
    showToast('لا توجد فاتورة مفتوحة — سجّل المريض من تسجيل مريض جديد أولًا', 'warning');
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
        operations: collectOperationsFromTable(),
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

    const invLabel = data.invoice_sync.created ? 'تم إنشاء فاتورة مسودة' : 'تم تحديث الفاتورة';
    const toastMsg = `تم الحفظ — أُضيف تلقائياً على الفاتورة الكبيرة (#${data.invoice_sync.invoice_id})`;
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

function openNewPatientRegistration() {
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

async function initDailyChargesView(options = {}) {
  if (!dailyCan('daily_charges.view')) return;
  try {
    if (typeof loadFinancialTreatments === 'function') await loadFinancialTreatments();
    await loadDailyDoctorSpecialties();
    await loadDailyStayTypes();
    populateStayTypeSelects();
    void loadPatientEntitySelects();
    if (!dailySectionsCache.length) await loadDailySections();
    if (dailySectionsLoadFailed) return;
    renderDailySectionTabs();
    setDailyTodayDate();
    if (typeof bindCommaAmountInputs === 'function') {
      bindCommaAmountInputs(document.getElementById('view-daily'));
    }
    showDailyPatientPicker();
    const openFile = String(options.openFileNumber || '').trim();
    if (openFile) {
      await selectDailyPatient(openFile);
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
  document.getElementById('patient-reg-stay-grade')?.addEventListener('change', syncStayGradeToRoom);
  document.getElementById('patient-reg-invoice-type')?.addEventListener('change', togglePatientRegEntityFields);
  document.getElementById('patient-reg-letter-from')?.addEventListener('change', updateLetterAuthorizedDaysDisplay);
  document.getElementById('patient-reg-letter-to')?.addEventListener('change', updateLetterAuthorizedDaysDisplay);
  document.getElementById('patient-reg-military-from')?.addEventListener('change', updatePatientRegMilitarySummary);
  document.getElementById('patient-reg-military-to')?.addEventListener('change', updatePatientRegMilitarySummary);
  document.getElementById('patient-reg-military-amount')?.addEventListener('input', updatePatientRegMilitarySummary);
  document.getElementById('daily-stay-invoice-type')?.addEventListener('change', () => {
    toggleDailyStayEntityFields();
    updateDailyMilitaryAuthBanner();
  });
  document.getElementById('daily-change-room-btn')?.addEventListener('click', openChangeRoomModal);
  document.getElementById('change-room-submit-btn')?.addEventListener('click', submitChangeRoom);
  document.getElementById('daily-batch-stay-btn')?.addEventListener('click', openBatchStayModal);
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
    showDailySection(tab.dataset.dailyTab);
  });
  document.getElementById('daily-change-patient-btn')?.addEventListener('click', () => {
    showDailyPatientPicker();
    void loadDailyPatientGrid();
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
  document.getElementById('daily-print-radiology-btn')?.addEventListener('click', () =>
    openDailyItemsPrint('radiology')
  );
  document.getElementById('daily-print-laboratory-btn')?.addEventListener('click', () =>
    openDailyItemsPrint('laboratory')
  );
  document.getElementById('daily-save-btn')?.addEventListener('click', saveDailyEntry);
  document.getElementById('daily-add-row-btn')?.addEventListener('click', () => {
    if (activeDailyTab === 'operations') addOperationRow();
    else addDailyEntryRow();
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
  document.getElementById('daily-free-save-btn')?.addEventListener('click', saveFreeItems);
  document.getElementById('import-daily-charges-btn')?.addEventListener('click', importDailyChargesToInvoice);
});

window.initDailyChargesView = initDailyChargesView;
window.initPatientRegistration = initPatientRegistration;
window.openNewPatientRegistration = openNewPatientRegistration;
window.loadDailyDoctorSpecialties = loadDailyDoctorSpecialties;
window.importDailyChargesToInvoice = importDailyChargesToInvoice;
window.syncDailyChargeRowsFromTotals = syncDailyChargeRowsFromTotals;
window.reloadDailyCatalogSectionsFromSettings = reloadDailyCatalogSectionsFromSettings;
