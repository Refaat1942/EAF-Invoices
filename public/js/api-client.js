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

async function apiFetch(url, options = {}) {
  const fetchImpl = typeof fetch === 'function' ? fetch : null;
  if (!fetchImpl) {
    throw new ApiClientError('تعذّر إتمام الطلب — بيئة غير مدعومة', {
      status: 0,
      category: 'environment',
    });
  }

  try {
    return await fetchImpl(url, { credentials: 'include', ...options });
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
