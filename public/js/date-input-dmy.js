/*
 * Every date box shows and accepts «يوم/شهر/سنة» (01/01/2026), whatever the device's
 * language. The browser's own date box follows the computer's settings (mm/dd/yyyy on an
 * English-US Windows), which made the same screen read differently from PC to PC.
 *
 * The original <input type="date"> stays in the page, hidden, and keeps its value in
 * yyyy-mm-dd: all the screen code, min / max and the server keep working unchanged. A
 * text box in front of it shows dd/mm/yyyy, and a 📅 button opens the browser calendar.
 */
(function () {
  const valueDesc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
  const STYLE_CLASSES = ['form-control', 'form-control-sm', 'form-control-lg', 'fw-bold', 'bg-light', 'text-center'];

  const pad = (n) => String(n).padStart(2, '0');
  const arabicDigits = (s) => String(s || '').replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660));

  function isoToDmy(iso) {
    const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
  }

  // «1/2/2026», «01-02-2026», «01022026», «1/2/26» → 2026-02-01 ('' when not a real date).
  function dmyToIso(text) {
    const t = arabicDigits(text).trim();
    if (!t) return '';
    let d;
    let m;
    let y;
    const parts = t.split(/[\/\-.\s]+/).filter(Boolean);
    if (parts.length === 3) [d, m, y] = parts;
    else if (/^\d{8}$/.test(t)) [d, m, y] = [t.slice(0, 2), t.slice(2, 4), t.slice(4)];
    else if (/^\d{6}$/.test(t)) [d, m, y] = [t.slice(0, 2), t.slice(2, 4), t.slice(4)];
    else return null;
    d = Number(d);
    m = Number(m);
    y = Number(y);
    if (y < 100) y += 2000;
    const date = new Date(y, m - 1, d);
    if (!y || date.getFullYear() !== y || date.getMonth() !== m - 1 || date.getDate() !== d) return null;
    return `${y}-${pad(m)}-${pad(d)}`;
  }

  function enhance(native) {
    if (native.dataset.dmy) return;
    native.dataset.dmy = '1';

    const wrap = document.createElement('span');
    wrap.className = 'dmy-wrap';
    const text = document.createElement('input');
    text.type = 'text';
    text.className = 'dmy-text ' + STYLE_CLASSES.filter((c) => native.classList.contains(c)).join(' ');
    text.setAttribute('inputmode', 'numeric');
    text.setAttribute('autocomplete', 'off');
    text.setAttribute('dir', 'ltr');
    text.placeholder = 'يوم/شهر/سنة';
    if (native.getAttribute('style')) text.setAttribute('style', native.getAttribute('style'));
    if (native.title) text.title = native.title;
    const label = native.id ? document.querySelector(`label[for="${CSS.escape(native.id)}"]`) : null;
    if (label) text.id = `${native.id}__dmy`;
    if (label) label.htmlFor = text.id;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'dmy-cal';
    btn.tabIndex = -1;
    btn.title = 'التقويم';
    btn.textContent = '📅';

    native.parentNode.insertBefore(wrap, native);
    wrap.appendChild(text);
    wrap.appendChild(btn);
    wrap.appendChild(native);
    native.classList.add('dmy-native');
    native.tabIndex = -1;
    if (native.required) {
      native.required = false;
      text.required = true;
    }

    const show = () => {
      text.value = isoToDmy(valueDesc.get.call(native));
    };
    // Code that sets input.value = '2026-…' keeps the visible box in step.
    Object.defineProperty(native, 'value', {
      configurable: true,
      get() {
        return valueDesc.get.call(this);
      },
      set(v) {
        valueDesc.set.call(this, v);
        show();
      },
    });

    const mirror = () => {
      text.readOnly = native.readOnly;
      text.disabled = native.disabled;
      btn.disabled = native.disabled || native.readOnly;
      wrap.classList.toggle('d-none', native.classList.contains('d-none') || native.hidden);
      wrap.style.display = native.style.display === 'none' ? 'none' : '';
    };
    new MutationObserver(mirror).observe(native, { attributes: true, attributeFilter: ['readonly', 'disabled', 'class', 'style', 'hidden'] });
    mirror();
    show();

    const commit = () => {
      const iso = dmyToIso(text.value);
      if (iso === null) {
        show(); // not a date: back to the last good value
        text.classList.add('is-invalid');
        setTimeout(() => text.classList.remove('is-invalid'), 1200);
        return;
      }
      if (iso === valueDesc.get.call(native)) {
        show();
        return;
      }
      valueDesc.set.call(native, iso);
      show();
      native.dispatchEvent(new Event('input', { bubbles: true }));
      native.dispatchEvent(new Event('change', { bubbles: true }));
    };
    text.addEventListener('change', commit);
    text.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') commit();
      if (e.key === 'ArrowDown' && e.altKey) openPicker();
    });
    // Slashes typed for the user: 0101 → 01/01/
    text.addEventListener('input', (e) => {
      if (e.inputType && e.inputType.startsWith('delete')) return;
      const v = arabicDigits(text.value);
      if (/^\d{2}$/.test(v) || /^\d{1,2}\/\d{2}$/.test(v)) text.value = `${v}/`;
      else if (v !== text.value) text.value = v;
    });
    native.addEventListener('change', show);
    native.addEventListener('focus', () => text.focus());

    function openPicker() {
      if (native.disabled || native.readOnly) return;
      try {
        native.showPicker();
      } catch {
        native.style.pointerEvents = 'auto';
        native.focus();
        native.click();
        native.style.pointerEvents = '';
      }
    }
    btn.addEventListener('click', openPicker);
  }

  function scan(root) {
    if (!root || !root.querySelectorAll) return;
    if (root.matches && root.matches('input[type="date"]')) enhance(root);
    root.querySelectorAll('input[type="date"]:not([data-dmy])').forEach(enhance);
  }

  const style = document.createElement('style');
  style.textContent = `
    .dmy-wrap { position: relative; display: flex; align-items: stretch; gap: 2px; width: 100%; }
    .dmy-wrap > .dmy-text { flex: 1 1 auto; min-width: 0; text-align: center; letter-spacing: .5px; }
    .dmy-wrap > .dmy-cal { flex: 0 0 auto; border: 1px solid #ced4da; background: #f8f9fa; border-radius: 6px; padding: 0 5px; line-height: 1; cursor: pointer; font-size: .85em; }
    .dmy-wrap > .dmy-cal:disabled { opacity: .45; cursor: default; }
    .dmy-wrap > input.dmy-native { position: absolute !important; left: 0 !important; bottom: 0 !important; width: 100% !important; height: 1px !important; min-height: 0 !important; opacity: 0 !important; pointer-events: none !important; border: 0 !important; padding: 0 !important; margin: 0 !important; }
  `;
  document.head.appendChild(style);

  const start = () => {
    scan(document.body);
    new MutationObserver((mutations) => {
      for (const m of mutations) m.addedNodes.forEach((n) => n.nodeType === 1 && scan(n));
    }).observe(document.body, { childList: true, subtree: true });
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();

  window.dmyToIso = dmyToIso;
})();
