/**
 * Keeps the logged-in user's role and permissions in step with the users table: a change
 * made by the admin applies on the employee's next request, not after a re-login.
 * A deactivated or deleted user is signed out.
 */
const { query } = require('../database/db');
const { sanitizeUser, getUsersVersion } = require('../services/authService');

function sessionUserRefreshMiddleware(req, res, next) {
  const user = req.session?.user;
  if (!user?.id || !String(req.originalUrl || '').startsWith('/api/')) return next();
  const version = getUsersVersion();
  const fresh = Date.now() - (req.session.userCheckedAt || 0) < 20000 && req.session.usersVersion === version;
  if (fresh) return next();
  query('SELECT id, username, full_name, role, custom_permissions, is_active FROM users WHERE id = $1', [user.id])
    .then(({ rows }) => {
      const row = rows[0];
      if (!row || row.is_active === false) {
        req.session.destroy(() => res.status(401).json({ error: 'انتهت الجلسة — سجّل الدخول مرة أخرى' }));
        return;
      }
      req.session.user = { ...user, ...sanitizeUser(row) };
      req.session.userCheckedAt = Date.now();
      req.session.usersVersion = version;
      next();
    })
    .catch(() => next());
}

module.exports = { sessionUserRefreshMiddleware };
