const fs = require('fs');
const path = require('path');
const { query } = require('../database/db');

const ASSETS_DIR = path.join(__dirname, '..', 'public', 'assets');
const LOGO_KEY = 'invoice_logo';

async function getSetting(key, defaultValue = '') {
  const { rows } = await query('SELECT value FROM app_settings WHERE key = $1', [key]);
  return rows[0]?.value || defaultValue;
}

async function setSetting(key, value) {
  await query(
    `INSERT INTO app_settings (key, value, updated_at) VALUES ($1, $2, NOW())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
    [key, value]
  );
}

async function getLogoUrl(baseUrl = '') {
  const filename = await getSetting(LOGO_KEY, 'logo.svg');
  const filePath = path.join(ASSETS_DIR, filename);
  if (!fs.existsSync(filePath)) return `${baseUrl}/assets/logo.svg`;
  const stat = fs.statSync(filePath);
  return `${baseUrl}/assets/${filename}?v=${stat.mtimeMs}`;
}

async function saveLogo(file) {
  if (!fs.existsSync(ASSETS_DIR)) fs.mkdirSync(ASSETS_DIR, { recursive: true });

  const ext = path.extname(file.originalname).toLowerCase() || '.png';
  const allowed = ['.png', '.jpg', '.jpeg', '.svg', '.webp'];
  if (!allowed.includes(ext)) throw new Error('صيغة الصورة غير مدعومة');

  const filename = `logo${ext}`;
  const dest = path.join(ASSETS_DIR, filename);

  // Remove old logo files
  for (const old of fs.readdirSync(ASSETS_DIR)) {
    if (old.startsWith('logo.')) {
      try {
        fs.unlinkSync(path.join(ASSETS_DIR, old));
      } catch {
        /* ignore */
      }
    }
  }

  fs.writeFileSync(dest, file.buffer);
  await setSetting(LOGO_KEY, filename);
  return filename;
}

async function getSettings() {
  const logo = await getSetting(LOGO_KEY, 'logo.svg');
  return { invoice_logo: logo };
}

module.exports = { getSetting, setSetting, getLogoUrl, saveLogo, getSettings, LOGO_KEY };
