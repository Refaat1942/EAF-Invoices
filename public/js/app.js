const API = '/api/invoices';
const SETTINGS_API = '/api/settings';
const PRICING_API = '/api/pricing';
const AUTH_API = '/api/auth';
const USERS_API = '/api/users';
const PATIENTS_API = '/api/patients';
let currentInvoiceId = null;
let currentUser = null;
let currentInvoiceStatus = null;
let invoiceFollowUpMode = false;
let currentInvoiceReturns = [];
let invoiceReturnModal = null;
let rowCount = 12;
let invoiceTypeLabels = {};
let paymentMethodsCache = [];
let contractedEntitiesCache = [];
let stayTypesCache = [];
let lastCalculationTotals = null;
let patientAccountBalance = null;
let permissionCatalog = [];
let roleDefaults = {};
let currentReportType = 'summary';
let selectedPatientFileNumber = '';
let catalogServicesCache = [];
let catalogListMeta = null;
let pricingCategoriesCache = [];
let pricingServicesCache = [];
let pricingListsCache = [];
let currentPricingListId = null;
let serviceEditModal = null;

const STATUS_BADGES = {
  draft: { text: 'مسودة', class: 'bg-secondary' },
  pending_review: { text: 'قيد المراجعة', class: 'bg-warning text-dark' },
  approved: { text: 'معتمدة', class: 'bg-success' },
};

function formatPlainNumber(n, maxDecimals = 2) {
  const num = Number(n) || 0;
  if (maxDecimals === 0) {
    return num.toLocaleString('ar-EG', { maximumFractionDigits: 0 });
  }
  return num.toLocaleString('ar-EG', { minimumFractionDigits: 2, maximumFractionDigits: maxDecimals });
}

function normalizeDigitsForParse(text) {
  return String(text || '')
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
    .replace(/[٬,]/g, '')
    .replace(/[٫]/g, '.');
}

function parseDisplayAmount(text) {
  return parseFloat(normalizeDigitsForParse(text).replace(/[^\d.-]/g, '')) || 0;
}

const fmt = (n) => formatPlainNumber(n, 2);
const fmtInt = (n) => formatPlainNumber(n, 0);

function formatAmountInput(n, decimals = 2) {
  if (n === '' || n === null || n === undefined) return '';
  const num = Number(n);
  if (Number.isNaN(num)) return '';
  return formatPlainNumber(num, decimals);
}

function setCommaAmountValue(input, value, decimals = 2) {
  if (!input) return;
  if (value === '' || value === null || value === undefined) {
    input.value = '';
    return;
  }
  input.value = formatAmountInput(value, decimals);
}

function bindCommaAmountInputs(root = document) {
  const scope = root === document ? document : root;
  scope.querySelectorAll('input.comma-amount, input[data-comma-amount="1"]').forEach((input) => {
    const decimals = input.dataset.decimals === '0' ? 0 : 2;
    if (input.type === 'number') input.type = 'text';
    if (input.value) {
      const existing = parseDisplayAmount(input.value);
      if (existing || existing === 0) input.value = formatAmountInput(existing, decimals);
    }
    if (input.dataset.commaBound === '1') return;
    input.dataset.commaBound = '1';
    input.setAttribute('inputmode', 'decimal');
    input.autocomplete = 'off';
    input.addEventListener('blur', () => {
      const raw = parseDisplayAmount(input.value);
      const next = raw || raw === 0 ? formatAmountInput(raw, decimals) : '';
      if (input.value !== next) input.value = next;
    });
    input.addEventListener('focus', () => {
      const raw = parseDisplayAmount(input.value);
      if (input.value && !Number.isNaN(raw)) input.value = String(raw);
    });
  });
}

function fmtDual(raw, rounded) {
  const r = Number(raw) || 0;
  const rd = Number(rounded) || 0;
  if (Math.round(r * 100) === Math.round(rd * 100)) return fmt(rd);
  return `<span class="dual-value"><span class="raw-part">${fmt(r)}</span> <span class="rounded-part">← ${fmt(rd)}</span></span>`;
}

function can(permission) {
  if (!currentUser) return false;
  const perms = currentUser.permissions || [];
  if (perms.includes('*')) return true;
  if (perms.includes(permission)) return true;
  const [group] = permission.split('.');
  return perms.includes(`${group}.*`);
}

async function apiFetch(url, opts = {}) {
  return window.ApiClient.apiFetch(url, opts);
}

async function parseApiResponse(res) {
  return window.ApiClient.parseApiResponse(res);
}

async function apiJson(url, opts = {}) {
  return window.ApiClient.apiJson(url, opts);
}

function sanitizeApiErrorMessage(message) {
  return window.ApiClient.sanitizeUserMessage(message);
}

function escapeAttr(text) {
  return String(text || '').replace(/"/g, '&quot;');
}

function escapeHtml(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('login-form').addEventListener('submit', handleLogin);
  document.getElementById('logout-btn').addEventListener('click', handleLogout);
  document.getElementById('add-user-btn').addEventListener('click', addUser);
  loadAppBranding();
  checkAuth();
});

async function loadAppBranding() {
  try {
    const res = await fetch('/api/public/branding');
    if (!res.ok) return;
    const data = await res.json();
    if (data.logo_url) {
      document.getElementById('login-logo').src = data.logo_url;
      const navbarLogo = document.getElementById('navbar-logo');
      if (navbarLogo) navbarLogo.src = data.logo_url;
    }
    if (data.app_name) {
      document.title = `${data.app_name} - مركز الطب الطبيعي والتأهيل`;
    }
  } catch {
    /* keep defaults */
  }
}

async function checkAuth() {
  try {
    const res = await apiFetch(`${AUTH_API}/me`);
    if (!res.ok) throw new Error('not auth');
    currentUser = await res.json();
    showApp();
  } catch {
    showLogin();
  }
}

function showLogin() {
  document.getElementById('login-screen').style.display = 'flex';
  document.getElementById('app-container').style.display = 'none';
}

function showApp() {
  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('app-container').style.display = 'block';
  document.getElementById('nav-user').textContent = `${currentUser.full_name || currentUser.username} (${currentUser.role_label})`;
  applyPermissions();
  bindEvents();
  loadInvoiceTypes();
  loadFinancialTreatments();
  loadStayTypes();
  loadPaymentMethodsForm();
  loadContractedEntities();
  loadPermissionCatalog();
  ensureDefaultPriceListId();
  loadCatalogCache();
  switchView('daily');
}

function isDailySourcedInvoice(inv) {
  if (!inv) return false;
  const hasDailyLines = (inv.items || []).some((item) => item.daily_entry_line_id);
  const hasStayFile = Boolean(String(inv.file_number || '').trim());
  return hasDailyLines || (hasStayFile && inv.status !== 'approved');
}

function applyInvoiceFollowUpMode(enabled) {
  invoiceFollowUpMode = enabled;
  const card = document.querySelector('.invoice-card');
  const banner = document.getElementById('invoice-followup-banner');
  if (card) card.classList.toggle('invoice-followup-mode', enabled);
  if (banner) banner.style.display = enabled ? '' : 'none';

  const metaIds = [
    'file_number',
    'patient_name',
    'admission_date',
    'discharge_date',
    'stay_days',
  ];
  metaIds.forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    if (enabled) {
      el.setAttribute('readonly', 'readonly');
      el.classList.add('bg-light');
    } else if (!(currentInvoiceStatus === 'approved')) {
      el.removeAttribute('readonly');
      el.classList.remove('bg-light');
    }
  });

  const manualEntryIds = ['add-row-btn', 'remove-row-btn', 'add-stay-entry-btn', 'import-daily-charges-btn'];
  manualEntryIds.forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.style.display = enabled ? 'none' : '';
  });

  const stayWrap = document.querySelector('.stay-entries-wrap');
  if (stayWrap) stayWrap.style.display = enabled ? 'none' : '';

  if (enabled) lockDailyInvoiceRows();
}

function lockDailyInvoiceRows() {
  document.querySelectorAll('#items-tbody tr').forEach((row) => {
    const isDaily = Boolean(row.dataset.dailyLineId);
    const desc = row.querySelector('[data-field="description"]')?.value?.trim();
    const amt = parseDisplayAmount(row.querySelector('[data-field="amount"]')?.value);
    const hasContent = Boolean(desc || amt || isDaily);

    if (invoiceFollowUpMode) {
      row.style.display = hasContent ? '' : 'none';
    } else {
      row.style.display = '';
    }

    row.classList.toggle('daily-invoice-row', isDaily);
    row.querySelectorAll('[data-field="description"], [data-field="quantity"], [data-field="amount"]').forEach((el) => {
      if (invoiceFollowUpMode && (isDaily || hasContent)) {
        el.setAttribute('readonly', 'readonly');
        el.classList.add('bg-light');
      } else if (currentInvoiceStatus !== 'approved') {
        el.removeAttribute('readonly');
        el.classList.remove('bg-light');
      }
    });
  });
}

async function openInvoiceFollowUpView() {
  const fileNumber = sessionStorage.getItem('dailyStayFileNumber');
  if (!fileNumber) {
    showToast('ابدأ من إقامة المريض — سجّل المريض والحركة اليومية أولًا', 'info');
    switchView('daily');
    return;
  }
  try {
    const res = await apiFetch(`/api/daily-charges/open-stay?file_number=${encodeURIComponent(fileNumber)}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'فشل تحميل الإقامة');
    if (data.invoice?.id) {
      await loadInvoiceForEdit(data.invoice.id, { followUp: true });
      return;
    }
    showToast('لا توجد فاتورة مفتوحة — سجّل المريض من إقامة المريض أولًا', 'warning');
    switchView('daily');
  } catch (err) {
    showToast(err.message, 'danger');
    switchView('daily');
  }
}

function applyPermissions() {
  const isAdmin = can('settings.*');
  document.getElementById('nav-settings').style.display = isAdmin ? '' : 'none';
  const dailyNav = document.getElementById('nav-daily');
  if (dailyNav) dailyNav.style.display = can('daily_charges.view') ? '' : 'none';
  document.getElementById('import-daily-charges-btn').style.display =
    can('invoices.create') || can('invoices.edit') ? '' : 'none';
  document.getElementById('users-settings-card').style.display = can('users.*') ? '' : 'none';
  document.getElementById('pricing-settings-card').style.display = isAdmin ? '' : 'none';
  document.getElementById('item-catalog-settings-card').style.display = isAdmin ? '' : 'none';
  document.getElementById('backup-settings-card').style.display = isAdmin ? '' : 'none';
  document.getElementById('doctors-settings-card').style.display = isAdmin ? '' : 'none';

  const createBtn = document.querySelector('[data-view="create"]');
  if (createBtn) createBtn.style.display = can('invoices.create') || can('invoices.edit') ? '' : 'none';

  const canEdit = can('invoices.create') || can('invoices.edit');
  document.getElementById('save-draft-btn').style.display = canEdit ? '' : 'none';
  document.getElementById('submit-review-btn').style.display = can('invoices.submit') ? '' : 'none';
  document.getElementById('approve-invoice-btn').style.display = can('invoices.approve') ? '' : 'none';
  document.getElementById('report-export-btn').style.display = can('reports.export') ? '' : 'none';

  ['reset-form-btn', 'add-row-btn', 'remove-row-btn', 'add-stay-entry-btn', 'pay-full-cash-btn', 'pay-full-bank-btn', 'pay-full-check-btn', 'clear-payments-btn'].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.style.display = canEdit ? '' : 'none';
  });
  setFormReadonly(!canEdit);
  updateInvoiceActionButtons();
}

function setFormReadonly(readonly) {
  document.querySelectorAll('#invoice-form input, #invoice-form select, #invoice-form textarea').forEach((el) => {
    if (el.type === 'hidden') return;
    if (readonly) {
      el.setAttribute('readonly', 'readonly');
      if (el.tagName === 'SELECT') el.disabled = true;
      if (el.type === 'checkbox') el.disabled = true;
    } else {
      el.removeAttribute('readonly');
      if (el.tagName === 'SELECT') el.disabled = false;
      if (el.type === 'checkbox') el.disabled = false;
    }
  });
}

async function handleLogin(e) {
  e.preventDefault();
  const username = document.getElementById('login-username').value;
  const password = document.getElementById('login-password').value;
  try {
    const res = await apiFetch(`${AUTH_API}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'فشل الدخول');
    currentUser = data.user;
    showApp();
    showToast(`مرحباً ${currentUser.full_name || currentUser.username}`, 'success');
  } catch (err) {
    showToast(err.message, 'danger');
  }
}

async function handleLogout() {
  await apiFetch(`${AUTH_API}/logout`, { method: 'POST' });
  currentUser = null;
  showLogin();
}

function initRows(count = rowCount) {
  const tbody = document.getElementById('items-tbody');
  tbody.innerHTML = '';
  for (let i = 0; i < count; i++) {
    tbody.appendChild(createRow(i));
  }
  rowCount = count;
}

function createRow(index) {
  const tr = document.createElement('tr');
  tr.dataset.index = index;
  tr.innerHTML = `
    <td><input type="text" class="row-total" data-field="total" readonly tabindex="-1"></td>
    <td><input type="text" inputmode="decimal" class="calc-trigger comma-amount" data-field="amount" value=""></td>
    <td><input type="text" inputmode="decimal" class="calc-trigger comma-amount" data-field="quantity" value=""><small class="invoice-return-hint text-danger d-none d-block"></small></td>
    <td><input type="text" class="discount-pct-display" data-field="discount_percent" readonly tabindex="-1" value="0%"></td>
    <td class="service-cell">
      <input type="hidden" data-field="invoice_item_id" value="">
      <input type="hidden" data-field="service_id" value="">
      <input type="text" class="desc-input calc-trigger service-search" data-field="description" autocomplete="off" placeholder="ابحث عن خدمة من اللائحة...">
      <div class="service-suggest d-none"></div>
    </td>
    <td><input type="text" inputmode="decimal" class="calc-trigger comma-amount patient-credit-input" data-field="patient_credit_applied" value="" placeholder="0" title="خصم من رصيد المريض"></td>
    <td><input type="text" inputmode="decimal" class="pay-amt calc-trigger comma-amount" data-field="pay_amount" value=""></td>
    <td><input type="text" class="pay-num calc-trigger" data-field="receipt_number"></td>
    <td><input type="date" class="pay-date calc-trigger" data-field="receipt_date"></td>
  `;
  return tr;
}

function bindEvents() {
  document.querySelectorAll('.nav-btn').forEach((btn) => {
    btn.addEventListener('click', () => switchView(btn.dataset.view));
  });

  document.getElementById('invoice-form').addEventListener('submit', (e) => {
    e.preventDefault();
    saveInvoiceWithMode('draft');
  });
  document.getElementById('save-draft-btn').addEventListener('click', () => saveInvoiceWithMode('draft'));
  document.getElementById('submit-review-btn').addEventListener('click', () => saveInvoiceWithMode('submit'));
  document.getElementById('approve-invoice-btn').addEventListener('click', approveCurrentInvoice);
  document.getElementById('reset-form-btn').addEventListener('click', () => switchView('daily'));
  document.getElementById('goto-daily-from-invoice-btn')?.addEventListener('click', () => switchView('daily'));
  document.getElementById('add-row-btn').addEventListener('click', () => {
    document.getElementById('items-tbody').appendChild(createRow(rowCount++));
    bindCalcTriggers();
  });
  document.getElementById('remove-row-btn').addEventListener('click', () => {
    const tbody = document.getElementById('items-tbody');
    if (tbody.children.length > 1) {
      tbody.removeChild(tbody.lastElementChild);
      rowCount--;
      recalculate();
    }
  });

  document.getElementById('add-stay-entry-btn').addEventListener('click', () => {
    addStayEntryRow();
    bindStayEntryTriggers();
  });

  document.getElementById('admission_date').addEventListener('change', () => {
    autoStayDays();
    prefillStayEntryDatesFromAdmission();
  });
  document.getElementById('discharge_date').addEventListener('change', () => {
    autoStayDays();
    prefillStayEntryDatesFromAdmission();
  });

  document.getElementById('download-pdf-btn').addEventListener('click', () => downloadFile('pdf'));
  document.getElementById('download-docx-btn').addEventListener('click', () => downloadFile('docx'));
  document.getElementById('preview-btn').addEventListener('click', () => {
    if (currentInvoiceId) window.open(`${API}/${currentInvoiceId}/preview`, '_blank');
  });

  const returnModalEl = document.getElementById('invoice-return-modal');
  if (returnModalEl) invoiceReturnModal = new bootstrap.Modal(returnModalEl);
  document.getElementById('record-return-btn')?.addEventListener('click', openInvoiceReturnModal);
  document.getElementById('invoice-return-submit-btn')?.addEventListener('click', submitInvoiceReturns);

  document.getElementById('list-refresh').addEventListener('click', loadInvoicesList);
  document.getElementById('list-search').addEventListener('input', debounce(loadInvoicesList, 300));
  document.getElementById('list-type-filter').addEventListener('change', loadInvoicesList);
  document.getElementById('list-status-filter').addEventListener('change', loadInvoicesList);
  document.getElementById('list-from').addEventListener('change', loadInvoicesList);
  document.getElementById('list-to').addEventListener('change', loadInvoicesList);

  document.getElementById('report-refresh-btn').addEventListener('click', loadReports);
  document.getElementById('report-export-btn').addEventListener('click', exportCurrentReport);
  document.querySelectorAll('.report-tab').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.report-tab').forEach((b) => {
        b.classList.toggle('active', b === btn);
        b.classList.toggle('btn-primary', b === btn);
        b.classList.toggle('btn-outline-primary', b !== btn);
      });
      currentReportType = btn.dataset.report;
      selectedPatientFileNumber = '';
      updateReportFiltersUI();
      loadReports();
    });
  });

  document.getElementById('report-patient-search')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      selectedPatientFileNumber = '';
      loadReports();
    }
  });

  document.getElementById('file_number').addEventListener('blur', loadPatientBalance);
  document.getElementById('edit-patient-balance-btn').addEventListener('click', editPatientBalance);
  document.getElementById('new-user-role').addEventListener('change', () => {
    renderPermissionCheckboxes('new-user-permissions', getDefaultPermissionsForRole(document.getElementById('new-user-role').value));
  });

  document.getElementById('upload-logo-btn').addEventListener('click', uploadLogo);
  document.getElementById('backup-run-btn')?.addEventListener('click', runManualBackup);
  document.getElementById('add-stay-type-btn').addEventListener('click', addStayType);
  document.getElementById('add-financial-treatment-btn')?.addEventListener('click', addFinancialTreatment);
  document.getElementById('add-invoice-type-btn').addEventListener('click', addInvoiceType);
  document.getElementById('add-payment-method-btn').addEventListener('click', addPaymentMethod);
  document.getElementById('new-stay-type').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); addStayType(); }
  });
  document.getElementById('new-invoice-type-name').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); addInvoiceType(); }
  });
  document.getElementById('new-payment-method-name').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); addPaymentMethod(); }
  });
  document.getElementById('add-entity-btn').addEventListener('click', addContractedEntity);
  document.getElementById('add-exclusion-btn').addEventListener('click', addDiscountExclusion);

  document.getElementById('pricing-refresh-btn')?.addEventListener('click', loadPricingSection);
  document.getElementById('pricing-search')?.addEventListener('input', debounce(loadPricingServices, 300));
  document.getElementById('pricing-category-filter')?.addEventListener('change', loadPricingServices);
  document.getElementById('pricing-list-select')?.addEventListener('change', onPricingListChange);
  document.getElementById('pricing-export-btn')?.addEventListener('click', exportPricingExcel);
  document.getElementById('pricing-export-csv-btn')?.addEventListener('click', exportPricingCsv);
  document.getElementById('pricing-import-file')?.addEventListener('change', importPricingFile);
  document.getElementById('pricing-clone-btn')?.addEventListener('click', cloneCurrentPriceList);
  document.getElementById('pricing-add-service-btn')?.addEventListener('click', () => openServiceEditor());
  document.getElementById('pricing-save-settings-btn')?.addEventListener('click', savePricingSettings);
  document.getElementById('service-edit-save-btn')?.addEventListener('click', saveServiceEditor);
  document.getElementById('service-edit-price-type')?.addEventListener('change', toggleServiceComponentsEditor);

  document.getElementById('pay-full-cash-btn').addEventListener('click', () => fillFullPayment('cash'));
  document.getElementById('pay-full-bank-btn').addEventListener('click', () => fillFullPayment('bank_transfer'));
  document.getElementById('pay-full-check-btn').addEventListener('click', () => fillFullPayment('check'));
  document.getElementById('clear-payments-btn').addEventListener('click', clearAllPayments);
  document.getElementById('invoice_type').addEventListener('change', toggleContractedFields);
  document.getElementById('contracted_entity_id').addEventListener('change', onContractedEntityChange);

  bindCalcTriggers();
}

function bindCalcTriggers() {
  document.querySelectorAll('.calc-trigger').forEach((el) => {
    el.removeEventListener('input', recalculate);
    el.addEventListener('input', recalculate);
  });
  bindNumberInputWheelBlock();
  bindCommaAmountInputs();
  bindServiceSearch();
  bindPaymentMethodHelpers();
}

function bindNumberInputWheelBlock() {
  document.querySelectorAll('input[type="number"]').forEach((input) => {
    if (input.dataset.wheelBlocked === '1') return;
    input.dataset.wheelBlocked = '1';
    input.addEventListener(
      'wheel',
      (e) => {
        if (document.activeElement === input) e.preventDefault();
      },
      { passive: false }
    );
  });
}

function bindPaymentMethodHelpers() {
  document.querySelectorAll('.pay-remaining-btn').forEach((btn) => {
    if (btn.dataset.bound === '1') return;
    btn.dataset.bound = '1';
    btn.addEventListener('click', () => fillRemainingPayment(btn.dataset.methodCode));
  });

  document.querySelectorAll('.payment-method-input').forEach((input) => {
    if (input.dataset.helperBound === '1') return;
    input.dataset.helperBound = '1';
    input.addEventListener('focus', updatePaymentRowHints);
    input.addEventListener('input', () => {
      updatePaymentRowHints();
      if (input.dataset.methodCode !== 'patient_credit') {
        recalculate({ skipAutoCredit: true, skipAutoPayments: true });
      }
    });
  });
}

function getPaymentRemainingExcluding(excludeInput = null) {
  const finalTotal = getInvoiceFinalTotalForPayment();
  let paid = 0;
  document.querySelectorAll('.payment-method-input').forEach((input) => {
    if (input !== excludeInput) paid += parseDisplayAmount(input.value);
  });
  return Math.max(0, Math.round((finalTotal - paid) * 100) / 100);
}

function updatePaymentRowHints() {
  const finalTotal = getInvoiceFinalTotalForPayment();
  let paid = 0;
  document.querySelectorAll('.payment-method-input').forEach((input) => {
    paid += parseDisplayAmount(input.value);
  });
  const remaining = Math.max(0, Math.round((finalTotal - paid) * 100) / 100);

  document.querySelectorAll('.payment-method-row').forEach((row) => {
    const hintRow = row.nextElementSibling?.classList?.contains('payment-row-remaining')
      ? row.nextElementSibling
      : null;
    const input = row.querySelector('.payment-method-input');
    const btn = row.querySelector('.pay-remaining-btn');
    if (!input || !btn) return;

    const rowRemaining = getPaymentRemainingExcluding(input);
    btn.disabled = rowRemaining <= 0 || finalTotal <= 0;
    btn.title = rowRemaining > 0 ? `إضافة المتبقي ${fmt(rowRemaining)}` : 'لا يوجد متبقي';

    if (hintRow) {
      if (rowRemaining > 0 && finalTotal > 0) {
        hintRow.style.display = '';
        hintRow.querySelector('.remaining-hint-text').textContent =
          `المتبقي بعد هذه الطريقة: ${fmt(rowRemaining)}`;
      } else {
        hintRow.style.display = 'none';
      }
    }
  });

  updatePaymentSplitSummary(
    finalTotal,
    paid,
    remaining,
    Number(lastCalculationTotals?.refundable_amount) || 0
  );
}

function updatePaymentSplitSummary(finalTotal, paid, remaining, refundable = 0) {
  const finalEl = document.getElementById('split-final-total');
  const paidEl = document.getElementById('split-paid-total');
  const remainingEl = document.getElementById('split-remaining-total');
  const remainingWrap = document.querySelector('.payment-split-summary .split-remaining');
  const refundableWrap = document.getElementById('split-refundable-wrap');
  const refundableEl = document.getElementById('split-refundable-total');
  if (!finalEl || !paidEl || !remainingEl) return;

  finalEl.textContent = fmt(finalTotal);
  paidEl.textContent = fmt(paid);
  remainingEl.textContent = fmt(remaining);
  if (remainingWrap) {
    remainingWrap.classList.toggle('is-zero', remaining <= 0.009 && finalTotal > 0);
    remainingWrap.classList.toggle('has-remaining', remaining > 0.009);
  }
  if (refundableWrap && refundableEl) {
    const show = refundable > 0.009;
    refundableWrap.style.display = show ? '' : 'none';
    if (show) refundableEl.textContent = fmt(refundable);
  }
}

function fillRemainingPayment(code) {
  const inputs = getPaymentInputsByCode(code);
  if (!inputs.length) return;
  const input = inputs[0];
  const remaining = getPaymentRemainingExcluding(input);
  if (remaining <= 0) {
    showToast('لا يوجد متبقي — تم تغطية إجمالي الفاتورة', 'info');
    return;
  }
  const current = parseDisplayAmount(input.value);
  input.value = formatAmountInput(Math.round((current + remaining) * 100) / 100);
  recalculate();
}

function bindServiceSearch() {
  document.querySelectorAll('.service-search').forEach((input) => {
    if (input.dataset.bound === '1') return;
    input.dataset.bound = '1';
    const cell = input.closest('.service-cell');
    const suggest = cell?.querySelector('.service-suggest');
    if (!suggest) return;

    input.addEventListener('input', debounce(async () => {
      const q = input.value.trim();
      const row = input.closest('tr');
      if (row?.querySelector('[data-field="service_id"]') && !row.dataset.staySync) {
        row.querySelector('[data-field="service_id"]').value = '';
      }
      try {
        const services = await searchCatalogServices(q);
        renderServiceSuggestions(suggest, services, input, q);
      } catch {
        suggest.classList.add('d-none');
      }
    }, 200));

    input.addEventListener('focus', async () => {
      const q = input.value.trim();
      try {
        const services = await searchCatalogServices(q);
        renderServiceSuggestions(suggest, services, input, q);
      } catch {
        /* ignore */
      }
    });

    input.addEventListener('keydown', (e) => {
      const items = suggest.querySelectorAll('.service-suggest-item');
      if (!items.length || suggest.classList.contains('d-none')) return;
      let active = suggest.querySelector('.service-suggest-item.active');
      let index = active ? [...items].indexOf(active) : -1;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        index = Math.min(index + 1, items.length - 1);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        index = Math.max(index - 1, 0);
      } else if (e.key === 'Enter' && active) {
        e.preventDefault();
        active.click();
        return;
      } else if (e.key === 'Escape') {
        suggest.classList.add('d-none');
        return;
      } else {
        return;
      }
      items.forEach((el) => el.classList.remove('active'));
      if (items[index]) items[index].classList.add('active');
    });

    input.addEventListener('blur', () => {
      setTimeout(() => {
        suggest.classList.add('d-none');
        const row = input.closest('tr');
        if (!row || row.dataset.staySync) return;
        const serviceIdEl = row.querySelector('[data-field="service_id"]');
        if (input.value.trim() && !serviceIdEl?.value) {
          const match = findCatalogServiceByName(input.value.trim());
          if (match) applyServiceToRow(row, match);
        }
      }, 200);
    });
  });
}

async function searchCatalogServices(q) {
  const norm = String(q || '').trim().toLowerCase();
  if (catalogServicesCache.length) {
    if (!norm) return catalogServicesCache.filter((s) => s.is_active !== false).slice(0, 12);
    return catalogServicesCache
      .filter(
        (s) =>
          s.is_active !== false &&
          (String(s.name || '').toLowerCase().includes(norm) ||
            String(s.code || '').toLowerCase().includes(norm) ||
            String(s.category_name || '').toLowerCase().includes(norm))
      )
      .slice(0, 15);
  }
  const params = new URLSearchParams({ limit: '15' });
  if (norm) params.set('search', norm);
  if (currentPricingListId) params.set('price_list_id', currentPricingListId);
  const res = await apiFetch(`${PRICING_API}/services?${params}`);
  if (!res.ok) throw new Error('search failed');
  return res.json();
}

function findCatalogServiceByName(name) {
  const norm = String(name || '').trim().toLowerCase();
  if (!norm || !catalogServicesCache.length) return null;
  const exact = catalogServicesCache.find((s) => String(s.name || '').trim().toLowerCase() === norm);
  if (exact) return exact;
  const includes = catalogServicesCache.find((s) => {
    const svcName = String(s.name || '').trim().toLowerCase();
    return svcName.includes(norm) || norm.includes(svcName);
  });
  return includes || null;
}

function renderServiceSuggestions(container, services, input, query = '') {
  if (!services.length) {
    container.innerHTML = query
      ? '<div class="service-suggest-empty p-2 small text-muted">لا توجد خدمات مطابقة — تأكد من رفع ملف اللائحة من الإعدادات</div>'
      : '<div class="service-suggest-empty p-2 small text-muted">اللائحة فارغة — ارفع ملف DOCX من الإعدادات → إدارة الأسعار</div>';
    container.classList.remove('d-none');
    return;
  }
  container.innerHTML = services
    .map(
      (svc) =>
        `<button type="button" class="service-suggest-item w-100 text-start border-0 bg-transparent" data-id="${svc.id}" data-price="${svc.price}" data-unit="${escapeAttr(svc.unit || '')}" data-discountable="${svc.discountable ? '1' : '0'}">
          <strong>${escapeHtml(svc.name)}</strong>
          <span class="text-muted"> — ${fmt(Number(svc.price) || 0)} / ${escapeHtml(svc.unit || 'مرة')}</span>
        </button>`
    )
    .join('');
  container.classList.remove('d-none');
  container.querySelectorAll('.service-suggest-item').forEach((btn) => {
    btn.addEventListener('mousedown', (e) => {
      e.preventDefault();
      applyServiceToRow(input.closest('tr'), {
        id: Number(btn.dataset.id),
        name: btn.querySelector('strong')?.textContent || '',
        price: Number(btn.dataset.price) || 0,
        unit: btn.dataset.unit || '',
        discountable: btn.dataset.discountable === '1',
      });
      container.classList.add('d-none');
    });
  });
}

function applyServiceToRow(row, service) {
  if (!row || !service) return;
  const descInput = row.querySelector('[data-field="description"]');
  const amountInput = row.querySelector('[data-field="amount"]');
  const qtyInput = row.querySelector('[data-field="quantity"]');
  const serviceIdInput = row.querySelector('[data-field="service_id"]');
  if (descInput) descInput.value = service.name;
  if (amountInput) amountInput.value = service.price != null && service.price !== '' ? formatAmountInput(service.price) : '';
  if (serviceIdInput) serviceIdInput.value = service.id || '';
  if (qtyInput && !parseDisplayAmount(qtyInput.value)) qtyInput.value = formatAmountInput(1, 0);
  row.dataset.discountOverride = service.discountable ? 'true' : 'false';
  row.classList.remove('stay-sync-row');
  delete row.dataset.staySync;
  recalculate();
  qtyInput?.focus();
}

async function loadCatalogCache() {
  try {
    await ensureDefaultPriceListId();
    const [listRes, svcRes] = await Promise.all([
      apiFetch(`${PRICING_API}/lists/default`),
      apiFetch(`${PRICING_API}/services?limit=2000`),
    ]);
    if (listRes.ok) catalogListMeta = await listRes.json();
    if (svcRes.ok) catalogServicesCache = await svcRes.json();
    updateCatalogStatusBadge();
  } catch {
    updateCatalogStatusBadge(true);
  }
}

function updateCatalogStatusBadge(errored = false) {
  const badge = document.getElementById('catalog-status-badge');
  if (!badge) return;
  if (errored || !catalogListMeta) {
    badge.className = 'badge bg-danger';
    badge.textContent = 'اللائحة غير متاحة';
    return;
  }
  const count = catalogListMeta.services_count ?? catalogServicesCache.length ?? 0;
  if (count <= 0) {
    badge.className = 'badge bg-warning text-dark';
    badge.textContent = 'اللائحة فارغة — ارفع ملف DOCX من الإعدادات';
    return;
  }
  badge.className = 'badge bg-success';
  badge.textContent = `اللائحة: ${catalogListMeta.name || 'افتراضية'} — ${count} خدمة`;
}

function getStayRowKey(row) {
  if (!row.dataset.stayKey) row.dataset.stayKey = `stay-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  return row.dataset.stayKey;
}

function findItemRowByStayKey(key) {
  return document.querySelector(`#items-tbody tr[data-stay-sync="${key}"]`);
}

function findFirstEmptyItemRow() {
  for (const row of document.querySelectorAll('#items-tbody tr')) {
    if (row.dataset.staySync) continue;
    const desc = row.querySelector('[data-field="description"]')?.value?.trim();
    const qty = parseDisplayAmount(row.querySelector('[data-field="quantity"]')?.value);
    const amt = parseDisplayAmount(row.querySelector('[data-field="amount"]')?.value);
    if (!desc && !qty && !amt) return row;
  }
  return null;
}

function appendNewItemRow() {
  const tbody = document.getElementById('items-tbody');
  const row = createRow(rowCount++);
  tbody.appendChild(row);
  bindCalcTriggers();
  return row;
}

function syncStayEntriesToItemRows() {
  const activeStayKeys = new Set();
  document.querySelectorAll('#stay-entries-tbody tr.stay-entry-row').forEach((stayRow) => {
    const stayKey = getStayRowKey(stayRow);
    const stayTypeSelect = stayRow.querySelector('[data-field="stay_type_id"]');
    const stayTypeId = stayTypeSelect?.value;
    const stayName =
      stayTypeSelect?.selectedOptions?.[0]?.textContent?.replace(/\s*\([\d,.]+\/يوم\)\s*$/, '')?.trim() || '';
    const days = parseDisplayAmount(stayRow.querySelector('[data-field="days"]')?.value);
    const rate = parseDisplayAmount(stayRow.querySelector('[data-field="daily_rate"]')?.value);

    if (!stayTypeId || (!days && !rate)) {
      const existing = findItemRowByStayKey(stayKey);
      if (existing) existing.remove();
      return;
    }

    activeStayKeys.add(stayKey);
    let itemRow = findItemRowByStayKey(stayKey);
    if (!itemRow) {
      itemRow = findFirstEmptyItemRow() || appendNewItemRow();
      itemRow.dataset.staySync = stayKey;
    }
    itemRow.classList.add('stay-sync-row');

    const desc = stayName ? `إقامة - ${stayName}` : 'إقامة';
    itemRow.querySelector('[data-field="description"]').value = desc;
    itemRow.querySelector('[data-field="quantity"]').value = days ? formatAmountInput(days, 0) : '';
    itemRow.querySelector('[data-field="amount"]').value = rate ? formatAmountInput(rate) : '';

    const matched = findCatalogServiceByName(stayName);
    const serviceIdEl = itemRow.querySelector('[data-field="service_id"]');
    if (matched && serviceIdEl) {
      serviceIdEl.value = matched.id;
      itemRow.dataset.discountOverride = matched.discountable ? 'true' : 'false';
    } else if (serviceIdEl) {
      serviceIdEl.value = '';
    }
  });

  document.querySelectorAll('#items-tbody tr[data-stay-sync]').forEach((row) => {
    if (!activeStayKeys.has(row.dataset.staySync)) row.remove();
  });
}

function calcDaysBetween(fromDate, toDate) {
  if (!fromDate || !toDate) return 0;
  const start = new Date(fromDate);
  const end = new Date(toDate);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return 0;
  return Math.max(Math.ceil((end - start) / 86400000), 0);
}

function buildStayTypeOptions(selectedId = '') {
  if (!stayTypesCache.length) {
    return '<option value="">-- اختر نوع الإقامة --</option>';
  }
  return (
    '<option value="">-- اختر نوع الإقامة --</option>' +
    stayTypesCache
      .map((t) => {
        const rate = Number(t.daily_rate) || 0;
        const rateLabel = rate ? ` (${fmt(rate)}/يوم)` : '';
        return `<option value="${t.id}" data-rate="${rate}" ${String(selectedId) === String(t.id) ? 'selected' : ''}>${t.name}${rateLabel}</option>`;
      })
      .join('')
  );
}

function createStayEntryRow(entry = {}) {
  const tr = document.createElement('tr');
  tr.className = 'stay-entry-row';
  tr.innerHTML = `
    <td><select class="form-select form-select-sm stay-type-select" data-field="stay_type_id">${buildStayTypeOptions(entry.stay_type_id)}</select></td>
    <td><input type="date" class="form-control form-control-sm stay-entry-trigger" data-field="from_date" value="${fmtDate(entry.from_date)}"></td>
    <td><input type="date" class="form-control form-control-sm stay-entry-trigger" data-field="to_date" value="${fmtDate(entry.to_date)}"></td>
    <td><input type="text" inputmode="decimal" class="form-control form-control-sm stay-entry-trigger comma-amount" data-decimals="0" data-field="days" value="${entry.days != null && entry.days !== '' ? formatAmountInput(entry.days, 0) : ''}"></td>
    <td><input type="text" inputmode="decimal" class="form-control form-control-sm stay-entry-trigger comma-amount" data-field="daily_rate" value="${entry.daily_rate != null && entry.daily_rate !== '' ? formatAmountInput(entry.daily_rate) : ''}"></td>
    <td><input type="text" class="form-control form-control-sm row-total" data-field="total" readonly tabindex="-1" value="${entry.total ? fmt(entry.total) : ''}"></td>
    <td class="text-center"><button type="button" class="btn btn-sm btn-outline-danger remove-stay-entry-btn" title="حذف">×</button></td>
  `;
  return tr;
}

function initStayEntries(entries = []) {
  const tbody = document.getElementById('stay-entries-tbody');
  tbody.innerHTML = '';
  const list = entries.length ? entries : [{}];
  list.forEach((entry) => tbody.appendChild(createStayEntryRow(entry)));
  bindStayEntryTriggers();
  updateStayEntryTotalsLocal();
  syncStayEntriesToItemRows();
}

function addStayEntryRow(entry = {}) {
  const tbody = document.getElementById('stay-entries-tbody');
  const rowEntry = { ...entry };
  if (!rowEntry.from_date) rowEntry.from_date = document.getElementById('admission_date').value;
  if (!rowEntry.to_date) rowEntry.to_date = document.getElementById('discharge_date').value;
  tbody.appendChild(createStayEntryRow(rowEntry));
  bindStayEntryTriggers();
  onStayEntryRowChange(tbody.lastElementChild);
}

function bindStayEntryTriggers() {
  document.querySelectorAll('.stay-entry-trigger').forEach((el) => {
    el.removeEventListener('input', onStayEntryInput);
    el.removeEventListener('change', onStayEntryInput);
    el.addEventListener('input', onStayEntryInput);
    el.addEventListener('change', onStayEntryInput);
  });
  bindCommaAmountInputs(document.getElementById('stay-entries-tbody'));
  document.querySelectorAll('.stay-type-select').forEach((el) => {
    el.removeEventListener('change', onStayTypeSelect);
    el.addEventListener('change', onStayTypeSelect);
  });
  document.querySelectorAll('.remove-stay-entry-btn').forEach((btn) => {
    btn.onclick = () => {
      const stayRow = btn.closest('tr');
      const stayKey = stayRow?.dataset?.stayKey;
      const tbody = document.getElementById('stay-entries-tbody');
      if (stayKey) findItemRowByStayKey(stayKey)?.remove();
      if (tbody.children.length > 1) {
        stayRow.remove();
      } else {
        stayRow.querySelectorAll('input, select').forEach((input) => {
          if (input.tagName === 'SELECT') input.selectedIndex = 0;
          else input.value = '';
        });
        delete stayRow.dataset.stayKey;
      }
      syncStayDaysFromEntries();
      updateStayEntryTotalsLocal();
      syncStayEntriesToItemRows();
      recalculate();
    };
  });
}

function onStayTypeSelect(e) {
  const row = e.target.closest('tr');
  const option = e.target.selectedOptions[0];
  const rate = option?.dataset?.rate;
  if (rate !== undefined && rate !== '') {
    row.querySelector('[data-field="daily_rate"]').value = rate;
  }
  onStayEntryRowChange(row);
}

function onStayEntryInput(e) {
  onStayEntryRowChange(e.target.closest('tr'));
}

function onStayEntryRowChange(row) {
  if (!row) return;
  const fromDate = row.querySelector('[data-field="from_date"]').value;
  const toDate = row.querySelector('[data-field="to_date"]').value;
  const daysInput = row.querySelector('[data-field="days"]');
  const rate = parseDisplayAmount(row.querySelector('[data-field="daily_rate"]').value);

  if (fromDate && toDate) {
    daysInput.value = formatAmountInput(calcDaysBetween(fromDate, toDate), 0);
  }

  const days = parseDisplayAmount(daysInput.value);
  const total = Math.round(days * rate * 100) / 100;
  row.querySelector('[data-field="total"]').value = total ? fmt(total) : '';
  syncStayDaysFromEntries();
  updateStayEntryTotalsLocal();
  syncStayEntriesToItemRows();
  recalculate();
}

function updateStayEntryTotalsLocal() {
  let subtotal = 0;
  document.querySelectorAll('#stay-entries-tbody tr').forEach((row) => {
    const days = parseDisplayAmount(row.querySelector('[data-field="days"]').value);
    const rate = parseDisplayAmount(row.querySelector('[data-field="daily_rate"]').value);
    subtotal += Math.round(days * rate * 100) / 100;
  });
  document.getElementById('stay-subtotal-display').textContent = fmt(subtotal);
}

function collectStayEntries() {
  const entries = [];
  document.querySelectorAll('#stay-entries-tbody tr').forEach((row) => {
    const stayTypeId = row.querySelector('[data-field="stay_type_id"]').value;
    const fromDate = row.querySelector('[data-field="from_date"]').value;
    const toDate = row.querySelector('[data-field="to_date"]').value;
    const days = row.querySelector('[data-field="days"]').value;
    const dailyRate = row.querySelector('[data-field="daily_rate"]').value;
    if (!stayTypeId && !fromDate && !toDate && !parseDisplayAmount(dailyRate)) return;
    entries.push({
      stay_type_id: stayTypeId || null,
      from_date: fromDate || null,
      to_date: toDate || null,
      days: parseDisplayAmount(days),
      daily_rate: parseDisplayAmount(dailyRate),
    });
  });
  return entries;
}

function syncStayDaysFromEntries() {
  const entries = collectStayEntries().filter((e) => e.stay_type_id || e.from_date || e.to_date);
  if (entries.length) {
    const totalDays = entries.reduce((sum, entry) => sum + (Number(entry.days) || 0), 0);
    document.getElementById('stay_days').value = totalDays;
  } else {
    autoStayDays();
  }
}

function prefillStayEntryDatesFromAdmission() {
  const admission = document.getElementById('admission_date').value;
  const discharge = document.getElementById('discharge_date').value;
  document.querySelectorAll('#stay-entries-tbody tr').forEach((row) => {
    const fromInput = row.querySelector('[data-field="from_date"]');
    const toInput = row.querySelector('[data-field="to_date"]');
    if (!fromInput.value && admission) fromInput.value = admission;
    if (!toInput.value && discharge) toInput.value = discharge;
    onStayEntryRowChange(row);
  });
}

function getDefaultPermissionsForRole(role) {
  return roleDefaults[role] || [];
}

function renderPermissionCheckboxes(containerId, selected = [], prefix = 'perm') {
  const container = document.getElementById(containerId);
  if (!container || !permissionCatalog.length) return;

  const groups = {};
  permissionCatalog.forEach((p) => {
    if (!groups[p.group]) groups[p.group] = [];
    groups[p.group].push(p);
  });

  container.innerHTML = Object.entries(groups)
    .map(
      ([group, items]) => `
    <div class="permission-group mb-2">
      <div class="fw-black small text-muted mb-1">${group}</div>
      <div class="d-flex flex-wrap gap-2">
        ${items
          .map(
            (p) => `
          <label class="permission-chip" title="${escapeAttr(p.description)}">
            <input type="checkbox" class="form-check-input ${prefix}-checkbox" value="${p.key}" ${selected.includes(p.key) ? 'checked' : ''}>
            <span>${p.label}</span>
          </label>`
          )
          .join('')}
      </div>
    </div>`
    )
    .join('');
}

function collectSelectedPermissions(containerId, prefix = 'perm') {
  return [...document.querySelectorAll(`#${containerId} .${prefix}-checkbox:checked`)].map((el) => el.value);
}

async function loadPermissionCatalog() {
  if (!can('users.*')) return;
  try {
    const [permRes, rolesRes] = await Promise.all([
      apiFetch(`${USERS_API}/permissions`),
      apiFetch(`${USERS_API}/roles`),
    ]);
    permissionCatalog = await permRes.json();
    const roles = await rolesRes.json();
    roleDefaults = {};
    roles.forEach((r) => {
      roleDefaults[r.id] = r.default_permissions || [];
    });
    renderPermissionCheckboxes('new-user-permissions', getDefaultPermissionsForRole('user'), 'new');
  } catch (err) {
    console.error(err);
  }
}

function hasPatientFileNumber() {
  return Boolean(document.getElementById('file_number')?.value?.trim());
}

function getPatientAccountBalance() {
  return patientAccountBalance ?? 0;
}

function sumBillableLineTotals() {
  let total = 0;
  document.querySelectorAll('#items-tbody tr').forEach((row) => {
    if (row.dataset.staySync) return;
    const qty = parseDisplayAmount(row.querySelector('[data-field="quantity"]')?.value);
    const amt = parseDisplayAmount(row.querySelector('[data-field="amount"]')?.value);
    const desc = row.querySelector('[data-field="description"]')?.value?.trim();
    if (desc || qty || amt) total += qty * amt;
  });
  document.querySelectorAll('#stay-entries-tbody tr').forEach((row) => {
    const days = parseDisplayAmount(row.querySelector('[data-field="days"]')?.value);
    const rate = parseDisplayAmount(row.querySelector('[data-field="daily_rate"]')?.value);
    if (days || rate) total += days * rate;
  });
  return Math.round(total * 100) / 100;
}

function sumManualPaymentMethods() {
  let total = 0;
  document.querySelectorAll('.payment-method-input').forEach((input) => {
    if (input.dataset.methodCode === 'patient_credit') return;
    total += parseDisplayAmount(input.value);
  });
  return Math.round(total * 100) / 100;
}

function getPatientNetBalance() {
  if (!hasPatientFileNumber()) return 0;
  const creditUsed = computeInvoicePatientCredit(
    Number(lastCalculationTotals?.final_total) || sumBillableLineTotals()
  );
  return Math.round((getPatientAccountBalance() - creditUsed) * 100) / 100;
}

function computeInvoicePatientCredit(finalTotal, otherPaid = null) {
  const balance = getPatientAccountBalance();
  if (balance <= 0) return 0;
  const total = Number(finalTotal) || 0;
  if (total <= 0) return 0;
  const paidElsewhere =
    otherPaid === null ? sumManualPaymentMethods() : Math.max(0, Number(otherPaid) || 0);
  const remainingDue = Math.max(0, Math.round((total - paidElsewhere) * 100) / 100);
  return Math.round(Math.min(balance, remainingDue) * 100) / 100;
}

function distributePatientCreditAcrossRows(creditPool) {
  let remaining = creditPool;
  document.querySelectorAll('#items-tbody tr').forEach((row) => {
    if (row.dataset.staySync) return;
    const creditInput = row.querySelector('[data-field="patient_credit_applied"]');
    if (!creditInput) return;

    const qty = parseDisplayAmount(row.querySelector('[data-field="quantity"]')?.value);
    const amt = parseDisplayAmount(row.querySelector('[data-field="amount"]')?.value);
    const desc = row.querySelector('[data-field="description"]')?.value?.trim();
    const lineTotal = Math.round(qty * amt * 100) / 100;

    if (!desc || lineTotal <= 0 || remaining <= 0) {
      if (creditInput.value !== '') creditInput.value = '';
      return;
    }

    const apply = Math.min(lineTotal, remaining);
    remaining = Math.round((remaining - apply) * 100) / 100;
    creditInput.value = apply > 0 ? formatAmountInput(apply) : '';
  });
}

function syncPatientBalanceField() {
  const balanceEl = document.getElementById('balance');
  const labelEl = document.getElementById('balance-field-label');
  if (!balanceEl) return;

  if (hasPatientFileNumber()) {
    const net = getPatientNetBalance();
    balanceEl.value = formatAmountInput(net);
    balanceEl.readOnly = true;
    balanceEl.classList.add('bg-light');
    balanceEl.classList.toggle('text-danger', net < 0);
    if (labelEl) labelEl.textContent = 'رصيد المريض (بعد البنود)';
  } else {
    balanceEl.readOnly = false;
    balanceEl.classList.remove('bg-light', 'text-danger');
    if (labelEl) labelEl.textContent = 'الرصيد';
  }
}

function autoApplyPatientCreditToRows() {
  if (!hasPatientFileNumber()) {
    document.querySelectorAll('#items-tbody tr [data-field="patient_credit_applied"]').forEach((input) => {
      input.value = '';
      input.readOnly = false;
      input.classList.remove('bg-light');
    });
    return false;
  }

  const finalTotal = Number(lastCalculationTotals?.final_total) || sumBillableLineTotals();
  const creditPool = computeInvoicePatientCredit(finalTotal);
  const before = sumLinePatientCredits();

  document.querySelectorAll('#items-tbody tr').forEach((row) => {
    const creditInput = row.querySelector('[data-field="patient_credit_applied"]');
    if (!creditInput) return;
    creditInput.readOnly = true;
    creditInput.classList.add('bg-light');
  });

  distributePatientCreditAcrossRows(creditPool);
  return Math.abs(before - sumLinePatientCredits()) > 0.009;
}

function syncPatientCreditPaymentOnly(totals) {
  if (!hasPatientFileNumber()) return false;

  const creditTotal = computeInvoicePatientCredit(Number(totals?.final_total) || 0);
  let changed = false;

  getPaymentInputsByCode('patient_credit').forEach((input) => {
    const current = parseDisplayAmount(input.value);
    const nextNum = creditTotal > 0.009 ? creditTotal : 0;
    if (Math.abs(current - nextNum) > 0.009) {
      input.value = creditTotal > 0.009 ? formatAmountInput(creditTotal) : '';
      changed = true;
    }
    input.readOnly = true;
    input.classList.add('bg-light');
    const row = input.closest('tr');
    if (row) row.classList.toggle('payment-row-active', creditTotal > 0.009);
  });

  return changed;
}

function sumLinePatientCredits() {
  let total = 0;
  document.querySelectorAll('#items-tbody tr [data-field="patient_credit_applied"]').forEach((input) => {
    if (input.closest('tr')?.dataset.staySync) return;
    total += parseDisplayAmount(input.value);
  });
  return Math.round(total * 100) / 100;
}

function updatePatientCreditSummary(totals) {
  const creditTotal = hasPatientFileNumber()
    ? computeInvoicePatientCredit(Number(totals?.final_total) || 0)
    : Number(totals?.patient_credit_applied ?? sumLinePatientCredits()) || 0;
  const display = document.getElementById('patient_credit_total_display');
  if (display) display.value = creditTotal ? fmt(creditTotal) : '0';

  const afterHint = document.getElementById('patient-balance-after-hint');
  const afterDisplay = document.getElementById('patient-balance-after-display');
  if (hasPatientFileNumber() && afterHint && afterDisplay) {
    const net = getPatientNetBalance();
    afterHint.style.display = '';
    afterDisplay.textContent = fmt(net);
    afterDisplay.classList.toggle('text-danger', net < 0);
  } else if (afterHint) {
    afterHint.style.display = 'none';
  }
}

function syncPatientCreditPaymentMethod(amount) {
  getPaymentInputsByCode('patient_credit').forEach((input) => {
    input.value = amount > 0 ? formatAmountInput(amount) : '';
    input.readOnly = true;
    input.classList.add('bg-light');
    const row = input.closest('tr');
    if (row) row.classList.toggle('payment-row-active', amount > 0);
  });
}

async function loadPatientBalance() {
  const fileNumber = document.getElementById('file_number').value.trim();
  const hint = document.getElementById('patient-balance-hint');
  const creditWrap = document.getElementById('patient-credit-wrap');
  if (!fileNumber) {
    patientAccountBalance = null;
    hint.style.display = 'none';
    creditWrap.style.display = 'none';
    document.getElementById('balance').value = formatAmountInput(0);
    syncPatientBalanceField();
    autoApplyPatientCreditToRows();
    await recalculate({ skipAutoCredit: true });
    return;
  }
  try {
    const res = await apiFetch(`${PATIENTS_API}/by-file/${encodeURIComponent(fileNumber)}`);
    const patient = await res.json();
    const balance = Number(patient.account_balance) || 0;
    patientAccountBalance = balance;
    document.getElementById('patient-balance-display').textContent = fmt(balance);
    hint.style.display = '';
    document.getElementById('edit-patient-balance-btn').style.display = can('patients.manage') ? '' : 'none';
    creditWrap.style.display = fileNumber ? '' : 'none';
    autoApplyPatientCreditToRows();
    await recalculate({ skipAutoCredit: true });
  } catch {
    hint.style.display = 'none';
  }
}

async function editPatientBalance() {
  const fileNumber = document.getElementById('file_number').value.trim();
  const patientName = document.getElementById('patient_name').value.trim();
  if (!fileNumber) return showToast('أدخل رقم الملف أولًا', 'warning');
  const current = parseDisplayAmount(document.getElementById('patient-balance-display').textContent);
  const input = prompt('رصيد حساب المريض:', current || '0');
  if (input === null) return;
  try {
    const res = await apiFetch(`${PATIENTS_API}/balance`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ file_number: fileNumber, name: patientName, account_balance: input }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    await loadPatientBalance();
    showToast('تم تحديث رصيد المريض', 'success');
  } catch (err) {
    showToast(err.message, 'danger');
  }
}

function updateInvoiceStatusUI(status, serialNumber = null) {
  currentInvoiceStatus = status;
  const badge = document.getElementById('invoice-status-badge');
  const editSerial = document.getElementById('edit-serial');
  const info = STATUS_BADGES[status] || { text: status, class: 'bg-secondary' };

  badge.style.display = status ? '' : 'none';
  badge.className = `badge status-badge ${info.class}`;
  badge.textContent = info.text;

  if (status === 'approved' && serialNumber) {
    editSerial.style.display = 'inline';
    editSerial.textContent = serialNumber;
  } else if (serialNumber) {
    editSerial.style.display = 'inline';
    editSerial.textContent = serialNumber;
  } else {
    editSerial.style.display = 'none';
    editSerial.textContent = '';
  }

  updateInvoiceActionButtons();
}

function updateInvoiceActionButtons() {
  const canEdit = can('invoices.create') || can('invoices.edit');
  const isApproved = currentInvoiceStatus === 'approved';
  const isPending = currentInvoiceStatus === 'pending_review';

  document.getElementById('save-draft-btn').style.display = canEdit && !isApproved ? '' : 'none';
  document.getElementById('submit-review-btn').style.display = can('invoices.submit') && !isApproved ? '' : 'none';
  document.getElementById('approve-invoice-btn').style.display =
    can('invoices.approve') && (isPending || currentInvoiceId) && !isApproved ? '' : 'none';

  const showExports = isApproved && currentInvoiceId;
  const returnBtn = document.getElementById('record-return-btn');
  if (returnBtn) {
    returnBtn.style.display =
      currentInvoiceId && currentInvoiceStatus === 'approved' && can('invoices.edit') ? '' : 'none';
  }
  ['download-pdf-btn', 'download-docx-btn', 'preview-btn'].forEach((id) => {
    document.getElementById(id).style.display = showExports ? 'inline-block' : 'none';
  });
  document.getElementById('qr-card').style.display = showExports ? 'block' : 'none';
}

function autoStayDays() {
  const admission = document.getElementById('admission_date').value;
  const discharge = document.getElementById('discharge_date').value;
  if (admission && discharge) {
    const start = new Date(admission);
    const end = new Date(discharge);
    const diff = Math.ceil((end - start) / (86400000));
    document.getElementById('stay_days').value = Math.max(diff, 0);
  }
}

function collectFormData() {
  const rows = document.querySelectorAll('#items-tbody tr');
  const items = [];
  const payments = [];

  rows.forEach((row) => {
    if (row.dataset.staySync) return;
    const desc = row.querySelector('[data-field="description"]').value.trim();
    const qty = parseDisplayAmount(row.querySelector('[data-field="quantity"]').value);
    const amt = parseDisplayAmount(row.querySelector('[data-field="amount"]').value);
    const payAmt = parseDisplayAmount(row.querySelector('[data-field="pay_amount"]').value);
    const creditAmt = parseDisplayAmount(row.querySelector('[data-field="patient_credit_applied"]')?.value);
    const receiptDate = row.querySelector('[data-field="receipt_date"]').value;
    const receiptNum = row.querySelector('[data-field="receipt_number"]').value;

    if (desc || qty || amt) {
      const serviceIdEl = row.querySelector('[data-field="service_id"]');
      const itemIdEl = row.querySelector('[data-field="invoice_item_id"]');
      const item = { description: desc, quantity: qty, amount: amt };
      if (itemIdEl?.value) item.id = Number(itemIdEl.value);
      const returnedQty = Number(row.dataset.returnedQty) || 0;
      if (returnedQty > 0) item.returned_quantity = returnedQty;
      if (creditAmt > 0) item.patient_credit_applied = creditAmt;
      if (serviceIdEl?.value) item.service_id = Number(serviceIdEl.value);
      if (row.dataset.dailyLineId) item.daily_entry_line_id = Number(row.dataset.dailyLineId);
      if (row.dataset.dailyEntryId) item.daily_entry_id = Number(row.dataset.dailyEntryId);
      const override = row.dataset.discountOverride;
      if (override === 'true' || override === 'false') {
        item.discount_eligible_override = override === 'true';
      }
      items.push(item);
    }
    if (payAmt || receiptDate || receiptNum) {
      payments.push({ receipt_date: receiptDate, receipt_number: receiptNum, amount: payAmt });
    }
  });

  const methodPayments = collectMethodPayments().filter((entry) => entry.code !== 'patient_credit');
  const otherPaid = methodPayments.reduce((sum, entry) => sum + (Number(entry.amount) || 0), 0);
  const creditSum = hasPatientFileNumber()
    ? computeInvoicePatientCredit(
        Number(lastCalculationTotals?.final_total) || sumBillableLineTotals(),
        otherPaid
      )
    : items.reduce((sum, item) => sum + (Number(item.patient_credit_applied) || 0), 0);
  if (creditSum > 0) {
    let creditMethod = (paymentMethodsCache || []).find((m) => m.code === 'patient_credit');
    if (!creditMethod?.id) {
      creditMethod = { id: null, code: 'patient_credit' };
    }
    methodPayments.push({
      payment_method_id: creditMethod.id,
      code: 'patient_credit',
      amount: creditSum,
    });
  }

  return {
    invoice_id: document.getElementById('invoice-id').value || null,
    invoice_type: document.getElementById('invoice_type').value,
    contracted_entity_id: document.getElementById('contracted_entity_id').value || null,
    discount_percent: parseFloat(document.getElementById('discount_percent_display').value) || 0,
    letter_from_date: document.getElementById('letter_from_date').value || null,
    letter_to_date: document.getElementById('letter_to_date').value || null,
    issue_date: document.getElementById('issue_date').value,
    file_number: document.getElementById('file_number').value,
    patient_name: document.getElementById('patient_name').value,
    admission_date: document.getElementById('admission_date').value,
    discharge_date: document.getElementById('discharge_date').value,
    stay_days: parseDisplayAmount(document.getElementById('stay_days').value),
    financial_treatment: document.getElementById('financial_treatment').value,
    stay_entries: collectStayEntries(),
    notes: document.getElementById('notes').value,
    stamp_duty: parseDisplayAmount(document.getElementById('stamp_duty').value),
    professional_fees: parseDisplayAmount(document.getElementById('professional_fees').value),
    balance: hasPatientFileNumber() ? 0 : parseDisplayAmount(document.getElementById('balance').value),
    admin_expenses_percent: parseDisplayAmount(document.getElementById('admin_expenses_percent').value),
    method_payments: methodPayments,
    employee_name: document.getElementById('employee_name').value,
    auditor_name: document.getElementById('auditor_name').value,
    captain_name: document.getElementById('captain_name').value,
    manager_name: document.getElementById('manager_name').value,
    items,
    payments,
  };
}

function collectMethodPayments() {
  const entries = [];
  document.querySelectorAll('.payment-method-input').forEach((input) => {
    entries.push({
      payment_method_id: Number(input.dataset.methodId),
      code: input.dataset.methodCode,
      amount: parseDisplayAmount(input.value),
    });
  });
  return entries;
}

async function recalculate(options = {}) {
  if (!options.skipAutoCredit) autoApplyPatientCreditToRows();
  syncPatientBalanceField();

  const data = collectFormData();

  document.querySelectorAll('#items-tbody tr').forEach((row) => {
    updateInvoiceRowLineTotal(row);
  });

  try {
    const res = await apiFetch(`${API}/calculate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    const totals = await res.json();
    if (!res.ok || totals.error) {
      throw new Error(totals.error || 'فشل حساب الفاتورة');
    }
    lastCalculationTotals = totals;
    syncInvoiceRowsFromCalculatedItems(totals.items || []);
    updateSummaryDisplay(totals);
    updateSummaryTable(totals);
    updatePaymentValidationUI(totals);
    updateCalculationFlowUI(totals);
    updateCalculationValidationUI(totals);
    applyItemDiscountPercents((totals.items || []).filter((item) => !item.is_stay_entry));
    updateStayEntriesFromTotals(totals.stay_entries || []);
    if (typeof syncDailyChargeRowsFromTotals === 'function') {
      syncDailyChargeRowsFromTotals(totals.items || []);
    }
    if (invoiceFollowUpMode) lockDailyInvoiceRows();

    if (hasPatientFileNumber()) {
      const creditChanged = syncPatientCreditPaymentOnly(totals);
      autoApplyPatientCreditToRows();
      syncPatientBalanceField();
      if (creditChanged) {
        return recalculate({ skipAutoCredit: true, skipAutoPayments: true });
      }
    }

    return totals;
  } catch (err) {
    console.error(err);
    showToast(err.message || 'فشل حساب الفاتورة', 'danger');
    return null;
  }
}

function updateInvoiceRowLineTotal(row) {
  if (!row || row.dataset.staySync) return;
  const qtyEl = row.querySelector('[data-field="quantity"]');
  const amtEl = row.querySelector('[data-field="amount"]');
  const totalEl = row.querySelector('[data-field="total"]');
  if (!qtyEl || !amtEl || !totalEl) return;
  const qty = parseDisplayAmount(qtyEl.value);
  const amt = parseDisplayAmount(amtEl.value);
  const total = Math.round(qty * amt * 100) / 100;
  totalEl.value = total ? fmt(total) : '';
}

function syncInvoiceRowsFromCalculatedItems(items = []) {
  const billable = (items || []).filter((item) => !item.is_stay_entry);
  const byLineId = new Map(
    billable.filter((item) => item.daily_entry_line_id).map((item) => [String(item.daily_entry_line_id), item])
  );
  let manualIdx = 0;
  const manualItems = billable.filter((item) => !item.daily_entry_line_id);

  document.querySelectorAll('#items-tbody tr').forEach((row) => {
    if (row.dataset.staySync) return;
    const lineId = row.dataset.dailyLineId;
    const desc = row.querySelector('[data-field="description"]')?.value?.trim();
    const qty = parseDisplayAmount(row.querySelector('[data-field="quantity"]')?.value);
    const amt = parseDisplayAmount(row.querySelector('[data-field="amount"]')?.value);
    const hasContent = Boolean(lineId || desc || qty || amt);
    if (!hasContent) return;

    let item = lineId ? byLineId.get(String(lineId)) : null;
    if (!item && !lineId) {
      item = manualItems[manualIdx];
      manualIdx += 1;
    }
    if (!item) return;

    const descEl = row.querySelector('[data-field="description"]');
    if (descEl && item.description) {
      const current = descEl.value.trim();
      if (lineId || !current || /GMT|Coordinated Universal Time/i.test(current)) {
        descEl.value = item.description;
      }
    }

    if (item.daily_entry_line_id) row.dataset.dailyLineId = String(item.daily_entry_line_id);
    if (item.daily_entry_id) row.dataset.dailyEntryId = String(item.daily_entry_id);

    const serviceIdEl = row.querySelector('[data-field="service_id"]');
    if (serviceIdEl && item.service_id) serviceIdEl.value = item.service_id;

    const qtyEl = row.querySelector('[data-field="quantity"]');
    const amtEl = row.querySelector('[data-field="amount"]');
    if (qtyEl && item.quantity != null && item.quantity !== '') {
      qtyEl.value = formatAmountInput(item.quantity, 0);
    }
    if (amtEl && item.amount != null && item.amount !== '') {
      amtEl.value = formatAmountInput(item.amount);
    }
    const totalEl = row.querySelector('[data-field="total"]');
    if (totalEl && item.total != null && item.total !== '') {
      totalEl.value = fmt(item.total);
    } else {
      updateInvoiceRowLineTotal(row);
    }
    updateInvoiceReturnHint(row, item);
  });
  updateInvoiceReturnHintsFromItems(billable);
}

function updateInvoiceReturnHint(row, item) {
  const hint = row?.querySelector('.invoice-return-hint');
  if (!hint) return;
  const returned = Number(item?.returned_quantity) || Number(row.dataset.returnedQty) || 0;
  const original = Number(item?.original_quantity ?? item?.quantity) || 0;
  const net = Number(item?.net_quantity) ?? Math.max(0, original - returned);
  if (returned > 0) {
    hint.classList.remove('d-none');
    hint.textContent = `مرتجع: ${formatAmountInput(returned, 0)} | صافي: ${formatAmountInput(net, 0)}`;
    row.dataset.returnedQty = String(returned);
  } else {
    hint.classList.add('d-none');
    hint.textContent = '';
    delete row.dataset.returnedQty;
  }
}

function updateInvoiceReturnHintsFromItems(items = []) {
  const billable = (items || []).filter((item) => !item.is_stay_entry);
  const byLineId = new Map(
    billable.filter((item) => item.daily_entry_line_id).map((item) => [String(item.daily_entry_line_id), item])
  );
  const byId = new Map(billable.filter((item) => item.id).map((item) => [String(item.id), item]));

  document.querySelectorAll('#items-tbody tr').forEach((row) => {
    if (row.dataset.staySync) return;
    const lineId = row.dataset.dailyLineId;
    const itemId = row.querySelector('[data-field="invoice_item_id"]')?.value;
    const item =
      lineId && byLineId.has(String(lineId))
        ? byLineId.get(String(lineId))
        : itemId && byId.has(String(itemId))
          ? byId.get(String(itemId))
          : null;
    if (item) updateInvoiceReturnHint(row, item);
  });
}

function renderInvoiceReturnsHistory(returns = []) {
  const card = document.getElementById('invoice-returns-card');
  const container = document.getElementById('invoice-returns-history');
  if (!card || !container) return;
  if (!returns?.length) {
    card.style.display = 'none';
    container.innerHTML = '<p class="small text-muted mb-0">لا توجد إرجاعات مسجلة.</p>';
    return;
  }
  card.style.display = '';
  container.innerHTML = returns
    .map((ret) => {
      const lines = (ret.lines || [])
        .map(
          (line) =>
            `<li class="small">${escapeHtml(line.description_snapshot || line.service_name_snapshot || '—')} — ${formatAmountInput(line.return_quantity, 0)} × ${fmt(line.unit_price_snapshot)} = ${fmt(line.return_amount)}</li>`
        )
        .join('');
      return `<div class="mb-2 border-bottom pb-2">
        <div class="fw-bold small">${ret.return_date || ''} ${ret.created_by_name ? `— ${escapeHtml(ret.created_by_name)}` : ''}</div>
        ${ret.notes ? `<div class="small text-muted">${escapeHtml(ret.notes)}</div>` : ''}
        <ul class="mb-0 ps-3">${lines}</ul>
      </div>`;
    })
    .join('');
}

async function openInvoiceReturnModal() {
  if (!currentInvoiceId) {
    showToast('احفظ الفاتورة أولاً قبل تسجيل الإرجاع', 'warning');
    return;
  }
  if (currentInvoiceStatus !== 'approved') {
    showToast('تسجيل الإرجاع متاح فقط للفواتير المعتمدة', 'warning');
    return;
  }
  try {
    const res = await apiFetch(`${API}/${currentInvoiceId}`);
    const inv = await res.json();
    if (!res.ok) throw new Error(inv.error);
    if (inv.status !== 'approved') {
      showToast('تسجيل الإرجاع متاح فقط للفواتير المعتمدة', 'warning');
      return;
    }

    const tbody = document.getElementById('invoice-return-lines-tbody');
    const today = new Date().toISOString().slice(0, 10);
    document.getElementById('invoice-return-date').value = today;
    document.getElementById('invoice-return-notes').value = '';

    const lines = (inv.items || []).filter((item) => {
      const qty = Number(item.quantity) || 0;
      const returned = Number(item.returned_quantity) || 0;
      return qty > 0 && returned < qty && (item.description || item.service_name_snapshot);
    });

    if (!lines.length) {
      showToast('لا توجد بنود متاحة للإرجاع', 'warning');
      return;
    }

    tbody.innerHTML = lines
      .map((item) => {
        const original = Number(item.quantity) || 0;
        const returned = Number(item.returned_quantity) || 0;
        const available = Math.max(0, original - returned);
        return `<tr>
          <td>${escapeHtml(item.description || item.service_name_snapshot || '—')}</td>
          <td class="text-center">${formatAmountInput(original, 0)}</td>
          <td class="text-center">${formatAmountInput(returned, 0)}</td>
          <td class="text-center fw-bold">${formatAmountInput(available, 0)}</td>
          <td><input type="text" inputmode="decimal" class="form-control form-control-sm invoice-return-qty comma-amount" data-item-id="${item.id}" value="" placeholder="0"></td>
        </tr>`;
      })
      .join('');

    bindCommaAmountInputs(tbody);
    invoiceReturnModal?.show();
  } catch (err) {
    showToast(err.message, 'danger');
  }
}

async function submitInvoiceReturns() {
  if (!currentInvoiceId) return;
  const lines = [];
  document.querySelectorAll('#invoice-return-lines-tbody .invoice-return-qty').forEach((input) => {
    const qty = parseDisplayAmount(input.value);
    const itemId = Number(input.dataset.itemId);
    if (itemId && qty > 0) lines.push({ invoice_item_id: itemId, return_quantity: qty });
  });
  if (!lines.length) {
    showToast('أدخل كمية إرجاع لبند واحد على الأقل', 'warning');
    return;
  }

  try {
    const res = await apiFetch(`${API}/${currentInvoiceId}/returns`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        return_date: document.getElementById('invoice-return-date').value || null,
        notes: document.getElementById('invoice-return-notes').value || '',
        lines,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'فشل تسجيل الإرجاع');
    invoiceReturnModal?.hide();
    showToast('تم تسجيل الإرجاع وتحديث إجماليات الفاتورة', 'success');
    currentInvoiceReturns = data.returns || [];
    await loadInvoiceForEdit(currentInvoiceId, {
      keepForm: true,
      followUp: invoiceFollowUpMode,
    });
  } catch (err) {
    showToast(err.message, 'danger');
  }
}

function updateStayEntriesFromTotals(entries) {
  document.querySelectorAll('#stay-entries-tbody tr').forEach((row, i) => {
    const entry = entries[i];
    if (!entry) return;
    row.querySelector('[data-field="days"]').value = entry.days ?? '';
    row.querySelector('[data-field="total"]').value = entry.total ? fmt(entry.total) : '';
  });
  if (Number(entries.length)) {
    document.getElementById('stay-subtotal-display').innerHTML = fmtDual(
      entries.reduce((sum, entry) => sum + (Number(entry.total_raw ?? entry.total) || 0), 0),
      entries.reduce((sum, entry) => sum + (Number(entry.total) || 0), 0)
    );
  }
}

function updateSummaryDisplay(t) {
  document.getElementById('sum_items').innerHTML = fmtDual(t.items_subtotal_raw, t.items_subtotal);
  const hasStay = Number(t.stay_subtotal) > 0;
  document.getElementById('sum_stay_wrap').style.display = hasStay ? '' : 'none';
  if (hasStay) {
    document.getElementById('sum_stay').innerHTML = fmtDual(t.stay_subtotal_raw, t.stay_subtotal);
    document.getElementById('stay-subtotal-display').innerHTML = fmtDual(t.stay_subtotal_raw, t.stay_subtotal);
  }
  document.getElementById('sum_fees').innerHTML = fmtDual(
    (t.stamp_duty_raw || 0) + (t.professional_fees_raw || 0),
    (t.stamp_duty || 0) + (t.professional_fees || 0)
  );
  document.getElementById('sum_admin').innerHTML = fmtDual(t.admin_expenses_raw, t.admin_expenses);
  document.getElementById('sum_after_admin').innerHTML = fmtDual(t.total_after_admin_raw, t.total_after_admin);

  const hasDiscount = Number(t.discount_amount) > 0 || Number(t.discount_percent) > 0;
  document.getElementById('sum_discount_wrap').style.display = hasDiscount ? '' : 'none';
  document.getElementById('sum_net_wrap').style.display = hasDiscount ? '' : 'none';
  if (hasDiscount) {
    document.getElementById('sum_discount').innerHTML = fmtDual(t.discount_amount_raw, t.discount_amount);
    const netRaw = t.net_after_discount_raw ?? t.items_subtotal_after_discount_raw;
    const netRounded = t.net_after_discount ?? t.items_subtotal_after_discount;
    document.getElementById('sum_net').innerHTML = fmtDual(netRaw, netRounded);
  }

  document.getElementById('sum_final').innerHTML = fmtDual(t.final_total_raw, t.final_total);
  document.getElementById('sum_collected').innerHTML = fmtDual(t.total_collected_raw, t.total_collected);
  document.getElementById('sum_remaining').innerHTML = fmtDual(
    t.outstanding_amount_raw ?? t.remaining_raw,
    t.outstanding_amount ?? t.remaining
  );

  const refundableRaw = Number(t.refundable_amount_raw) || 0;
  const refundable = Number(t.refundable_amount) || 0;
  const showRefundable = refundableRaw > 0.009;
  document.getElementById('sum_refundable_wrap').style.display = showRefundable ? '' : 'none';
  if (showRefundable) {
    document.getElementById('sum_refundable').innerHTML = fmtDual(refundableRaw, refundable);
  }

  document.getElementById('display_final_total').innerHTML = fmtDual(t.final_total_raw, t.final_total);
  document.getElementById('display_total_collected').innerHTML = fmtDual(t.total_collected_raw, t.total_collected);
  document.getElementById('display_total_collected2').innerHTML = fmtDual(t.total_collected_raw, t.total_collected);
  document.getElementById('display_remaining').innerHTML = fmtDual(
    t.outstanding_amount_raw ?? t.remaining_raw,
    t.outstanding_amount ?? t.remaining
  );
  const refundableRow = document.getElementById('display-refundable-row');
  if (refundableRow) refundableRow.style.display = showRefundable ? '' : 'none';
  if (showRefundable) {
    document.getElementById('display_refundable').innerHTML = fmtDual(refundableRaw, refundable);
  }
  updatePatientCreditSummary(t);
  updatePaymentRowHints();
  updatePaymentValidationUI(t);
}

function updateCalculationFlowUI(t) {
  const list = document.getElementById('calculation-flow-list');
  const steps = t.calculation_steps || [];
  if (!steps.length) {
    list.innerHTML = '<li class="text-muted small">أدخل البيانات لعرض مسار الحساب...</li>';
    return;
  }

  list.innerHTML = steps
    .map((step) => {
      const classes = [
        step.is_total ? 'is-total' : '',
        step.is_deduction ? 'is-deduction' : '',
        step.is_remaining ? 'is-remaining' : '',
      ]
        .filter(Boolean)
        .join(' ');
      const value = step.is_percent
        ? `${step.rounded}%`
        : step.is_deduction
          ? `− ${fmtDual(step.raw, step.rounded)}`
          : fmtDual(step.raw, step.rounded);
      return `<li class="${classes}"><span>${step.label}</span><strong>${value}</strong></li>`;
    })
    .join('');
}

function updateCalculationValidationUI(t) {
  const banner = document.getElementById('calculation-validation-banner');
  const validation = t.calculation_validation;
  if (!validation) {
    banner.style.display = 'none';
    return;
  }

  banner.style.display = '';
  if (validation.is_valid && !(validation.warnings || []).length) {
    banner.className = 'calc-validation-banner is-valid';
    banner.textContent = '✓ الحسابات متسقة — لا توجد أخطاء';
    return;
  }

  if (!validation.is_valid) {
    banner.className = 'calc-validation-banner is-error';
    banner.innerHTML = validation.errors.map((e) => `✗ ${e}`).join('<br>');
    return;
  }

  banner.className = 'calc-validation-banner is-warning';
  banner.innerHTML = (validation.warnings || []).map((w) => `⚠ ${w}`).join('<br>');
}

function validateCalculationsBeforeSave(totals) {
  const validation = totals?.calculation_validation;
  if (!validation) return { ok: true };
  if (validation.is_valid) return { ok: true };
  return {
    ok: false,
    message: validation.errors[0] || 'خطأ في حسابات الفاتورة',
  };
}

function updatePaymentValidationUI(t) {
  const validation = t.payment_validation || {};
  const banner = document.getElementById('payment-validation-banner');
  const matchRow = document.getElementById('payment-match-row');
  const statusEl = document.getElementById('display_payment_status');
  const finalTotal = Number(t.final_total) || 0;
  const collected = Number(t.total_collected) || 0;
  const hasPayments = validation.has_payments || collected > 0;

  document.querySelectorAll('.payment-method-input').forEach((input) => {
    const amount = parseDisplayAmount(input.value);
    const row = input.closest('tr');
    input.classList.toggle('is-active', amount > 0);
    if (row) row.classList.toggle('payment-row-active', amount > 0);
  });

  if (!hasPayments && finalTotal === 0) {
    banner.style.display = 'none';
    matchRow.style.display = 'none';
    return;
  }

  banner.style.display = '';
  matchRow.style.display = '';

  if (!hasPayments) {
    banner.className = 'payment-validation-banner is-underpaid';
    banner.textContent = `لم يتم إدخال مدفوعات — إجمالي الفاتورة: ${fmt(finalTotal)}`;
    statusEl.textContent = 'بانتظار الدفع';
    statusEl.className = 'fw-black text-warning';
    return;
  }

  if (validation.is_balanced || Math.abs(Number(t.remaining) || 0) < 0.01) {
    banner.className = 'payment-validation-banner is-balanced';
    banner.textContent = `✓ متطابق: مجموع طرق الدفع (${fmt(collected)}) = إجمالي الفاتورة (${fmt(finalTotal)})`;
    statusEl.textContent = '✓ متطابق';
    statusEl.className = 'fw-black text-success';
    return;
  }

  const diff = Math.abs(Number(validation.difference ?? t.remaining) || 0);
  if (validation.status === 'overpaid' || Number(t.remaining) < -0.01) {
    const refundable = Number(t.refundable_amount) || 0;
    banner.className = 'payment-validation-banner is-overpaid';
    banner.textContent =
      refundable > 0.009
        ? `⚠ زيادة في الدفع — مستحق إرجاع للمريض: ${fmt(refundable)}`
        : `⚠ زيادة في الدفع: ${fmt(diff)} — المجموع ${fmt(collected)} أكبر من ${fmt(finalTotal)}`;
    statusEl.textContent = refundable > 0.009 ? `إرجاع ${fmt(refundable)}` : `زيادة ${fmt(diff)}`;
    statusEl.className = 'fw-black text-danger';
  } else {
    banner.className = 'payment-validation-banner is-underpaid';
    banner.textContent = `⚠ نقص في الدفع: ${fmt(diff)} — المجموع ${fmt(collected)} أقل من ${fmt(finalTotal)}`;
    statusEl.textContent = `نقص ${fmt(diff)}`;
    statusEl.className = 'fw-black text-warning';
  }
}

function getPaymentInputsByCode(code) {
  return [...document.querySelectorAll('.payment-method-input')].filter(
    (input) => input.dataset.methodCode === code
  );
}

function getInvoiceFinalTotalForPayment() {
  if (lastCalculationTotals) {
    return Number(lastCalculationTotals.final_total_raw ?? lastCalculationTotals.final_total) || 0;
  }
  return parseDisplayAmount(document.getElementById('display_final_total').textContent);
}

function fillFullPayment(code) {
  const total = getInvoiceFinalTotalForPayment();
  if (total <= 0) {
    showToast('أدخل بنود الفاتورة أولاً لحساب الإجمالي', 'warning');
    return;
  }
  const creditSum = hasPatientFileNumber() ? computeInvoicePatientCredit(total) : sumLinePatientCredits();
  const remainingForCash = Math.max(total - creditSum, 0);
  document.querySelectorAll('.payment-method-input').forEach((input) => {
    if (input.dataset.methodCode === 'patient_credit') return;
    input.value = input.dataset.methodCode === code ? formatAmountInput(remainingForCash) : formatAmountInput(0);
  });
  syncPatientCreditPaymentMethod(creditSum);
  recalculate();
}

function clearAllPayments() {
  document.querySelectorAll('.payment-method-input').forEach((input) => {
    input.value = formatAmountInput(0);
  });
  recalculate();
}

function validatePaymentsBeforeSave(totals) {
  const validation = totals?.payment_validation;
  if (!validation?.has_payments) return { ok: true };
  if (validation.is_balanced) return { ok: true };
  const diff = Math.abs(Number(validation.difference_raw ?? validation.difference) || 0);
  const msg =
    validation.status === 'overpaid'
      ? `مجموع طرق الدفع أكبر من إجمالي الفاتورة بمقدار ${fmt(diff)}`
      : `مجموع طرق الدفع أقل من إجمالي الفاتورة بمقدار ${fmt(diff)}`;
  return { ok: false, message: msg };
}

function applyItemDiscountPercents(items) {
  const byLineId = Object.fromEntries(
    (items || []).filter((item) => item.daily_entry_line_id).map((item) => [String(item.daily_entry_line_id), item])
  );
  const manualItems = (items || []).filter((item) => !item.daily_entry_line_id);
  let manualIdx = 0;
  const rows = document.querySelectorAll('#items-tbody tr');
  rows.forEach((row) => {
    if (row.dataset.staySync) return;
    const lineId = row.dataset.dailyLineId;
    const item = lineId ? byLineId[String(lineId)] : manualItems[manualIdx++];
    const pctField = row.querySelector('[data-field="discount_percent"]');
    if (!pctField) return;
    if (item) {
      const pct = item.item_discount_percent || 0;
      const amt = item.item_discount_amount || 0;
      pctField.value =
        pct > 0 && amt > 0 ? `${pct}% (${fmt(amt)})` : pct > 0 ? `${pct}%` : '0%';
      pctField.title = item.is_discount_eligible ? 'خاضع للخصم' : 'غير خاضع للخصم';
      pctField.classList.toggle('text-success', item.is_discount_eligible);
      pctField.classList.toggle('text-muted', !item.is_discount_eligible);
    } else {
      pctField.value = '0%';
      pctField.title = '';
    }
  });
}

function updateSummaryTable(t) {
  const adminPct =
    t.admin_expenses_percent ??
    parseDisplayAmount(document.getElementById('admin_expenses_percent')?.value) ??
    12;
  const adminLabel = `مصروفات إدارية ${adminPct}%`;
  const hasDiscount = Number(t.discount_amount) > 0 || Number(t.discount_percent) > 0;

  const discountRows = hasDiscount
    ? `
    <tr><td>${fmtDual(t.discount_amount_raw, t.discount_amount)}</td><td></td><td></td><td></td><td class="summary-label">خصم جهة متعاقدة ${t.discount_percent}%</td><td></td><td></td><td></td></tr>
    <tr><td>${fmtDual(t.net_after_discount_raw ?? t.items_subtotal_after_discount_raw, t.net_after_discount ?? t.items_subtotal_after_discount)}</td><td></td><td></td><td></td><td class="summary-label">صافي بعد الخصم</td><td></td><td></td><td></td></tr>`
    : '';

  const stayRows =
    Number(t.stay_subtotal) > 0
      ? `<tr><td>${fmtDual(t.stay_subtotal_raw, t.stay_subtotal)}</td><td></td><td></td><td></td><td class="summary-label">إجمالي تكلفة الإقامة</td><td></td><td></td><td></td></tr>`
      : '';

  document.getElementById('summary-tfoot').innerHTML = `
    ${stayRows}
    <tr><td>${fmtDual(t.items_subtotal_raw, t.items_subtotal)}</td><td></td><td></td><td></td><td class="summary-label">إجمالي البنود</td><td></td><td></td><td></td></tr>
    <tr><td>${fmtDual(t.stamp_duty_raw, t.stamp_duty)}</td><td></td><td></td><td></td><td class="summary-label">دمغة</td><td></td><td></td><td></td></tr>
    <tr><td>${fmtDual(t.professional_fees_raw, t.professional_fees)}</td><td></td><td></td><td></td><td class="summary-label">مهن</td><td></td><td></td><td></td></tr>
    <tr><td>${fmtDual(t.subtotal_before_admin_raw, t.subtotal_before_admin)}</td><td></td><td></td><td></td><td class="summary-label">الإجمالي</td><td></td><td></td><td></td></tr>
    <tr><td>${fmtDual(t.admin_expenses_raw, t.admin_expenses)}</td><td></td><td></td><td></td><td class="summary-label">${adminLabel}</td><td></td><td></td><td></td></tr>
    <tr><td>${fmtDual(t.total_after_admin_raw, t.total_after_admin)}</td><td></td><td></td><td></td><td class="summary-label">الإجمالي بعد المصروفات الإدارية</td><td></td><td></td><td></td></tr>
    ${discountRows}
    <tr><td>${hasPatientFileNumber() ? fmt(getPatientNetBalance()) : fmtDual(t.balance_raw, t.balance)}</td><td></td><td></td><td></td><td class="summary-label">${hasPatientFileNumber() ? 'رصيد المريض (بعد البنود)' : 'الرصيد'}</td><td></td><td></td><td></td></tr>
    <tr><td>${fmtDual(t.final_total_raw, t.final_total)}</td><td></td><td></td><td></td><td class="summary-label">الإجمالي</td><td>${fmtDual(t.total_collected_raw, t.total_collected)}</td><td></td><td></td></tr>
  `;
}

async function saveInvoiceWithMode(saveMode) {
  const data = collectFormData();
  data.save_mode = saveMode;

  if (!data.invoice_type) {
    showToast('يجب اختيار نوع الفاتورة', 'danger');
    return;
  }
  if (data.invoice_type === 'contracted' && !data.contracted_entity_id) {
    showToast('يجب اختيار الجهة المتعاقدة', 'danger');
    return;
  }

  if (!lastCalculationTotals) {
    await recalculate();
  }

  const calcCheck = validateCalculationsBeforeSave(lastCalculationTotals);
  if (!calcCheck.ok) {
    showToast(calcCheck.message, 'danger');
    return;
  }

  if (saveMode === 'submit') {
    const paymentCheck = validatePaymentsBeforeSave(lastCalculationTotals);
    if (!paymentCheck.ok) {
      showToast(paymentCheck.message, 'danger');
      return;
    }
  }

  try {
    const isEdit = !!currentInvoiceId;
    const url = isEdit ? `${API}/${currentInvoiceId}` : API;
    const method = isEdit ? 'PUT' : 'POST';

    const res = await apiFetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });

    const result = await res.json();
    if (!res.ok) throw new Error(result.error || 'خطأ في الحفظ');
    if (!result?.id) throw new Error('فشل حفظ الفاتورة — لم يتم إرجاع بيانات صالحة');

    currentInvoiceId = result.id;
    document.getElementById('invoice-id').value = result.id;
    document.getElementById('form-title').textContent = 'تعديل الفاتورة';
    updateInvoiceStatusUI(result.status, result.serial_number);

    if (result.created_by_name) {
      document.getElementById('created_by_display').textContent = result.created_by_name;
      document.getElementById('created-by-wrap').style.display = '';
    }

    if (result.status === 'approved' && result.qr_token) {
      await loadQR(result.id);
    }

    const msg =
      saveMode === 'submit'
        ? 'تم إرسال الفاتورة للمراجعة'
        : result.status === 'approved'
          ? `تم حفظ الفاتورة - ${result.serial_number}`
          : 'تم حفظ الفاتورة مؤقتًا (بدون رقم)';
    showToast(msg, 'success');
  } catch (err) {
    showToast(err.message, 'danger');
  }
}

async function approveCurrentInvoice() {
  if (!currentInvoiceId) {
    showToast('احفظ الفاتورة وأرسلها للمراجعة أولًا', 'warning');
    return;
  }
  if (!confirm('اعتماد الفاتورة نهائيًا وإصدار الرقم التسلسلي؟')) return;

  try {
    const res = await apiFetch(`${API}/${currentInvoiceId}/approve`, { method: 'POST' });
    const result = await res.json();
    if (!res.ok) throw new Error(result.error || 'فشل الاعتماد');

    updateInvoiceStatusUI(result.status, result.serial_number);
    if (result.created_by_name) {
      document.getElementById('created_by_display').textContent = result.created_by_name;
      document.getElementById('created-by-wrap').style.display = '';
    }
    await loadQR(result.id);
    await loadPatientBalance();
    showToast(`تم اعتماد الفاتورة - ${result.serial_number}`, 'success');
  } catch (err) {
    showToast(err.message, 'danger');
  }
}

async function handleSave(e) {
  e.preventDefault();
  await saveInvoiceWithMode('draft');
}

async function loadQR(id) {
  try {
    const res = await apiFetch(`${API}/${id}/qr`);
    const data = await res.json();
    document.getElementById('qr-card').style.display = 'block';
    document.getElementById('qr-image').src = data.qr_data_url;
    document.getElementById('qr-serial').textContent = data.serial_number;
  } catch (err) {
    console.error(err);
  }
}

function downloadFile(format) {
  if (!currentInvoiceId) return;
  window.open(`${API}/${currentInvoiceId}/${format}`, '_blank');
}

function resetForm() {
  applyInvoiceFollowUpMode(false);
  currentInvoiceId = null;
  currentInvoiceReturns = [];
  renderInvoiceReturnsHistory([]);
  currentInvoiceStatus = null;
  document.getElementById('invoice-form').reset();
  document.getElementById('invoice-id').value = '';
  document.getElementById('form-title').textContent = 'إنشاء فاتورة جديدة';
  document.getElementById('issue_date').value = new Date().toISOString().slice(0, 10);
  updateInvoiceStatusUI(null);
  document.getElementById('captain_name').value = 'نقيب / عمرو صالح محمد';
  document.getElementById('manager_name').value = 'رائد / جمال عبد الناصر - المدير المالي';
  document.getElementById('admin_expenses_percent').value = formatAmountInput(12);
  document.getElementById('stamp_duty').value = formatAmountInput(0);
  document.getElementById('professional_fees').value = formatAmountInput(0);
  patientAccountBalance = null;
  document.getElementById('balance').value = formatAmountInput(0);
  syncPatientBalanceField();
  const creditDisplay = document.getElementById('patient_credit_total_display');
  if (creditDisplay) creditDisplay.value = '0';
  document.getElementById('patient-balance-hint').style.display = 'none';
  document.getElementById('patient-balance-after-hint')?.style && (document.getElementById('patient-balance-after-hint').style.display = 'none');
  document.getElementById('patient-credit-wrap').style.display = 'none';
  loadStayTypes().then(() => initStayEntries());
  ['download-pdf-btn', 'download-docx-btn', 'preview-btn'].forEach((id) => {
    document.getElementById(id).style.display = 'none';
  });
  document.getElementById('qr-card').style.display = 'none';
  document.getElementById('created-by-wrap').style.display = 'none';
  document.getElementById('created_by_display').textContent = '';
  document.getElementById('letter_from_date').value = '';
  document.getElementById('letter_to_date').value = '';
  loadPaymentMethodsForm();
  toggleContractedFields();
  initRows();
  bindCalcTriggers();
  recalculate();
}

async function loadInvoiceForEdit(id, options = {}) {
  try {
    const res = await apiFetch(`${API}/${id}`);
    const inv = await res.json();
    if (!res.ok) throw new Error(inv.error);

    currentInvoiceId = inv.id;
    switchView('create', { keepForm: true });

    const followUp = options.followUp === true || isDailySourcedInvoice(inv);
    applyInvoiceFollowUpMode(followUp && inv.status !== 'approved');

    document.getElementById('invoice-id').value = inv.id;
    if (followUp) {
      document.getElementById('form-title').textContent = inv.serial_number
        ? `متابعة الفاتورة ${inv.serial_number}`
        : `متابعة الفاتورة #${inv.id}`;
    } else {
      document.getElementById('form-title').textContent = 'تعديل الفاتورة';
    }
    updateInvoiceStatusUI(inv.status, inv.serial_number);

    document.getElementById('invoice_type').value = inv.invoice_type;
    toggleContractedFields();
    await loadContractedEntities(inv.contracted_entity_id || null);
    if (inv.contracted_entity_id) {
      document.getElementById('contracted_entity_id').value = inv.contracted_entity_id;
    }
    document.getElementById('discount_percent_display').value = inv.discount_percent || 0;
    document.getElementById('letter_from_date').value = fmtDate(inv.letter_from_date);
    document.getElementById('letter_to_date').value = fmtDate(inv.letter_to_date);
    if (inv.created_by_name) {
      document.getElementById('created_by_display').textContent = inv.created_by_name;
      document.getElementById('created-by-wrap').style.display = '';
    } else {
      document.getElementById('created-by-wrap').style.display = 'none';
    }
    document.getElementById('patient_name').value = inv.patient_name;
    document.getElementById('file_number').value = inv.file_number || '';
    await loadPatientBalance();
    document.getElementById('issue_date').value = fmtDate(inv.issue_date || inv.created_at);
    document.getElementById('admission_date').value = fmtDate(inv.admission_date);
    document.getElementById('discharge_date').value = fmtDate(inv.discharge_date);
    document.getElementById('stay_days').value = inv.stay_days != null && inv.stay_days !== '' ? formatAmountInput(inv.stay_days, 0) : '';
    await loadFinancialTreatments({ financial_treatment: inv.financial_treatment || '' });
    await loadStayTypes();
    initStayEntries(inv.stay_entries || []);
    document.getElementById('notes').value = inv.notes || '';
    document.getElementById('stamp_duty').value = formatAmountInput(inv.stamp_duty ?? 0);
    document.getElementById('professional_fees').value = formatAmountInput(inv.professional_fees ?? 0);
    if (!inv.file_number) {
      document.getElementById('balance').value = formatAmountInput(inv.balance ?? 0);
    }
    document.getElementById('admin_expenses_percent').value = formatAmountInput(inv.admin_expenses_percent ?? 0);

    const paymentValues = {};
    if (inv.method_payments?.length) {
      inv.method_payments.forEach((m) => {
        paymentValues[m.payment_method_id] = m.amount;
      });
    } else {
      paymentValues.cash = inv.cash_private;
      paymentValues.bank_transfer = inv.bank_private;
      paymentValues.check = inv.cash_external;
    }
    await loadPaymentMethodsForm(paymentValues);

    document.getElementById('employee_name').value = inv.employee_name;
    document.getElementById('auditor_name').value = inv.auditor_name;
    document.getElementById('captain_name').value = inv.captain_name;
    document.getElementById('manager_name').value = inv.manager_name;

    const maxLen = Math.max((inv.items || []).length, (inv.payments || []).length, 12);
    initRows(maxLen);

    const rows = document.querySelectorAll('#items-tbody tr');
    for (let i = 0; i < maxLen; i++) {
      const item = inv.items[i] || {};
      const pay = inv.payments[i] || {};
      const row = rows[i];
      if (!row) continue;
      row.querySelector('[data-field="description"]').value = item.description || '';
      const itemIdEl = row.querySelector('[data-field="invoice_item_id"]');
      if (itemIdEl) itemIdEl.value = item.id || '';
      const serviceIdEl = row.querySelector('[data-field="service_id"]');
      if (serviceIdEl) serviceIdEl.value = item.service_id || '';
      if (item.discountable_snapshot === false) row.dataset.discountOverride = 'false';
      else if (item.discountable_snapshot === true) row.dataset.discountOverride = 'true';
      else delete row.dataset.discountOverride;
      row.querySelector('[data-field="quantity"]').value = item.quantity ? formatAmountInput(item.quantity, 0) : '';
      row.querySelector('[data-field="amount"]').value = item.amount ? formatAmountInput(item.amount) : '';
      const creditField = row.querySelector('[data-field="patient_credit_applied"]');
      if (creditField) creditField.value = item.patient_credit_applied ? formatAmountInput(item.patient_credit_applied) : '';
      const pctField = row.querySelector('[data-field="discount_percent"]');
      if (pctField) pctField.value = `${item.item_discount_percent || 0}%`;
      row.querySelector('[data-field="receipt_date"]').value = pay.receipt_date || '';
      row.querySelector('[data-field="receipt_number"]').value = pay.receipt_number || '';
      row.querySelector('[data-field="pay_amount"]').value = pay.amount ? formatAmountInput(pay.amount) : '';
      if (item.daily_entry_line_id) row.dataset.dailyLineId = item.daily_entry_line_id;
      if (item.daily_entry_id) row.dataset.dailyEntryId = item.daily_entry_id;
      updateInvoiceReturnHint(row, item);
    }

    currentInvoiceReturns = inv.returns || [];
    renderInvoiceReturnsHistory(currentInvoiceReturns);

    ['download-pdf-btn', 'download-docx-btn', 'preview-btn'].forEach((id) => {
      document.getElementById(id).style.display = inv.status === 'approved' ? 'inline-block' : 'none';
    });

    if (inv.status === 'approved') {
      setFormReadonly(true);
    } else {
      setFormReadonly(!(can('invoices.create') || can('invoices.edit')));
    }

    bindCalcTriggers();
    await recalculate();
    if (invoiceFollowUpMode) lockDailyInvoiceRows();
    if (inv.status === 'approved') loadQR(inv.id);
    updateInvoiceActionButtons();
  } catch (err) {
    showToast(err.message, 'danger');
  }
}

function switchView(view, options = {}) {
  if (view === 'create' && !options.keepForm) {
    void openInvoiceFollowUpView();
    return;
  }
  document.querySelectorAll('.view-section').forEach((s) => (s.style.display = 'none'));
  document.getElementById(`view-${view}`).style.display = 'block';
  document.querySelectorAll('.nav-btn').forEach((b) => b.classList.toggle('active', b.dataset.view === view));

  if (view === 'list') loadInvoicesList();
  if (view === 'reports') {
    populateReportTypeFilter();
    updateReportFiltersUI();
    loadReports();
  }
  if (view === 'settings') loadSettingsPage();
  if (view === 'daily' && typeof initDailyChargesView === 'function') initDailyChargesView();
}

function populateReportTypeFilter() {
  const select = document.getElementById('report-type-filter');
  if (!select || select.options.length > 1) return;
  Object.entries(invoiceTypeLabels).forEach(([code, label]) => {
    select.insertAdjacentHTML('beforeend', `<option value="${code}">${label}</option>`);
  });
}

function updateReportFiltersUI() {
  const isPatientReport = currentReportType === 'patient_status';
  const isDoctorReport = currentReportType === 'doctors';
  document.getElementById('report-patient-wrap').style.display = isPatientReport ? '' : 'none';
  document.getElementById('report-invoice-type-wrap').style.display = isPatientReport ? '' : 'none';
  document.getElementById('report-doctor-filters-wrap').style.display = isDoctorReport ? '' : 'none';
  document.getElementById('report-doctor-specialty-wrap').style.display = isDoctorReport ? '' : 'none';
  document.getElementById('report-doctor-id-wrap').style.display = isDoctorReport ? '' : 'none';
  document.getElementById('report-doctor-file-wrap').style.display = isDoctorReport ? '' : 'none';
  if (isDoctorReport && typeof loadDoctorReportFilters === 'function') loadDoctorReportFilters();
}

function getReportQueryParams() {
  const params = new URLSearchParams();
  const from = document.getElementById('report-from')?.value;
  const to = document.getElementById('report-to')?.value;
  const type = document.getElementById('report-type-filter')?.value;
  if (from) params.set('from', from);
  if (to) params.set('to', to);
  if (type) params.set('type', type);

  if (currentReportType === 'patient_status') {
    const rawSearch = document.getElementById('report-patient-search')?.value.trim();
    const fileNumber = selectedPatientFileNumber || (rawSearch?.includes('—') ? rawSearch.split('—')[0].trim() : rawSearch);
    if (fileNumber) {
      if (/[\u0600-\u06FF]/.test(fileNumber) && !selectedPatientFileNumber) {
        params.set('patient_search', fileNumber);
      } else {
        params.set('file_number', fileNumber);
      }
    } else if (rawSearch) {
      params.set('patient_search', rawSearch);
    }
  }

  if (currentReportType === 'doctors') {
    const from = document.getElementById('report-from')?.value;
    const to = document.getElementById('report-to')?.value;
    if (from) params.set('from_date', from);
    if (to) params.set('to_date', to);
    const dept = document.getElementById('report-doctor-department')?.value;
    const spec = document.getElementById('report-doctor-specialty')?.value;
    const docId = document.getElementById('report-doctor-id')?.value;
    const file = document.getElementById('report-doctor-file')?.value?.trim();
    if (dept) params.set('department', dept);
    if (spec) params.set('specialty', spec);
    if (docId) params.set('doctor_id', docId);
    if (file) params.set('file_number', file);
  }
  return params;
}

function exportCurrentReport() {
  const params = getReportQueryParams();
  if (currentReportType === 'doctors') {
    window.open(`/api/doctors/reports/export?${params}`, '_blank');
    return;
  }
  params.set('report', currentReportType);
  window.open(`${API}/reports/export?${params}`, '_blank');
}

async function loadDoctorReportFilters() {
  try {
    const [deptRes, specRes, docRes] = await Promise.all([
      apiFetch('/api/doctors/departments?all=1'),
      apiFetch('/api/doctors/specialties?all=1'),
      apiFetch('/api/doctors?all=1'),
    ]);
    const departments = await deptRes.json();
    const specialties = await specRes.json();
    const doctors = await docRes.json();
    const deptSel = document.getElementById('report-doctor-department');
    const specSel = document.getElementById('report-doctor-specialty');
    const docSel = document.getElementById('report-doctor-id');
    if (deptSel) {
      deptSel.innerHTML =
        '<option value="">كل الأقسام</option>' +
        departments.map((d) => `<option value="${escapeHtml(d)}">${escapeHtml(d)}</option>`).join('');
    }
    if (specSel) {
      specSel.innerHTML =
        '<option value="">كل التخصصات</option>' +
        specialties.map((s) => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join('');
    }
    if (docSel) {
      docSel.innerHTML =
        '<option value="">كل الأطباء</option>' +
        doctors.map((d) => `<option value="${d.id}">${escapeHtml(d.name)} — ${escapeHtml(d.specialty)}</option>`).join('');
    }
  } catch {
    /* ignore */
  }
}

async function loadUsers() {
  if (!can('users.*')) return;
  await loadPermissionCatalog();
  try {
    const res = await apiFetch(USERS_API);
    const users = await res.json();
    document.getElementById('users-list').innerHTML = users
      .map((u) => {
        const permLabels = (u.permissions || [])
          .map((key) => permissionCatalog.find((p) => p.key === key)?.label || key)
          .slice(0, 6)
          .join('، ');
        const more = (u.permissions || []).length > 6 ? ` +${u.permissions.length - 6}` : '';
        return `
      <tr>
        <td class="fw-bold">${u.username}</td>
        <td>${u.full_name || '-'}</td>
        <td><span class="badge bg-primary">${u.role_label}</span></td>
        <td>
          <small class="text-muted d-block mb-1">${permLabels}${more}</small>
          <button class="btn btn-sm btn-outline-secondary" onclick="editUserPermissions(${u.id})">⚙️ الصلاحيات</button>
        </td>
        <td>${u.username !== 'admin' ? `<button class="btn btn-sm btn-outline-danger" onclick="removeSystemUser(${u.id})">🗑️</button>` : ''}</td>
      </tr>`;
      })
      .join('');
  } catch (err) {
    console.error(err);
  }
}

async function editUserPermissions(userId) {
  try {
    const res = await apiFetch(USERS_API);
    const users = await res.json();
    const user = users.find((u) => u.id === userId);
    if (!user) return;

    const modalId = `user-perm-modal-${userId}`;
    let modal = document.getElementById(modalId);
    if (!modal) {
      document.body.insertAdjacentHTML(
        'beforeend',
        `<div class="modal fade" id="${modalId}" tabindex="-1">
          <div class="modal-dialog modal-lg modal-dialog-scrollable">
            <div class="modal-content">
              <div class="modal-header"><h5 class="modal-title fw-black">صلاحيات: ${user.username}</h5>
                <button type="button" class="btn-close" data-bs-dismiss="modal"></button></div>
              <div class="modal-body">
                <div class="mb-2">
                  <label class="form-label fw-bold">الدور</label>
                  <select class="form-select form-select-sm" id="${modalId}-role">
                    <option value="user">مستخدم</option>
                    <option value="reviewer">مراجع مالي</option>
                    <option value="admin">مدير النظام</option>
                  </select>
                </div>
                <div id="${modalId}-permissions"></div>
              </div>
              <div class="modal-footer">
                <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">إلغاء</button>
                <button type="button" class="btn btn-primary fw-bold" id="${modalId}-save">حفظ</button>
              </div>
            </div>
          </div>
        </div>`
      );
      modal = document.getElementById(modalId);
    }

    document.getElementById(`${modalId}-role`).value = user.role;
    renderPermissionCheckboxes(`${modalId}-permissions`, user.custom_permissions?.length ? user.custom_permissions : user.permissions, `u${userId}`);
    document.getElementById(`${modalId}-role`).onchange = () => {
      renderPermissionCheckboxes(`${modalId}-permissions`, getDefaultPermissionsForRole(document.getElementById(`${modalId}-role`).value), `u${userId}`);
    };
    document.getElementById(`${modalId}-save`).onclick = async () => {
      const role = document.getElementById(`${modalId}-role`).value;
      const custom_permissions = collectSelectedPermissions(`${modalId}-permissions`, `u${userId}`);
      const updateRes = await apiFetch(`${USERS_API}/${userId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role, custom_permissions }),
      });
      const data = await updateRes.json();
      if (!updateRes.ok) throw new Error(data.error);
      bootstrap.Modal.getInstance(modal).hide();
      showToast('تم تحديث الصلاحيات', 'success');
      loadUsers();
    };

    new bootstrap.Modal(modal).show();
  } catch (err) {
    showToast(err.message, 'danger');
  }
}

async function addUser() {
  const username = document.getElementById('new-user-name').value.trim();
  const full_name = document.getElementById('new-user-fullname').value.trim();
  const password = document.getElementById('new-user-pass').value;
  const role = document.getElementById('new-user-role').value;
  const custom_permissions = collectSelectedPermissions('new-user-permissions', 'new');
  if (!username || !password) return showToast('اسم المستخدم وكلمة المرور مطلوبان', 'warning');
  try {
    const res = await apiFetch(USERS_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, full_name, password, role, custom_permissions }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    document.getElementById('new-user-name').value = '';
    document.getElementById('new-user-fullname').value = '';
    document.getElementById('new-user-pass').value = '';
    showToast('تم إضافة المستخدم', 'success');
    loadUsers();
  } catch (err) {
    showToast(err.message, 'danger');
  }
}

async function removeSystemUser(id) {
  if (!confirm('حذف المستخدم؟')) return;
  try {
    const res = await apiFetch(`${USERS_API}/${id}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('فشل الحذف');
    showToast('تم الحذف', 'success');
    loadUsers();
  } catch (err) {
    showToast(err.message, 'danger');
  }
}

function fmtDate(d) {
  if (!d) return '';
  return String(d).slice(0, 10);
}

function renderStayTypesList(items) {
  if (!items.length) return '<li class="list-group-item text-muted">لا توجد أنواع إقامة</li>';
  return items
    .map(
      (item) => `
    <li class="list-group-item admin-lookup-item ${item.is_active ? '' : 'is-inactive'}">
      <div class="d-flex justify-content-between align-items-center gap-2 flex-wrap">
        <div class="flex-grow-1">
          <input type="text" class="form-control form-control-sm fw-bold admin-lookup-name"
            data-id="${item.id}" data-kind="stay" value="${escapeAttr(item.name)}">
          <small class="text-muted">سعر اليوم الافتراضي</small>
        </div>
        <div class="d-flex gap-1 align-items-center flex-wrap">
          <input type="text" inputmode="decimal" class="form-control form-control-sm fw-bold comma-amount" style="width:110px"
            id="stay-rate-${item.id}" value="${formatAmountInput(item.daily_rate || 0)}">
          <button type="button" class="btn btn-sm btn-outline-primary" onclick="saveStayTypeItem(${item.id})">💾</button>
          <button type="button" class="btn btn-sm btn-outline-${item.is_active ? 'warning' : 'success'}"
            onclick="toggleLookupItem('stay', ${item.id}, ${!item.is_active})">${item.is_active ? '⏸️' : '▶️'}</button>
          <button type="button" class="btn btn-sm btn-outline-danger" onclick="deleteLookupItem('stay', ${item.id})">🗑️</button>
        </div>
      </div>
    </li>`
    )
    .join('');
}

async function saveStayTypeItem(id) {
  const nameInput = document.querySelector(`.admin-lookup-name[data-kind="stay"][data-id="${id}"]`);
  const rateInput = document.getElementById(`stay-rate-${id}`);
  const name = nameInput?.value.trim();
  const daily_rate = parseDisplayAmount(rateInput?.value);
  if (!name) return showToast('اسم نوع الإقامة مطلوب', 'warning');
  try {
    const res = await apiFetch(`${SETTINGS_API}/stay-types/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, daily_rate }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    showToast('تم الحفظ', 'success');
    loadSettingsPage();
    loadStayTypes();
  } catch (err) {
    showToast(err.message, 'danger');
  }
}

async function loadStayTypes() {
  try {
    const res = await apiFetch(`${SETTINGS_API}/stay-types`);
    const types = await res.json();
    stayTypesCache = types;
    document.querySelectorAll('.stay-type-select').forEach((select) => {
      const current = select.value;
      select.innerHTML = buildStayTypeOptions(current);
    });
    return types;
  } catch (err) {
    console.error(err);
    return [];
  }
}

async function loadInvoiceTypes() {
  try {
    const res = await apiFetch(`${SETTINGS_API}/invoice-types`);
    const types = await res.json();
    invoiceTypeLabels = {};
    types.forEach((t) => {
      invoiceTypeLabels[t.code] = t.name;
    });

    const select = document.getElementById('invoice_type');
    const current = select.value;
    select.innerHTML =
      '<option value="">-- اختر النوع --</option>' +
      types.map((t) => `<option value="${t.code}">${t.name}</option>`).join('');
    if (current) select.value = current;

    const filter = document.getElementById('list-type-filter');
    const filterCurrent = filter.value;
    filter.innerHTML =
      '<option value="">كل الأنواع</option>' +
      types.map((t) => `<option value="${t.code}">${t.name}</option>`).join('');
    if (filterCurrent) filter.value = filterCurrent;
  } catch (err) {
    console.error(err);
  }
}

async function loadFinancialTreatments(selected = {}) {
  try {
    const items = await apiJson(`${SETTINGS_API}/financial-treatments`);

    const fillSelect = (selectId, value) => {
      const select = document.getElementById(selectId);
      if (!select) return;
      select.innerHTML =
        '<option value="">-- اختر --</option>' +
        items.map((t) => `<option value="${escapeAttr(t.name)}">${escapeHtml(t.name)}</option>`).join('');
      if (value) {
        if (!items.some((t) => t.name === value)) {
          select.insertAdjacentHTML(
            'beforeend',
            `<option value="${escapeAttr(value)}">${escapeHtml(value)}</option>`
          );
        }
        select.value = value;
      }
    };

    fillSelect('financial_treatment', selected.financial_treatment);
    fillSelect('daily-stay-financial', selected.daily_stay_financial ?? selected.financial_treatment);
  } catch (err) {
    console.error(err);
  }
}

async function loadPaymentMethodsForm(values = {}) {
  try {
    const res = await apiFetch(`${SETTINGS_API}/payment-methods`);
    const methods = await res.json();
    paymentMethodsCache = methods;

    const tbody = document.getElementById('payment-methods-tbody');
    const amountMethods = methods.filter((m) => m.accepts_amount !== false);
    const infoMethods = methods.filter((m) => m.accepts_amount === false);

    let html = amountMethods
      .map((m, i) => {
        const val = values[m.id] ?? values[m.code] ?? 0;
        const displayVal = val ? formatAmountInput(val) : '';
        const isPatientCredit = m.code === 'patient_credit';
        const readonlyAttr = isPatientCredit ? 'readonly' : '';
        const extraClass = isPatientCredit ? ' bg-light' : '';
        const actionCell = isPatientCredit
          ? '<span class="text-muted small">—</span>'
          : `<button type="button" class="btn btn-outline-success btn-sm fw-bold pay-remaining-btn" data-method-code="${m.code}">الباقي</button>`;
        const labelSuffix = isPatientCredit ? ' <small class="text-muted">(تلقائي من البيان)</small>' : '';
        return `<tr class="payment-method-row" data-method-code="${m.code}">
          <td class="fw-bold">${i + 1} - ${m.name}${labelSuffix}</td>
          <td><input type="text" inputmode="decimal" class="form-control form-control-sm payment-method-input comma-amount${extraClass}"
            data-method-id="${m.id}" data-method-code="${m.code}" data-method-name="${escapeAttr(m.name)}" value="${displayVal}" placeholder="0" ${readonlyAttr}></td>
          <td class="text-center">${actionCell}</td>
        </tr>
        <tr class="payment-row-remaining" style="display:none"><td colspan="3" class="remaining-hint-text py-1"></td></tr>`;
      })
      .join('');

    if (infoMethods.length) {
      html += infoMethods
        .map((m) => `<tr class="table-light"><td class="fw-bold text-muted" colspan="3">ℹ️ ${m.name}</td></tr>`)
        .join('');
    }

    tbody.innerHTML = html || '<tr><td colspan="3" class="text-muted text-center">لا توجد طرق دفع — أضفها من الإعدادات</td></tr>';
    bindCalcTriggers();
    updatePaymentRowHints();
  } catch (err) {
    console.error(err);
  }
}

function renderAdminLookupList(items, kind) {
  if (!items.length) return '<li class="list-group-item text-muted">لا توجد عناصر</li>';
  return items
    .map(
      (item) => `
    <li class="list-group-item admin-lookup-item ${item.is_active ? '' : 'is-inactive'}">
      <div class="d-flex justify-content-between align-items-center gap-2 flex-wrap">
        <div class="flex-grow-1">
          <input type="text" class="form-control form-control-sm fw-bold admin-lookup-name"
            data-id="${item.id}" data-kind="${kind}" value="${escapeAttr(item.name)}">
          ${item.code ? `<small class="text-muted d-block">${item.code}</small>` : ''}
          ${item.accepts_amount === false ? '<small class="text-muted d-block">بدون حقل مبلغ</small>' : ''}
        </div>
        <div class="btn-group btn-group-sm">
          <button type="button" class="btn btn-outline-primary" title="حفظ" onclick="saveLookupItem('${kind}', ${item.id})">💾</button>
          <button type="button" class="btn btn-outline-${item.is_active ? 'warning' : 'success'}" title="${item.is_active ? 'تعطيل' : 'تفعيل'}" onclick="toggleLookupItem('${kind}', ${item.id}, ${!item.is_active})">${item.is_active ? '⏸️' : '▶️'}</button>
          <button type="button" class="btn btn-outline-danger" title="حذف" onclick="deleteLookupItem('${kind}', ${item.id})">🗑️</button>
        </div>
      </div>
    </li>`
    )
    .join('');
}

function lookupEndpoint(kind, id = '') {
  const map = {
    stay: `${SETTINGS_API}/stay-types${id ? `/${id}` : ''}`,
    invoice: `${SETTINGS_API}/invoice-types${id ? `/${id}` : ''}`,
    payment: `${SETTINGS_API}/payment-methods${id ? `/${id}` : ''}`,
    entity: `${SETTINGS_API}/contracted-entities${id ? `/${id}` : ''}`,
    exclusion: `${SETTINGS_API}/discount-exclusions${id ? `/${id}` : ''}`,
    financial: `${SETTINGS_API}/financial-treatments${id ? `/${id}` : ''}`,
  };
  return map[kind];
}

async function saveLookupItem(kind, id) {
  const input = document.querySelector(`.admin-lookup-name[data-kind="${kind}"][data-id="${id}"]`);
  if (!input) return;
  const name = input.value.trim();
  if (!name) return showToast('الاسم مطلوب', 'warning');
  try {
    const res = await apiFetch(lookupEndpoint(kind, id), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    showToast('تم الحفظ', 'success');
    loadSettingsPage();
    if (kind === 'invoice') loadInvoiceTypes();
    if (kind === 'payment') loadPaymentMethodsForm();
    if (kind === 'stay') loadStayTypes();
    if (kind === 'entity') loadContractedEntities();
    if (kind === 'exclusion') recalculate();
    if (kind === 'financial') loadFinancialTreatments();
  } catch (err) {
    showToast(err.message, 'danger');
  }
}

async function toggleLookupItem(kind, id, isActive) {
  try {
    const res = await apiFetch(lookupEndpoint(kind, id), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_active: isActive }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    showToast(isActive ? 'تم التفعيل' : 'تم التعطيل', 'success');
    loadSettingsPage();
    if (kind === 'invoice') loadInvoiceTypes();
    if (kind === 'payment') loadPaymentMethodsForm();
    if (kind === 'stay') loadStayTypes();
    if (kind === 'entity') loadContractedEntities();
    if (kind === 'exclusion') recalculate();
    if (kind === 'financial') loadFinancialTreatments();
  } catch (err) {
    showToast(err.message, 'danger');
  }
}

async function deleteLookupItem(kind, id) {
  if (!confirm('حذف هذا العنصر؟')) return;
  try {
    const res = await apiFetch(lookupEndpoint(kind, id), { method: 'DELETE' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'فشل الحذف');
    showToast('تم الحذف', 'success');
    loadSettingsPage();
    if (kind === 'invoice') loadInvoiceTypes();
    if (kind === 'payment') loadPaymentMethodsForm();
    if (kind === 'stay') loadStayTypes();
    if (kind === 'entity') loadContractedEntities();
    if (kind === 'exclusion') recalculate();
    if (kind === 'financial') loadFinancialTreatments();
  } catch (err) {
    showToast(err.message, 'danger');
  }
}

async function loadContractedEntities(selectedId = null) {
  try {
    const res = await apiFetch(`${SETTINGS_API}/contracted-entities/tree`);
    const entities = await res.json();
    contractedEntitiesCache = entities;

    const select = document.getElementById('contracted_entity_id');
    const parentSelect = document.getElementById('new-entity-parent');
    const current = selectedId || select.value;

    const options = entities
      .map((e) => {
        const indent = '— '.repeat(e.depth || 0);
        const effective = getEffectiveDiscountFromCache(e.id);
        const discount = effective ? ` (${effective}%)` : '';
        return `<option value="${e.id}">${indent}${e.name}${discount}</option>`;
      })
      .join('');

    select.innerHTML = `<option value="">-- اختر الجهة --</option>${options}`;
    parentSelect.innerHTML = `<option value="">— جهة رئيسية —</option>${options}`;
    if (current) select.value = current;
    onContractedEntityChange();
  } catch (err) {
    console.error(err);
  }
}

function toggleContractedFields() {
  const isContracted = document.getElementById('invoice_type').value === 'contracted';
  document.getElementById('contracted-entity-wrap').style.display = isContracted ? '' : 'none';
  document.getElementById('contracted-discount-wrap').style.display = isContracted ? '' : 'none';
  document.getElementById('contracted-letter-wrap').style.display = isContracted ? '' : 'none';
  if (!isContracted) {
    document.getElementById('contracted_entity_id').value = '';
    document.getElementById('discount_percent_display').value = '0';
    document.getElementById('letter_from_date').value = '';
    document.getElementById('letter_to_date').value = '';
  } else {
    onContractedEntityChange();
  }
  recalculate();
}

function getEffectiveDiscountFromCache(entityId) {
  let current = contractedEntitiesCache.find((e) => e.id === Number(entityId));
  while (current) {
    const rate = Number(current.discount_percent) || 0;
    if (rate > 0) return rate;
    if (!current.parent_id) break;
    current = contractedEntitiesCache.find((e) => e.id === current.parent_id);
  }
  return 0;
}

function onContractedEntityChange() {
  const select = document.getElementById('contracted_entity_id');
  const entityId = select.value;
  const discount = entityId ? getEffectiveDiscountFromCache(entityId) : 0;
  document.getElementById('discount_percent_display').value = discount;
  recalculate();
}

function renderContractedEntitiesList(items) {
  if (!items.length) return '<li class="list-group-item text-muted">لا توجد جهات</li>';
  return items
    .map((item) => {
      const indent = '&nbsp;'.repeat((item.depth || 0) * 4);
      return `
    <li class="list-group-item admin-lookup-item ${item.is_active ? '' : 'is-inactive'}">
      <div class="d-flex justify-content-between align-items-center gap-2 flex-wrap">
        <div class="flex-grow-1">
          <div class="fw-bold">${indent}${item.name}</div>
          <small class="text-muted">خصم: ${item.discount_percent || 0}%</small>
        </div>
        <div class="d-flex gap-1 align-items-center flex-wrap">
          <input type="text" class="form-control form-control-sm fw-bold admin-lookup-name" style="max-width:180px"
            data-id="${item.id}" data-kind="entity" value="${escapeAttr(item.name)}">
          <input type="text" inputmode="decimal" class="form-control form-control-sm comma-amount" style="width:80px"
            id="entity-discount-${item.id}" value="${formatAmountInput(item.discount_percent || 0)}">
          <button type="button" class="btn btn-sm btn-outline-primary" onclick="saveEntityItem(${item.id})">💾</button>
          <button type="button" class="btn btn-sm btn-outline-${item.is_active ? 'warning' : 'success'}"
            onclick="toggleLookupItem('entity', ${item.id}, ${!item.is_active})">${item.is_active ? '⏸️' : '▶️'}</button>
          <button type="button" class="btn btn-sm btn-outline-danger" onclick="deleteLookupItem('entity', ${item.id})">🗑️</button>
        </div>
      </div>
    </li>`;
    })
    .join('');
}

async function saveEntityItem(id) {
  const nameInput = document.querySelector(`.admin-lookup-name[data-kind="entity"][data-id="${id}"]`);
  const discountInput = document.getElementById(`entity-discount-${id}`);
  const name = nameInput?.value.trim();
  const discount_percent = parseDisplayAmount(discountInput?.value);
  if (!name) return showToast('اسم الجهة مطلوب', 'warning');
  try {
    const res = await apiFetch(`${SETTINGS_API}/contracted-entities/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, discount_percent }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    showToast('تم الحفظ', 'success');
    loadSettingsPage();
  } catch (err) {
    showToast(err.message, 'danger');
  }
}

async function addContractedEntity() {
  const name = document.getElementById('new-entity-name').value.trim();
  const parent_id = document.getElementById('new-entity-parent').value || null;
  const discount_percent = parseDisplayAmount(document.getElementById('new-entity-discount').value);
  if (!name) return showToast('اسم الجهة مطلوب', 'warning');
  try {
    const res = await apiFetch(`${SETTINGS_API}/contracted-entities`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, parent_id, discount_percent }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    document.getElementById('new-entity-name').value = '';
    document.getElementById('new-entity-discount').value = '';
    showToast('تمت الإضافة', 'success');
    loadSettingsPage();
  } catch (err) {
    showToast(err.message, 'danger');
  }
}

async function addDiscountExclusion() {
  const name = document.getElementById('new-exclusion-name').value.trim();
  if (!name) return showToast('اسم البند مطلوب', 'warning');
  try {
    const res = await apiFetch(`${SETTINGS_API}/discount-exclusions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    document.getElementById('new-exclusion-name').value = '';
    showToast('تمت الإضافة', 'success');
    loadSettingsPage();
  } catch (err) {
    showToast(err.message, 'danger');
  }
}

async function loadSettingsPage() {
  try {
    const [settingsRes, stayRes, invoiceRes, paymentRes, entityRes, exclusionRes, financialRes] =
      await Promise.all([
      apiFetch(SETTINGS_API),
      apiFetch(`${SETTINGS_API}/stay-types?all=1`),
      apiFetch(`${SETTINGS_API}/invoice-types?all=1`),
      apiFetch(`${SETTINGS_API}/payment-methods?all=1`),
      apiFetch(`${SETTINGS_API}/contracted-entities/tree?all=1`),
      apiFetch(`${SETTINGS_API}/discount-exclusions?all=1`),
      apiFetch(`${SETTINGS_API}/financial-treatments?all=1`),
    ]);
    const settings = await settingsRes.json();
    const stayTypes = await stayRes.json();
    const invoiceTypes = await invoiceRes.json();
    const paymentMethods = await paymentRes.json();
    const entities = await entityRes.json();
    const exclusions = await exclusionRes.json();
    const financialTreatments = await financialRes.json();

    if (settings.logo_url) {
      document.getElementById('logo-preview').src = settings.logo_url;
      const navbarLogo = document.getElementById('navbar-logo');
      const loginLogo = document.getElementById('login-logo');
      if (navbarLogo) navbarLogo.src = settings.logo_url;
      if (loginLogo) loginLogo.src = settings.logo_url;
    }

    document.getElementById('stay-types-list').innerHTML = renderStayTypesList(stayTypes);
    document.getElementById('financial-treatments-list').innerHTML = renderAdminLookupList(
      financialTreatments,
      'financial'
    );
    document.getElementById('invoice-types-list').innerHTML = renderAdminLookupList(invoiceTypes, 'invoice');
    document.getElementById('payment-methods-list').innerHTML = renderAdminLookupList(paymentMethods, 'payment');
    document.getElementById('contracted-entities-list').innerHTML = renderContractedEntitiesList(entities);
    document.getElementById('discount-exclusions-list').innerHTML = renderAdminLookupList(exclusions, 'exclusion');
    bindCommaAmountInputs(document.getElementById('stay-types-list'));
    bindCommaAmountInputs(document.getElementById('contracted-entities-list'));

    await loadInvoiceTypes();
    await loadFinancialTreatments();
    await loadStayTypes();
    await loadPaymentMethodsForm();
    await loadContractedEntities();
    loadUsers();
    if (can('settings.*')) await loadPricingSection();
    if (can('settings.*')) await loadBackupSection();
    if (typeof loadDoctorsSection === 'function') await loadDoctorsSection();
    if (typeof loadItemCatalogSection === 'function') await loadItemCatalogSection();
  } catch (err) {
    showToast('خطأ في تحميل الإعدادات', 'danger');
  }
}

function formatBackupBytes(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

function formatBackupDate(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString('ar-EG');
}

async function loadBackupSection() {
  if (!can('settings.*')) return;
  try {
    const res = await apiFetch(`${SETTINGS_API}/backup`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'تعذر تحميل حالة النسخ الاحتياطي');

    const set = (id, text) => {
      const el = document.getElementById(id);
      if (el) el.textContent = text;
    };

    set('backup-last-attempt', formatBackupDate(data.last_attempt_at));
    const statusEl = document.getElementById('backup-last-status');
    if (statusEl) {
      statusEl.textContent = data.last_status || '—';
      statusEl.className = `fw-bold ${data.last_status === 'success' ? 'text-success' : data.last_status === 'failed' ? 'text-danger' : ''}`;
    }
    set('backup-last-success', formatBackupDate(data.last_success_at));
    set('backup-last-size', data.last_size_bytes ? formatBackupBytes(data.last_size_bytes) : '—');
    set('backup-dir', data.backup_dir || '—');
    set('backup-retained-count', String(data.retained_count ?? '—'));
    set('backup-next-scheduled', formatBackupDate(data.next_scheduled_at));
    set('backup-last-file', data.last_file || '—');

    const errEl = document.getElementById('backup-last-error');
    if (errEl) {
      if (data.last_failure_message) {
        errEl.style.display = '';
        errEl.textContent = data.last_failure_message;
      } else {
        errEl.style.display = 'none';
        errEl.textContent = '';
      }
    }
  } catch (err) {
    showToast(err.message, 'danger');
  }
}

async function runManualBackup() {
  if (!can('settings.*')) return showToast('ليس لديك صلاحية', 'warning');
  const btn = document.getElementById('backup-run-btn');
  const resultEl = document.getElementById('backup-manual-result');
  if (btn) btn.disabled = true;
  if (resultEl) {
    resultEl.style.display = 'none';
    resultEl.textContent = '';
  }
  try {
    const res = await apiFetch(`${SETTINGS_API}/backup/run`, { method: 'POST' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'فشل النسخ الاحتياطي');
    await loadBackupSection();
    if (resultEl) {
      resultEl.style.display = '';
      if (data.success) {
        resultEl.className = 'col-12 text-success fw-bold';
        resultEl.textContent = `تم النسخ بنجاح: ${data.filename || ''} (${formatBackupBytes(data.size_bytes)}) — تم التحقق`;
      } else {
        resultEl.className = 'col-12 text-danger fw-bold';
        resultEl.textContent = data.error || 'فشل النسخ الاحتياطي';
      }
    }
    showToast(data.success ? 'تم النسخ الاحتياطي بنجاح' : data.error || 'فشل النسخ', data.success ? 'success' : 'danger');
  } catch (err) {
    showToast(err.message, 'danger');
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function uploadLogo() {
  const fileInput = document.getElementById('logo-file');
  if (!fileInput.files.length) return showToast('اختر ملف الشعار', 'warning');

  const form = new FormData();
  form.append('logo', fileInput.files[0]);

  try {
    const res = await apiFetch(`${SETTINGS_API}/logo`, { method: 'POST', body: form });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    document.getElementById('logo-preview').src = data.logo_url;
    const navbarLogo = document.getElementById('navbar-logo');
    const loginLogo = document.getElementById('login-logo');
    if (navbarLogo) navbarLogo.src = data.logo_url;
    if (loginLogo) loginLogo.src = data.logo_url;
    showToast('تم رفع الشعار بنجاح', 'success');
    fileInput.value = '';
  } catch (err) {
    showToast(err.message, 'danger');
  }
}

async function addStayType() {
  const input = document.getElementById('new-stay-type');
  const rateInput = document.getElementById('new-stay-rate');
  const name = input.value.trim();
  const daily_rate = parseDisplayAmount(rateInput?.value);
  if (!name) return showToast('اكتب اسم نوع الإقامة', 'warning');

  try {
    const res = await apiFetch(`${SETTINGS_API}/stay-types`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, daily_rate }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    input.value = '';
    if (rateInput) rateInput.value = '';
    showToast('تمت الإضافة', 'success');
    loadSettingsPage();
    loadStayTypes();
  } catch (err) {
    showToast(err.message, 'danger');
  }
}

async function addFinancialTreatment() {
  const input = document.getElementById('new-financial-treatment');
  const name = input?.value.trim();
  if (!name) return showToast('اكتب اسم المعاملة المالية', 'warning');

  try {
    const res = await apiFetch(`${SETTINGS_API}/financial-treatments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    input.value = '';
    showToast('تمت الإضافة', 'success');
    loadSettingsPage();
    loadFinancialTreatments();
  } catch (err) {
    showToast(err.message, 'danger');
  }
}

async function addInvoiceType() {
  const input = document.getElementById('new-invoice-type-name');
  const name = input.value.trim();
  if (!name) return showToast('اكتب اسم نوع الفاتورة', 'warning');

  try {
    const res = await apiFetch(`${SETTINGS_API}/invoice-types`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    input.value = '';
    showToast('تمت الإضافة', 'success');
    loadSettingsPage();
  } catch (err) {
    showToast(err.message, 'danger');
  }
}

async function addPaymentMethod() {
  const input = document.getElementById('new-payment-method-name');
  const name = input.value.trim();
  if (!name) return showToast('اكتب اسم طريقة الدفع', 'warning');

  try {
    const res = await apiFetch(`${SETTINGS_API}/payment-methods`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    input.value = '';
    showToast('تمت الإضافة', 'success');
    loadSettingsPage();
  } catch (err) {
    showToast(err.message, 'danger');
  }
}

async function loadInvoicesList() {
  const params = new URLSearchParams();
  const type = document.getElementById('list-type-filter').value;
  const status = document.getElementById('list-status-filter').value;
  const search = document.getElementById('list-search').value;
  const from = document.getElementById('list-from').value;
  const to = document.getElementById('list-to').value;
  if (type) params.set('type', type);
  if (status) params.set('status', status);
  if (search) params.set('search', search);
  if (from) params.set('from', from);
  if (to) params.set('to', to);

  try {
    const res = await apiFetch(`${API}?${params}`);
    const invoices = await res.json();
    const canEdit = can('invoices.edit');
    const canDelete = can('invoices.delete');
    const canApprove = can('invoices.approve');
    const tbody = document.getElementById('invoices-list');
    tbody.innerHTML = invoices.length
      ? invoices
          .map((inv) => {
            const statusInfo = STATUS_BADGES[inv.status] || { text: inv.status_label || inv.status, class: 'bg-secondary' };
            const serialCell =
              inv.status === 'approved' && inv.serial_number
                ? `<span class="fw-black text-primary">${inv.serial_number}</span>`
                : `<span class="text-muted">—</span>`;
            return `
        <tr>
          <td>${serialCell}<br><span class="badge ${statusInfo.class}">${statusInfo.text}</span></td>
          <td class="fw-bold">${inv.file_number || '-'}</td>
          <td>${inv.patient_name || '-'}</td>
          <td><span class="badge bg-secondary">${inv.invoice_type_label || invoiceTypeLabels[inv.invoice_type] || inv.invoice_type}</span></td>
          <td class="fw-bold">${fmtDual(inv.final_total_raw ?? inv.final_total, inv.final_total)}</td>
          <td>${fmtDual(inv.total_collected_raw ?? inv.total_collected, inv.total_collected)}</td>
          <td class="${inv.remaining > 0 ? 'text-danger fw-bold' : ''}">${fmtDual(inv.remaining_raw ?? inv.remaining, inv.remaining)}</td>
          <td>${inv.issue_date ? new Date(inv.issue_date).toLocaleDateString('ar-EG') : new Date(inv.created_at).toLocaleDateString('ar-EG')}</td>
          <td class="text-nowrap">
            <button class="btn btn-sm btn-outline-primary" onclick="loadInvoiceForEdit(${inv.id})">${canEdit ? '✏️' : '👁️'}</button>
            ${inv.status === 'approved' ? `<button class="btn btn-sm btn-outline-danger" onclick="window.open('${API}/${inv.id}/pdf')">📄</button>` : ''}
            ${canApprove && inv.status === 'pending_review' ? `<button class="btn btn-sm btn-outline-success" onclick="quickApproveInvoice(${inv.id})">✅</button>` : ''}
            ${canDelete && inv.status !== 'approved' ? `<button class="btn btn-sm btn-outline-danger" onclick="deleteInvoice(${inv.id})">🗑️</button>` : ''}
          </td>
        </tr>`;
          })
          .join('')
      : '<tr><td colspan="9" class="text-center py-4">لا توجد فواتير</td></tr>';
  } catch (err) {
    showToast('خطأ في تحميل الفواتير', 'danger');
  }
}

async function quickApproveInvoice(id) {
  if (!confirm('اعتماد هذه الفاتورة؟')) return;
  try {
    const res = await apiFetch(`${API}/${id}/approve`, { method: 'POST' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    showToast(`تم الاعتماد - ${data.serial_number}`, 'success');
    loadInvoicesList();
  } catch (err) {
    showToast(err.message, 'danger');
  }
}

async function deleteInvoice(id) {
  if (!confirm('هل أنت متأكد من حذف هذه الفاتورة؟')) return;
  try {
    const res = await apiFetch(`${API}/${id}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('فشل الحذف');
    showToast('تم حذف الفاتورة', 'success');
    loadInvoicesList();
  } catch (err) {
    showToast(err.message, 'danger');
  }
}

async function loadReports() {
  const container = document.getElementById('reports-content');
  container.innerHTML = '<div class="col-12 text-center py-5"><div class="spinner-border text-primary"></div></div>';

  if (currentReportType === 'patient_status') {
    const search = document.getElementById('report-patient-search')?.value.trim();
    if (!search && !selectedPatientFileNumber) {
      container.innerHTML = `
        <div class="col-12">
          <div class="card shadow-sm patient-report-empty">
            <div class="card-body text-center py-5">
              <h5 class="fw-black mb-2">تقرير موقف مريض</h5>
              <p class="text-muted mb-0">أدخل رقم الملف أو اسم المريض في الأعلى ثم اضغط تحديث</p>
            </div>
          </div>
        </div>`;
      return;
    }
  }

  const params = getReportQueryParams();

  try {
    let endpoint = `${API}/reports/summary?${params}`;
    if (currentReportType === 'payments') endpoint = `${API}/reports/payments?${params}`;
    if (currentReportType === 'remaining') endpoint = `${API}/reports/remaining?${params}`;
    if (currentReportType === 'patient_status') endpoint = `${API}/reports/patient-status?${params}`;
    if (currentReportType === 'supplies_markup') endpoint = `${API}/reports/supplies-markup?${params}`;
    if (currentReportType === 'doctors') endpoint = `/api/doctors/reports/summary?${params}`;
    if (currentReportType === 'invoices') {
      params.set('approved_only', 'false');
      endpoint = `${API}?${params}`;
    }

    const res = await apiFetch(endpoint);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'خطأ');

    if (currentReportType === 'patient_status') {
      if (data.multiple_matches) {
        container.innerHTML = `
          <div class="col-12">
            <div class="card shadow-sm">
              <div class="card-header bg-warning text-dark fw-black">تم العثور على أكثر من مريض — اختر المطلوب</div>
              <div class="card-body p-0">
                <table class="table table-hover mb-0">
                  <thead class="table-light"><tr><th>رقم الملف</th><th>الاسم</th><th>عدد الفواتير</th><th>أول دخول</th><th></th></tr></thead>
                  <tbody>
                    ${data.matches
                      .map(
                        (m) => `
                      <tr>
                        <td class="fw-black">${m.file_number}</td>
                        <td>${m.patient_name || '-'}</td>
                        <td>${m.invoice_count}</td>
                        <td>${m.first_admission ? new Date(m.first_admission).toLocaleDateString('ar-EG') : '—'}</td>
                        <td><button class="btn btn-sm btn-primary fw-bold" onclick="selectPatientForReport('${escapeAttr(m.file_number)}', '${escapeAttr(m.patient_name || '')}')">عرض الموقف</button></td>
                      </tr>`
                      )
                      .join('')}
                  </tbody>
                </table>
              </div>
            </div>
          </div>`;
        return;
      }

      container.innerHTML = renderPatientStatusReport(data);
      return;
    }

    if (currentReportType === 'doctors') {
      const rows = data.rows || [];
      container.innerHTML = `
        <div class="col-12">
          <div class="card shadow-sm">
            <div class="card-header bg-info text-dark fw-black">تقرير الأطباء (داخلي)</div>
            <div class="card-body p-0">
              <table class="table table-striped mb-0">
                <thead class="table-light">
                  <tr><th>الطبيب</th><th>التخصص</th><th>القسم</th><th>زيارات</th><th>خدمات</th><th>إجمالي القيمة</th></tr>
                </thead>
                <tbody>
                  ${rows.length
                    ? rows
                        .map(
                          (r) =>
                            `<tr><td class="fw-bold">${escapeHtml(r.doctor_name)}</td><td>${escapeHtml(r.specialty)}</td><td>${escapeHtml(r.department)}</td><td>${r.visit_count}</td><td>${r.service_count}</td><td>${fmt(r.total_value)}</td></tr>`
                        )
                        .join('')
                    : '<tr><td colspan="6" class="text-center py-4">لا توجد بيانات</td></tr>'}
                </tbody>
                <tfoot class="table-warning">
                  <tr><td colspan="3" class="fw-black text-end">الإجمالي</td>
                  <td class="fw-black">${data.totals?.visit_count || 0}</td>
                  <td class="fw-black">${data.totals?.service_count || 0}</td>
                  <td class="fw-black">${fmt(data.totals?.total_value || 0)}</td></tr>
                </tfoot>
              </table>
            </div>
          </div>
        </div>`;
      return;
    }

    if (currentReportType === 'summary') {
      const typeCards = Object.entries(data.by_type)
        .filter(([, val]) => val.count > 0)
        .map(
          ([, val]) => `
        <div class="col-md-3">
          <div class="card report-card shadow-sm h-100">
            <div class="card-body text-center">
              <div class="report-label">${val.label}</div>
              <div class="report-stat text-primary">${val.count}</div>
              <div class="small fw-bold">فاتورة</div>
              <hr>
              <div class="d-flex justify-content-between small fw-bold"><span>الإجمالي:</span><span>${fmt(val.total)}</span></div>
              <div class="d-flex justify-content-between small fw-bold"><span>المحصل:</span><span>${fmt(val.collected)}</span></div>
              <div class="d-flex justify-content-between small fw-bold text-danger"><span>المتبقي:</span><span>${fmt(val.remaining)}</span></div>
            </div>
          </div>
        </div>`
        )
        .join('');

      const monthlyRows = (data.monthly || [])
        .map(
          (m) => `<tr>
          <td class="fw-bold">${m.month}</td><td>${m.count}</td><td>${fmt(m.total)}</td>
          <td>${fmt(m.collected)}</td><td class="text-danger">${fmt(m.remaining)}</td></tr>`
        )
        .join('');

      container.innerHTML = `
        <div class="col-md-3"><div class="card report-card shadow-sm"><div class="card-body text-center">
          <div class="report-label">فواتير معتمدة</div><div class="report-stat">${data.total_invoices}</div></div></div></div>
        <div class="col-md-3"><div class="card report-card shadow-sm"><div class="card-body text-center">
          <div class="report-label">إجمالي المبالغ</div><div class="report-stat text-success">${fmt(data.grand_total)}</div></div></div></div>
        <div class="col-md-3"><div class="card report-card shadow-sm"><div class="card-body text-center">
          <div class="report-label">إجمالي المحصل</div><div class="report-stat text-primary">${fmt(data.grand_collected)}</div></div></div></div>
        <div class="col-md-3"><div class="card report-card shadow-sm"><div class="card-body text-center">
          <div class="report-label">إجمالي المتبقي</div><div class="report-stat text-danger">${fmt(data.grand_remaining)}</div></div></div></div>
        ${typeCards}
        <div class="col-12"><div class="card shadow-sm mt-2"><div class="card-header bg-dark text-white fw-black">التقرير الشهري (فواتير معتمدة)</div>
          <div class="card-body p-0"><table class="table table-striped mb-0">
            <thead class="table-dark"><tr><th>الشهر</th><th>عدد</th><th>الإجمالي</th><th>المحصل</th><th>المتبقي</th></tr></thead>
            <tbody>${monthlyRows || '<tr><td colspan="5" class="text-center">لا توجد بيانات</td></tr>'}</tbody>
          </table></div></div></div>`;
      return;
    }

    if (currentReportType === 'supplies_markup') {
      const rows = (data.rows || [])
        .map(
          (row) => `<tr>
          <td>${row.entry_date ? new Date(row.entry_date).toLocaleDateString('ar-EG') : '—'}</td>
          <td class="fw-bold">${escapeHtml(row.file_number || '')}</td>
          <td>${escapeHtml(row.patient_name || '')}</td>
          <td>${escapeHtml(row.serial_number || '—')}</td>
          <td>${escapeHtml(row.item_code || '')}</td>
          <td>${escapeHtml(row.item_name || '')}</td>
          <td>${fmt(row.quantity, 0)}</td>
          <td>${row.cost_price != null ? fmt(row.cost_price) : '—'}</td>
          <td>${row.markup_percent != null ? fmt(row.markup_percent) + '%' : '—'}</td>
          <td>${fmt(row.selling_price)}</td>
          <td>${fmt(row.unit_margin)}</td>
          <td class="text-success fw-bold">${fmt(row.margin_amount)}</td>
          <td>${fmt(row.line_total)}</td>
        </tr>`
        )
        .join('');
      container.innerHTML = `
        <div class="col-md-3"><div class="card report-card shadow-sm"><div class="card-body text-center">
          <div class="report-label">عدد البنود</div><div class="report-stat">${data.totals?.row_count || 0}</div></div></div></div>
        <div class="col-md-3"><div class="card report-card shadow-sm"><div class="card-body text-center">
          <div class="report-label">إجمالي التكلفة</div><div class="report-stat">${fmt(data.totals?.total_cost || 0)}</div></div></div></div>
        <div class="col-md-3"><div class="card report-card shadow-sm"><div class="card-body text-center">
          <div class="report-label">إجمالي البيع</div><div class="report-stat text-primary">${fmt(data.totals?.total_selling || 0)}</div></div></div></div>
        <div class="col-md-3"><div class="card report-card shadow-sm"><div class="card-body text-center">
          <div class="report-label">إجمالي الهامش</div><div class="report-stat text-success">${fmt(data.totals?.total_margin || 0)}</div></div></div></div>
        <div class="col-12"><div class="card shadow-sm"><div class="card-header bg-dark text-white fw-black">تقرير هامش المستلزمات</div>
          <div class="card-body p-0"><table class="table table-striped table-sm mb-0">
            <thead class="table-dark"><tr>
              <th>التاريخ</th><th>الملف</th><th>المريض</th><th>الفاتورة</th><th>كود</th><th>الصنف</th>
              <th>الكمية</th><th>سعر التكلفة</th><th>نسبة الربح %</th><th>سعر البيع</th>
              <th>هامش الوحدة</th><th>مبلغ الهامش</th><th>إجمالي البند</th>
            </tr></thead>
            <tbody>${rows || '<tr><td colspan="13" class="text-center py-4">لا توجد بيانات</td></tr>'}</tbody>
          </table></div></div></div>`;
      return;
    }

    if (currentReportType === 'invoices') {
      const rows = (Array.isArray(data) ? data : [])
        .map((inv) => {
          const st = STATUS_BADGES[inv.status] || { text: inv.status, class: 'bg-secondary' };
          return `<tr>
            <td>${inv.serial_number || '—'}</td>
            <td><span class="badge ${st.class}">${st.text}</span></td>
            <td>${inv.file_number || '-'}</td>
            <td>${inv.patient_name || '-'}</td>
            <td>${inv.invoice_type_label || invoiceTypeLabels[inv.invoice_type] || inv.invoice_type}</td>
            <td>${fmt(inv.final_total)}</td>
            <td>${fmt(inv.total_collected)}</td>
            <td class="text-danger">${fmt(inv.remaining)}</td>
          </tr>`;
        })
        .join('');
      container.innerHTML = `<div class="col-12"><div class="card shadow-sm"><div class="card-header bg-dark text-white fw-black">تقرير الفواتير</div>
        <div class="card-body p-0"><table class="table table-striped mb-0">
          <thead class="table-dark"><tr><th>الرقم</th><th>الحالة</th><th>الملف</th><th>المريض</th><th>النوع</th><th>الإجمالي</th><th>المحصل</th><th>المتبقي</th></tr></thead>
          <tbody>${rows || '<tr><td colspan="8" class="text-center py-4">لا توجد بيانات</td></tr>'}</tbody>
        </table></div></div></div>`;
      return;
    }

    const isPayments = currentReportType === 'payments';
    const rows = (Array.isArray(data) ? data : [])
      .map((r) =>
        isPayments
          ? `<tr><td>${r.serial_number}</td><td>${r.file_number || '-'}</td><td>${r.patient_name || '-'}</td>
             <td>${r.issue_date || '-'}</td><td>${fmt(r.final_total)}</td><td>${fmt(r.cash_private)}</td>
             <td>${fmt(r.bank_private)}</td><td>${fmt(r.cash_external)}</td><td>${fmt(r.patient_credit_applied)}</td>
             <td>${fmt(r.total_collected)}</td><td class="text-danger">${fmt(r.remaining)}</td></tr>`
          : `<tr><td>${r.serial_number}</td><td>${r.file_number || '-'}</td><td>${r.patient_name || '-'}</td>
             <td>${r.issue_date || '-'}</td><td>${fmt(r.final_total)}</td><td>${fmt(r.total_collected)}</td>
             <td class="text-danger fw-bold">${fmt(r.remaining)}</td></tr>`
      )
      .join('');

    const title = isPayments ? 'تقرير المدفوعات' : 'تقرير المتبقي';
    const head = isPayments
      ? '<th>الرقم</th><th>الملف</th><th>المريض</th><th>التاريخ</th><th>الإجمالي</th><th>نقدي</th><th>تحويل</th><th>شيك</th><th>خصم رصيد</th><th>المحصل</th><th>المتبقي</th>'
      : '<th>الرقم</th><th>الملف</th><th>المريض</th><th>التاريخ</th><th>الإجمالي</th><th>المحصل</th><th>المتبقي</th>';

    container.innerHTML = `<div class="col-12"><div class="card shadow-sm"><div class="card-header bg-dark text-white fw-black">${title}</div>
      <div class="card-body p-0"><table class="table table-striped mb-0">
        <thead class="table-dark"><tr>${head}</tr></thead>
        <tbody>${rows || '<tr><td colspan="11" class="text-center py-4">لا توجد بيانات</td></tr>'}</tbody>
      </table></div></div></div>`;
  } catch (err) {
    container.innerHTML = `<div class="col-12 text-center text-danger py-5">${err.message || 'خطأ في تحميل التقارير'}</div>`;
  }
}

function renderPatientStatusReport(data) {
  const stayBadge = data.stay.is_still_admitted
    ? '<span class="badge bg-info">لا يزال بالمركز</span>'
    : data.stay.latest_discharge
      ? '<span class="badge bg-secondary">خرج</span>'
      : '<span class="badge bg-light text-dark border">غير محدد</span>';

  const invoiceRows = (data.invoices || [])
    .map((inv) => {
      const st = STATUS_BADGES[inv.status] || { text: inv.status_label, class: 'bg-secondary' };
      const paymentLines = (inv.payments || [])
        .map(
          (pay) =>
            `<div class="small text-muted">📄 ${pay.receipt_date ? new Date(pay.receipt_date).toLocaleDateString('ar-EG') : '—'} — ${pay.receipt_number || 'بدون رقم'} — ${fmt(pay.amount)}</div>`
        )
        .join('');
      return `<tr>
        <td>${inv.serial_number || `<span class="text-muted">مسودة #${inv.id}</span>`}</td>
        <td><span class="badge ${st.class}">${st.text}</span></td>
        <td>${inv.invoice_type_label}</td>
        <td>${inv.issue_date ? new Date(inv.issue_date).toLocaleDateString('ar-EG') : '—'}</td>
        <td>${inv.admission_date ? new Date(inv.admission_date).toLocaleDateString('ar-EG') : '—'}</td>
        <td>${inv.discharge_date ? new Date(inv.discharge_date).toLocaleDateString('ar-EG') : '—'}</td>
        <td>${inv.stay_days || 0}</td>
        <td class="fw-bold">${fmt(inv.final_total)}</td>
        <td>${fmt(inv.total_collected)}</td>
        <td>${fmt(inv.patient_credit_applied)}</td>
        <td class="${inv.remaining > 0 ? 'text-danger fw-bold' : ''}">${fmt(inv.remaining)}</td>
        <td>${paymentLines || '<span class="text-muted small">—</span>'}</td>
      </tr>`;
    })
    .join('');

  const txRows = (data.transactions || [])
    .map(
      (tx) => `<tr>
      <td>${new Date(tx.created_at).toLocaleDateString('ar-EG')}</td>
      <td class="${Number(tx.amount) < 0 ? 'text-danger' : 'text-success'} fw-bold">${fmt(tx.amount)}</td>
      <td>${fmt(tx.balance_after)}</td>
      <td>${tx.serial_number || '—'}</td>
      <td>${tx.note || '—'}</td>
    </tr>`
    )
    .join('');

  return `
    <div class="col-12">
      <div class="card shadow-sm patient-report-card mb-3">
        <div class="card-header bg-primary text-white d-flex justify-content-between align-items-center flex-wrap gap-2">
          <h5 class="mb-0 fw-black">موقف المريض: ${data.patient.name || '—'}</h5>
          ${stayBadge}
        </div>
        <div class="card-body">
          <div class="row g-3">
            <div class="col-md-3"><div class="patient-stat-box"><span>رقم الملف</span><strong>${data.patient.file_number}</strong></div></div>
            <div class="col-md-3"><div class="patient-stat-box"><span>تاريخ الدخول</span><strong>${data.stay.earliest_admission ? new Date(data.stay.earliest_admission).toLocaleDateString('ar-EG') : '—'}</strong></div></div>
            <div class="col-md-3"><div class="patient-stat-box"><span>تاريخ الخروج</span><strong>${data.stay.latest_discharge ? new Date(data.stay.latest_discharge).toLocaleDateString('ar-EG') : '—'}</strong></div></div>
            <div class="col-md-3"><div class="patient-stat-box"><span>مدة الإقامة</span><strong>${data.stay.duration_label}</strong></div></div>
            <div class="col-md-3"><div class="patient-stat-box"><span>أيام الإقامة (مجموع)</span><strong>${data.stay.total_stay_days || 0} يوم</strong></div></div>
            <div class="col-md-3"><div class="patient-stat-box"><span>رصيد الحساب</span><strong class="text-success">${fmt(data.patient.account_balance)}</strong></div></div>
            <div class="col-md-3"><div class="patient-stat-box"><span>عدد الفواتير</span><strong>${data.totals.invoices_count}</strong></div></div>
            <div class="col-md-3"><div class="patient-stat-box"><span>معتمدة / مسودة / مراجعة</span><strong>${data.totals.approved_count} / ${data.totals.draft_count} / ${data.totals.pending_count}</strong></div></div>
          </div>
        </div>
      </div>
    </div>
    <div class="col-md-3"><div class="card report-card shadow-sm h-100"><div class="card-body text-center">
      <div class="report-label">إجمالي الفواتير</div><div class="report-stat text-success">${fmt(data.totals.total_billed)}</div></div></div></div>
    <div class="col-md-3"><div class="card report-card shadow-sm h-100"><div class="card-body text-center">
      <div class="report-label">إجمالي المحصل</div><div class="report-stat text-primary">${fmt(data.totals.total_collected)}</div></div></div></div>
    <div class="col-md-3"><div class="card report-card shadow-sm h-100"><div class="card-body text-center">
      <div class="report-label">خصم من الرصيد</div><div class="report-stat">${fmt(data.totals.total_credit_applied)}</div></div></div></div>
    <div class="col-md-3"><div class="card report-card shadow-sm h-100"><div class="card-body text-center">
      <div class="report-label">المتبقي</div><div class="report-stat text-danger">${fmt(data.totals.total_remaining)}</div></div></div></div>
    <div class="col-12">
      <div class="card shadow-sm">
        <div class="card-header bg-dark text-white fw-black">فواتير المريض والمدفوعات</div>
        <div class="card-body p-0 table-responsive">
          <table class="table table-striped mb-0 patient-report-table">
            <thead class="table-light">
              <tr>
                <th>الرقم</th><th>الحالة</th><th>النوع</th><th>الإصدار</th><th>الدخول</th><th>الخروج</th><th>الأيام</th>
                <th>الإجمالي</th><th>المحصل</th><th>خصم الرصيد</th><th>المتبقي</th><th>إيصالات الدفع</th>
              </tr>
            </thead>
            <tbody>${invoiceRows || '<tr><td colspan="12" class="text-center py-4">لا توجد فواتير</td></tr>'}</tbody>
          </table>
        </div>
      </div>
    </div>
    ${
      txRows
        ? `<div class="col-12"><div class="card shadow-sm"><div class="card-header bg-secondary text-white fw-black">حركة رصيد الحساب</div>
      <div class="card-body p-0 table-responsive"><table class="table table-sm mb-0">
        <thead class="table-light"><tr><th>التاريخ</th><th>الحركة</th><th>الرصيد بعد</th><th>الفاتورة</th><th>البيان</th></tr></thead>
        <tbody>${txRows}</tbody>
      </table></div></div></div>`
        : ''
    }`;
}

function selectPatientForReport(fileNumber, patientName) {
  selectedPatientFileNumber = fileNumber;
  const input = document.getElementById('report-patient-search');
  if (input) input.value = `${fileNumber}${patientName ? ` — ${patientName}` : ''}`;
  loadReports();
}

function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  const text = sanitizeApiErrorMessage(message);
  const now = Date.now();
  if (
    type === 'danger' &&
    showToast._lastDanger &&
    showToast._lastDanger.text === text &&
    now - showToast._lastDanger.time < 3000
  ) {
    return;
  }
  if (type === 'danger') {
    showToast._lastDanger = { text, time: now };
  }
  const id = 'toast-' + now;
  container.insertAdjacentHTML(
    'beforeend',
    `<div id="${id}" class="toast align-items-center text-bg-${type} border-0" role="alert">
      <div class="d-flex"><div class="toast-body fw-bold">${escapeHtml(text)}</div>
      <button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast"></button></div></div>`
  );
  const toast = new bootstrap.Toast(document.getElementById(id), { delay: 4000 });
  toast.show();
}

function debounce(fn, ms) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

async function ensureDefaultPriceListId() {
  if (currentPricingListId) return currentPricingListId;
  try {
    const res = await apiFetch(`${PRICING_API}/lists/default`);
    if (!res.ok) return null;
    const list = await res.json();
    currentPricingListId = list.id;
    return currentPricingListId;
  } catch {
    return null;
  }
}

async function loadPricingSection() {
  if (!can('settings.*')) return;
  try {
    const [listsRes, settingsRes, defaultRes] = await Promise.all([
      apiFetch(`${PRICING_API}/lists?all=1`),
      apiFetch(`${PRICING_API}/settings`),
      apiFetch(`${PRICING_API}/lists/default`),
    ]);
    pricingListsCache = listsRes.ok ? await listsRes.json() : [];
    const settings = settingsRes.ok ? await settingsRes.json() : {};
    const defaultList = defaultRes.ok ? await defaultRes.json() : null;
    currentPricingListId = defaultList?.id || pricingListsCache.find((l) => l.is_default)?.id || pricingListsCache[0]?.id || null;

    const listSelect = document.getElementById('pricing-list-select');
    if (listSelect) {
      listSelect.innerHTML = pricingListsCache
        .map((l) => `<option value="${l.id}" ${l.id === currentPricingListId ? 'selected' : ''}>${escapeHtml(l.name)}</option>`)
        .join('');
    }

    document.getElementById('pricing-admin-fee-rate').value = formatAmountInput(settings.administrative_fee_rate ?? 12);
    document.getElementById('pricing-file-opening-fee').value = formatAmountInput(settings.file_opening_fee ?? 50);
    document.getElementById('pricing-ambulance-fee').value = formatAmountInput(settings.ambulance_rental_cairo ?? 3000);
    document.getElementById('pricing-foreign-resident').value = formatAmountInput(settings.foreign_resident_multiplier ?? 150);
    document.getElementById('pricing-foreign-non-resident').value = formatAmountInput(settings.foreign_non_resident_multiplier ?? 200);
    bindCommaAmountInputs(document.getElementById('pricing-settings-card'));

    await loadPricingCategories();
    await loadPricingServices();
    renderPricingStats(defaultList);
  } catch (err) {
    showToast('خطأ في تحميل الأسعار', 'danger');
  }
}

function renderPricingStats(listMeta) {
  const statsRow = document.getElementById('pricing-stats-row');
  if (!statsRow) return;
  const services = pricingServicesCache;
  const discountableCount = services.filter((s) => s.discountable).length;
  const nonDiscountableCount = services.filter((s) => !s.discountable).length;
  statsRow.innerHTML = `
    <div class="col-md-2"><div class="pricing-stat-box"><span>الأقسام</span><strong>${fmtInt(pricingCategoriesCache.length)}</strong></div></div>
    <div class="col-md-2"><div class="pricing-stat-box"><span>الخدمات</span><strong>${fmtInt(services.length)}</strong></div></div>
    <div class="col-md-2"><div class="pricing-stat-box"><span>تخضع للخصم</span><strong>${fmtInt(discountableCount)}</strong></div></div>
    <div class="col-md-2"><div class="pricing-stat-box"><span>غير خاضعة</span><strong>${fmtInt(nonDiscountableCount)}</strong></div></div>
    <div class="col-md-4"><div class="pricing-stat-box"><span>اللائحة الافتراضية</span><strong>${escapeHtml(listMeta?.name || '—')}</strong></div></div>`;
  const note = document.getElementById('pricing-footer-note');
  if (note) {
    const count = listMeta?.services_count ?? services.length;
    note.textContent = count
      ? `إجمالي الخدمات في اللائحة: ${count} — ابحث عنها في حقل «البيان» أثناء إنشاء الفاتورة`
      : 'اللائحة فارغة — ارفع ملف DOCX من الزر أعلاه ثم اضغط تحديث';
  }
  renderPricingImportStatus(listMeta);
}

function renderPricingImportStatus(listMeta) {
  const statusEl = document.getElementById('pricing-import-status');
  if (!statusEl) return;
  const count = listMeta?.services_count ?? pricingServicesCache.length ?? 0;
  if (count > 0) {
    statusEl.style.display = '';
    statusEl.className = 'alert alert-success py-2 mb-3';
    statusEl.innerHTML = `<strong>✓ اللائحة جاهزة:</strong> ${listMeta?.name || 'لائحة 2026-2027'} — <strong>${count}</strong> خدمة و<strong>${listMeta?.categories_count ?? pricingCategoriesCache.length ?? 0}</strong> قسم`;
  } else {
    statusEl.style.display = '';
    statusEl.className = 'alert alert-warning py-2 mb-3';
    statusEl.textContent = 'لم يتم استيراد اللائحة بعد — ارفع ملف DOCX من الزر «استيراد DOCX/JSON/CSV»';
  }
}

async function loadPricingCategories() {
  if (!currentPricingListId) return;
  const res = await apiFetch(`${PRICING_API}/categories?price_list_id=${currentPricingListId}&all=1`);
  pricingCategoriesCache = res.ok ? await res.json() : [];
  const filter = document.getElementById('pricing-category-filter');
  const editSelect = document.getElementById('service-edit-category');
  const options = ['<option value="">— كل الأقسام —</option>']
    .concat(pricingCategoriesCache.map((c) => `<option value="${c.id}">${escapeHtml(c.name)}</option>`))
    .join('');
  if (filter) filter.innerHTML = options;
  if (editSelect) {
    editSelect.innerHTML = pricingCategoriesCache
      .map((c) => `<option value="${c.id}">${escapeHtml(c.name)}</option>`)
      .join('');
  }
}

async function loadPricingServices() {
  if (!currentPricingListId) return;
  const search = document.getElementById('pricing-search')?.value?.trim() || '';
  const categoryId = document.getElementById('pricing-category-filter')?.value || '';
  const params = new URLSearchParams({ price_list_id: currentPricingListId, all: '1', limit: '500' });
  if (search) params.set('search', search);
  if (categoryId) params.set('category_id', categoryId);
  const res = await apiFetch(`${PRICING_API}/services?${params}`);
  pricingServicesCache = res.ok ? await res.json() : [];
  renderPricingServicesTable();
  renderPricingStats(pricingListsCache.find((l) => l.id === currentPricingListId));
}

function renderPricingServicesTable() {
  const tbody = document.getElementById('pricing-services-tbody');
  if (!tbody) return;
  if (!pricingServicesCache.length) {
    tbody.innerHTML = '<tr><td colspan="9" class="text-center text-muted py-4">لا توجد خدمات — استورد ملف DOCX أو أضف خدمة يدوياً</td></tr>';
    return;
  }
  tbody.innerHTML = pricingServicesCache
    .map(
      (svc) => `<tr class="${svc.is_active ? '' : 'inactive-row'}">
        <td>${escapeHtml(svc.code)}</td>
        <td>${escapeHtml(svc.category_name || '—')}</td>
        <td>${escapeHtml(svc.name)}</td>
        <td>${escapeHtml(svc.unit || 'مرة')}</td>
        <td>${fmt(Number(svc.price) || 0)}</td>
        <td>${svc.discountable ? 'نعم' : 'لا'}</td>
        <td>${svc.administrative_fee_applicable ? 'نعم' : 'لا'}</td>
        <td>${escapeHtml(svc.price_type || 'fixed')}</td>
        <td><button type="button" class="btn btn-sm btn-outline-primary fw-bold" onclick="openServiceEditor(${svc.id})">تعديل</button></td>
      </tr>`
    )
    .join('');
}

async function onPricingListChange() {
  currentPricingListId = Number(document.getElementById('pricing-list-select').value) || null;
  await loadPricingCategories();
  await loadPricingServices();
}

async function savePricingSettings() {
  try {
    const body = {
      administrative_fee_rate: parseDisplayAmount(document.getElementById('pricing-admin-fee-rate').value),
      file_opening_fee: parseDisplayAmount(document.getElementById('pricing-file-opening-fee').value),
      ambulance_rental_cairo: parseDisplayAmount(document.getElementById('pricing-ambulance-fee').value),
      foreign_resident_multiplier: parseDisplayAmount(document.getElementById('pricing-foreign-resident').value),
      foreign_non_resident_multiplier: parseDisplayAmount(document.getElementById('pricing-foreign-non-resident').value),
    };
    const res = await apiFetch(`${PRICING_API}/settings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    showToast('تم حفظ إعدادات الأسعار', 'success');
  } catch (err) {
    showToast(err.message, 'danger');
  }
}

async function exportPricingExcel() {
  if (!currentPricingListId) return;
  window.open(`${PRICING_API}/services-export?price_list_id=${currentPricingListId}`, '_blank');
}

async function exportPricingCsv() {
  if (!currentPricingListId) return;
  window.open(`${PRICING_API}/services-export?price_list_id=${currentPricingListId}&format=csv`, '_blank');
}

async function importPricingFile(e) {
  const file = e.target.files?.[0];
  if (!file) return;
  const replaceExisting = document.getElementById('pricing-import-replace')?.checked;
  const statusEl = document.getElementById('pricing-import-status');
  if (statusEl) {
    statusEl.style.display = '';
    statusEl.className = 'alert alert-info py-2 mb-3';
    statusEl.textContent = `جاري استيراد ${file.name}...`;
  }
  const form = new FormData();
  form.append('file', file);
  form.append('replace_existing', replaceExisting ? 'true' : 'false');
  try {
    const lower = file.name.toLowerCase();
    let res;
    if (lower.endsWith('.json')) {
      const text = await file.text();
      const payload = JSON.parse(text);
      payload.replace_existing = !!replaceExisting;
      res = await apiFetch(`${PRICING_API}/import-json`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    } else if (lower.endsWith('.csv')) {
      const csvForm = new FormData();
      csvForm.append('file', file);
      if (currentPricingListId) csvForm.append('price_list_id', currentPricingListId);
      res = await apiFetch(`${PRICING_API}/import-csv`, { method: 'POST', body: csvForm });
    } else {
      res = await apiFetch(`${PRICING_API}/import-docx`, { method: 'POST', body: form });
    }
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    const servicesCount = data.services_count || data.serviceCount || data.imported || 0;
    const categoriesCount = data.categories_count || data.categoryCount || 0;
    const msg = `تم استيراد ${servicesCount} خدمة${categoriesCount ? ` في ${categoriesCount} قسم` : ''} من ملف ${file.name}`;
    showToast(msg, 'success');
    if (statusEl) {
      statusEl.style.display = '';
      statusEl.className = 'alert alert-success py-2 mb-3';
      statusEl.innerHTML = `<strong>✓ ${msg}</strong><br><small class="text-muted">الآن يمكنك البحث عن الخدمات في حقل «البيان» أثناء إنشاء الفاتورة</small>`;
    }
    e.target.value = '';
    await loadPricingSection();
    await loadStayTypes();
    await loadCatalogCache();
  } catch (err) {
    showToast(err.message, 'danger');
    if (statusEl) {
      statusEl.style.display = '';
      statusEl.className = 'alert alert-danger py-2 mb-3';
      statusEl.textContent = `فشل الاستيراد: ${err.message}`;
    }
    e.target.value = '';
  }
}

async function cloneCurrentPriceList() {
  if (!currentPricingListId) return;
  const name = prompt('اسم النسخة الجديدة من اللائحة:', 'لائحة جديدة');
  if (!name) return;
  try {
    const res = await apiFetch(`${PRICING_API}/lists/${currentPricingListId}/clone`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, code: `PL-${Date.now()}`, is_default: false }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    showToast('تم إنشاء نسخة جديدة من اللائحة', 'success');
    await loadPricingSection();
  } catch (err) {
    showToast(err.message, 'danger');
  }
}

async function openServiceEditor(id = null) {
  if (!serviceEditModal) {
    serviceEditModal = new bootstrap.Modal(document.getElementById('service-edit-modal'));
  }
  document.getElementById('service-edit-id').value = id || '';
  document.getElementById('service-edit-title').textContent = id ? 'تعديل خدمة' : 'إضافة خدمة';
  document.getElementById('service-edit-reason').value = '';
  document.getElementById('service-edit-components').innerHTML = '';
  document.getElementById('service-edit-components-wrap').style.display = 'none';

  if (id) {
    const res = await apiFetch(`${PRICING_API}/services/${id}`);
    const svc = await res.json();
    if (!res.ok) return showToast(svc.error || 'خطأ', 'danger');
    document.getElementById('service-edit-category').value = svc.category_id || '';
    document.getElementById('service-edit-code').value = svc.code || '';
    document.getElementById('service-edit-name').value = svc.name || '';
    document.getElementById('service-edit-unit').value = svc.unit || 'مرة';
    document.getElementById('service-edit-price').value = svc.price != null ? formatAmountInput(svc.price) : '';
    document.getElementById('service-edit-price-type').value = svc.price_type || 'fixed';
    document.getElementById('service-edit-discountable').checked = !!svc.discountable;
    document.getElementById('service-edit-admin-fee').checked = !!svc.administrative_fee_applicable;
    document.getElementById('service-edit-active').checked = svc.is_active !== false;
    document.getElementById('service-edit-notes').value = svc.notes || '';
    renderServiceComponentsEditor(svc.components || []);
    toggleServiceComponentsEditor();
  } else {
    document.getElementById('service-edit-code').value = '';
    document.getElementById('service-edit-name').value = '';
    document.getElementById('service-edit-unit').value = 'مرة';
    document.getElementById('service-edit-price').value = '';
    document.getElementById('service-edit-price-type').value = 'fixed';
    document.getElementById('service-edit-discountable').checked = true;
    document.getElementById('service-edit-admin-fee').checked = true;
    document.getElementById('service-edit-active').checked = true;
    document.getElementById('service-edit-notes').value = '';
  }
  bindCommaAmountInputs(document.getElementById('service-edit-modal'));
  serviceEditModal.show();
}

function toggleServiceComponentsEditor() {
  const type = document.getElementById('service-edit-price-type').value;
  const wrap = document.getElementById('service-edit-components-wrap');
  wrap.style.display = type === 'composite' ? '' : 'none';
}

function renderServiceComponentsEditor(components = []) {
  const container = document.getElementById('service-edit-components');
  if (!components.length) {
    components = [
      { code: 'SURGEON', name: 'أجر الجراح', amount: 0, discountable: false, administrative_fee_applicable: false },
      { code: 'ASSISTANT', name: 'أجر المساعد', amount: 0, discountable: false, administrative_fee_applicable: false },
      { code: 'ANESTHESIA', name: 'أجر التخدير', amount: 0, discountable: false, administrative_fee_applicable: false },
      { code: 'TOTAL', name: 'الإجمالي', amount: 0, discountable: true, administrative_fee_applicable: true, is_total: true },
    ];
  }
  container.innerHTML = components
    .map(
      (c, i) => `<div class="row g-1 mb-1 component-row" data-index="${i}">
        <div class="col-md-4"><input class="form-control form-control-sm fw-bold comp-name" value="${escapeAttr(c.name || '')}"></div>
        <div class="col-md-3"><input type="text" inputmode="decimal" class="form-control form-control-sm fw-bold comp-amount comma-amount" value="${c.amount != null ? formatAmountInput(c.amount) : formatAmountInput(0)}"></div>
        <div class="col-md-2"><label class="small"><input type="checkbox" class="comp-discountable" ${c.discountable !== false ? 'checked' : ''}> خصم</label></div>
        <div class="col-md-2"><label class="small"><input type="checkbox" class="comp-admin" ${c.administrative_fee_applicable !== false ? 'checked' : ''}> إداري</label></div>
        <div class="col-md-1"><label class="small"><input type="checkbox" class="comp-total" ${c.is_total ? 'checked' : ''}> ∑</label></div>
      </div>`
    )
    .join('');
  bindCommaAmountInputs(container);
}

function collectServiceComponentsFromEditor() {
  return [...document.querySelectorAll('#service-edit-components .component-row')].map((row, sort_order) => ({
    name: row.querySelector('.comp-name')?.value || '',
    amount: parseDisplayAmount(row.querySelector('.comp-amount')?.value),
    discountable: row.querySelector('.comp-discountable')?.checked ?? true,
    administrative_fee_applicable: row.querySelector('.comp-admin')?.checked ?? true,
    is_total: row.querySelector('.comp-total')?.checked ?? false,
    sort_order,
  }));
}

async function saveServiceEditor() {
  const id = document.getElementById('service-edit-id').value;
  const body = {
    category_id: Number(document.getElementById('service-edit-category').value) || null,
    code: document.getElementById('service-edit-code').value.trim(),
    name: document.getElementById('service-edit-name').value.trim(),
    unit: document.getElementById('service-edit-unit').value.trim() || 'مرة',
    price: parseDisplayAmount(document.getElementById('service-edit-price').value),
    price_type: document.getElementById('service-edit-price-type').value,
    discountable: document.getElementById('service-edit-discountable').checked,
    administrative_fee_applicable: document.getElementById('service-edit-admin-fee').checked,
    is_active: document.getElementById('service-edit-active').checked,
    notes: document.getElementById('service-edit-notes').value,
    change_reason: document.getElementById('service-edit-reason').value || 'تعديل من لوحة التحكم',
    price_list_id: currentPricingListId,
  };
  if (body.price_type === 'composite') body.components = collectServiceComponentsFromEditor();
  if (!body.name) return showToast('اسم الخدمة مطلوب', 'warning');

  try {
    const res = await apiFetch(id ? `${PRICING_API}/services/${id}` : `${PRICING_API}/services`, {
      method: id ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    serviceEditModal?.hide();
    showToast('تم حفظ الخدمة', 'success');
    await loadPricingServices();
    await loadStayTypes();
  } catch (err) {
    showToast(err.message, 'danger');
  }
}

window.loadInvoiceForEdit = loadInvoiceForEdit;
window.loadFinancialTreatments = loadFinancialTreatments;
window.parseDisplayAmount = parseDisplayAmount;
window.formatAmountInput = formatAmountInput;
window.setCommaAmountValue = setCommaAmountValue;
window.bindCommaAmountInputs = bindCommaAmountInputs;
window.fmt = fmt;
window.fmtInt = fmtInt;
window.deleteInvoice = deleteInvoice;
window.quickApproveInvoice = quickApproveInvoice;
window.selectPatientForReport = selectPatientForReport;
window.editUserPermissions = editUserPermissions;
window.removeSystemUser = removeSystemUser;
window.saveLookupItem = saveLookupItem;
window.toggleLookupItem = toggleLookupItem;
window.deleteLookupItem = deleteLookupItem;
window.saveEntityItem = saveEntityItem;
window.openServiceEditor = openServiceEditor;
