const fs = require('fs');
const path = require('path');

/**
 * Load project-root .env into process.env (only keys not already set).
 * Same behavior as server.js — does not override existing environment variables.
 */
function loadProjectEnv(rootDir = path.join(__dirname, '..')) {
  const envPath = path.join(rootDir, '.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (m && !process.env[m[1].trim()]) process.env[m[1].trim()] = m[2].trim();
  }
}

module.exports = { loadProjectEnv };
