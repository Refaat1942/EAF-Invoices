/**
 * Shared PostgreSQL connection string resolution for the app pool and backup service.
 * Never log the returned value — it may contain credentials.
 */
const DEV_FALLBACK_CONNECTION_STRING = 'postgresql://eaf:eaf2026@localhost:5432/eaf_invoices';

function isProductionEnv() {
  return process.env.NODE_ENV === 'production';
}

/**
 * @param {{ forBackup?: boolean }} options
 * - Default (app pool): DATABASE_URL if set, else development fallback.
 * - forBackup: production requires explicit DATABASE_URL; non-production may use fallback.
 */
function getDatabaseConnectionString(options = {}) {
  const forBackup = options.forBackup === true;
  const explicit = String(process.env.DATABASE_URL || '').trim();

  if (explicit) return explicit;

  if (forBackup && isProductionEnv()) {
    throw new Error(
      'Production backup requires DATABASE_URL in the server environment (set in .env and load via systemd EnvironmentFile, node --env-file=.env, or PM2 env).'
    );
  }

  return DEV_FALLBACK_CONNECTION_STRING;
}

module.exports = {
  DEV_FALLBACK_CONNECTION_STRING,
  isProductionEnv,
  getDatabaseConnectionString,
};
