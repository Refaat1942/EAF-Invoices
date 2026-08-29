const crypto = require('crypto');

function safeRequestPath(url = '') {
  const raw = String(url || '').split('?')[0];
  if (!raw) return '/';
  return raw.length > 200 ? `${raw.slice(0, 200)}…` : raw;
}

function requestLogMiddleware(req, res, next) {
  const requestId =
    String(req.headers['x-request-id'] || '').trim() ||
    crypto.randomBytes(8).toString('hex');
  req.requestId = requestId;
  res.setHeader('X-Request-Id', requestId);

  const startedAt = Date.now();
  const path = safeRequestPath(req.originalUrl || req.url);

  res.on('finish', () => {
    const durationMs = Date.now() - startedAt;
    const status = res.statusCode;
    let category = 'success';
    if (status === 401) category = 'auth';
    else if (status === 403) category = 'forbidden';
    else if (status === 404) category = 'not_found';
    else if (status === 409) category = 'conflict';
    else if (status === 422) category = 'validation';
    else if (status >= 500) category = 'server_error';
    else if (status >= 400) category = 'client_error';

    console.log(
      `[http] id=${requestId} ${req.method} ${path} status=${status} category=${category} ${durationMs}ms`
    );
  });

  next();
}

module.exports = { requestLogMiddleware, safeRequestPath };
