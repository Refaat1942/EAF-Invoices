const fs = require('fs');
const path = require('path');

/**
 * Keys that should always reflect the project .env file (even if PM2 cached old values).
 */
const ENV_FILE_OVERRIDES = new Set([
  'PORT',
  'HOST',
  'DATABASE_URL',
  'ALLOWED_ORIGINS',
  'PUBLIC_APP_URL',
  'APP_URL',
  'SESSION_SECRET',
  'APP_SECRET',
  'NODE_ENV',
  'ADMIN_PASSWORD',
  'COOKIE_SECURE',
]);

function parseEnvLineValue(raw) {
  let value = String(raw || '').trim();
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  const hashAt = value.indexOf('#');
  if (hashAt > 0) {
    value = value.slice(0, hashAt).trim();
  }
  return value;
}

/**
 * Load project-root .env into process.env.
 * By default does not override existing variables — except ENV_FILE_OVERRIDES.
 */
function loadProjectEnv(rootDir = path.join(__dirname, '..')) {
  const envPath = path.join(rootDir, '.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = parseEnvLineValue(trimmed.slice(eq + 1));
    if (ENV_FILE_OVERRIDES.has(key) || !process.env[key]) {
      process.env[key] = value;
    }
  }
}

module.exports = { loadProjectEnv };
