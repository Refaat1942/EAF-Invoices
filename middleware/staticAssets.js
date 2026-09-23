const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const TYPES = {
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
};

/** path → { mtimeMs, raw, gzip } — rebuilt when the file changes on disk. */
const cache = new Map();

function loadEntry(filePath) {
  const stat = fs.statSync(filePath);
  const hit = cache.get(filePath);
  if (hit && hit.mtimeMs === stat.mtimeMs) return hit;
  const raw = fs.readFileSync(filePath);
  const entry = {
    mtimeMs: stat.mtimeMs,
    raw,
    gzip: zlib.gzipSync(raw, { level: 9 }),
    etag: `W/"${stat.size.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}"`,
  };
  cache.set(filePath, entry);
  return entry;
}

/**
 * Serves text assets from `root` gzipped and cached in memory.
 * Versioned URLs (?v=…) are immutable for a year; index.html is never cached.
 */
function compressedStatic(root) {
  const rootResolved = path.resolve(root);
  return (req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    let rel = decodeURIComponent(req.path);
    if (rel === '/') rel = '/index.html';
    const ext = path.extname(rel).toLowerCase();
    if (!TYPES[ext]) return next();

    const filePath = path.resolve(rootResolved, `.${rel}`);
    if (!filePath.startsWith(rootResolved + path.sep)) return next();
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) return next();

    let entry;
    try {
      entry = loadEntry(filePath);
    } catch {
      return next();
    }

    res.setHeader('Content-Type', TYPES[ext]);
    res.setHeader('Vary', 'Accept-Encoding');
    if (ext === '.html') {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    } else if (req.query && req.query.v) {
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    } else {
      res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate');
      res.setHeader('ETag', entry.etag);
      if (req.headers['if-none-match'] === entry.etag) {
        res.statusCode = 304;
        return res.end();
      }
    }

    const acceptsGzip = /\bgzip\b/.test(req.headers['accept-encoding'] || '');
    const body = acceptsGzip ? entry.gzip : entry.raw;
    if (acceptsGzip) res.setHeader('Content-Encoding', 'gzip');
    res.setHeader('Content-Length', body.length);
    if (req.method === 'HEAD') return res.end();
    return res.end(body);
  };
}

/** Gzips JSON API responses larger than ~1 KB (lists, pickers, reports). */
function compressJson(req, res, next) {
  if (!/\bgzip\b/.test(req.headers['accept-encoding'] || '')) return next();
  const originalJson = res.json.bind(res);
  res.json = (payload) => {
    const text = JSON.stringify(payload);
    if (text === undefined || Buffer.byteLength(text) < 1024 || res.headersSent) {
      return originalJson(payload);
    }
    const gz = zlib.gzipSync(Buffer.from(text), { level: 6 });
    if (!res.getHeader('Content-Type')) res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Encoding', 'gzip');
    res.setHeader('Vary', 'Accept-Encoding');
    res.setHeader('Content-Length', gz.length);
    return res.end(gz);
  };
  next();
}

module.exports = { compressedStatic, compressJson };
