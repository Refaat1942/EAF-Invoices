/**
 * Prevents duplicate clicks / double-submit on async actions.
 */
(function initActionGuard(global) {
  const inFlight = new Map();

  function resolveElements(elements = []) {
    return elements
      .flat()
      .map((ref) => {
        if (!ref) return null;
        if (typeof ref === 'string') {
          return document.getElementById(ref) || document.querySelector(ref);
        }
        return ref;
      })
      .filter(Boolean);
  }

  function guardKeyForElement(el) {
    if (!el) return 'action:unknown';
    if (el.dataset.guardKey) return String(el.dataset.guardKey);
    if (el.id) return `el:${el.id}`;
    return `el:${el.tagName}:${String(el.className || '').slice(0, 40)}`;
  }

  function guardElementsFor(el) {
    if (!el) return [];
    const seen = new Set();
    const elements = [];
    const add = (node) => {
      if (!node || seen.has(node)) return;
      seen.add(node);
      elements.push(node);
    };
    add(el);
    String(el.dataset.guardSiblings || '')
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean)
      .forEach((id) => add(document.getElementById(id)));
    return elements;
  }

  function shouldAutoGuard(el) {
    if (!(el instanceof Element)) return false;
    if (el.dataset.noGuard === 'true') return false;
    if (el.closest('[data-no-guard="true"]')) return false;

    const tag = el.tagName;
    if (tag !== 'BUTTON' && !(tag === 'INPUT' && el.type === 'submit')) return false;

    if (el.classList.contains('btn-close')) return false;
    if (el.classList.contains('dropdown-toggle')) return false;
    if (el.dataset.bsToggle) return false;
    if (el.dataset.bsDismiss) return false;
    if (el.classList.contains('daily-row-delete')) return false;
    if (el.classList.contains('daily-free-remove')) return false;
    if (el.classList.contains('daily-op-remove')) return false;
    if (el.classList.contains('daily-stay-addon-remove')) return false;
    if (el.classList.contains('hub-tile')) return false;
    if (el.classList.contains('report-type-tile')) return false;
    if (el.classList.contains('settings-section-tile')) return false;

    const id = el.id || '';
    if (
      /^(add-row|remove-row|add-stay-entry|daily-add-row|daily-sheet-add-row|daily-op-add-row|daily-free-add-row|reset-form|clear-payments|pay-full|nav-|hub-)/.test(
        id
      )
    ) {
      return false;
    }
    if (id === 'goto-daily-from-invoice-btn') return false;

    if (el.dataset.guardClick === 'true') return true;
    if (el.type === 'submit') return true;
    if (
      el.classList.contains('ops-approve-invoice') ||
      el.classList.contains('ops-delete-invoice') ||
      el.classList.contains('ops-open-invoice')
    ) {
      return true;
    }

    if (
      /save|submit|delete|import|export|upload|approve|backup|refresh|reconcile|post|confirm|lookup|search|print|download|clone|sync|convert|open-stay|batch-stay|change-room|register|login|logout|add-user|empty-register|goto-register/i.test(
        id
      )
    ) {
      return true;
    }

    if (el.classList.contains('btn-primary') || el.classList.contains('btn-success')) {
      return true;
    }
    if (el.classList.contains('btn-danger')) return true;
    if (el.classList.contains('btn-outline-danger') && /delete|remove/i.test(id)) return true;
    if (
      el.classList.contains('btn-outline-primary') &&
      /save|submit|import|upload|add-user/i.test(id)
    ) {
      return true;
    }

    return false;
  }

  function shouldAutoGuardForm(form) {
    return form instanceof HTMLFormElement && form.dataset.noGuard !== 'true';
  }

  async function runGuarded(key, fn, options = {}) {
    const lockKey = String(key || 'default');
    if (inFlight.has(lockKey)) {
      if (typeof options.onDuplicate === 'function') options.onDuplicate();
      return options.duplicateResult;
    }

    inFlight.set(lockKey, true);
    const elements = resolveElements(options.elements || options.buttons || []);
    const snapshots = elements.map((el) => ({
      el,
      disabled: el.disabled,
      text: el.tagName === 'BUTTON' ? el.textContent : '',
      html: el.tagName === 'BUTTON' ? el.innerHTML : '',
      busyText: el.dataset.guardBusy || options.busyText || '',
    }));

    snapshots.forEach(({ el, busyText }) => {
      el.disabled = true;
      el.setAttribute('aria-busy', 'true');
      if (busyText && el.tagName === 'BUTTON') {
        el.textContent = busyText;
      }
    });

    try {
      return await fn();
    } finally {
      inFlight.delete(lockKey);
      snapshots.forEach(({ el, disabled, text, html, busyText }) => {
        el.disabled = disabled;
        el.removeAttribute('aria-busy');
        if (busyText && el.tagName === 'BUTTON') {
          if (html) el.innerHTML = html;
          else el.textContent = text;
        }
      });
    }
  }

  function isLocked(key) {
    return inFlight.has(String(key));
  }

  function guardHandler(key, handler, options = {}) {
    return async function guardedHandler(...args) {
      const event = args[0];
      const target =
        event?.currentTarget instanceof Element
          ? event.currentTarget
          : event?.target instanceof Element
            ? event.target
            : null;
      const lockKey = key || guardKeyForElement(target);
      const elements = options.elements || (target ? guardElementsFor(target) : []);
      if (event?.preventDefault && options.preventDefault !== false && event.type === 'submit') {
        event.preventDefault();
      }
      return runGuarded(lockKey, () => handler.apply(this, args), {
        ...options,
        elements,
      });
    };
  }

  function bindGuardedClick(selector, handler, key, options = {}) {
    const el = typeof selector === 'string' ? document.querySelector(selector) : selector;
    if (!el) return;
    el.addEventListener('click', guardHandler(key || guardKeyForElement(el), handler, { elements: [el], ...options }));
  }

  function bindGuardedSubmit(selector, handler, key, options = {}) {
    const el = typeof selector === 'string' ? document.querySelector(selector) : selector;
    if (!el) return;
    el.addEventListener(
      'submit',
      guardHandler(key || guardKeyForElement(el), handler, {
        elements: options.elements || [],
        preventDefault: false,
        ...options,
      })
    );
  }

  function patchEventListener() {
    if (EventTarget.prototype._eafGuardPatched) return;
    const original = EventTarget.prototype.addEventListener;
    EventTarget.prototype.addEventListener = function patchedAddEventListener(type, listener, options) {
      if (!listener || typeof listener !== 'function') {
        return original.call(this, type, listener, options);
      }

      let wrapped = listener;
      if (type === 'click' && this instanceof Element && shouldAutoGuard(this)) {
        const el = this;
        const lockKey = guardKeyForElement(el);
        wrapped = function guardedClickListener(...args) {
          return runGuarded(
            lockKey,
            () => listener.apply(this, args),
            {
              elements: guardElementsFor(el),
              busyText: el.dataset.guardBusy || '',
            }
          );
        };
      }

      if (type === 'submit' && shouldAutoGuardForm(this)) {
        const form = this;
        const lockKey = form.dataset.guardKey || form.id || 'form:submit';
        wrapped = function guardedSubmitListener(...args) {
          const event = args[0];
          const submitter = event?.submitter;
          const elements = submitter
            ? [submitter]
            : Array.from(form.querySelectorAll('button[type="submit"], input[type="submit"]'));
          return runGuarded(lockKey, () => listener.apply(this, args), {
            elements,
            preventDefault: false,
          });
        };
      }

      return original.call(this, type, wrapped, options);
    };
    EventTarget.prototype._eafGuardPatched = true;
  }

  patchEventListener();

  const ActionGuard = {
    runGuarded,
    isLocked,
    guardHandler,
    bindGuardedClick,
    bindGuardedSubmit,
    guardKeyForElement,
    shouldAutoGuard,
  };

  global.ActionGuard = ActionGuard;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = ActionGuard;
  }
})(typeof window !== 'undefined' ? window : globalThis);
