/**
 * Doctors catalog in Settings + import/export.
 */
const DOCTORS_API = '/api/doctors';

let doctorImportFile = null;
let doctorImportState = null;
let doctorPage = 1;
let doctorSearchTimer = null;

function doctorsCanManage() {
  return typeof can === 'function' && can('settings.*');
}

function doctorEscape(text) {
  if (typeof escapeHtml === 'function') return escapeHtml(text);
  return String(text || '');
}

async function loadDoctorsSection() {
  if (!doctorsCanManage()) return;
  await loadDoctorsTable();
  await loadDoctorFilterOptions();
}

async function loadDoctorFilterOptions() {
  try {
    const [deptRes, specRes] = await Promise.all([
      apiFetch(`${DOCTORS_API}/departments?all=1`),
      apiFetch(`${DOCTORS_API}/specialties?all=1`),
    ]);
    const departments = await deptRes.json();
    const specialties = await specRes.json();
    const deptSel = document.getElementById('doctor-filter-department');
    const specSel = document.getElementById('doctor-filter-specialty');
    if (deptSel) {
      deptSel.innerHTML =
        '<option value="">كل الأقسام</option>' +
        departments.map((d) => `<option value="${doctorEscape(d)}">${doctorEscape(d)}</option>`).join('');
    }
    if (specSel) {
      specSel.innerHTML =
        '<option value="">كل التخصصات</option>' +
        specialties.map((s) => `<option value="${doctorEscape(s)}">${doctorEscape(s)}</option>`).join('');
    }
  } catch {
    /* ignore */
  }
}

function renderDoctorPagination(infoEl, controlsEl, page, totalPages, total, onPage) {
  if (!infoEl || !controlsEl) return;
  if (!total) {
    infoEl.textContent = 'لا توجد نتائج';
    controlsEl.innerHTML = '';
    return;
  }
  infoEl.textContent = `صفحة ${page} من ${totalPages} — ${total} طبيب`;
  controlsEl.innerHTML = '';
  const prev = document.createElement('button');
  prev.type = 'button';
  prev.className = 'btn btn-outline-secondary';
  prev.textContent = 'السابق';
  prev.disabled = page <= 1;
  prev.addEventListener('click', () => onPage(page - 1));
  const next = document.createElement('button');
  next.type = 'button';
  next.className = 'btn btn-outline-secondary';
  next.textContent = 'التالي';
  next.disabled = page >= totalPages;
  next.addEventListener('click', () => onPage(page + 1));
  controlsEl.appendChild(prev);
  controlsEl.appendChild(next);
}

async function loadDoctorsTable(page = doctorPage) {
  const tbody = document.getElementById('doctors-manage-body');
  if (!tbody) return;
  doctorPage = page;
  const department = document.getElementById('doctor-filter-department')?.value || '';
  const specialty = document.getElementById('doctor-filter-specialty')?.value || '';
  const active = document.getElementById('doctor-filter-active')?.value || '';
  const search = document.getElementById('doctor-filter-search')?.value?.trim() || '';
  const sort = document.getElementById('doctor-filter-sort')?.value || 'name';
  const order = document.getElementById('doctor-filter-order')?.value || 'asc';
  const limit = document.getElementById('doctor-filter-limit')?.value || '25';

  const params = new URLSearchParams({
    page: String(page),
    limit,
    sort,
    order,
    all: '1',
  });
  if (department) params.set('department', department);
  if (specialty) params.set('specialty', specialty);
  if (active) params.set('active', active);
  if (search) params.set('search', search);

  tbody.innerHTML = '<tr><td colspan="6" class="text-muted text-center">جاري التحميل...</td></tr>';

  try {
    const res = await apiFetch(`${DOCTORS_API}?${params}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'فشل التحميل');
    const doctors = data.rows || [];
    if (!doctors.length) {
      tbody.innerHTML = '<tr><td colspan="6" class="text-muted text-center">لا يوجد أطباء</td></tr>';
    } else {
      tbody.innerHTML = doctors
        .map(
          (d) => `
      <tr>
        <td>${doctorEscape(d.department)}</td>
        <td>${doctorEscape(d.specialty)}</td>
        <td class="fw-bold">${doctorEscape(d.name)}</td>
        <td>${doctorEscape(d.code || '—')}</td>
        <td>${d.is_active ? '<span class="badge bg-success">نشط</span>' : '<span class="badge bg-secondary">غير نشط</span>'}</td>
        <td class="text-nowrap">
          <button type="button" class="btn btn-sm btn-outline-primary" data-doctor-edit="${d.id}">تعديل</button>
          <button type="button" class="btn btn-sm btn-outline-warning" data-doctor-toggle="${d.id}" data-active="${d.is_active ? '1' : '0'}">${d.is_active ? 'إيقاف' : 'تفعيل'}</button>
        </td>
      </tr>`
        )
        .join('');

      tbody.querySelectorAll('[data-doctor-edit]').forEach((btn) => {
        btn.addEventListener('click', () => openDoctorEditModal(Number(btn.dataset.doctorEdit)));
      });
      tbody.querySelectorAll('[data-doctor-toggle]').forEach((btn) => {
        btn.addEventListener('click', () => toggleDoctorActive(Number(btn.dataset.doctorToggle), btn.dataset.active !== '1'));
      });
    }
    renderDoctorPagination(
      document.getElementById('doctor-pagination-info'),
      document.getElementById('doctor-pagination-controls'),
      data.page || page,
      data.totalPages || 1,
      data.total || 0,
      (p) => loadDoctorsTable(p)
    );
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="6" class="text-danger">${err.message}</td></tr>`;
  }
}

async function submitDoctorAdd(e) {
  e.preventDefault();
  if (!doctorsCanManage()) return;
  const body = {
    department: document.getElementById('doctor-add-department')?.value.trim(),
    specialty: document.getElementById('doctor-add-specialty')?.value.trim(),
    name: document.getElementById('doctor-add-name')?.value.trim(),
    code: document.getElementById('doctor-add-code')?.value.trim() || null,
  };
  try {
    const res = await apiFetch(DOCTORS_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    e.target.reset();
    showToast('تمت إضافة الطبيب', 'success');
    await loadDoctorsSection();
    if (typeof loadDailyDoctorSpecialties === 'function') await loadDailyDoctorSpecialties();
  } catch (err) {
    showToast(err.message, 'danger');
  }
}

async function openDoctorEditModal(id) {
  try {
    const res = await apiFetch(`${DOCTORS_API}/${id}`);
    const d = await res.json();
    if (!res.ok) throw new Error(d.error);
    document.getElementById('doctor-edit-id').value = d.id;
    document.getElementById('doctor-edit-department').value = d.department || '';
    document.getElementById('doctor-edit-specialty').value = d.specialty || '';
    document.getElementById('doctor-edit-name').value = d.name || '';
    document.getElementById('doctor-edit-code').value = d.code || '';
    document.getElementById('doctor-edit-modal')?.classList.add('show');
    document.getElementById('doctor-edit-modal').style.display = 'block';
    document.body.classList.add('modal-open');
  } catch (err) {
    showToast(err.message, 'danger');
  }
}

async function submitDoctorEdit(e) {
  e.preventDefault();
  const id = document.getElementById('doctor-edit-id')?.value;
  const body = {
    department: document.getElementById('doctor-edit-department')?.value.trim(),
    specialty: document.getElementById('doctor-edit-specialty')?.value.trim(),
    name: document.getElementById('doctor-edit-name')?.value.trim(),
    code: document.getElementById('doctor-edit-code')?.value.trim() || null,
  };
  try {
    const res = await apiFetch(`${DOCTORS_API}/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    closeDoctorEditModal();
    showToast('تم تحديث الطبيب', 'success');
    await loadDoctorsSection();
  } catch (err) {
    showToast(err.message, 'danger');
  }
}

function closeDoctorEditModal() {
  const modal = document.getElementById('doctor-edit-modal');
  if (!modal) return;
  modal.classList.remove('show');
  modal.style.display = 'none';
  document.body.classList.remove('modal-open');
}

async function toggleDoctorActive(id, activate) {
  try {
    const res = await apiFetch(`${DOCTORS_API}/${id}/active`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_active: activate }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    await loadDoctorsSection();
  } catch (err) {
    showToast(err.message, 'danger');
  }
}

async function runDoctorImportAnalyze() {
  if (!doctorImportFile) return showToast('اختر ملف Excel', 'warning');
  const form = new FormData();
  form.append('file', doctorImportFile);
  const res = await apiFetch(`${DOCTORS_API}/import/analyze`, { method: 'POST', body: form });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error);
  doctorImportState = data;
  const preview = document.getElementById('doctor-import-preview');
  if (preview) {
    preview.innerHTML = `
      <p class="small mb-2">جديد: <strong>${data.new_count}</strong> — موجود: <strong>${data.existing_count}</strong> — مكرر في الملف: <strong>${data.duplicate_rows?.length || 0}</strong> — غير صالح: <strong>${data.invalid_rows?.length || 0}</strong></p>
      <div class="table-responsive"><table class="table table-sm table-bordered">
        <thead><tr><th>القسم</th><th>التخصص</th><th>الاسم</th><th>الحالة</th></tr></thead>
        <tbody>${(data.preview_rows || [])
          .slice(0, 20)
          .map(
            (r) =>
              `<tr><td>${doctorEscape(r.department)}</td><td>${doctorEscape(r.specialty)}</td><td>${doctorEscape(r.name)}</td><td>${doctorEscape(r.import_message || r.import_status)}</td></tr>`
          )
          .join('')}</tbody></table></div>`;
    preview.style.display = '';
  }
  document.getElementById('doctor-import-confirm-btn').style.display = '';
}

async function confirmDoctorImport() {
  if (!doctorImportFile) return;
  const form = new FormData();
  form.append('file', doctorImportFile);
  if (doctorImportState?.mapping) form.append('mapping', JSON.stringify(doctorImportState.mapping));
  const res = await apiFetch(`${DOCTORS_API}/import/confirm`, { method: 'POST', body: form });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error);
  showToast(`تم الاستيراد: ${data.inserted} إضافة، ${data.skipped} تخطي`, 'success');
  doctorImportFile = null;
  doctorImportState = null;
  document.getElementById('doctor-import-preview').style.display = 'none';
  document.getElementById('doctor-import-confirm-btn').style.display = 'none';
  await loadDoctorsSection();
  if (typeof loadDailyDoctorSpecialties === 'function') await loadDailyDoctorSpecialties();
}

function bindDoctorSettingsEvents() {
  document.getElementById('doctor-add-form')?.addEventListener('submit', submitDoctorAdd);
  document.getElementById('doctor-edit-form')?.addEventListener('submit', submitDoctorEdit);
  document.getElementById('doctor-filter-refresh')?.addEventListener('click', () => loadDoctorsTable(1));
  document.getElementById('doctor-filter-department')?.addEventListener('change', () => loadDoctorsTable(1));
  document.getElementById('doctor-filter-specialty')?.addEventListener('change', () => loadDoctorsTable(1));
  ['doctor-filter-active', 'doctor-filter-sort', 'doctor-filter-order', 'doctor-filter-limit'].forEach((id) => {
    document.getElementById(id)?.addEventListener('change', () => loadDoctorsTable(1));
  });
  document.getElementById('doctor-filter-search')?.addEventListener('input', () => {
    clearTimeout(doctorSearchTimer);
    doctorSearchTimer = setTimeout(() => loadDoctorsTable(1), 300);
  });
  document.getElementById('doctor-export-btn')?.addEventListener('click', () => {
    window.open(`${DOCTORS_API}/export`, '_blank');
  });
  document.getElementById('doctor-template-btn')?.addEventListener('click', () => {
    window.open(`${DOCTORS_API}/export/template`, '_blank');
  });
  document.getElementById('doctor-import-analyze-btn')?.addEventListener('click', () => {
    const fileInput = document.getElementById('doctor-import-file');
    if (!doctorImportFile && fileInput) {
      fileInput.click();
      return;
    }
    runDoctorImportAnalyze().catch((err) => showToast(err.message, 'danger'));
  });
  document.getElementById('doctor-import-file')?.addEventListener('change', (e) => {
    doctorImportFile = e.target.files?.[0] || null;
    if (doctorImportFile) {
      runDoctorImportAnalyze().catch((err) => showToast(err.message, 'danger'));
    }
  });
  document.getElementById('doctor-import-confirm-btn')?.addEventListener('click', () => {
    confirmDoctorImport().catch((err) => showToast(err.message, 'danger'));
  });
  document.querySelectorAll('[data-close-doctor-edit]').forEach((el) => {
    el.addEventListener('click', closeDoctorEditModal);
  });
}

document.addEventListener('DOMContentLoaded', () => {
  bindDoctorSettingsEvents();
});

window.loadDoctorsSection = loadDoctorsSection;
