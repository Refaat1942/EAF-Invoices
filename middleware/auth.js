const { canAccess } = require('../services/authService');

function requireAuth(req, res, next) {
  if (!req.session?.user) {
    return res.status(401).json({ error: 'يجب تسجيل الدخول' });
  }
  req.user = req.session.user;
  next();
}

function requirePermission(permission) {
  return (req, res, next) => {
    if (!req.session?.user) {
      return res.status(401).json({ error: 'يجب تسجيل الدخول' });
    }
    req.user = req.session.user;
    if (!canAccess(req.user.role, permission)) {
      return res.status(403).json({ error: 'ليس لديك صلاحية لهذا الإجراء' });
    }
    next();
  };
}

module.exports = { requireAuth, requirePermission };
