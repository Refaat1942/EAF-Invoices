const { isProduction } = require('../services/backupService');

const WEAK_SECRETS = new Set([
  'change-this-session-secret',
  'eaf-session-secret',
  'eaf-invoices-secret-key',
  'secret',
  'changeme',
]);

function validateProductionConfig() {
  if (!isProduction()) return;

  const sessionSecret = process.env.SESSION_SECRET || process.env.APP_SECRET;
  if (!sessionSecret || sessionSecret.length < 32 || WEAK_SECRETS.has(sessionSecret)) {
    throw new Error(
      'Production requires SESSION_SECRET (32+ chars, not a default value). Set it in the server environment.'
    );
  }

  if (process.env.APP_SECRET && WEAK_SECRETS.has(process.env.APP_SECRET)) {
    throw new Error('Production requires APP_SECRET to be changed from default values.');
  }

  const rawOrigins = process.env.ALLOWED_ORIGINS;
  if (!rawOrigins || !rawOrigins.trim()) {
    throw new Error('Production requires ALLOWED_ORIGINS (comma-separated browser origins).');
  }
}

function parseAllowedOrigins() {
  const raw = process.env.ALLOWED_ORIGINS;
  if (!raw) {
    if (isProduction()) {
      throw new Error('Production requires ALLOWED_ORIGINS (comma-separated browser origins).');
    }
    return null;
  }
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function buildCorsOptions() {
  const allowed = parseAllowedOrigins();
  if (!allowed) {
    return { origin: true, credentials: true };
  }
  return {
    origin(origin, callback) {
      if (!origin) return callback(null, true);
      if (allowed.includes(origin)) return callback(null, true);
      console.warn(`[security] CORS blocked origin: ${origin}`);
      return callback(new Error('Not allowed by CORS'));
    },
    credentials: true,
  };
}

function securityHeaders(req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  if (req.secure || process.env.COOKIE_SECURE === 'true') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  next();
}

function safeErrorMessage(err) {
  if (!isProduction()) return err.message || 'خطأ في الخادم';
  if (err.status && err.status < 500) return err.message || 'طلب غير صالح';
  return 'خطأ في الخادم';
}

function errorHandler(err, req, res, next) {
  const status = err.status && err.status >= 400 && err.status < 600 ? err.status : 500;
  if (status >= 500) {
    console.error('[error]', err.stack || err.message || err);
  } else {
    console.warn(`[error] ${status} ${req.method} ${req.originalUrl}: ${err.message}`);
  }
  if (res.headersSent) return next(err);
  res.status(status).json({ error: safeErrorMessage(err) });
}

module.exports = {
  validateProductionConfig,
  buildCorsOptions,
  securityHeaders,
  errorHandler,
  safeErrorMessage,
  WEAK_SECRETS,
};
