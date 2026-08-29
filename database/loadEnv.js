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
  'SESSION_SECRET',
  'APP_SECRET',
  'NODE_ENV',
]);

/**
 * Load project-root .env into process.env.
 * By default does not override existing variables — except ENV_FILE_OVERRIDES.
 */
function loadProjectEnv(rootDir = path.join(__dirname, '..')) {
  const envPath = path.join(rootDir, '.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (!m) continue;
    const key = m[1].trim();
    const value = m[2].trim();
    if (ENV_FILE_OVERRIDES.has(key) || !process.env[key]) {
      process.env[key] = value;
    }
  }
}

module.exports = { loadProjectEnv };
