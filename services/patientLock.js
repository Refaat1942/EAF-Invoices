/**
 * One write at a time per patient file.
 *
 * Two saves of the same patient running together (two tabs, autosave + save, two
 * employees) each created a new entry for the day, then merged the other's lines away
 * while syncing the invoice: one request failed «بند ... غير موجود» but its lines stayed
 * saved, so a retry doubled them. Writes for the same file now queue behind each other.
 * Re-entrant: a locked call that calls another locked function for the same file runs
 * straight through (no self-deadlock). The app runs as a single Node process.
 */
const { AsyncLocalStorage } = require('async_hooks');

const held = new AsyncLocalStorage();
const tails = new Map();

function lockKey(fileNumber) {
  return String(fileNumber ?? '').trim();
}

async function withPatientLock(fileNumber, fn) {
  const key = lockKey(fileNumber);
  if (!key) return fn();
  const mine = held.getStore();
  if (mine && mine.has(key)) return fn();

  const previous = tails.get(key) || Promise.resolve();
  let release;
  const current = new Promise((resolve) => {
    release = resolve;
  });
  const tail = previous.then(() => current);
  tails.set(key, tail);

  await previous;
  try {
    const keys = new Set(mine || []);
    keys.add(key);
    return await held.run(keys, fn);
  } finally {
    release();
    if (tails.get(key) === tail) tails.delete(key);
  }
}

module.exports = { withPatientLock };
