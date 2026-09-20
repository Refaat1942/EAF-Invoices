/**
 * Debounced auto-save with a small status indicator (silent draft saves).
 */
(function initAutoSave(global) {
  const scopes = new Map();

  function formatTime(date = new Date()) {
    return date.toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' });
  }

  function applyStatusElement(scope, status, message) {
    const cfg = scopes.get(scope);
    if (!cfg?.statusEl) return;
    const el = document.getElementById(cfg.statusEl);
    if (!el) return;
    el.textContent = message || '—';
    el.classList.remove(
      'bg-light',
      'text-muted',
      'bg-warning-subtle',
      'text-warning-emphasis',
      'bg-info-subtle',
      'text-info-emphasis',
      'bg-success-subtle',
      'text-success-emphasis',
      'bg-danger-subtle',
      'text-danger-emphasis'
    );
    if (status === 'pending') {
      el.classList.add('bg-warning-subtle', 'text-warning-emphasis');
    } else if (status === 'saving') {
      el.classList.add('bg-info-subtle', 'text-info-emphasis');
    } else if (status === 'saved') {
      el.classList.add('bg-success-subtle', 'text-success-emphasis');
    } else if (status === 'error') {
      el.classList.add('bg-danger-subtle', 'text-danger-emphasis');
    } else {
      el.classList.add('bg-light', 'text-muted');
    }
  }

  function setStatus(scope, status, message) {
    const cfg = scopes.get(scope);
    if (!cfg) return;
    cfg.status = status;
    const text =
      message ||
      (status === 'saved' ? `${cfg.savedText || 'محفوظ تلقائياً'} • ${formatTime()}` : '—');
    applyStatusElement(scope, status, text);
    if (typeof cfg.onStatus === 'function') cfg.onStatus(status, text);
  }

  function register(scope, config = {}) {
    scopes.set(scope, {
      ...config,
      timer: null,
      lastFingerprint: null,
      status: 'idle',
      disabled: false,
    });
  }

  function noteSaved(scope, fingerprint) {
    const cfg = scopes.get(scope);
    if (!cfg) return;
    if (fingerprint !== undefined) cfg.lastFingerprint = fingerprint;
    setStatus(scope, 'saved');
  }

  function schedule(scope) {
    const cfg = scopes.get(scope);
    if (!cfg || cfg.disabled) return;
    clearTimeout(cfg.timer);
    setStatus(scope, 'pending', cfg.pendingText || 'تغييرات غير محفوظة…');
    cfg.timer = setTimeout(() => {
      void run(scope);
    }, cfg.debounceMs || 2000);
  }

  async function run(scope) {
    const cfg = scopes.get(scope);
    if (!cfg) return false;
    if (typeof cfg.canSave === 'function' && !cfg.canSave()) {
      setStatus(scope, 'idle', '—');
      return false;
    }

    let fingerprint;
    if (typeof cfg.getFingerprint === 'function') {
      try {
        fingerprint = cfg.getFingerprint();
      } catch {
        fingerprint = null;
      }
      if (fingerprint && fingerprint === cfg.lastFingerprint) {
        setStatus(scope, 'saved');
        return true;
      }
    }

    setStatus(scope, 'saving', cfg.savingText || 'جاري الحفظ التلقائي…');
    try {
      const result = await cfg.save({ silent: true, auto: true });
      if (result === false) {
        setStatus(scope, 'idle', '—');
        return false;
      }
      if (fingerprint !== undefined) cfg.lastFingerprint = fingerprint;
      setStatus(scope, 'saved');
      return true;
    } catch (err) {
      const msg = err?.message ? String(err.message) : 'فشل الحفظ التلقائي';
      setStatus(scope, 'error', msg);
      return false;
    }
  }

  function installChangeListeners(root, scope) {
    if (!root) return;
    const handler = () => schedule(scope);
    root.addEventListener('input', handler, true);
    root.addEventListener('change', handler, true);
  }

  const AutoSave = {
    register,
    schedule,
    run,
    noteSaved,
    setStatus,
    installChangeListeners,
  };

  global.AutoSave = AutoSave;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = AutoSave;
  }
})(typeof window !== 'undefined' ? window : globalThis);
