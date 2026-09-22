const { AsyncLocalStorage } = require('async_hooks');

const CLIENT_DATE_HEADER = 'x-client-date';
const CLIENT_DATE_COOKIE = 'eaf_client_date';

const storage = new AsyncLocalStorage();

function normalizeClientDate(value) {
  const text = String(value || '').trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!match) return '';
  const [, y, m, d] = match.map(Number);
  const probe = new Date(Date.UTC(y, m - 1, d));
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== m - 1 || probe.getUTCDate() !== d) {
    return '';
  }
  return text;
}

/** The business "today" follows the user's PC calendar date, sent with every request. */
function clientDateMiddleware(req, res, next) {
  const clientDate =
    normalizeClientDate(req.get(CLIENT_DATE_HEADER)) ||
    normalizeClientDate(req.cookies?.[CLIENT_DATE_COOKIE]);
  storage.run({ clientDate }, next);
}

function getRequestClientDate() {
  return storage.getStore()?.clientDate || '';
}

module.exports = {
  clientDateMiddleware,
  getRequestClientDate,
  normalizeClientDate,
  CLIENT_DATE_HEADER,
  CLIENT_DATE_COOKIE,
};
