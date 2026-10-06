/**
 * Logo for printed pages as an embedded data URI. Print previews open as blob: pages and
 * PDFs render via page.setContent, where /assets/... links do not load (and the server may
 * be offline), so the image itself goes into the page.
 */
const fs = require('fs');
const path = require('path');

const ASSETS_DIR = path.join(__dirname, '..', 'public', 'assets');
const MIME_BY_EXT = {
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
};

const cache = new Map();

function logoSrcForPrint(logoUrl) {
  const url = String(logoUrl || '').trim();
  if (!url || url.startsWith('data:')) return url;
  const match = url.match(/\/assets\/(logo\.(?:svg|png|jpe?g|webp))(?:[?#].*)?$/i);
  if (!match) return url;
  const filePath = path.join(ASSETS_DIR, match[1]);
  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile() || stat.size < 200) return url;
    const key = `${filePath}:${stat.mtimeMs}`;
    if (!cache.has(key)) {
      const mime = MIME_BY_EXT[path.extname(filePath).toLowerCase()] || 'image/png';
      cache.clear();
      cache.set(key, `data:${mime};base64,${fs.readFileSync(filePath).toString('base64')}`);
    }
    return cache.get(key);
  } catch {
    return url;
  }
}

module.exports = { logoSrcForPrint };
