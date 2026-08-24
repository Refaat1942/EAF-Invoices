const buckets = new Map();

function createRateLimiter({ windowMs = 15 * 60 * 1000, max = 20, keyPrefix = 'rl' } = {}) {
  return function rateLimit(req, res, next) {
    const ip = req.ip || req.connection?.remoteAddress || 'unknown';
    const key = `${keyPrefix}:${ip}`;
    const now = Date.now();
    let entry = buckets.get(key);
    if (!entry || now - entry.start > windowMs) {
      entry = { start: now, count: 0 };
    }
    entry.count += 1;
    buckets.set(key, entry);

    if (entry.count > max) {
      console.warn(`[security] rate limit exceeded for ${ip} (${keyPrefix})`);
      return res.status(429).json({ error: 'محاولات كثيرة — أعد المحاولة بعد قليل' });
    }
    next();
  };
}

const loginRateLimit = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 20,
  keyPrefix: 'login',
});

module.exports = { createRateLimiter, loginRateLimit };
