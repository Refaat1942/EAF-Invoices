const API = '/api/invoices';
const SETTINGS_API = '/api/settings';
const AUTH_API = '/api/auth';
const USERS_API = '/api/users';
let currentInvoiceId = null;
let currentUser = null;
let rowCount = 12;

const fmt = (n) =>
  (Number(n) || 0).toLocaleString('ar-EG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const fmtInt = (n) => (Number(n) || 0).toLocaleString('ar-EG', { maximumFractionDigits: 0 });

function fmtDual(raw, rounded) {
  const r = Number(raw) || 0;
  const rd = Number(rounded) || 0;
  if (Math.round(r * 100) === Math.round(rd * 100)) return fmtInt(rd);
  return `<span class="dual-value"><span class="raw-part">${fmt(r)}</span> <span class="rounded-part">← ${fmtInt(rd)}</span></span>`;
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
  return fetch(url, { credentials: 'include', ...opts });
}

const TYPE_LABELS = {
  civil: 'مدني (خاص)',
  contracted: 'جهات متعاقدة',
  non_contracted: 'جهات غير متعاقدة',
  military: 'عسكري',
};

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('login-form').addEventListener('submit', handleLogin);
  document.getElementById('logout-btn').addEventListener('click', handleLogout);
  document.getElementById('add-user-btn').addEventListener('click', addUser);
  checkAuth();
});

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
  loadStayTypes();
  resetForm();
}

function applyPermissions() {
  const isAdmin = can('settings.*');
  document.getElementById('nav-settings').style.display = isAdmin ? '' : 'none';
  document.getElementById('users-settings-card').style.display = can('users.*') ? '' : 'none';

  const createBtn = document.querySelector('[data-view="create"]');
  if (createBtn) createBtn.style.display = can('invoices.create') || can('invoices.edit') ? '' : 'none';

  const canEdit = can('invoices.create') || can('invoices.edit');
  const saveBtn = document.querySelector('#invoice-form button[type="submit"]');
  if (saveBtn) saveBtn.style.display = canEdit ? '' : 'none';
  ['reset-form-btn', 'add-row-btn', 'remove-row-btn'].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.style.display = canEdit ? '' : 'none';
  });
  setFormReadonly(!canEdit);
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
    <td><input type="number" step="0.01" class="calc-trigger" data-field="amount" value=""></td>
    <td><input type="number" step="0.01" class="calc-trigger" data-field="quantity" value=""></td>
    <td><input type="text" class="desc-input calc-trigger" data-field="description"></td>
    <td><input type="number" step="0.01" class="pay-amt calc-trigger" data-field="pay_amount" value=""></td>
    <td><input type="text" class="pay-num calc-trigger" data-field="receipt_number"></td>
    <td><input type="date" class="pay-date calc-trigger" data-field="receipt_date"></td>
  `;
  return tr;
}

function bindEvents() {
  document.querySelectorAll('.nav-btn').forEach((btn) => {
    btn.addEventListener('click', () => switchView(btn.dataset.view));
  });

  document.getElementById('invoice-form').addEventListener('submit', handleSave);
  document.getElementById('reset-form-btn').addEventListener('click', resetForm);
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

  document.getElementById('admission_date').addEventListener('change', autoStayDays);
  document.getElementById('discharge_date').addEventListener('change', autoStayDays);

  document.getElementById('download-pdf-btn').addEventListener('click', () => downloadFile('pdf'));
  document.getElementById('download-docx-btn').addEventListener('click', () => downloadFile('docx'));
  document.getElementById('preview-btn').addEventListener('click', () => {
    if (currentInvoiceId) window.open(`${API}/${currentInvoiceId}/preview`, '_blank');
  });

  document.getElementById('list-refresh').addEventListener('click', loadInvoicesList);
  document.getElementById('list-search').addEventListener('input', debounce(loadInvoicesList, 300));
  document.getElementById('list-type-filter').addEventListener('change', loadInvoicesList);
  document.getElementById('list-from').addEventListener('change', loadInvoicesList);
  document.getElementById('list-to').addEventListener('change', loadInvoicesList);

  document.getElementById('upload-logo-btn').addEventListener('click', uploadLogo);
  document.getElementById('add-stay-type-btn').addEventListener('click', addStayType);
  document.getElementById('new-stay-type').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); addStayType(); }
  });

  bindCalcTriggers();
}

function bindCalcTriggers() {
  document.querySelectorAll('.calc-trigger').forEach((el) => {
    el.removeEventListener('input', recalculate);
    el.addEventListener('input', recalculate);
  });
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
    const desc = row.querySelector('[data-field="description"]').value.trim();
    const qty = parseFloat(row.querySelector('[data-field="quantity"]').value) || 0;
    const amt = parseFloat(row.querySelector('[data-field="amount"]').value) || 0;
    const payAmt = parseFloat(row.querySelector('[data-field="pay_amount"]').value) || 0;
    const receiptDate = row.querySelector('[data-field="receipt_date"]').value;
    const receiptNum = row.querySelector('[data-field="receipt_number"]').value;

    if (desc || qty || amt) {
      items.push({ description: desc, quantity: qty, amount: amt });
    }
    if (payAmt || receiptDate || receiptNum) {
      payments.push({ receipt_date: receiptDate, receipt_number: receiptNum, amount: payAmt });
    }
  });

  return {
    invoice_type: document.getElementById('invoice_type').value,
    issue_date: document.getElementById('issue_date').value,
    file_number: document.getElementById('file_number').value,
    patient_name: document.getElementById('patient_name').value,
    admission_date: document.getElementById('admission_date').value,
    discharge_date: document.getElementById('discharge_date').value,
    stay_days: document.getElementById('stay_days').value,
    financial_treatment: document.getElementById('financial_treatment').value,
    stay_type_ids: getSelectedStayTypeIds(),
    notes: document.getElementById('notes').value,
    stamp_duty: document.getElementById('stamp_duty').value,
    professional_fees: document.getElementById('professional_fees').value,
    balance: document.getElementById('balance').value,
    admin_expenses_percent: document.getElementById('admin_expenses_percent').value,
    cash_private: document.getElementById('cash_private').value,
    bank_private: document.getElementById('bank_private').value,
    cash_external: document.getElementById('cash_external').value,
    bank_external: document.getElementById('bank_external').value,
    employee_name: document.getElementById('employee_name').value,
    auditor_name: document.getElementById('auditor_name').value,
    captain_name: document.getElementById('captain_name').value,
    manager_name: document.getElementById('manager_name').value,
    items,
    payments,
  };
}

async function recalculate() {
  const data = collectFormData();

  document.querySelectorAll('#items-tbody tr').forEach((row) => {
    const qty = parseFloat(row.querySelector('[data-field="quantity"]').value) || 0;
    const amt = parseFloat(row.querySelector('[data-field="amount"]').value) || 0;
    const total = Math.round(qty * amt * 100) / 100;
    row.querySelector('[data-field="total"]').value = total ? fmt(total) : '';
  });

  try {
    const res = await apiFetch(`${API}/calculate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    const totals = await res.json();
    updateSummaryDisplay(totals);
    updateSummaryTable(totals);
  } catch (err) {
    console.error(err);
  }
}

function updateSummaryDisplay(t) {
  document.getElementById('sum_items').innerHTML = fmtDual(t.items_subtotal_raw, t.items_subtotal);
  document.getElementById('sum_fees').innerHTML = fmtDual(
    (t.stamp_duty_raw || 0) + (t.professional_fees_raw || 0),
    (t.stamp_duty || 0) + (t.professional_fees || 0)
  );
  document.getElementById('sum_admin').innerHTML = fmtDual(t.admin_expenses_raw, t.admin_expenses);
  document.getElementById('sum_after_admin').innerHTML = fmtDual(t.total_after_admin_raw, t.total_after_admin);
  document.getElementById('sum_final').innerHTML = fmtDual(t.final_total_raw, t.final_total);
  document.getElementById('sum_final_raw').textContent = fmt(t.final_total_raw);
  document.getElementById('sum_collected').innerHTML = fmtDual(t.total_collected_raw, t.total_collected);
  document.getElementById('sum_remaining').innerHTML = fmtDual(t.remaining_raw, t.remaining);

  document.getElementById('display_final_total').innerHTML = fmtDual(t.final_total_raw, t.final_total);
  document.getElementById('display_total_collected').innerHTML = fmtDual(t.total_collected_raw, t.total_collected);
  document.getElementById('display_total_collected2').innerHTML = fmtDual(t.total_collected_raw, t.total_collected);
  document.getElementById('display_remaining').innerHTML = fmtDual(t.remaining_raw, t.remaining);
}

function updateSummaryTable(t) {
  const adminLabel = `مصروفات إدارية ${t.admin_expenses_percent}%`;

  document.getElementById('summary-tfoot').innerHTML = `
    <tr><td>${fmtDual(t.stamp_duty_raw, t.stamp_duty)}</td><td></td><td></td><td class="summary-label">دمغة</td><td></td><td></td><td></td></tr>
    <tr><td>${fmtDual(t.professional_fees_raw, t.professional_fees)}</td><td></td><td></td><td class="summary-label">مهن</td><td></td><td></td><td></td></tr>
    <tr><td>${fmtDual(t.subtotal_before_admin_raw, t.subtotal_before_admin)}</td><td></td><td></td><td class="summary-label">الإجمالي</td><td></td><td></td><td></td></tr>
    <tr><td>${fmtDual(t.admin_expenses_raw, t.admin_expenses)}</td><td></td><td></td><td class="summary-label">${adminLabel}</td><td></td><td></td><td></td></tr>
    <tr><td>${fmtDual(t.total_after_admin_raw, t.total_after_admin)}</td><td></td><td></td><td class="summary-label">الإجمالي بعد المصروفات الإدارية</td><td></td><td></td><td></td></tr>
    <tr><td>${fmtDual(t.balance_raw, t.balance)}</td><td></td><td></td><td class="summary-label">الرصيد</td><td></td><td></td><td></td></tr>
    <tr><td>${fmtDual(t.final_total_raw, t.final_total)}</td><td></td><td></td><td class="summary-label">الإجمالي</td><td>${fmtDual(t.total_collected_raw, t.total_collected)}</td><td></td><td></td></tr>
  `;
}

async function handleSave(e) {
  e.preventDefault();
  const data = collectFormData();

  if (!data.invoice_type) {
    showToast('يجب اختيار نوع الفاتورة', 'danger');
    return;
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
    document.getElementById('edit-serial').style.display = 'inline';
    document.getElementById('edit-serial').textContent = result.serial_number;

    ['download-pdf-btn', 'download-docx-btn', 'preview-btn'].forEach((id) => {
      document.getElementById(id).style.display = 'inline-block';
    });

    await loadQR(result.id);
    showToast(`تم حفظ الفاتورة بنجاح - ${result.serial_number}`, 'success');
  } catch (err) {
    showToast(err.message, 'danger');
  }
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
  currentInvoiceId = null;
  document.getElementById('invoice-form').reset();
  document.getElementById('invoice-id').value = '';
  document.getElementById('form-title').textContent = 'إنشاء فاتورة جديدة';
  document.getElementById('edit-serial').style.display = 'none';
  document.getElementById('issue_date').value = new Date().toISOString().slice(0, 10);
  document.getElementById('captain_name').value = 'نقيب / عمرو صالح محمد';
  document.getElementById('manager_name').value = 'رائد / جمال عبد الناصر - المدير المالي';
  document.getElementById('admin_expenses_percent').value = '12';
  document.getElementById('stamp_duty').value = '0';
  document.getElementById('professional_fees').value = '0';
  document.getElementById('balance').value = '0';
  document.getElementById('cash_private').value = '0';
  document.getElementById('bank_private').value = '0';
  document.getElementById('cash_external').value = '0';
  document.getElementById('bank_external').value = '0';
  setSelectedStayTypes([]);
  ['download-pdf-btn', 'download-docx-btn', 'preview-btn'].forEach((id) => {
    document.getElementById(id).style.display = 'none';
  });
  document.getElementById('qr-card').style.display = 'none';
  initRows();
  bindCalcTriggers();
  recalculate();
}

async function loadInvoiceForEdit(id) {
  try {
    const res = await apiFetch(`${API}/${id}`);
    const inv = await res.json();
    if (!res.ok) throw new Error(inv.error);

    currentInvoiceId = inv.id;
    switchView('create', { keepForm: true });

    document.getElementById('invoice-id').value = inv.id;
    document.getElementById('form-title').textContent = 'تعديل الفاتورة';
    document.getElementById('edit-serial').style.display = 'inline';
    document.getElementById('edit-serial').textContent = inv.serial_number;

    document.getElementById('invoice_type').value = inv.invoice_type;
    document.getElementById('patient_name').value = inv.patient_name;
    document.getElementById('file_number').value = inv.file_number || '';
    document.getElementById('issue_date').value = fmtDate(inv.issue_date || inv.created_at);
    document.getElementById('admission_date').value = fmtDate(inv.admission_date);
    document.getElementById('discharge_date').value = fmtDate(inv.discharge_date);
    document.getElementById('stay_days').value = inv.stay_days;
    document.getElementById('financial_treatment').value = inv.financial_treatment;
    await loadStayTypes(parseStayTypeIds(inv));
    document.getElementById('notes').value = inv.notes || '';
    document.getElementById('stamp_duty').value = inv.stamp_duty;
    document.getElementById('professional_fees').value = inv.professional_fees;
    document.getElementById('balance').value = inv.balance;
    document.getElementById('admin_expenses_percent').value = inv.admin_expenses_percent;
    document.getElementById('cash_private').value = inv.cash_private;
    document.getElementById('bank_private').value = inv.bank_private;
    document.getElementById('cash_external').value = inv.cash_external;
    document.getElementById('bank_external').value = inv.bank_external;
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
      row.querySelector('[data-field="quantity"]').value = item.quantity || '';
      row.querySelector('[data-field="amount"]').value = item.amount || '';
      row.querySelector('[data-field="receipt_date"]').value = pay.receipt_date || '';
      row.querySelector('[data-field="receipt_number"]').value = pay.receipt_number || '';
      row.querySelector('[data-field="pay_amount"]').value = pay.amount || '';
    }

    ['download-pdf-btn', 'download-docx-btn', 'preview-btn'].forEach((id) => {
      document.getElementById(id).style.display = 'inline-block';
    });

    bindCalcTriggers();
    recalculate();
    loadQR(inv.id);
  } catch (err) {
    showToast(err.message, 'danger');
  }
}

function switchView(view, options = {}) {
  document.querySelectorAll('.view-section').forEach((s) => (s.style.display = 'none'));
  document.getElementById(`view-${view}`).style.display = 'block';
  document.querySelectorAll('.nav-btn').forEach((b) => b.classList.toggle('active', b.dataset.view === view));

  if (view === 'create' && !options.keepForm) resetForm();
  if (view === 'list') loadInvoicesList();
  if (view === 'reports') loadReports();
  if (view === 'settings') loadSettingsPage();
}

async function loadUsers() {
  if (!can('users.*')) return;
  try {
    const res = await apiFetch(USERS_API);
    const users = await res.json();
    document.getElementById('users-list').innerHTML = users
      .map(
        (u) => `
      <tr>
        <td class="fw-bold">${u.username}</td>
        <td>${u.full_name || '-'}</td>
        <td><span class="badge bg-primary">${u.role_label}</span></td>
        <td>${u.username !== 'admin' ? `<button class="btn btn-sm btn-outline-danger" onclick="removeSystemUser(${u.id})">🗑️</button>` : ''}</td>
      </tr>`
      )
      .join('');
  } catch (err) {
    console.error(err);
  }
}

async function addUser() {
  const username = document.getElementById('new-user-name').value.trim();
  const full_name = document.getElementById('new-user-fullname').value.trim();
  const password = document.getElementById('new-user-pass').value;
  const role = document.getElementById('new-user-role').value;
  if (!username || !password) return showToast('اسم المستخدم وكلمة المرور مطلوبان', 'warning');
  try {
    const res = await apiFetch(USERS_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, full_name, password, role }),
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

function getSelectedStayTypeIds() {
  return [...document.querySelectorAll('#stay-types-checkboxes input:checked')].map((el) =>
    Number(el.value)
  );
}

function setSelectedStayTypes(ids = []) {
  const selected = new Set((ids || []).map(Number));
  document.querySelectorAll('#stay-types-checkboxes input').forEach((el) => {
    el.checked = selected.has(Number(el.value));
  });
}

function parseStayTypeIds(inv) {
  let ids = inv.stay_type_ids;
  if (typeof ids === 'string') {
    try {
      ids = JSON.parse(ids);
    } catch {
      ids = [];
    }
  }
  if (Array.isArray(ids) && ids.length) return ids.map(Number).filter(Boolean);
  if (inv.stay_type_id) return [Number(inv.stay_type_id)];
  return [];
}

async function loadStayTypes(selectedIds = null) {
  try {
    const res = await apiFetch(`${SETTINGS_API}/stay-types`);
    const types = await res.json();
    const current =
      selectedIds !== null && selectedIds !== undefined ? selectedIds : getSelectedStayTypeIds();
    const container = document.getElementById('stay-types-checkboxes');
    container.innerHTML = types.length
      ? types
          .map(
            (t) => `
      <label class="stay-type-chip">
        <input type="checkbox" value="${t.id}" ${current.includes(t.id) ? 'checked' : ''}>
        <span>${t.name}</span>
      </label>`
          )
          .join('')
      : '<span class="text-muted fw-bold">لا توجد أنواع إقامة — أضفها من الإعدادات</span>';
    return types;
  } catch (err) {
    console.error(err);
    return [];
  }
}

async function loadSettingsPage() {
  try {
    const [settingsRes, typesRes] = await Promise.all([
      apiFetch(SETTINGS_API),
      apiFetch(`${SETTINGS_API}/stay-types?all=1`),
    ]);
    const settings = await settingsRes.json();
    const types = await typesRes.json();

    if (settings.logo_url) {
      document.getElementById('logo-preview').src = settings.logo_url;
    }

    const list = document.getElementById('stay-types-list');
    list.innerHTML = types.length
      ? types.map((t) => `
        <li class="list-group-item d-flex justify-content-between align-items-center fw-bold">
          <span>${t.name}</span>
          <button class="btn btn-sm btn-outline-danger" onclick="deleteStayType(${t.id})">🗑️</button>
        </li>`).join('')
      : '<li class="list-group-item text-muted">لا توجد أنواع</li>';

    await loadStayTypes();
    loadUsers();
  } catch (err) {
    showToast('خطأ في تحميل الإعدادات', 'danger');
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
    showToast('تم رفع الشعار بنجاح', 'success');
    fileInput.value = '';
  } catch (err) {
    showToast(err.message, 'danger');
  }
}

async function addStayType() {
  const input = document.getElementById('new-stay-type');
  const name = input.value.trim();
  if (!name) return showToast('اكتب اسم نوع الإقامة', 'warning');

  try {
    const res = await apiFetch(`${SETTINGS_API}/stay-types`, {
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

async function deleteStayType(id) {
  if (!confirm('حذف نوع الإقامة؟')) return;
  try {
    const res = await apiFetch(`${SETTINGS_API}/stay-types/${id}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('فشل الحذف');
    showToast('تم الحذف', 'success');
    loadSettingsPage();
  } catch (err) {
    showToast(err.message, 'danger');
  }
}

async function loadInvoicesList() {
  const params = new URLSearchParams();
  const type = document.getElementById('list-type-filter').value;
  const search = document.getElementById('list-search').value;
  const from = document.getElementById('list-from').value;
  const to = document.getElementById('list-to').value;
  if (type) params.set('type', type);
  if (search) params.set('search', search);
  if (from) params.set('from', from);
  if (to) params.set('to', to);

  try {
    const res = await apiFetch(`${API}?${params}`);
    const invoices = await res.json();
    const canEdit = can('invoices.edit');
    const canDelete = can('invoices.delete');
    const tbody = document.getElementById('invoices-list');
    tbody.innerHTML = invoices.length
      ? invoices
          .map(
            (inv) => `
        <tr>
          <td class="fw-black text-primary">${inv.serial_number}</td>
          <td class="fw-bold">${inv.file_number || '-'}</td>
          <td>${inv.patient_name || '-'}</td>
          <td><span class="badge bg-secondary">${TYPE_LABELS[inv.invoice_type] || inv.invoice_type}</span></td>
          <td class="fw-bold">${fmtDual(inv.final_total_raw ?? inv.final_total, inv.final_total)}</td>
          <td>${fmtDual(inv.total_collected_raw ?? inv.total_collected, inv.total_collected)}</td>
          <td class="${inv.remaining > 0 ? 'text-danger fw-bold' : ''}">${fmtDual(inv.remaining_raw ?? inv.remaining, inv.remaining)}</td>
          <td>${inv.issue_date ? new Date(inv.issue_date).toLocaleDateString('ar-EG') : new Date(inv.created_at).toLocaleDateString('ar-EG')}</td>
          <td>
            <button class="btn btn-sm btn-outline-primary" onclick="loadInvoiceForEdit(${inv.id})">${canEdit ? '✏️' : '👁️'}</button>
            <button class="btn btn-sm btn-outline-danger" onclick="window.open('${API}/${inv.id}/pdf')">📄</button>
            ${canDelete ? `<button class="btn btn-sm btn-outline-danger" onclick="deleteInvoice(${inv.id})">🗑️</button>` : ''}
          </td>
        </tr>`
          )
          .join('')
      : '<tr><td colspan="9" class="text-center py-4">لا توجد فواتير</td></tr>';
  } catch (err) {
    showToast('خطأ في تحميل الفواتير', 'danger');
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

  try {
    const res = await apiFetch(`${API}/reports/summary`);
    const data = await res.json();

    const typeCards = Object.entries(data.by_type)
      .map(
        ([key, val]) => `
      <div class="col-md-3">
        <div class="card report-card shadow-sm h-100">
          <div class="card-body text-center">
            <div class="report-label">${val.label}</div>
            <div class="report-stat text-primary">${val.count}</div>
            <div class="small fw-bold">فاتورة</div>
            <hr>
            <div class="d-flex justify-content-between small fw-bold">
              <span>الإجمالي:</span><span>${fmt(val.total)}</span>
            </div>
            <div class="d-flex justify-content-between small fw-bold">
              <span>المحصل:</span><span>${fmt(val.collected)}</span>
            </div>
            <div class="d-flex justify-content-between small fw-bold text-danger">
              <span>المتبقي:</span><span>${fmt(val.remaining)}</span>
            </div>
          </div>
        </div>
      </div>`
      )
      .join('');

    const monthlyRows = (data.monthly || [])
      .map(
        (m) => `
      <tr>
        <td class="fw-bold">${m.month}</td>
        <td>${m.count}</td>
        <td>${fmt(m.total)}</td>
        <td>${fmt(m.collected)}</td>
        <td class="text-danger">${fmt(m.remaining)}</td>
      </tr>`
      )
      .join('');

    container.innerHTML = `
      <div class="col-md-3"><div class="card report-card shadow-sm"><div class="card-body text-center">
        <div class="report-label">إجمالي الفواتير</div><div class="report-stat">${data.total_invoices}</div>
      </div></div></div>
      <div class="col-md-3"><div class="card report-card shadow-sm"><div class="card-body text-center">
        <div class="report-label">إجمالي المبالغ</div><div class="report-stat text-success">${fmt(data.grand_total)}</div>
      </div></div></div>
      <div class="col-md-3"><div class="card report-card shadow-sm"><div class="card-body text-center">
        <div class="report-label">إجمالي المحصل</div><div class="report-stat text-primary">${fmt(data.grand_collected)}</div>
      </div></div></div>
      <div class="col-md-3"><div class="card report-card shadow-sm"><div class="card-body text-center">
        <div class="report-label">إجمالي المتبقي</div><div class="report-stat text-danger">${fmt(data.grand_remaining)}</div>
      </div></div></div>
      ${typeCards}
      <div class="col-12"><div class="card shadow-sm mt-2"><div class="card-header bg-dark text-white fw-black">التقرير الشهري</div>
        <div class="card-body p-0"><table class="table table-striped mb-0">
          <thead class="table-dark"><tr><th>الشهر</th><th>عدد الفواتير</th><th>الإجمالي</th><th>المحصل</th><th>المتبقي</th></tr></thead>
          <tbody>${monthlyRows || '<tr><td colspan="5" class="text-center">لا توجد بيانات</td></tr>'}</tbody>
        </table></div></div></div>`;
  } catch (err) {
    container.innerHTML = '<div class="col-12 text-center text-danger py-5">خطأ في تحميل التقارير</div>';
  }
}

function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  const id = 'toast-' + Date.now();
  container.insertAdjacentHTML(
    'beforeend',
    `<div id="${id}" class="toast align-items-center text-bg-${type} border-0" role="alert">
      <div class="d-flex"><div class="toast-body fw-bold">${message}</div>
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

window.loadInvoiceForEdit = loadInvoiceForEdit;
window.deleteInvoice = deleteInvoice;
window.removeSystemUser = removeSystemUser;
window.deleteStayType = deleteStayType;
