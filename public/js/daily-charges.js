const DAILY_API = '/api/daily-charges';

const DAILY_TAB_GROUPS = [
  { id: 'stay', label: 'إقامة ورعاية', icon: '🏨', tileClass: 'hub-tile--teal', codes: ['accommodation', 'companion', 'nursing_point', 'patient_assistant'] },
  { id: 'sessions', label: 'جلسات', icon: '📅', tileClass: 'hub-tile--indigo', codes: ['sessions_date', 'sessions_detail', 'sessions'] },
  { id: 'medicines', label: 'أدوية', icon: '💊', tileClass: 'hub-tile--blue', codes: ['medicines'] },
  { id: 'supplies', label: 'مستلزمات', icon: '🧴', tileClass: 'hub-tile--green', codes: ['supplies', 'cosmetics'] },
  { id: 'exams', label: 'كشوفات', icon: '🩺', tileClass: 'hub-tile--primary', codes: ['consultant_exam', 'specialist_exam', 'consultation_stamp'] },
  { id: 'lab', label: 'تحاليل', icon: '🔬', tileClass: 'hub-tile--slate', codes: ['analyses', 'analyses_stamp'] },
  { id: 'radiology', label: 'أشعة', icon: '🩻', tileClass: 'hub-tile--blue', codes: ['xray_type', 'xray_total', 'xray_stamp'] },
  { id: 'other', label: 'أخرى', icon: '📎', tileClass: 'hub-tile--slate', codes: ['other', 'prosthetics'] },
  { id: 'operations', label: 'عمليات', icon: '⚕️', tileClass: 'hub-tile--red', codes: [] },
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
  if (!activeDailyTab) return null;
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

  const catalogTabs = ['medicines', 'supplies', 'exams', 'radiology', 'other'];
  const hideMeta = catalogTabs.includes(activeDailyTab);
  document.querySelectorAll('.daily-meta-th').forEach((el) => {
    el.classList.toggle('daily-col-hidden', hideMeta);
  });
  document.querySelectorAll('.daily-entry-row .daily-row-date, .daily-row-stay-type, .daily-row-specialty, .daily-row-doctor, .daily-doctor-search').forEach((el) => {
    const cell = el.closest('td');
    if (cell) cell.classList.toggle('daily-col-hidden', hideMeta);
  });

  const mainSheet = document.getElementById('daily-main-sheet-wrap');
  const opsPanel = document.getElementById('daily-operations-panel');
  const glassesPanel = document.getElementById('daily-glasses-panel');
  const totalBar = document.getElementById('daily-section-total-bar');
  if (mainSheet) mainSheet.style.display = activeDailyTab === 'operations' ? 'none' : '';
  if (opsPanel) opsPanel.style.display = activeDailyTab === 'operations' ? '' : 'none';
  if (glassesPanel) glassesPanel.style.display = activeDailyTab === 'supplies' ? '' : 'none';
  if (totalBar) totalBar.style.display = hideMeta || activeDailyTab === 'operations' ? '' : 'none';

  updateSectionTabTotal();

  const hint = document.getElementById('daily-tab-hint');
  if (hint && codes) {
    const label = DAILY_TAB_GROUPS.find((g) => g.id === activeDailyTab)?.label || '';
    hint.textContent = `قسم «${label}» — أدخل البيانات ثم احفظ الكل.`;
  } else if (hint) {
    hint.textContent = 'كل أقسام الحركة اليومية — أو اختر تبويبًا لعرض قسم واحد.';
  }
}

function updateSectionTabTotal() {
  const codes = codesForActiveDailyTab();
  const display = document.getElementById('daily-section-total');
  if (!display) return;
  let total = 0;
  if (activeDailyTab === 'operations') {
    total = dailyParseAmount(document.getElementById('daily-operations-total')?.textContent);
  } else if (codes) {
    document.querySelectorAll('.daily-entry-row').forEach((tr) => {
      codes.forEach((code) => {
        const input = tr.querySelector(`.daily-amount[data-section="${code}"]`);
        if (input) total += dailyParseAmount(input.value);
      });
    });
    if (activeDailyTab === 'supplies') total += getGlassesFinalAmount();
  }
  display.textContent = total > 0 ? dailyFmt(total) : '0';
}

function updateGlassesFinalAmount() {
  const price = dailyParseAmount(document.getElementById('daily-glasses-price')?.value);
  const disc = dailyParseAmount(document.getElementById('daily-glasses-discount')?.value);
  const finalEl = document.getElementById('daily-glasses-final');
  if (!finalEl) return;
  const final = Math.round(price * (1 - disc / 100) * 100) / 100;
  finalEl.value = typeof formatAmountInput === 'function' ? formatAmountInput(final) : String(final);
  updateSectionTabTotal();
  updateDailyGrandTotal();
}

function getGlassesFinalAmount() {
  return dailyParseAmount(document.getElementById('daily-glasses-final')?.value);
}

const OPERATION_CASE_OPTIONS = [
  { value: 'civil', label: 'نقدي' },
  { value: 'contracted', label: 'تعاقد / تأمين' },
  { value: 'non_contracted', label: 'جهة غير متعاقدة' },
  { value: 'military', label: 'عسكري' },
  { value: 'hospital', label: 'حالة مستشفى' },
  { value: 'special', label: 'حالة خاصة' },
];

function buildOperationCaseTypeOptions(selected = 'civil') {
  return OPERATION_CASE_OPTIONS.map(
    (opt) =>
      `<option value="${opt.value}"${String(selected) === opt.value ? ' selected' : ''}>${dailyEscapeHtml(opt.label)}</option>`
  ).join('');
}

function updateOperationsTotal() {
  let total = 0;
  document.querySelectorAll('#daily-operations-tbody .daily-op-amount').forEach((input) => {
    total += dailyParseAmount(input.value);
  });
  const cell = document.getElementById('daily-operations-total');
  if (cell) cell.textContent = total > 0 ? dailyFmt(total) : '0';
  updateSectionTabTotal();
  updateDailyGrandTotal();
}

function createOperationRowHtml(op = {}) {
  const amountVal =
    op.amount != null && Number(op.amount) > 0
      ? typeof formatAmountInput === 'function'
        ? formatAmountInput(op.amount)
        : dailyFormatInput(op.amount)
      : '';
  const durationVal =
    op.duration_hours != null && Number(op.duration_hours) > 0 ? String(op.duration_hours) : '';
  return `
    <td><input type="text" class="form-control form-control-sm daily-op-name" value="${dailyEscapeAttr(op.operation_name || '')}" autocomplete="off"></td>
    <td><input type="text" inputmode="decimal" class="form-control form-control-sm daily-op-duration comma-amount" value="${dailyEscapeAttr(durationVal)}" autocomplete="off"></td>
    <td><input type="text" class="form-control form-control-sm daily-op-surgeon" value="${dailyEscapeAttr(op.surgeon_name || '')}" autocomplete="off"></td>
    <td><input type="text" class="form-control form-control-sm daily-op-doctor" value="${dailyEscapeAttr(op.doctor_name || '')}" autocomplete="off"></td>
    <td><input type="text" class="form-control form-control-sm daily-op-anesthesia" value="${dailyEscapeAttr(op.anesthesia_doctor || '')}" autocomplete="off"></td>
    <td><input type="text" class="form-control form-control-sm daily-op-assistant" value="${dailyEscapeAttr(op.assistant_surgeon || '')}" autocomplete="off"></td>
    <td><select class="form-select form-select-sm daily-op-case-type">${buildOperationCaseTypeOptions(op.case_type || 'civil')}</select></td>
    <td><input type="text" inputmode="decimal" class="form-control form-control-sm daily-op-amount comma-amount" value="${dailyEscapeAttr(amountVal)}" autocomplete="off"></td>
    <td class="text-center"><button type="button" class="btn btn-sm btn-outline-danger daily-op-remove" title="حذف">×</button></td>`;
}

function bindOperationRowEvents(tr) {
  tr.querySelectorAll('.daily-op-amount').forEach((el) => {
    el.addEventListener('input', updateOperationsTotal);
  });
  tr.querySelector('.daily-op-remove')?.addEventListener('click', () => {
    tr.remove();
    updateOperationsTotal();
  });
  if (typeof bindCommaAmountInputs === 'function') bindCommaAmountInputs(tr);
}

function addOperationRow(op = {}) {
  const tbody = document.getElementById('daily-operations-tbody');
  if (!tbody) return;
  const tr = document.createElement('tr');
  tr.className = 'daily-operation-row';
  tr.innerHTML = createOperationRowHtml(op);
  tbody.appendChild(tr);
  bindOperationRowEvents(tr);
  updateOperationsTotal();
}

function collectOperationsFromTable() {
  const rows = [];
  document.querySelectorAll('#daily-operations-tbody .daily-operation-row').forEach((tr) => {
    const operation_name = tr.querySelector('.daily-op-name')?.value?.trim() || '';
    const amount = dailyParseAmount(tr.querySelector('.daily-op-amount')?.value);
    const duration_hours = dailyParseAmount(tr.querySelector('.daily-op-duration')?.value);
    if (!operation_name && amount <= 0) return;
    rows.push({
      operation_name,
      duration_hours,
      surgeon_name: tr.querySelector('.daily-op-surgeon')?.value?.trim() || '',
      doctor_name: tr.querySelector('.daily-op-doctor')?.value?.trim() || '',
      anesthesia_doctor: tr.querySelector('.daily-op-anesthesia')?.value?.trim() || '',
      assistant_surgeon: tr.querySelector('.daily-op-assistant')?.value?.trim() || '',
      case_type: tr.querySelector('.daily-op-case-type')?.value || 'civil',
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
    updateOperationsTotal();
    return;
  }
  try {
    const today = getLocalDateString();
    const ops = await apiJson(
      `${DAILY_API}/operations?file_number=${encodeURIComponent(fileNumber)}&entry_date=${encodeURIComponent(today)}`
    );
    tbody.innerHTML = '';
    if (ops.length) {
      ops.forEach((op) => addOperationRow(op));
    } else {
      updateOperationsTotal();
    }
  } catch (err) {
    console.error(err);
    tbody.innerHTML = '';
    updateOperationsTotal();
  }
}

function renderDailySectionTiles() {
  const grid = document.getElementById('daily-section-tiles-grid');
  if (!grid) return;
  grid.innerHTML = DAILY_TAB_GROUPS
    .map(
      (g) =>
        `<button type="button" class="hub-tile ${g.tileClass || 'hub-tile--slate'} daily-section-tile" data-daily-tab="${g.id}">
          <span class="hub-tile-icon">${g.icon || '📋'}</span>
          <span class="hub-tile-title">${dailyEscapeHtml(g.label)}</span>
        </button>`
    )
    .join('');
}

function showDailySection(sectionId) {
  activeDailyTab = sectionId || '';
  const tilesWrap = document.getElementById('daily-section-tiles-wrap');
  const sectionWorkspace = document.getElementById('daily-section-workspace');
  if (tilesWrap) tilesWrap.classList.toggle('d-none', !!sectionId);
  if (sectionWorkspace) {
    if (sectionId) sectionWorkspace.classList.remove('d-none');
    else sectionWorkspace.classList.add('d-none');
  }
  if (sectionId) applyDailyTabColumnVisibility();
}

function showDailyPatientPicker() {
  document.getElementById('daily-patient-picker-wrap')?.classList.remove('d-none');
  document.getElementById('daily-patient-workspace')?.classList.add('d-none');
  document.getElementById('daily-change-patient-btn')?.classList.add('d-none');
  sessionStorage.removeItem('dailyStayFileNumber');
  dailyStayContext = null;
}

function showDailyPatientWorkspace() {
  document.getElementById('daily-patient-picker-wrap')?.classList.add('d-none');
  document.getElementById('daily-patient-workspace')?.classList.remove('d-none');
  document.getElementById('daily-change-patient-btn')?.classList.remove('d-none');
  showDailySection('');
  renderDailySectionTiles();
}

function updateDailyPatientHeader(ctx) {
  const p = ctx?.patient;
  const nameEl = document.getElementById('daily-header-patient-name');
  const metaEl = document.getElementById('daily-header-patient-meta');
  if (nameEl) nameEl.textContent = p?.name || ctx?.invoice?.patient_name || '—';
  if (metaEl) {
    const typeLabel = p?.patient_type === 'external' ? 'خارجي' : 'داخلي';
    const parts = [`ملف ${p?.file_number || '—'}`, typeLabel];
    if (p?.nationality) parts.push(p.nationality);
    if (p?.phone) parts.push(p.phone);
    metaEl.textContent = parts.join(' · ');
  }
  const changeRoomBtn = document.getElementById('daily-change-room-btn');
  if (changeRoomBtn) {
    const showRoom = Boolean(ctx?.invoice?.id) && p?.patient_type !== 'external';
    changeRoomBtn.classList.toggle('d-none', !showRoom);
  }
}

async function loadDailyPatientGrid(search = '') {
  const grid = document.getElementById('daily-patient-grid');
  if (!grid) return;
  grid.innerHTML = '<p class="text-muted text-center col-12 py-3">جاري التحميل...</p>';
  try {
    const params = new URLSearchParams({ limit: '40' });
    if (search.trim()) params.set('search', search.trim());
    const patients = await apiJson(`${DAILY_API}/patients?${params}`);
    if (!patients.length) {
      grid.innerHTML =
        '<p class="text-muted text-center col-12 py-4 mb-0">لا يوجد مرضى مطابقين — سجّل مريضًا جديدًا أولًا</p>';
      return;
    }
    grid.innerHTML = patients
      .map(
        (p) =>
          `<button type="button" class="hub-tile hub-tile--teal daily-patient-tile" data-file-number="${dailyEscapeHtml(p.file_number)}">
            <span class="hub-tile-icon">${p.patient_type === 'external' ? '🩺' : '🏥'}</span>
            <span class="hub-tile-title">${dailyEscapeHtml(p.name)}</span>
            <span class="hub-tile-desc">ملف ${dailyEscapeHtml(p.file_number)}</span>
          </button>`
      )
      .join('');
  } catch (err) {
    grid.innerHTML = `<p class="text-danger text-center col-12 py-3">${dailyEscapeHtml(sanitizeApiErrorMessage(err.message))}</p>`;
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
        nationality: p.nationality || '',
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

function setDailyWorkflowSteps(hasStay) {
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

function togglePatientRegEntityFields() {
  const type = document.getElementById('patient-reg-invoice-type')?.value || 'civil';
  const showEntity = isEntityInvoiceType(type);
  const isMilitary = type === 'military';
  const entityWrap = document.getElementById('patient-reg-entity-wrap');
  const letterWrap = document.getElementById('patient-reg-letter-wrap');
  const letterEnd = document.getElementById('patient-reg-letter-wrap-end');
  const milFrom = document.getElementById('patient-reg-military-wrap');
  const milTo = document.getElementById('patient-reg-military-wrap-end');
  if (entityWrap) entityWrap.style.display = showEntity ? '' : 'none';
  if (letterWrap) letterWrap.style.display = showEntity ? '' : 'none';
  if (letterEnd) letterEnd.style.display = showEntity ? '' : 'none';
  if (milFrom) milFrom.style.display = isMilitary ? '' : 'none';
  if (milTo) milTo.style.display = isMilitary ? '' : 'none';
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

function collectPatientDemographics(mode = 'register') {
  const isDaily = mode === 'daily';
  const invoice_type = document.getElementById(
    isDaily ? 'daily-stay-invoice-type' : 'patient-reg-invoice-type'
  )?.value || 'civil';
  const payload = {
    age: document.getElementById(isDaily ? 'daily-stay-age' : 'patient-reg-age')?.value?.trim() || null,
    disability_degree: document.getElementById(
      isDaily ? 'daily-stay-disability-degree' : 'patient-reg-disability-degree'
    )?.value?.trim() || '',
    disability_type: document.getElementById(
      isDaily ? 'daily-stay-disability-type' : 'patient-reg-disability-type'
    )?.value?.trim() || '',
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
  }
  if (isDaily) {
    payload.glasses_lens_type = document.getElementById('daily-glasses-lens')?.value?.trim() || '';
    payload.glasses_start_date = document.getElementById('daily-glasses-start')?.value || null;
    payload.glasses_price = dailyParseAmount(document.getElementById('daily-glasses-price')?.value);
    payload.glasses_discount_percent = dailyParseAmount(document.getElementById('daily-glasses-discount')?.value);
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
  const rows = document.querySelectorAll('#daily-sections-body .daily-entry-row');
  const today = getLocalDateString();
  for (const tr of rows) {
    const rowDate = tr.querySelector('.daily-row-date')?.value;
    if (rowDate && rowDate !== today) continue;
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
      }),
    });
    dailyStayContext = data;
    applyDailyStayContext(data);
    if (changeRoomModal) changeRoomModal.hide();
    showToast('تم تغيير الغرفة — سيُسجَّل الإقامة تلقائيًا من التاريخ المحدد', 'success');
    await loadDailyEntriesIntoSheet();
    await applyAutoRoomToTodayRows();
  } catch (err) {
    showToast(sanitizeApiErrorMessage(err.message), 'danger');
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
  clearPatientRegisterForm({ keepType: true });
  populateStayTypeSelects();
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
    'patient-reg-nationality',
    'patient-reg-admission',
    'patient-reg-balance',
    'patient-reg-age',
    'patient-reg-disability-degree',
    'patient-reg-disability-type',
    'patient-reg-room-insurance',
    'patient-reg-military-from',
    'patient-reg-military-to',
  ];
  ids.forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  const genderEl = document.getElementById('patient-reg-gender');
  if (genderEl) genderEl.value = '';
  const financialEl = document.getElementById('patient-reg-financial');
  if (financialEl) financialEl.value = '';
  if (!keepType) {
    patientRegSelectedType = null;
    const typeInput = document.getElementById('patient-reg-type');
    if (typeInput) typeInput.value = 'internal';
  }
  bustFieldAutocomplete(document.getElementById('patient-register-form'));
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
  const nationality = document.getElementById('patient-reg-nationality')?.value.trim() || '';
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
    showToast(`${label} — ملف ${file_number}`, 'success');
    clearPatientRegisterForm();
    if (typeof switchView === 'function') {
      switchView('daily');
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
  void loadDailyStayTypes().then(() => populateStayTypeSelects());
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
    const nationalityEl = document.getElementById('daily-stay-nationality');
    if (nationalityEl) nationalityEl.value = ctx.patient.nationality || '';
    const genderEl = document.getElementById('daily-stay-gender');
    if (genderEl) genderEl.value = ctx.patient.gender || '';
    const ageEl = document.getElementById('daily-stay-age');
    if (ageEl && ctx.patient.age != null) ageEl.value = String(ctx.patient.age);
    const disDeg = document.getElementById('daily-stay-disability-degree');
    if (disDeg) disDeg.value = ctx.patient.disability_degree || '';
    const disType = document.getElementById('daily-stay-disability-type');
    if (disType) disType.value = ctx.patient.disability_type || '';
    const roomIns = document.getElementById('daily-stay-room-insurance');
    if (roomIns && typeof setCommaAmountValue === 'function') {
      setCommaAmountValue(roomIns, ctx.patient.room_insurance_amount || 0);
    }
    const milFrom = document.getElementById('daily-stay-military-from');
    const milTo = document.getElementById('daily-stay-military-to');
    if (milFrom) milFrom.value = fmtStayDate(ctx.patient.military_auth_from) || '';
    if (milTo) milTo.value = fmtStayDate(ctx.patient.military_auth_to) || '';
    const gLens = document.getElementById('daily-glasses-lens');
    if (gLens) gLens.value = ctx.patient.glasses_lens_type || '';
    const gStart = document.getElementById('daily-glasses-start');
    if (gStart) gStart.value = fmtStayDate(ctx.patient.glasses_start_date) || '';
    const gPrice = document.getElementById('daily-glasses-price');
    if (gPrice && typeof setCommaAmountValue === 'function') {
      setCommaAmountValue(gPrice, ctx.patient.glasses_price || 0);
    }
    const gDisc = document.getElementById('daily-glasses-discount');
    if (gDisc && typeof setCommaAmountValue === 'function') {
      setCommaAmountValue(gDisc, ctx.patient.glasses_discount_percent || 0);
    }
    updateGlassesFinalAmount();
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
  if (ctx?.patient?.file_number && ctx?.patient?.name) {
    showDailyPatientWorkspace();
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
      nationality: document.getElementById('daily-stay-nationality')?.value.trim() || '',
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
      ? `<input type="text" inputmode="decimal" class="form-control form-control-sm daily-weight mb-1" data-section="${section.code}" placeholder="الوزن" value="${dailyEscapeAttr(weightVal)}" autocomplete="off">`
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
    return `<td class="daily-section-cell" data-section="${section.code}">${pickerHtml}<input type="text" inputmode="decimal" class="form-control form-control-sm daily-field daily-amount comma-amount" data-section="${section.code}" data-type="amount" data-manual-amount="${amountVal ? '1' : '0'}" value="${amountVal}" placeholder="المبلغ"></td>`;
  }

  return `<td class="daily-section-cell" data-section="${section.code}">${pickerHtml}${weightHtml}<div class="input-group input-group-sm mb-1"><span class="input-group-text">كمية</span><input type="text" inputmode="decimal" class="form-control daily-catalog-qty comma-amount" data-section="${section.code}" data-decimals="0" value="${qtyVal}" autocomplete="off"></div><input type="text" inputmode="decimal" class="form-control form-control-sm daily-field daily-amount comma-amount" data-section="${section.code}" data-type="amount" data-manual-amount="${amountVal ? '1' : '0'}" value="${amountVal}" placeholder="الإجمالي"></td>`;
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
  tr.querySelectorAll('.daily-field, .daily-catalog-unit, .daily-row-date, .daily-row-stay-type, .daily-catalog-qty, .daily-weight').forEach((el) => {
    el.addEventListener('input', () => {
      if (el.classList.contains('daily-amount')) el.dataset.manualAmount = '1';
      if (el.classList.contains('daily-catalog-qty')) {
        const section = dailySectionsCache.find((s) => s.code === el.dataset.section);
        const amtEl = tr.querySelector(`.daily-amount[data-section="${el.dataset.section}"]`);
        const picker = tr.querySelector(`.daily-picker[data-section="${el.dataset.section}"]`);
        const unitSel = tr.querySelector(`.daily-catalog-unit[data-section="${el.dataset.section}"]`);
        let unitPrice = 0;
        if (unitSel && unitSel.value) {
          const opt = unitSel.selectedOptions[0];
          unitPrice = dailyParseAmount(opt?.dataset.price);
        }
        if (amtEl && unitPrice > 0) {
          const qty = dailyParseAmount(el.value) || 1;
          const total = Math.round(unitPrice * qty * 100) / 100;
          if (typeof setCommaAmountValue === 'function') setCommaAmountValue(amtEl, total);
          else amtEl.value = dailyFormatInput(total);
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
  void applyAutoRoomToTodayRows();
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
    const qtyInput = tr.querySelector(`.daily-catalog-qty[data-section="${section.code}"]`);
    const qty = dailyParseAmount(qtyInput?.value) || 1;
    const weightInput = tr.querySelector(`.daily-weight[data-section="${section.code}"]`);
    const weightRaw = weightInput?.value?.trim();
    const weight = weightRaw ? Number(weightRaw.replace(/,/g, '')) : null;
    return {
      section_code: section.code,
      catalog_item_id: pickerFields.catalog_item_id ?? null,
      catalog_unit_level: pickerFields.catalog_unit_level ?? null,
      catalog_unit: pickerFields.catalog_unit ?? null,
      service_id: pickerFields.service_id ?? null,
      amount: dailyParseAmount(field?.value),
      quantity: qty,
      weight: Number.isFinite(weight) ? weight : null,
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
  total += dailyParseAmount(document.getElementById('daily-operations-total')?.textContent);
  total += getGlassesFinalAmount();
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
    await applyAutoRoomToTodayRows();
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
    await applyAutoRoomToTodayRows();
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
          nationality: document.getElementById('daily-stay-nationality')?.value?.trim() || '',
          gender: document.getElementById('daily-stay-gender')?.value || '',
          age: document.getElementById('daily-stay-age')?.value?.trim() || null,
        },
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
  if (opsBody) opsBody.innerHTML = '';
  updateOperationsTotal();
  updateDailyGrandTotal();
}

async function initDailyChargesView() {
  if (!dailyCan('daily_charges.view')) return;
  try {
    if (typeof loadFinancialTreatments === 'function') await loadFinancialTreatments();
    await loadDailyDoctorSpecialties();
    await loadDailyStayTypes();
    populateStayTypeSelects();
    void loadPatientEntitySelects();
    if (!dailySectionsCache.length) await loadDailySections();
    if (dailySectionsLoadFailed) return;
    setDailyTodayDate();
    if (typeof bindCommaAmountInputs === 'function') {
      bindCommaAmountInputs(document.getElementById('view-daily'));
    }
    await loadDailyPatientGrid();
    const savedFile = sessionStorage.getItem('dailyStayFileNumber');
    if (savedFile) {
      await selectDailyPatient(savedFile);
    } else {
      applyDailyStayContext(null);
      showDailyPatientPicker();
      await loadDailyEntriesIntoSheet();
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
  document.getElementById('patient-reg-invoice-type')?.addEventListener('change', togglePatientRegEntityFields);
  document.getElementById('daily-stay-invoice-type')?.addEventListener('change', toggleDailyStayEntityFields);
  document.getElementById('daily-change-room-btn')?.addEventListener('click', openChangeRoomModal);
  document.getElementById('change-room-submit-btn')?.addEventListener('click', submitChangeRoom);
  document.getElementById('daily-stay-open-btn')?.addEventListener('click', saveOpenPatientStay);
  document.getElementById('daily-stay-lookup-btn')?.addEventListener('click', () => loadOpenPatientStay());
  document.getElementById('daily-open-invoice-btn')?.addEventListener('click', openDailyStayInvoice);
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
  document.getElementById('daily-patient-grid')?.addEventListener('click', (e) => {
    const tile = e.target.closest('.daily-patient-tile');
    if (!tile) return;
    void selectDailyPatient(tile.dataset.fileNumber);
  });
  document.getElementById('daily-section-tiles-grid')?.addEventListener('click', (e) => {
    const tile = e.target.closest('.daily-section-tile');
    if (!tile) return;
    if (!dailyStayContext?.invoice?.id) {
      showToast('لا توجد فاتورة مفتوحة لهذا المريض', 'warning');
      return;
    }
    showDailySection(tile.dataset.dailyTab);
  });
  document.getElementById('daily-section-back')?.addEventListener('click', () => showDailySection(''));
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
  document.getElementById('daily-clear-btn')?.addEventListener('click', clearDailyForm);
  document.getElementById('daily-add-row-btn')?.addEventListener('click', () => addDailyEntryRow());
  document.getElementById('daily-op-add-row')?.addEventListener('click', () => addOperationRow());
  document.getElementById('daily-glasses-price')?.addEventListener('input', updateGlassesFinalAmount);
  document.getElementById('daily-glasses-discount')?.addEventListener('input', updateGlassesFinalAmount);
  document.getElementById('import-daily-charges-btn')?.addEventListener('click', importDailyChargesToInvoice);
});

window.initDailyChargesView = initDailyChargesView;
window.initPatientRegistration = initPatientRegistration;
window.openNewPatientRegistration = openNewPatientRegistration;
window.loadDailyDoctorSpecialties = loadDailyDoctorSpecialties;
window.importDailyChargesToInvoice = importDailyChargesToInvoice;
window.syncDailyChargeRowsFromTotals = syncDailyChargeRowsFromTotals;
window.reloadDailyCatalogSectionsFromSettings = reloadDailyCatalogSectionsFromSettings;
