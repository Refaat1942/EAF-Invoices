/**
 * Searchable Daily Entry item/service picker (catalog + price-list services).
 */
(function () {
  const MANUAL_AMOUNT_SECTION_CODES = Object.freeze(['accommodation', 'companion', 'nursing_point', 'patient_assistant']);

  function isManualDailyAmountSection(section) {
    return MANUAL_AMOUNT_SECTION_CODES.includes(String(section?.code || '').trim());
  }

  const PICKER_MIN_SEARCH = 2;
  const PICKER_DEBOUNCE_MS = 300;
  const PICKER_DEFAULT_LIMIT = 25;

  function esc(text) {
    if (typeof escapeHtml === 'function') return escapeHtml(text);
    return String(text || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function escAttr(text) {
    return String(text || '').replace(/"/g, '&quot;');
  }

  function fmtAmount(n) {
    if (typeof dailyFmt === 'function') return dailyFmt(n);
    if (typeof fmt === 'function') return fmt(n);
    if (typeof formatPlainNumber === 'function') return formatPlainNumber(n, 2);
    return Number(n || 0).toLocaleString('ar-EG-u-nu-latn', {
      useGrouping: true,
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    });
  }

  function formatInputAmount(n) {
    if (typeof formatAmountInput === 'function') return formatAmountInput(n);
    return String(n ?? '');
  }

  function pickerLabel(item, kind) {
    if (!item) return '';
    const code = item.code ? `${item.code} — ` : '';
    const unit = item.unit ? ` (${item.unit})` : '';
    return `${code}${item.name || ''}${unit}`;
  }

  function buildCellHtml(section, line = {}) {
    const usesCatalog = section.catalog_category || section.uses_catalog;
    const hasServicePicker = section.category_code && section.input_type === 'amount' && !usesCatalog;
    if (!usesCatalog && !hasServicePicker) return '';

    const kind = usesCatalog ? 'catalog' : 'service';
    const placeholder = '';
    const selectedId = usesCatalog ? line.catalog_item_id || '' : line.service_id || '';
    const unitSelect =
      usesCatalog
        ? `<select class="form-select form-select-sm mb-1 daily-catalog-unit" data-section="${escAttr(section.code)}" style="display:none"><option value="">— وحدة —</option></select>`
        : '';

    return `
      <div class="daily-picker position-relative mb-1" data-section="${escAttr(section.code)}" data-kind="${kind}">
        <div class="input-group input-group-sm">
          <input type="search" class="form-control daily-picker-search" placeholder="${escAttr(placeholder)}" autocomplete="off" value="">
          <button type="button" class="btn btn-outline-secondary daily-picker-clear" title="مسح الاختيار" aria-label="مسح">×</button>
        </div>
        <input type="hidden" class="daily-picker-value" value="${escAttr(selectedId)}">
        <div class="daily-picker-suggest service-suggest d-none"></div>
      </div>${unitSelect}`;
  }

  async function searchPicker(sectionCode, query, page = 1, signal) {
    const params = new URLSearchParams({
      section_code: sectionCode,
      search: query,
      page: String(page),
      limit: String(PICKER_DEFAULT_LIMIT),
    });
    const opts = signal ? { signal } : {};
    return await apiJson(`${DAILY_API}/picker/search?${params}`, opts);
  }

  async function fetchPickerItem(sectionCode, id) {
    const params = new URLSearchParams({ section_code: sectionCode, id: String(id) });
    return await apiJson(`${DAILY_API}/picker/item?${params}`);
  }

  function renderSuggestions(container, result, query) {
    const rows = result?.rows || [];
    if (result?.min_search && String(query || '').trim().length < PICKER_MIN_SEARCH) {
      container.innerHTML =
        '<div class="service-suggest-empty p-2 small text-muted">اكتب حرفين على الأقل للبحث</div>';
      container.classList.remove('d-none');
      return;
    }
    if (!rows.length) {
      container.innerHTML = query
        ? '<div class="service-suggest-empty p-2 small text-muted">لا توجد نتائج مطابقة</div>'
        : '<div class="service-suggest-empty p-2 small text-muted">ابدأ بالبحث لعرض النتائج</div>';
      container.classList.remove('d-none');
      return;
    }

    container.innerHTML = rows
      .map((item) => {
        const price = Number(item.price ?? item.list_price) || 0;
        const unit = item.unit ? ` / ${esc(item.unit)}` : '';
        const label = item.code ? `${esc(item.code)} — ${esc(item.name)}` : esc(item.name);
        return `<button type="button" class="service-suggest-item daily-picker-suggest-item w-100 text-start border-0 bg-transparent" data-item="${escAttr(JSON.stringify(item))}">
          <strong>${label}</strong>
          <span class="text-muted"> — ${fmtAmount(price)}${unit}</span>
        </button>`;
      })
      .join('');
    container.classList.remove('d-none');

    container.querySelectorAll('.daily-picker-suggest-item').forEach((btn) => {
      btn.addEventListener('mousedown', (e) => {
        e.preventDefault();
        const picker = container.closest('.daily-picker');
        const tr = picker?.closest('.daily-entry-row');
        const sectionCode = picker?.dataset.section;
        const section = dailySectionsCache.find((s) => s.code === sectionCode);
        let item;
        try {
          item = JSON.parse(btn.dataset.item || '{}');
        } catch {
          return;
        }
        applyPickerSelection(tr, section, picker, item);
        container.classList.add('d-none');
      });
    });
  }

  function populateCatalogUnitSelect(tr, sectionCode, item, preset = {}) {
    const unitSelect = tr?.querySelector(`.daily-catalog-unit[data-section="${sectionCode}"]`);
    if (!unitSelect || !item) {
      if (unitSelect) {
        unitSelect.style.display = 'none';
        unitSelect.innerHTML = '<option value="">— وحدة —</option>';
      }
      return;
    }

    const unitOptions = item.unit_options || [{ level: 'major', unit: item.unit || '', price: item.price }];
    unitSelect.innerHTML = unitOptions
      .map((opt) => {
        const selected =
          preset.catalog_unit_level === opt.level || (preset.catalog_unit && preset.catalog_unit === opt.unit)
            ? 'selected'
            : '';
        return `<option value="${escAttr(opt.level)}" data-unit="${escAttr(opt.unit)}" data-price="${opt.price}" ${selected}>${esc(opt.unit)} — ${fmtAmount(opt.price)}</option>`;
      })
      .join('');

    unitSelect.style.display = unitOptions.length > 1 ? '' : 'none';
    if (!unitSelect.value && unitOptions.length) {
      unitSelect.value = preset.catalog_unit_level || unitOptions[0].level;
    }
  }

  function parseQty(tr, sectionCode) {
    const qtyInput = tr?.querySelector(`.daily-catalog-qty[data-section="${sectionCode}"]`);
    if (!qtyInput) return 1;
    if (typeof dailyParseAmount === 'function') return dailyParseAmount(qtyInput.value) || 1;
    return Number(String(qtyInput.value || '1').replace(/,/g, '')) || 1;
  }

  function applyLineAmountFromUnitPrice(tr, sectionCode, unitPrice) {
    const amountInput = tr?.querySelector(`.daily-amount[data-section="${sectionCode}"]`);
    if (!amountInput || unitPrice <= 0) return;
    const qty = parseQty(tr, sectionCode);
    const total = Math.round(unitPrice * qty * 100) / 100;
    amountInput.value = formatInputAmount(total);
    amountInput.dataset.manualAmount = '0';
    amountInput.dataset.unitPrice = String(unitPrice);
  }

  function getUnitPriceForSection(tr, sectionCode) {
    const amountInput = tr?.querySelector(`.daily-amount[data-section="${sectionCode}"]`);
    let unitPrice = Number(amountInput?.dataset.unitPrice) || 0;
    if (unitPrice > 0) return unitPrice;
    const unitSelect = tr?.querySelector(`.daily-catalog-unit[data-section="${sectionCode}"]`);
    if (unitSelect?.value) {
      unitPrice = Number(unitSelect.selectedOptions[0]?.dataset.price) || 0;
      if (unitPrice > 0) return unitPrice;
    }
    const picker = tr?.querySelector(`.daily-picker[data-section="${sectionCode}"]`);
    const item = picker?._selectedItem;
    if (item) return Number(item.price ?? item.list_price) || 0;
    return 0;
  }
  function applyCatalogUnitPrice(tr, sectionCode) {
    const unitSelect = tr?.querySelector(`.daily-catalog-unit[data-section="${sectionCode}"]`);
    if (!unitSelect) return;
    const opt = unitSelect.selectedOptions[0];
    const price = Number(opt?.dataset.price) || 0;
    if (price > 0) {
      applyLineAmountFromUnitPrice(tr, sectionCode, price);
      return;
    }
    const picker = tr?.querySelector(`.daily-picker[data-section="${sectionCode}"]`);
    const name = picker?._selectedItem?.name || 'الصنف';
    const amountInput = tr?.querySelector(`.daily-amount[data-section="${sectionCode}"]`);
    if (amountInput) {
      amountInput.value = '';
      amountInput.dataset.unitPrice = '';
    }
    if (picker?._selectedItem) showToast(`الصنف «${name}» ليس له سعر في الكتالوج`, 'warning');
  }

  function applyPickerSelection(tr, section, picker, item) {
    if (!tr || !section || !picker || !item) return;
    const kind = picker.dataset.kind;
    const searchInput = picker.querySelector('.daily-picker-search');
    const valueInput = picker.querySelector('.daily-picker-value');
    const amountInput = tr.querySelector(`.daily-amount[data-section="${section.code}"]`);

    picker._selectedItem = item;
    if (valueInput) valueInput.value = String(item.id || '');
    if (searchInput) searchInput.value = pickerLabel(item, kind);

    if (kind === 'catalog') {
      populateCatalogUnitSelect(tr, section.code, item);
      applyCatalogUnitPrice(tr, section.code);
    } else if (isManualDailyAmountSection(section)) {
      if (amountInput) {
        amountInput.title = `${item.name || section.name} — أدخل المبلغ يدوياً`;
      }
    } else {
      const unitPrice = Number(item.price ?? item.list_price) || 0;
      if (amountInput && unitPrice > 0) {
        applyLineAmountFromUnitPrice(tr, section.code, unitPrice);
        const unit = item.unit ? ` — ${item.unit}` : '';
        if (item.category_name) amountInput.title = `${item.category_name}${unit} — السعر من اللائحة`;
      } else if (amountInput) {
        amountInput.value = '';
        amountInput.dataset.unitPrice = '';
        showToast(`الخدمة «${item.name}» ليس لها سعر في اللائحة`, 'warning');
      }
    }

    if (typeof updateRowTotal === 'function') updateRowTotal(tr);
    if (typeof updateDailyGrandTotal === 'function') updateDailyGrandTotal();
    if (typeof updateSectionTabTotal === 'function') updateSectionTabTotal();
    if (typeof window.onDailyCatalogPickerApplied === 'function') {
      window.onDailyCatalogPickerApplied(tr, section, item);
    }
  }

  function clearPicker(tr, sectionCode) {
    const picker = tr?.querySelector(`.daily-picker[data-section="${sectionCode}"]`);
    if (!picker) return;
    const searchInput = picker.querySelector('.daily-picker-search');
    const valueInput = picker.querySelector('.daily-picker-value');
    const suggest = picker.querySelector('.daily-picker-suggest');
    if (searchInput) searchInput.value = '';
    if (valueInput) valueInput.value = '';
    picker._selectedItem = null;
    if (suggest) suggest.classList.add('d-none');

    const unitSelect = tr.querySelector(`.daily-catalog-unit[data-section="${sectionCode}"]`);
    if (unitSelect) {
      unitSelect.style.display = 'none';
      unitSelect.innerHTML = '<option value="">— وحدة —</option>';
    }
    const amountInput = tr.querySelector(`.daily-amount[data-section="${sectionCode}"]`);
    if (amountInput) {
      amountInput.value = '';
      amountInput.dataset.unitPrice = '';
      amountInput.dataset.manualAmount = '0';
    }
    if (typeof window.onDailyCatalogPickerCleared === 'function') {
      window.onDailyCatalogPickerCleared(tr, sectionCode);
    }
  }

  function bindPicker(picker, tr, section) {
    if (!picker || picker.dataset.bound === '1') return;
    picker.dataset.bound = '1';
    const searchInput = picker.querySelector('.daily-picker-search');
    const suggest = picker.querySelector('.daily-picker-suggest');
    const clearBtn = picker.querySelector('.daily-picker-clear');
    if (!searchInput || !suggest) return;

    const runSearch = async () => {
      const q = searchInput.value.trim();
      if (picker._searchAbort) picker._searchAbort.abort();
      picker._searchAbort = new AbortController();
      suggest.innerHTML = '<div class="service-suggest-empty p-2 small text-muted">جاري البحث...</div>';
      suggest.classList.remove('d-none');
      try {
        const result = await searchPicker(section.code, q, 1, picker._searchAbort.signal);
        renderSuggestions(suggest, result, q);
      } catch (err) {
        if (err?.name === 'AbortError') return;
        suggest.innerHTML = `<div class="service-suggest-empty p-2 small text-danger">${esc(sanitizeApiErrorMessage(err.message))}</div>`;
        suggest.classList.remove('d-none');
      }
    };

    searchInput.addEventListener('input', () => {
      const valueInput = picker.querySelector('.daily-picker-value');
      if (valueInput) valueInput.value = '';
      picker._selectedItem = null;
      clearTimeout(picker._searchTimer);
      picker._searchTimer = setTimeout(runSearch, PICKER_DEBOUNCE_MS);
    });

    searchInput.addEventListener('focus', () => {
      const q = searchInput.value.trim();
      if (q.length >= PICKER_MIN_SEARCH || !q) runSearch();
      else renderSuggestions(suggest, { min_search: 2 }, q);
    });

    searchInput.addEventListener('keydown', (e) => {
      const items = suggest.querySelectorAll('.daily-picker-suggest-item');
      if (!items.length || suggest.classList.contains('d-none')) return;
      let active = suggest.querySelector('.daily-picker-suggest-item.active');
      let index = active ? [...items].indexOf(active) : -1;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        index = Math.min(index + 1, items.length - 1);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        index = Math.max(index - 1, 0);
      } else if (e.key === 'Enter' && active) {
        e.preventDefault();
        active.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
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

    searchInput.addEventListener('blur', () => {
      setTimeout(() => suggest.classList.add('d-none'), 200);
    });

    clearBtn?.addEventListener('click', () => {
      clearPicker(tr, section.code);
      if (typeof updateRowTotal === 'function') updateRowTotal(tr);
      if (typeof updateDailyGrandTotal === 'function') updateDailyGrandTotal();
      searchInput.focus();
    });
  }

  async function hydratePicker(tr, section, line = {}) {
    const picker = tr?.querySelector(`.daily-picker[data-section="${section.code}"]`);
    if (!picker) return;
    const usesCatalog = section.catalog_category || section.uses_catalog;
    const id = usesCatalog ? line.catalog_item_id : line.service_id;
    if (!id) return;

    try {
      const payload = await fetchPickerItem(section.code, id);
      const item = payload?.item;
      if (!item) return;
      applyPickerSelection(tr, section, picker, item);
      if (usesCatalog) {
        populateCatalogUnitSelect(tr, section.code, item, line);
        const amountInput = tr.querySelector(`.daily-amount[data-section="${section.code}"]`);
        if (line.unit_price) {
          if (amountInput) amountInput.dataset.unitPrice = String(line.unit_price);
        } else if (line.amount && line.quantity) {
          const qty = Number(line.quantity) || 1;
          if (amountInput && qty > 0) amountInput.dataset.unitPrice = String(Number(line.amount) / qty);
        } else {
          applyCatalogUnitPrice(tr, section.code);
        }
      }
    } catch (err) {
      console.error(err);
    }
  }

  function bindRow(tr) {
    tr.querySelectorAll('.daily-picker').forEach((picker) => {
      const sectionCode = picker.dataset.section;
      const section = dailySectionsCache.find((s) => s.code === sectionCode);
      if (section) bindPicker(picker, tr, section);
    });
    tr.querySelectorAll('.daily-catalog-unit').forEach((unitSelect) => {
      unitSelect.addEventListener('change', () => {
        applyCatalogUnitPrice(tr, unitSelect.dataset.section);
        if (typeof updateRowTotal === 'function') updateRowTotal(tr);
        if (typeof updateDailyGrandTotal === 'function') updateDailyGrandTotal();
        if (typeof updateSectionTabTotal === 'function') updateSectionTabTotal();
        if (typeof window.onDailyCatalogPickerApplied === 'function') {
          const section = dailySectionsCache.find((s) => s.code === unitSelect.dataset.section);
          const picker = tr.querySelector(`.daily-picker[data-section="${unitSelect.dataset.section}"]`);
          window.onDailyCatalogPickerApplied(tr, section, picker?._selectedItem);
        }
      });
    });
  }

  function recalcSectionLineTotal(tr, sectionCode) {
    const amtEl = tr?.querySelector(`.daily-amount[data-section="${sectionCode}"]`);
    if (!amtEl || amtEl.dataset.manualAmount === '1') return;
    const unitPrice = getUnitPriceForSection(tr, sectionCode);
    if (unitPrice > 0) applyLineAmountFromUnitPrice(tr, sectionCode, unitPrice);
  }

  function readPickerFields(tr, section) {
    const picker = tr.querySelector(`.daily-picker[data-section="${section.code}"]`);
    if (!picker) return {};
    const usesCatalog = section.catalog_category || section.uses_catalog;
    const value = picker.querySelector('.daily-picker-value')?.value || '';
    const unitSelect = tr.querySelector(`.daily-catalog-unit[data-section="${section.code}"]`);
    const unitOpt = unitSelect?.selectedOptions?.[0];
    return {
      catalog_item_id: usesCatalog && value ? Number(value) : null,
      catalog_unit_level: usesCatalog && unitSelect?.value ? unitSelect.value : null,
      catalog_unit: usesCatalog && unitOpt?.dataset?.unit ? unitOpt.dataset.unit : null,
      service_id: !usesCatalog && value ? Number(value) : null,
    };
  }

  window.DailyEntryPicker = {
    buildCellHtml,
    bindRow,
    hydratePicker,
    readPickerFields,
    applyPickerSelection,
    clearPicker,
    searchPicker,
    populateCatalogUnitSelect,
    applyCatalogUnitPrice,
    applyLineAmountFromUnitPrice,
    recalcSectionLineTotal,
    getUnitPriceForSection,
  };
})();
