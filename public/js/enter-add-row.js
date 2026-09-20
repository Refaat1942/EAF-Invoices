/**
 * Press Enter in the last filled table row to append a new row.
 */
(function initEnterAddRow(global) {
  const configs = [];

  function register(config) {
    if (config) configs.push(config);
  }

  function isEnterKey(e) {
    return e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey;
  }

  function fieldHasValue(el) {
    if (!(el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement)) {
      return false;
    }
    if (el.type === 'checkbox' || el.type === 'radio') return el.checked;
    return String(el.value || '').trim() !== '';
  }

  function hasOpenSuggest(el) {
    const serviceSuggest = el.closest('.service-cell')?.querySelector('.service-suggest');
    if (serviceSuggest && !serviceSuggest.classList.contains('d-none')) return true;
    const pickerSuggest = el.closest('.daily-picker')?.querySelector('.daily-picker-suggest');
    if (pickerSuggest && !pickerSuggest.classList.contains('d-none')) return true;
    return false;
  }

  function shouldSkipTarget(el) {
    if (!(el instanceof HTMLElement)) return true;
    if (el.closest('[data-no-enter-row]')) return true;
    if (el.closest('#login-screen, #assistant-form, .modal')) return true;
    if (el.tagName === 'TEXTAREA') return true;
    if (el.tagName === 'BUTTON') return true;
    if (el instanceof HTMLInputElement && (el.type === 'submit' || el.type === 'button' || el.type === 'file')) {
      return true;
    }
    if (hasOpenSuggest(el)) return true;
    return false;
  }

  function visibleDataRows(tbody, rowSelector) {
    return [...tbody.querySelectorAll(rowSelector)].filter((row) => {
      if (row.offsetParent === null && !row.getClientRects().length) return false;
      if (row.dataset.sectionHeader || row.dataset.sectionAggregate) return false;
      if (row.classList.contains('d-none')) return false;
      return true;
    });
  }

  function isLastDataRow(row, rowSelector) {
    const tbody = row.closest('tbody');
    if (!tbody) return false;
    const rows = visibleDataRows(tbody, rowSelector);
    return rows.length > 0 && rows[rows.length - 1] === row;
  }

  document.addEventListener(
    'keydown',
    (e) => {
      if (!isEnterKey(e)) return;
      const el = e.target;
      if (shouldSkipTarget(el)) return;

      for (const cfg of configs) {
        const row = el.closest(cfg.rowSelector);
        if (!row) continue;
        if (cfg.container && !row.closest(cfg.container)) continue;
        if (typeof cfg.canHandle === 'function' && !cfg.canHandle(row, el)) continue;
        if (!isLastDataRow(row, cfg.rowSelector)) continue;

        const rowHasData =
          typeof cfg.rowHasData === 'function' ? cfg.rowHasData(row) : fieldHasValue(el);
        if (!rowHasData && !fieldHasValue(el)) continue;

        e.preventDefault();
        if (typeof cfg.addRow === 'function') cfg.addRow(row, el);
        return;
      }
    },
    true
  );

  const EnterAddRow = { register };
  global.EnterAddRow = EnterAddRow;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = EnterAddRow;
  }
})(typeof window !== 'undefined' ? window : globalThis);
