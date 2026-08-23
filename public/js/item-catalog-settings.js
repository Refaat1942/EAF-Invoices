/**
 * Item Catalog management in Settings (Medicines, Supplies, Cosmetics).
 * Daily Entry reads active items only via daily-charges sections API.
 */
const ITEM_CATALOG_API = '/api/daily-charges';

const ITEM_CATALOG_CATEGORY_LABELS = {
  Medicine: 'أدوية',
  Supplies: 'مستلزمات',
  Cosmetics: 'مستحضرات تجميل',
};

const ITEM_IMPORT_FIELD_LABELS = {
  code: 'الكود',
  name: 'الاسم',
  category: 'الفئة',
  unit: 'الوحدة',
  price: 'السعر',
  cost_price: 'سعر التكلفة',
  markup_percent: 'نسبة الربح %',
};

let itemCatalogSearchTimer = null;
let itemCatalogImportFile = null;
let itemCatalogImportState = null;

function catalogCanManage() {
  return typeof can === 'function' && (can('settings.*') || can('daily_charges.manage'));
}

function catalogCanView() {
  return typeof can === 'function' && (can('settings.*') || can('daily_charges.view') || can('daily_charges.manage'));
}

function catalogParseAmount(text) {
  if (typeof parseDisplayAmount === 'function') return parseDisplayAmount(text);
  return (
    parseFloat(
      String(text || '')
        .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
        .replace(/[٬,]/g, '')
        .replace(/[٫]/g, '.')
        .replace(/[^\d.-]/g, '')
    ) || 0
  );
}

function catalogFmt(n) {
  const num = Number(n) || 0;
  return num.toLocaleString('ar-EG', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

function catalogEscapeHtml(text) {
  if (typeof escapeHtml === 'function') return escapeHtml(text);
  return String(text || '');
}

function catalogEscapeAttr(text) {
  return String(text || '').replace(/"/g, '&quot;');
}

function catalogComputeSellingPrice(cost, markup) {
  const c = catalogParseAmount(cost);
  const m = catalogParseAmount(markup);
  return Math.round((c + (c * m) / 100) * 100) / 100;
}

function toggleItemCatalogPricingFields(mode = 'add') {
  const prefix = mode === 'edit' ? 'edit' : 'add';
  const category = document.getElementById(`item-catalog-${prefix}-category`)?.value;
  const isSupplies = category === 'Supplies';
  const priceWrap = document.getElementById(`item-catalog-${prefix}-price-wrap`);
  const costWrap = document.getElementById(`item-catalog-${prefix}-cost-wrap`);
  const markupWrap = document.getElementById(`item-catalog-${prefix}-markup-wrap`);
  const sellingWrap = document.getElementById(`item-catalog-${prefix}-selling-wrap`);
  if (priceWrap) priceWrap.style.display = isSupplies ? 'none' : '';
  if (costWrap) costWrap.style.display = isSupplies ? '' : 'none';
  if (markupWrap) markupWrap.style.display = isSupplies ? '' : 'none';
  if (sellingWrap) sellingWrap.style.display = isSupplies ? '' : 'none';
  const priceEl = document.getElementById(`item-catalog-${prefix}-price`);
  if (priceEl) priceEl.required = !isSupplies;
  const costEl = document.getElementById(`item-catalog-${prefix}-cost`);
  if (costEl) costEl.required = isSupplies;
  if (isSupplies) updateItemCatalogSellingPreview(mode);
}

function updateItemCatalogSellingPreview(mode = 'add') {
  const prefix = mode === 'edit' ? 'edit' : 'add';
  const selling = catalogComputeSellingPrice(
    document.getElementById(`item-catalog-${prefix}-cost`)?.value,
    document.getElementById(`item-catalog-${prefix}-markup`)?.value
  );
  const el = document.getElementById(`item-catalog-${prefix}-selling`);
  if (!el) return;
  el.value =
    selling > 0
      ? typeof formatAmountInput === 'function'
        ? formatAmountInput(selling)
        : String(selling)
      : '';
}

function buildItemCatalogPayload(mode = 'add') {
  const prefix = mode === 'edit' ? 'edit' : 'add';
  const category = document.getElementById(`item-catalog-${prefix}-category`)?.value;
  const base = {
    code: document.getElementById(`item-catalog-${prefix}-code`)?.value.trim(),
    name: document.getElementById(`item-catalog-${prefix}-name`)?.value.trim(),
    category,
    unit: document.getElementById(`item-catalog-${prefix}-unit`)?.value.trim() || 'مرة',
  };
  if (category === 'Supplies') {
    return {
      ...base,
      cost_price: catalogParseAmount(document.getElementById(`item-catalog-${prefix}-cost`)?.value),
      markup_percent: catalogParseAmount(document.getElementById(`item-catalog-${prefix}-markup`)?.value),
    };
  }
  return {
    ...base,
    price: catalogParseAmount(document.getElementById(`item-catalog-${prefix}-price`)?.value),
  };
}

async function loadItemCatalogStats() {
  const el = document.getElementById('item-catalog-stats');
  if (!el || !catalogCanView()) return;
  try {
    const res = await apiFetch(`${ITEM_CATALOG_API}/catalog/stats`);
    if (!res.ok) return;
    const stats = await res.json();
    if (!stats.total) {
      el.textContent = 'لا توجد أصناف — أضف أو استورد من Excel/CSV';
      return;
    }
    const parts = (stats.by_category || []).map((row) => `${ITEM_CATALOG_CATEGORY_LABELS[row.category] || row.category}: ${row.count}`);
    el.textContent = `${stats.total} صنف (${parts.join(' · ')})`;
  } catch (err) {
    console.error(err);
  }
}

async function refreshItemCatalogAfterChange() {
  await loadItemCatalogStats();
  await loadItemCatalogManageTable();
  if (typeof window.reloadDailyCatalogSectionsFromSettings === 'function') {
    await window.reloadDailyCatalogSectionsFromSettings();
  }
}

function renderItemCatalogManageRow(item) {
  const label = ITEM_CATALOG_CATEGORY_LABELS[item.category] || item.category;
  const priceCell =
    item.category === 'Supplies'
      ? `<small class="d-block text-muted">تكلفة: ${catalogFmt(item.cost_price || 0)}</small>
         <small class="d-block text-muted">ربح: ${catalogFmt(item.markup_percent || 0)}%</small>
         <strong>بيع: ${catalogFmt(item.price)}</strong>`
      : catalogFmt(item.price);
  const statusBadge = item.is_active
    ? '<span class="badge bg-success">نشط</span>'
    : '<span class="badge bg-secondary">موقوف</span>';
  const canManage = catalogCanManage();
  const actions = canManage
    ? `<button type="button" class="btn btn-outline-primary btn-sm" data-item-catalog-edit="${item.id}">تعديل</button>
       <button type="button" class="btn btn-outline-${item.is_active ? 'warning' : 'success'} btn-sm" data-item-catalog-toggle="${item.id}" data-item-catalog-active="${item.is_active ? '1' : '0'}">${item.is_active ? 'إيقاف' : 'تفعيل'}</button>`
    : '';
  const rowClass = item.is_active ? '' : 'table-secondary';
  return `<tr class="${rowClass}">
    <td class="fw-bold">${catalogEscapeHtml(item.code)}</td>
    <td>${catalogEscapeHtml(item.name)}</td>
    <td>${catalogEscapeHtml(label)}</td>
    <td>${catalogEscapeHtml(item.unit || '')}</td>
    <td>${priceCell}</td>
    <td>${statusBadge}</td>
    <td class="d-flex gap-1 flex-wrap">${actions}</td>
  </tr>`;
}

function bindItemCatalogManageRowActions() {
  const body = document.getElementById('item-catalog-manage-body');
  if (!body) return;
  body.querySelectorAll('[data-item-catalog-edit]').forEach((btn) => {
    btn.addEventListener('click', () => openItemCatalogEditModal(Number(btn.dataset.itemCatalogEdit)));
  });
  body.querySelectorAll('[data-item-catalog-toggle]').forEach((btn) => {
    btn.addEventListener('click', () =>
      toggleItemCatalogActive(Number(btn.dataset.itemCatalogToggle), btn.dataset.itemCatalogActive !== '1')
    );
  });
}

async function loadItemCatalogManageTable() {
  if (!catalogCanView()) return;
  const body = document.getElementById('item-catalog-manage-body');
  if (!body) return;
  body.innerHTML = '<tr><td colspan="7" class="text-center text-muted">جاري التحميل...</td></tr>';

  const category = document.getElementById('item-catalog-filter-category')?.value || '';
  const search = document.getElementById('item-catalog-filter-search')?.value.trim() || '';
  const params = new URLSearchParams({ active_only: '0' });
  if (category) params.set('category', category);
  if (search) params.set('search', search);

  try {
    const res = await apiFetch(`${ITEM_CATALOG_API}/catalog?${params}`);
    const items = await res.json();
    if (!res.ok) throw new Error(items.error || 'فشل التحميل');
    if (!items.length) {
      body.innerHTML = '<tr><td colspan="7" class="text-center text-muted">لا توجد أصناف</td></tr>';
      return;
    }
    body.innerHTML = items.map((item) => renderItemCatalogManageRow(item)).join('');
    bindItemCatalogManageRowActions();
  } catch (err) {
    body.innerHTML = `<tr><td colspan="7" class="text-center text-danger">${catalogEscapeHtml(err.message)}</td></tr>`;
  }
}

async function submitItemCatalogAdd(event) {
  event.preventDefault();
  if (!catalogCanManage()) {
    showToast('ليس لديك صلاحية الإضافة', 'warning');
    return;
  }
  const payload = buildItemCatalogPayload('add');
  try {
    const res = await apiFetch(`${ITEM_CATALOG_API}/catalog`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'فشل الإضافة');
    showToast('تم إضافة الصنف', 'success');
    const form = document.getElementById('item-catalog-add-form');
    if (form) form.reset();
    const unitEl = document.getElementById('item-catalog-add-unit');
    if (unitEl) unitEl.value = 'مرة';
    const filterCat = document.getElementById('item-catalog-filter-category')?.value;
    const addCat = document.getElementById('item-catalog-add-category');
    if (filterCat && addCat) addCat.value = filterCat;
    toggleItemCatalogPricingFields('add');
    await refreshItemCatalogAfterChange();
  } catch (err) {
    showToast(err.message, 'danger');
  }
}

async function openItemCatalogEditModal(itemId) {
  if (!catalogCanManage()) return;
  try {
    const res = await apiFetch(`${ITEM_CATALOG_API}/catalog/${itemId}`);
    const item = await res.json();
    if (!res.ok) throw new Error(item.error || 'فشل التحميل');
    document.getElementById('item-catalog-edit-id').value = item.id;
    document.getElementById('item-catalog-edit-code').value = item.code || '';
    document.getElementById('item-catalog-edit-name').value = item.name || '';
    document.getElementById('item-catalog-edit-category').value = item.category || 'Medicine';
    document.getElementById('item-catalog-edit-unit').value = item.unit || 'مرة';
    const priceEl = document.getElementById('item-catalog-edit-price');
    const costEl = document.getElementById('item-catalog-edit-cost');
    const markupEl = document.getElementById('item-catalog-edit-markup');
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
    toggleItemCatalogPricingFields('edit');
    const modalEl = document.getElementById('item-catalog-edit-modal');
    if (modalEl && window.bootstrap) {
      window.bootstrap.Modal.getOrCreateInstance(modalEl).show();
    }
  } catch (err) {
    showToast(err.message, 'danger');
  }
}

async function saveItemCatalogEdit() {
  if (!catalogCanManage()) return;
  const id = document.getElementById('item-catalog-edit-id')?.value;
  if (!id) return;
  const payload = buildItemCatalogPayload('edit');
  try {
    const res = await apiFetch(`${ITEM_CATALOG_API}/catalog/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'فشل الحفظ');
    showToast('تم تحديث الصنف', 'success');
    const modalEl = document.getElementById('item-catalog-edit-modal');
    if (modalEl && window.bootstrap) {
      window.bootstrap.Modal.getOrCreateInstance(modalEl).hide();
    }
    await refreshItemCatalogAfterChange();
  } catch (err) {
    showToast(err.message, 'danger');
  }
}

async function toggleItemCatalogActive(id, activate) {
  if (!catalogCanManage()) return;
  const actionLabel = activate ? 'تفعيل' : 'إيقاف';
  if (!confirm(`${actionLabel} هذا الصنف؟`)) return;
  try {
    const res = await apiFetch(`${ITEM_CATALOG_API}/catalog/${id}/active`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_active: activate }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'فشل التحديث');
    showToast(activate ? 'تم تفعيل الصنف' : 'تم إيقاف الصنف', 'success');
    await refreshItemCatalogAfterChange();
  } catch (err) {
    showToast(err.message, 'danger');
  }
}

function resetItemCatalogImportModal() {
  itemCatalogImportState = null;
  document.getElementById('item-catalog-import-loading').style.display = 'none';
  document.getElementById('item-catalog-import-step-map').style.display = 'none';
  document.getElementById('item-catalog-import-step-preview').style.display = 'none';
  document.getElementById('item-catalog-import-step-result').style.display = 'none';
  document.getElementById('item-catalog-import-confirm-btn').style.display = 'none';
  document.getElementById('item-catalog-import-hint').style.display = 'none';
  document.getElementById('item-catalog-import-errors-wrap').style.display = 'none';
}

function renderItemCatalogImportMapping(state) {
  const wrap = document.getElementById('item-catalog-import-mapping');
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
            `<option value="${catalogEscapeAttr(h)}" ${mapping[field.key] === h ? 'selected' : ''}>${catalogEscapeHtml(h)}</option>`
        )
        .join('');
      const requiredMark = field.required ? ' *' : '';
      return `<div class="col-md-4 col-lg-3">
        <label class="form-label small fw-bold">${catalogEscapeHtml(field.label || ITEM_IMPORT_FIELD_LABELS[field.key] || field.key)}${requiredMark}</label>
        <select class="form-select form-select-sm item-catalog-import-map" data-field="${field.key}">
          <option value="">— لا يطابق —</option>
          ${options}
        </select>
      </div>`;
    })
    .join('');

  wrap.querySelectorAll('.item-catalog-import-map').forEach((select) => {
    select.addEventListener('change', () => {
      if (!itemCatalogImportState) return;
      if (select.value) {
        itemCatalogImportState.mapping[select.dataset.field] = select.value;
      } else {
        delete itemCatalogImportState.mapping[select.dataset.field];
      }
    });
  });

  const hint = document.getElementById('item-catalog-import-hint');
  if (hint && state.needs_manual_mapping) {
    hint.style.display = '';
    hint.textContent = 'راجع تعيين الأعمدة — لم يتم التعرف على بعض الأعمدة المطلوبة تلقائيًا.';
  }

  const countEl = document.getElementById('item-catalog-import-row-count');
  if (countEl) countEl.textContent = `${state.total_rows || 0} صف في الملف`;
}

function renderItemCatalogImportPreview(rows = []) {
  const body = document.getElementById('item-catalog-import-preview-body');
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
          <td>${catalogEscapeHtml(row.code)}</td>
          <td>${catalogEscapeHtml(row.name)}</td>
          <td>${catalogEscapeHtml(row.category)}</td>
          <td>${catalogEscapeHtml(row.unit)}</td>
          <td>${catalogFmt(row.price)}</td>
        </tr>`
    )
    .join('');
}

function collectItemCatalogImportMapping() {
  const mapping = {};
  document.querySelectorAll('.item-catalog-import-map').forEach((select) => {
    if (select.value) mapping[select.dataset.field] = select.value;
  });
  return mapping;
}

async function refreshItemCatalogImportPreview() {
  if (!itemCatalogImportFile) return;
  const mapping = collectItemCatalogImportMapping();
  const formData = new FormData();
  formData.append('file', itemCatalogImportFile);
  formData.append('mapping', JSON.stringify(mapping));

  document.getElementById('item-catalog-import-loading').style.display = '';
  try {
    const res = await apiFetch(`${ITEM_CATALOG_API}/catalog/import/analyze`, { method: 'POST', body: formData });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'فشل المعاينة');
    itemCatalogImportState = data;
    renderItemCatalogImportMapping(data);
    renderItemCatalogImportPreview(data.preview_rows || []);
    document.getElementById('item-catalog-import-step-preview').style.display = '';
    document.getElementById('item-catalog-import-confirm-btn').style.display = '';
  } catch (err) {
    showToast(err.message, 'danger');
  } finally {
    document.getElementById('item-catalog-import-loading').style.display = 'none';
  }
}

async function openItemCatalogImportModal(file) {
  if (!catalogCanManage()) {
    showToast('ليس لديك صلاحية استيراد الكتالوج', 'warning');
    return;
  }
  if (!file) return;

  itemCatalogImportFile = file;
  resetItemCatalogImportModal();

  const modalEl = document.getElementById('item-catalog-import-modal');
  if (modalEl && window.bootstrap) {
    window.bootstrap.Modal.getOrCreateInstance(modalEl).show();
  }

  document.getElementById('item-catalog-import-loading').style.display = '';
  document.getElementById('item-catalog-import-step-map').style.display = '';

  const formData = new FormData();
  formData.append('file', file);

  try {
    const res = await apiFetch(`${ITEM_CATALOG_API}/catalog/import/analyze`, { method: 'POST', body: formData });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'فشل تحليل الملف');
    itemCatalogImportState = data;
    renderItemCatalogImportMapping(data);
    renderItemCatalogImportPreview(data.preview_rows || []);
    document.getElementById('item-catalog-import-step-preview').style.display = '';
    document.getElementById('item-catalog-import-confirm-btn').style.display = '';
  } catch (err) {
    showToast(err.message, 'danger');
    if (modalEl && window.bootstrap) {
      window.bootstrap.Modal.getOrCreateInstance(modalEl).hide();
    }
  } finally {
    document.getElementById('item-catalog-import-loading').style.display = 'none';
  }
}

async function confirmItemCatalogImport() {
  if (!itemCatalogImportFile) return;
  const mapping = collectItemCatalogImportMapping();
  const required = ['code', 'name', 'category', 'price'];
  const missing = required.filter((key) => !mapping[key]);
  if (missing.length) {
    showToast(`يجب تعيين: ${missing.map((k) => ITEM_IMPORT_FIELD_LABELS[k]).join('، ')}`, 'warning');
    return;
  }

  const formData = new FormData();
  formData.append('file', itemCatalogImportFile);
  formData.append('mapping', JSON.stringify(mapping));

  const confirmBtn = document.getElementById('item-catalog-import-confirm-btn');
  if (confirmBtn) confirmBtn.disabled = true;

  try {
    const res = await apiFetch(`${ITEM_CATALOG_API}/catalog/import/confirm`, { method: 'POST', body: formData });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'فشل الاستيراد');

    document.getElementById('item-catalog-import-step-map').style.display = 'none';
    document.getElementById('item-catalog-import-step-preview').style.display = 'none';
    document.getElementById('item-catalog-import-step-result').style.display = '';
    document.getElementById('item-catalog-import-confirm-btn').style.display = 'none';

    const summary = document.getElementById('item-catalog-import-result-summary');
    if (summary) {
      summary.innerHTML = `تم الاستيراد: <strong>${data.inserted || 0}</strong> مُضاف، <strong>${data.updated || 0}</strong> محدّث، <strong>${data.skipped || 0}</strong> متخطى، <strong>${(data.errors || []).length}</strong> خطأ`;
    }

    const errorsWrap = document.getElementById('item-catalog-import-errors-wrap');
    const errorsList = document.getElementById('item-catalog-import-errors-list');
    if (data.errors?.length && errorsWrap && errorsList) {
      errorsWrap.style.display = '';
      errorsList.innerHTML = data.errors
        .slice(0, 30)
        .map(
          (err) =>
            `<li>صف ${err.row || '—'} (${catalogEscapeHtml(err.code || '—')}): ${catalogEscapeHtml(err.message)}</li>`
        )
        .join('');
    }

    await refreshItemCatalogAfterChange();
    showToast('تم استيراد الكتالوج', 'success');
  } catch (err) {
    showToast(err.message, 'danger');
  } finally {
    if (confirmBtn) confirmBtn.disabled = false;
  }
}

async function exportItemCatalogCsv() {
  if (!catalogCanManage()) return;
  try {
    const res = await apiFetch(`${ITEM_CATALOG_API}/catalog/export`);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || 'فشل التصدير');
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'item-catalog.csv';
    a.click();
    URL.revokeObjectURL(url);
  } catch (err) {
    showToast(err.message, 'danger');
  }
}

async function loadItemCatalogSection() {
  if (!catalogCanView()) return;
  await loadItemCatalogStats();
  await loadItemCatalogManageTable();
  toggleItemCatalogPricingFields('add');
  if (typeof bindCommaAmountInputs === 'function') {
    bindCommaAmountInputs(document.getElementById('item-catalog-settings-card'));
    bindCommaAmountInputs(document.getElementById('item-catalog-edit-modal'));
  }
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('item-catalog-import-btn')?.addEventListener('click', () => {
    document.getElementById('item-catalog-import-file')?.click();
  });
  document.getElementById('item-catalog-import-file')?.addEventListener('change', (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (file) openItemCatalogImportModal(file);
  });
  document.getElementById('item-catalog-import-refresh-preview-btn')?.addEventListener('click', () =>
    refreshItemCatalogImportPreview()
  );
  document.getElementById('item-catalog-import-confirm-btn')?.addEventListener('click', () =>
    confirmItemCatalogImport()
  );
  document.getElementById('item-catalog-add-form')?.addEventListener('submit', submitItemCatalogAdd);
  document.getElementById('item-catalog-add-category')?.addEventListener('change', () =>
    toggleItemCatalogPricingFields('add')
  );
  document.getElementById('item-catalog-edit-category')?.addEventListener('change', () =>
    toggleItemCatalogPricingFields('edit')
  );
  ['add', 'edit'].forEach((mode) => {
    document.getElementById(`item-catalog-${mode}-cost`)?.addEventListener('input', () =>
      updateItemCatalogSellingPreview(mode)
    );
    document.getElementById(`item-catalog-${mode}-markup`)?.addEventListener('input', () =>
      updateItemCatalogSellingPreview(mode)
    );
  });
  document.getElementById('item-catalog-edit-save-btn')?.addEventListener('click', saveItemCatalogEdit);
  document.getElementById('item-catalog-refresh-btn')?.addEventListener('click', () => loadItemCatalogManageTable());
  document.getElementById('item-catalog-export-btn')?.addEventListener('click', () => exportItemCatalogCsv());
  document.getElementById('item-catalog-filter-category')?.addEventListener('change', (event) => {
    const addCat = document.getElementById('item-catalog-add-category');
    if (addCat && event.target.value) addCat.value = event.target.value;
    loadItemCatalogManageTable();
  });
  document.getElementById('item-catalog-filter-search')?.addEventListener('input', () => {
    clearTimeout(itemCatalogSearchTimer);
    itemCatalogSearchTimer = setTimeout(() => loadItemCatalogManageTable(), 300);
  });
});

window.loadItemCatalogSection = loadItemCatalogSection;
