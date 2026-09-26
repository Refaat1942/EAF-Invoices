/**
 * Shared API client helpers (browser + Node tests).
 */
class ApiClientError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = 'ApiClientError';
    this.status = options.status ?? 0;
    this.category = options.category ?? 'unknown';
    this.body = options.body ?? null;
  }
}

function extractErrorFromBody(body) {
  if (!body) return '';
  if (typeof body === 'string') return body.trim().slice(0, 300);
  if (typeof body.error === 'string') return body.error.trim();
  if (typeof body.message === 'string') return body.message.trim();
  return '';
}

function classifyHttpStatus(status, body) {
  const serverMsg = extractErrorFromBody(body);
  switch (status) {
    case 401:
      return {
        category: 'auth',
        message: serverMsg || 'انتهت الجلسة — يرجى تسجيل الدخول مرة أخرى',
      };
    case 403:
      return {
        category: 'forbidden',
        message: serverMsg || 'ليس لديك صلاحية لهذا الإجراء',
      };
    case 404:
      return {
        category: 'not_found',
        message: serverMsg || 'المسار المطلوب غير موجود',
      };
    case 409:
      return {
        category: 'conflict',
        message: serverMsg || 'تعارض في البيانات — راجع العملية',
      };
    case 422:
      return {
        category: 'validation',
        message: serverMsg || 'بيانات غير صالحة — راجع الحقول المطلوبة',
      };
    default:
      if (status >= 500) {
        return {
          category: 'server',
          message: serverMsg || 'خطأ في الخادم — حاول لاحقًا',
        };
      }
      if (status >= 400) {
        return {
          category: 'client',
          message: serverMsg || 'تعذّر تنفيذ الطلب',
        };
      }
      return {
        category: 'unknown',
        message: serverMsg || 'خطأ غير متوقع',
      };
  }
}

function sanitizeUserMessage(message) {
  const value = String(message || '').trim();
  if (!value) return 'تعذّر إتمام الطلب';
  if (/failed to fetch/i.test(value)) {
    return 'تعذّر الاتصال بالخادم — تحقق من الشبكة أو أن الخدمة تعمل';
  }
  if (/networkerror/i.test(value)) {
    return 'تعذّر الاتصال بالخادم — تحقق من الشبكة أو أن الخدمة تعمل';
  }
  if (/unexpected token/i.test(value) || /json parse/i.test(value) || /is not valid json/i.test(value)) {
    return 'تعذّر قراءة رد الخادم — صيغة غير متوقعة';
  }
  return value;
}

async function readApiBody(res) {
  const text = await res.text();
  if (!text) return null;

  const contentType = String(res.headers?.get?.('content-type') || '').toLowerCase();
  const trimmed = text.trim();
  const looksJson =
    contentType.includes('application/json') ||
    trimmed.startsWith('{') ||
    trimmed.startsWith('[');

  if (!looksJson) {
    if (!res.ok) {
      const { category, message } = classifyHttpStatus(res.status, null);
      throw new ApiClientError(message, {
        status: res.status,
        category: res.status === 401 ? 'auth' : category,
      });
    }
    return text;
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new ApiClientError('تعذّر قراءة رد الخادم — صيغة غير متوقعة', {
      status: res.status,
      category: 'invalid_json',
    });
  }
}

async function parseApiResponse(res) {
  const body = await readApiBody(res);
  if (!res.ok) {
    const { category, message } = classifyHttpStatus(res.status, body);
    throw new ApiClientError(message, {
      status: res.status,
      category,
      body,
    });
  }
  return body;
}

/**
 * The server treats the PC's calendar date as "today". The cookie covers requests that
 * bypass apiFetch (window.open previews, downloads).
 */
function stampClientDate() {
  if (typeof document === 'undefined') return '';
  const now = new Date();
  const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(
    now.getDate()
  ).padStart(2, '0')}`;
  document.cookie = `eaf_client_date=${date}; path=/; SameSite=Lax`;
  return date;
}

if (typeof window !== 'undefined') {
  stampClientDate();
  setInterval(stampClientDate, 60 * 1000);
}

const REF_DATA_WRITE_RE =
  /\/api\/(settings|pricing|doctors)\b|\/api\/daily-charges\/(catalog|sections|stay-grades|picker)\b/;

const PATIENT_DATA_WRITE_RE = /\/api\/(daily-charges|invoices|patients)\b/;

/** Screens that cache lookup lists or patient entries compare against these before reusing them. */
function noteRefDataWrite(url, method) {
  if (typeof window === 'undefined') return;
  const path = String(url || '');
  if (String(method || 'GET').toUpperCase() === 'GET') {
    // These GETs post missing stay days on the server.
    if (/\/api\/daily-charges\/open-stay|\/api\/invoices\/\d+\/preview/.test(path)) {
      window.eafPatientDataChangedAt = Date.now();
    }
    return;
  }
  if (REF_DATA_WRITE_RE.test(path)) window.eafRefDataChangedAt = Date.now();
  if (PATIENT_DATA_WRITE_RE.test(path)) window.eafPatientDataChangedAt = Date.now();
}

async function apiFetch(url, options = {}) {
  noteRefDataWrite(url, options.method);
  const fetchImpl = typeof fetch === 'function' ? fetch : null;
  if (!fetchImpl) {
    throw new ApiClientError('تعذّر إتمام الطلب — بيئة غير مدعومة', {
      status: 0,
      category: 'environment',
    });
  }

  const clientDate = stampClientDate();
  const headers =
    typeof Headers !== 'undefined' && options.headers instanceof Headers
      ? Object.fromEntries(options.headers.entries())
      : { ...(options.headers || {}) };
  if (clientDate) headers['X-Client-Date'] = clientDate;

  try {
    return await fetchImpl(url, { credentials: 'include', ...options, headers });
  } catch (err) {
    if (err instanceof ApiClientError) throw err;
    const isNetwork =
      err instanceof TypeError ||
      String(err?.message || '').toLowerCase().includes('failed to fetch') ||
      String(err?.message || '').toLowerCase().includes('network');
    throw new ApiClientError(
      isNetwork
        ? 'تعذّر الاتصال بالخادم — تحقق من الشبكة أو أن الخدمة تعمل'
        : sanitizeUserMessage(err.message),
      { status: 0, category: 'network' }
    );
  }
}

async function apiJson(url, options = {}) {
  const res = await apiFetch(url, options);
  return parseApiResponse(res);
}

const apiClient = {
  ApiClientError,
  classifyHttpStatus,
  extractErrorFromBody,
  sanitizeUserMessage,
  readApiBody,
  parseApiResponse,
  apiFetch,
  apiJson,
};

if (typeof window !== 'undefined') {
  window.ApiClient = apiClient;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = apiClient;
}
