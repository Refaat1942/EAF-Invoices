const API = '/api/invoices';
let currentInvoiceId = null;
let rowCount = 12;

const fmt = (n) =>
  (Number(n) || 0).toLocaleString('ar-EG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const TYPE_LABELS = {
  civil: 'مدني (خاص)',
  contracted: 'جهات متعاقدة',
  non_contracted: 'جهات غير متعاقدة',
  military: 'عسكري',
};

document.addEventListener('DOMContentLoaded', () => {
  initRows();
  bindEvents();
  recalculate();
});

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
    patient_name: document.getElementById('patient_name').value,
    admission_date: document.getElementById('admission_date').value,
    discharge_date: document.getElementById('discharge_date').value,
    stay_days: document.getElementById('stay_days').value,
    financial_treatment: document.getElementById('financial_treatment').value,
    stay_type: document.getElementById('stay_type').value,
    notes: document.getElementById('notes').value,
    file_password: document.getElementById('file_password').value,
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
    const res = await fetch(`${API}/calculate`, {
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
  document.getElementById('sum_items').textContent = fmt(t.items_subtotal);
  document.getElementById('sum_fees').textContent = fmt(t.stamp_duty + t.professional_fees);
  document.getElementById('sum_admin').textContent = fmt(t.admin_expenses);
  document.getElementById('sum_after_admin').textContent = fmt(t.total_after_admin);
  document.getElementById('sum_final').textContent = fmt(t.final_total);
  document.getElementById('sum_collected').textContent = fmt(t.total_collected);
  document.getElementById('sum_remaining').textContent = fmt(t.remaining);

  document.getElementById('display_final_total').textContent = fmt(t.final_total);
  document.getElementById('display_total_collected').textContent = fmt(t.total_collected);
  document.getElementById('display_total_collected2').textContent = fmt(t.total_collected);
  document.getElementById('display_remaining').textContent = fmt(t.remaining);
}

function updateSummaryTable(t) {
  const adminLabel = `مصروفات إدارية ${t.admin_expenses_percent}%`;
  const subtotalFees = t.items_subtotal + t.stamp_duty + t.professional_fees;

  document.getElementById('summary-tfoot').innerHTML = `
    <tr><td>${fmt(t.stamp_duty)}</td><td></td><td></td><td class="summary-label">دمغة</td><td></td><td></td><td></td></tr>
    <tr><td>${fmt(t.professional_fees)}</td><td></td><td></td><td class="summary-label">مهن</td><td></td><td></td><td></td></tr>
    <tr><td>${fmt(subtotalFees)}</td><td></td><td></td><td class="summary-label">الإجمالي</td><td></td><td></td><td></td></tr>
    <tr><td>${fmt(t.admin_expenses)}</td><td></td><td></td><td class="summary-label">${adminLabel}</td><td></td><td></td><td></td></tr>
    <tr><td>${fmt(t.total_after_admin)}</td><td></td><td></td><td class="summary-label">الإجمالي بعد المصروفات الإدارية</td><td></td><td></td><td></td></tr>
    <tr><td>${fmt(t.balance)}</td><td></td><td></td><td class="summary-label">الرصيد</td><td></td><td></td><td></td></tr>
    <tr><td>${fmt(t.final_total)}</td><td></td><td></td><td class="summary-label">الإجمالي</td><td>${fmt(t.total_collected)}</td><td></td><td></td></tr>
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

    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });

    const result = await res.json();
    if (!res.ok) throw new Error(result.error || 'خطأ في الحفظ');

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
    const res = await fetch(`${API}/${id}/qr`);
    const data = await res.json();
    document.getElementById('qr-card').style.display = 'block';
    document.getElementById('qr-image').src = data.qr_data_url;
    document.getElementById('qr-serial').textContent = data.serial_number;
    document.getElementById('qr-password').textContent = `🔒 كلمة المرور: ${data.file_password}`;
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
  document.getElementById('captain_name').value = 'نقيب / عمرو صالح محمد';
  document.getElementById('manager_name').value = 'رائد / جمال عبد الناصر - المدير المالي';
  document.getElementById('admin_expenses_percent').value = '12';
  document.getElementById('stamp_duty').value = '0';
  document.getElementById('professional_fees').value = '0';
  document.getElementById('balance').value = '0';
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
    const res = await fetch(`${API}/${id}`);
    const inv = await res.json();
    if (!res.ok) throw new Error(inv.error);

    currentInvoiceId = inv.id;
    switchView('create');

    document.getElementById('invoice-id').value = inv.id;
    document.getElementById('form-title').textContent = 'تعديل الفاتورة';
    document.getElementById('edit-serial').style.display = 'inline';
    document.getElementById('edit-serial').textContent = inv.serial_number;

    document.getElementById('invoice_type').value = inv.invoice_type;
    document.getElementById('patient_name').value = inv.patient_name;
    document.getElementById('admission_date').value = inv.admission_date;
    document.getElementById('discharge_date').value = inv.discharge_date;
    document.getElementById('stay_days').value = inv.stay_days;
    document.getElementById('financial_treatment').value = inv.financial_treatment;
    document.getElementById('stay_type').value = inv.stay_type;
    document.getElementById('notes').value = inv.notes || '';
    document.getElementById('file_password').value = inv.file_password || '';
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

function switchView(view) {
  document.querySelectorAll('.view-section').forEach((s) => (s.style.display = 'none'));
  document.getElementById(`view-${view}`).style.display = 'block';
  document.querySelectorAll('.nav-btn').forEach((b) => b.classList.toggle('active', b.dataset.view === view));

  if (view === 'list') loadInvoicesList();
  if (view === 'reports') loadReports();
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
    const res = await fetch(`${API}?${params}`);
    const invoices = await res.json();
    const tbody = document.getElementById('invoices-list');
    tbody.innerHTML = invoices.length
      ? invoices
          .map(
            (inv) => `
        <tr>
          <td class="fw-black text-primary">${inv.serial_number}</td>
          <td>${inv.patient_name || '-'}</td>
          <td><span class="badge bg-secondary">${TYPE_LABELS[inv.invoice_type] || inv.invoice_type}</span></td>
          <td class="fw-bold">${fmt(inv.final_total)}</td>
          <td>${fmt(inv.total_collected)}</td>
          <td class="${inv.remaining > 0 ? 'text-danger fw-bold' : ''}">${fmt(inv.remaining)}</td>
          <td>${new Date(inv.created_at).toLocaleDateString('ar-EG')}</td>
          <td>
            <button class="btn btn-sm btn-outline-primary" onclick="loadInvoiceForEdit(${inv.id})">✏️</button>
            <button class="btn btn-sm btn-outline-danger" onclick="window.open('${API}/${inv.id}/pdf')">📄</button>
            <button class="btn btn-sm btn-outline-danger" onclick="deleteInvoice(${inv.id})">🗑️</button>
          </td>
        </tr>`
          )
          .join('')
      : '<tr><td colspan="8" class="text-center py-4">لا توجد فواتير</td></tr>';
  } catch (err) {
    showToast('خطأ في تحميل الفواتير', 'danger');
  }
}

async function deleteInvoice(id) {
  if (!confirm('هل أنت متأكد من حذف هذه الفاتورة؟')) return;
  try {
    const res = await fetch(`${API}/${id}`, { method: 'DELETE' });
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
    const res = await fetch(`${API}/reports/summary`);
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
