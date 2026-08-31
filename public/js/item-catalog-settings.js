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
  name: 'اسم الصنف',
  category: 'الفئة',
  major_unit: 'الوحدة الكبرى',
  minor_unit: 'الوحدة الصغرى',
  minor_quantity_per_major: 'عدد الصغرى لكل كبرى',
  major_unit_selling_price: 'سعر الوحدة الكبرى',
  minor_unit_selling_price: 'سعر الوحدة الصغرى',
  unit: 'الوحدة',
  price: 'السعر',
  cost_price: 'سعر التكلفة',
  markup_percent: 'نسبة الربح %',
};

const ITEM_IMPORT_STATUS_LABELS = {
  insert: 'إضافة',
  update: 'تحديث',
  skip: 'تخطي',
  duplicate: 'مكرر',
  conflict: 'تعارض',
  error: 'خطأ',
};

let itemCatalogSearchTimer = null;
let itemCatalogPage = 1;
let itemCatalogImportPreviewPage = 1;
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
  if (typeof fmt === 'function') return fmt(n);
  const num = Number(n) || 0;
  return num.toLocaleString('ar-EG-u-nu-latn', {
    useGrouping: true,
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}

function catalogEscapeHtml(text) {
  if (typeof escapeHtml === 'function') return escapeHtml(text);
  return String(text || '');
}

function catalogEscapeAttr(text) {
  return String(text || '').replace(/"/g, '&quot;');
}

function displayCatalogUnitLabel(unit) {
  const value = String(unit || '').trim();
  if (!value || value === 'مرة') return 'قطعة';
  return value;
}

function displayCatalogMinorUnitLabel(major, minor, ratio) {
  const maj = String(major || '').trim();
  const min = String(minor || maj).trim();
  const qty = Number(ratio) || 1;
  if (!min || min === maj || qty <= 1) return '—';
  return displayCatalogUnitLabel(min);
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
  const majorPriceWrap = document.getElementById(`item-catalog-${prefix}-major-price-wrap`);
  const minorPriceWrap = document.getElementById(`item-catalog-${prefix}-minor-price-wrap`);
  const costWrap = document.getElementById(`item-catalog-${prefix}-cost-wrap`);
  const markupWrap = document.getElementById(`item-catalog-${prefix}-markup-wrap`);
  const sellingWrap = document.getElementById(`item-catalog-${prefix}-selling-wrap`);
  if (majorPriceWrap) majorPriceWrap.style.display = isSupplies ? 'none' : '';
  if (minorPriceWrap) minorPriceWrap.style.display = isSupplies ? 'none' : '';
  if (costWrap) costWrap.style.display = isSupplies ? '' : 'none';
  if (markupWrap) markupWrap.style.display = isSupplies ? '' : 'none';
  if (sellingWrap) sellingWrap.style.display = isSupplies ? '' : 'none';
  const majorPriceEl = document.getElementById(`item-catalog-${prefix}-major-price`);
  if (majorPriceEl) majorPriceEl.required = !isSupplies;
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

function formatCatalogUnitsCell(item) {
  const major = displayCatalogUnitLabel(item.major_unit || item.unit || '');
  const minor = displayCatalogMinorUnitLabel(
    item.major_unit || item.unit,
    item.minor_unit,
    item.minor_quantity_per_major
  );
  const qty = Number(item.minor_quantity_per_major) || 1;
  if (minor === '—') {
    return catalogEscapeHtml(major);
  }
  return `${catalogEscapeHtml(major)} / ${catalogEscapeHtml(minor)} <small class="text-muted">(${qty})</small>`;
}

function formatCatalogPricesCell(item) {
  if (item.category === 'Supplies') {
    return `<small class="d-block text-muted">تكلفة: ${catalogFmt(item.cost_price || 0)}</small>
            <small class="d-block text-muted">ربح: ${catalogFmt(item.markup_percent || 0)}%</small>
            <strong>بيع: ${catalogFmt(item.major_unit_selling_price || item.price)}</strong>`;
  }
  const major = catalogFmt(item.major_unit_selling_price || item.price);
  const minor = catalogFmt(item.minor_unit_selling_price || item.price);
  if ((item.minor_unit || item.unit) !== (item.major_unit || item.unit)) {
    return `<small class="d-block">كبرى: ${major}</small><small class="d-block">صغرى: ${minor}</small>`;
  }
  return major;
}

function buildItemCatalogPayload(mode = 'add') {
  const prefix = mode === 'edit' ? 'edit' : 'add';
  const category = document.getElementById(`item-catalog-${prefix}-category`)?.value;
  const codeRaw = document.getElementById(`item-catalog-${prefix}-code`)?.value.trim() || '';
  const base = {
    code: codeRaw,
    name: document.getElementById(`item-catalog-${prefix}-name`)?.value.trim(),
    category,
    major_unit:
      document.getElementById(`item-catalog-${prefix}-major-unit`)?.value.trim() || 'قطعة',
    minor_unit: document.getElementById(`item-catalog-${prefix}-minor-unit`)?.value.trim() || '',
    minor_quantity_per_major: catalogParseAmount(
      document.getElementById(`item-catalog-${prefix}-minor-qty`)?.value
    ),
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
    major_unit_selling_price: catalogParseAmount(
      document.getElementById(`item-catalog-${prefix}-major-price`)?.value
    ),
    minor_unit_selling_price: catalogParseAmount(
      document.getElementById(`item-catalog-${prefix}-minor-price`)?.value
    ),
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
  const majorUnit = displayCatalogUnitLabel(item.major_unit || item.unit || '');
  const minorUnit = displayCatalogMinorUnitLabel(
    item.major_unit || item.unit,
    item.minor_unit,
    item.minor_quantity_per_major
  );
  const ratio = Number(item.minor_quantity_per_major) || 1;
  const rawMajor = String(item.major_unit || item.unit || '').trim();
  const rawMinor = String(item.minor_unit || rawMajor).trim();
  const hasMinorTier = rawMinor && rawMinor !== rawMajor && ratio > 1;
  const majorPrice = catalogFmt(item.major_unit_selling_price || item.price);
  const minorPrice = catalogFmt(item.minor_unit_selling_price || item.price);
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
    <td>${catalogEscapeHtml(majorUnit)}</td>
    <td>${catalogEscapeHtml(minorUnit)}</td>
    <td>${ratio > 1 && hasMinorTier ? ratio : '—'}</td>
    <td>${majorPrice}</td>
    <td>${hasMinorTier ? minorPrice : '—'}</td>
    <td>${statusBadge}</td>
    <td class="d-flex gap-1 flex-wrap">${actions}</td>
  </tr>`;
}

function renderCatalogPagination(infoEl, controlsEl, page, totalPages, total, onPage) {
  if (!infoEl || !controlsEl) return;
  if (!total) {
    infoEl.textContent = 'لا توجد نتائج';
    controlsEl.innerHTML = '';
    return;
  }
  infoEl.textContent = `صفحة ${page} من ${totalPages} — ${total} صنف`;
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

async function loadItemCatalogManageTable(page = itemCatalogPage) {
  if (!catalogCanView()) return;
  const body = document.getElementById('item-catalog-manage-body');
  if (!body) return;
  body.innerHTML = '<tr><td colspan="10" class="text-center text-muted">جاري التحميل...</td></tr>';

  const category = document.getElementById('item-catalog-filter-category')?.value || '';
  const active = document.getElementById('item-catalog-filter-active')?.value || '';
  const search = document.getElementById('item-catalog-filter-search')?.value.trim() || '';
  const unit = document.getElementById('item-catalog-filter-unit')?.value.trim() || '';
  const sort = document.getElementById('item-catalog-filter-sort')?.value || 'name';
  const order = document.getElementById('item-catalog-filter-order')?.value || 'asc';
  const limit = document.getElementById('item-catalog-filter-limit')?.value || '25';
  itemCatalogPage = page;

  const params = new URLSearchParams({
    page: String(page),
    limit,
    sort,
    order,
  });
  if (category) params.set('category', category);
  if (active) params.set('active', active);
  if (search) params.set('search', search);
  if (unit) params.set('unit', unit);

  try {
    const res = await apiFetch(`${ITEM_CATALOG_API}/catalog?${params}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'فشل التحميل');
    const items = data.rows || [];
    if (!items.length) {
      body.innerHTML = '<tr><td colspan="10" class="text-center text-muted">لا توجد أصناف</td></tr>';
    } else {
      body.innerHTML = items.map((item) => renderItemCatalogManageRow(item)).join('');
      bindItemCatalogManageRowActions();
    }
    renderCatalogPagination(
      document.getElementById('item-catalog-pagination-info'),
      document.getElementById('item-catalog-pagination-controls'),
      data.page || page,
      data.totalPages || 1,
      data.total || 0,
      (p) => loadItemCatalogManageTable(p)
    );
  } catch (err) {
    body.innerHTML = `<tr><td colspan="10" class="text-center text-danger">${catalogEscapeHtml(err.message)}</td></tr>`;
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
    const majorUnitEl = document.getElementById('item-catalog-add-major-unit');
    if (majorUnitEl) majorUnitEl.value = 'قطعة';
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
    document.getElementById('item-catalog-edit-major-unit').value = displayCatalogUnitLabel(
      item.major_unit || item.unit || 'قطعة'
    );
    const rawMajor = String(item.major_unit || item.unit || '').trim();
    const rawMinor = String(item.minor_unit || '').trim();
    document.getElementById('item-catalog-edit-minor-unit').value =
      rawMinor && rawMinor !== rawMajor && rawMinor !== 'مرة' ? rawMinor : '';
    const minorQtyEl = document.getElementById('item-catalog-edit-minor-qty');
    if (minorQtyEl) {
      minorQtyEl.value =
        item.minor_quantity_per_major != null && typeof formatAmountInput === 'function'
          ? formatAmountInput(item.minor_quantity_per_major)
          : item.minor_quantity_per_major != null
            ? String(item.minor_quantity_per_major)
            : '1';
    }
    const majorPriceEl = document.getElementById('item-catalog-edit-major-price');
    const minorPriceEl = document.getElementById('item-catalog-edit-minor-price');
    if (majorPriceEl) {
      majorPriceEl.value =
        typeof formatAmountInput === 'function'
          ? formatAmountInput(item.major_unit_selling_price || item.price || 0)
          : String(item.major_unit_selling_price || item.price || '');
    }
    if (minorPriceEl) {
      minorPriceEl.value =
        typeof formatAmountInput === 'function'
          ? formatAmountInput(item.minor_unit_selling_price || item.price || 0)
          : String(item.minor_unit_selling_price || item.price || '');
    }
    const costEl = document.getElementById('item-catalog-edit-cost');
    const markupEl = document.getElementById('item-catalog-edit-markup');
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
  itemCatalogImportPreviewPage = 1;
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
  const fields = state.fields || [];

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

function renderImportStatusBadge(status) {
  const label = ITEM_IMPORT_STATUS_LABELS[status] || status || '';
  const cls =
    status === 'conflict' || status === 'error'
      ? 'bg-danger'
      : status === 'duplicate'
        ? 'bg-warning text-dark'
        : status === 'skip'
          ? 'bg-secondary'
          : 'bg-success';
  return `<span class="badge ${cls}">${catalogEscapeHtml(label)}</span>`;
}

function renderItemCatalogImportSummary(state = {}) {
  const el = document.getElementById('item-catalog-import-summary');
  if (!el) return;
  const s = state.summary || {};
  el.innerHTML = `<span class="badge bg-secondary me-1">إجمالي الصفوف: ${s.total_rows || state.total_rows || 0}</span>
    <span class="badge bg-success me-1">جديد: ${s.new_products || 0}</span>
    <span class="badge bg-info text-dark me-1">مُدمج: ${s.merged_products || 0}</span>
    <span class="badge bg-secondary me-1">موجود: ${s.existing_products || 0}</span>
    <span class="badge bg-danger me-1">تعارض: ${s.conflicts || 0}</span>
    <span class="badge bg-warning text-dark me-1">مكرر: ${s.duplicates || 0}</span>
    <span class="badge bg-danger me-1">غير صالح: ${s.invalid_rows || 0}</span>`;
}

function renderItemCatalogImportPreview(rows = [], state = {}) {
  const body = document.getElementById('item-catalog-import-preview-body');
  if (!body) return;
  renderItemCatalogImportSummary(state);
  const dupCount = state.duplicate_rows?.length || 0;
  const conflictCount = state.conflict_rows?.length || 0;
  if (dupCount || conflictCount) {
    const alert = document.getElementById('item-catalog-import-hint');
    if (alert) {
      alert.style.display = '';
      alert.className = 'alert alert-warning py-2 mb-3';
      alert.textContent = `تعارضات/تكرارات: ${conflictCount} تعارض · ${dupCount} مكرر — راجع قبل التأكيد`;
    }
  }
  if (!rows.length) {
    body.innerHTML = '<tr><td colspan="10" class="text-muted text-center">لا توجد صفوف للمعاينة</td></tr>';
  } else {
    body.innerHTML = rows
      .map(
        (row) =>
          `<tr class="${row.import_status === 'conflict' || row.import_status === 'error' ? 'table-danger' : row.import_status === 'duplicate' ? 'table-warning' : ''}">
          <td>${row.row_number || ''}</td>
          <td>${catalogEscapeHtml(row.code || '—')}</td>
          <td>${catalogEscapeHtml(row.name)}</td>
          <td>${catalogEscapeHtml(row.category)}</td>
          <td>${catalogEscapeHtml(displayCatalogUnitLabel(row.major_unit || row.unit || ''))}</td>
          <td>${catalogEscapeHtml(displayCatalogMinorUnitLabel(row.major_unit || row.unit, row.minor_unit, row.minor_quantity_per_major))}</td>
          <td>${catalogFmt(row.minor_quantity_per_major || 1)}</td>
          <td>${catalogFmt(row.major_unit_selling_price || row.price)}</td>
          <td>${catalogFmt(row.minor_unit_selling_price || '')}</td>
          <td>${renderImportStatusBadge(row.import_status)}<small class="d-block text-muted">${catalogEscapeHtml(row.import_message || '')}</small></td>
        </tr>`
      )
      .join('');
  }
  renderCatalogPagination(
    document.getElementById('item-catalog-import-preview-info'),
    document.getElementById('item-catalog-import-preview-controls'),
    state.preview_page || itemCatalogImportPreviewPage,
    state.preview_total_pages || 1,
    state.preview_total || rows.length,
    (p) => refreshItemCatalogImportPreview(p)
  );
}

function collectItemCatalogImportMapping() {
  const mapping = {};
  document.querySelectorAll('.item-catalog-import-map').forEach((select) => {
    if (select.value) mapping[select.dataset.field] = select.value;
  });
  return mapping;
}

async function refreshItemCatalogImportPreview(page = itemCatalogImportPreviewPage) {
  if (!itemCatalogImportFile) return;
  itemCatalogImportPreviewPage = page;
  const mapping = collectItemCatalogImportMapping();
  const formData = new FormData();
  formData.append('file', itemCatalogImportFile);
  formData.append('mapping', JSON.stringify(mapping));
  formData.append('preview_page', String(page));
  formData.append('preview_limit', '50');

  document.getElementById('item-catalog-import-loading').style.display = '';
  try {
    const res = await apiFetch(`${ITEM_CATALOG_API}/catalog/import/analyze`, { method: 'POST', body: formData });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'فشل المعاينة');
    itemCatalogImportState = data;
    renderItemCatalogImportMapping(data);
    renderItemCatalogImportPreview(data.preview_rows || [], data);
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
    renderItemCatalogImportPreview(data.preview_rows || [], data);
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
  const required = ['name', 'category'];
  const missing = required.filter((key) => !mapping[key]);
  const hasPrice =
    mapping.major_unit_selling_price ||
    mapping.price ||
    mapping.cost_price;
  if (!hasPrice) {
    showToast('يجب تعيين سعر الوحدة الكبرى أو سعر التكلفة للمستلزمات', 'warning');
    return;
  }
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
  document.getElementById('item-catalog-refresh-btn')?.addEventListener('click', () => loadItemCatalogManageTable(1));
  document.getElementById('item-catalog-export-btn')?.addEventListener('click', () => exportItemCatalogCsv());
  document.getElementById('item-catalog-filter-category')?.addEventListener('change', (event) => {
    const addCat = document.getElementById('item-catalog-add-category');
    if (addCat && event.target.value) addCat.value = event.target.value;
    loadItemCatalogManageTable(1);
  });
  ['item-catalog-filter-active', 'item-catalog-filter-sort', 'item-catalog-filter-order', 'item-catalog-filter-limit'].forEach(
    (id) => {
      document.getElementById(id)?.addEventListener('change', () => loadItemCatalogManageTable(1));
    }
  );
  document.getElementById('item-catalog-filter-unit')?.addEventListener('input', () => {
    clearTimeout(itemCatalogSearchTimer);
    itemCatalogSearchTimer = setTimeout(() => loadItemCatalogManageTable(1), 300);
  });
  document.getElementById('item-catalog-filter-search')?.addEventListener('input', () => {
    clearTimeout(itemCatalogSearchTimer);
    itemCatalogSearchTimer = setTimeout(() => loadItemCatalogManageTable(1), 300);
  });
});

window.loadItemCatalogSection = loadItemCatalogSection;
