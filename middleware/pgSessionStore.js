/**
 * express-session store kept in PostgreSQL (table user_sessions).
 *
 * The default in-memory store logged every employee out on each restart / update and
 * grew without limit. Sessions now survive restarts and expired ones are pruned.
 */
const session = require('express-session');
const { query } = require('../database/db');

const PRUNE_EVERY_MS = 15 * 60 * 1000;

class PgSessionStore extends session.Store {
  constructor(options = {}) {
    super(options);
    this.ttlMs = Number(options.ttlMs) || 8 * 60 * 60 * 1000;
    this.pruneTimer = setInterval(() => this.prune().catch(() => {}), PRUNE_EVERY_MS);
    if (this.pruneTimer.unref) this.pruneTimer.unref();
  }

  expiryFor(sess) {
    const maxAge = Number(sess?.cookie?.maxAge);
    return new Date(Date.now() + (Number.isFinite(maxAge) && maxAge > 0 ? maxAge : this.ttlMs));
  }

  get(sid, cb) {
    query(`SELECT sess FROM user_sessions WHERE sid = $1 AND expire > NOW()`, [sid])
      .then(({ rows }) => cb(null, rows[0]?.sess || null))
      .catch((err) => cb(err));
  }

  set(sid, sess, cb = () => {}) {
    query(
      `INSERT INTO user_sessions (sid, sess, expire) VALUES ($1, $2::jsonb, $3)
       ON CONFLICT (sid) DO UPDATE SET sess = EXCLUDED.sess, expire = EXCLUDED.expire`,
      [sid, JSON.stringify(sess), this.expiryFor(sess)]
    )
      .then(() => cb(null))
      .catch((err) => cb(err));
  }

  touch(sid, sess, cb = () => {}) {
    query(`UPDATE user_sessions SET expire = $2 WHERE sid = $1`, [sid, this.expiryFor(sess)])
      .then(() => cb(null))
      .catch((err) => cb(err));
  }

  destroy(sid, cb = () => {}) {
    query(`DELETE FROM user_sessions WHERE sid = $1`, [sid])
      .then(() => cb(null))
      .catch((err) => cb(err));
  }

  prune() {
    return query(`DELETE FROM user_sessions WHERE expire <= NOW()`);
  }
}

module.exports = { PgSessionStore };
