const express = require('express');
const { login, findUserById, sanitizeUser } = require('../services/authService');
const { requireAuth } = require('../middleware/auth');
const { loginRateLimit } = require('../middleware/rateLimit');

const router = express.Router();

router.post('/login', loginRateLimit, async (req, res) => {
  try {
    const { username, password } = req.body;
    const user = await login(username, password);
    const origin = req.headers.origin || '—';
    const ip = req.ip || req.connection?.remoteAddress || '—';
    if (!user) {
      console.warn(
        `[auth] LOGIN FAILED user="${String(username || '').trim().toLowerCase()}" origin=${origin} ip=${ip}`
      );
      return res.status(401).json({ error: 'اسم المستخدم أو كلمة المرور غير صحيحة' });
    }
    const sessionUser = user;
    req.session.regenerate((regenErr) => {
      if (regenErr) {
        console.error('[auth] session regenerate failed:', regenErr.message);
        return res.status(500).json({ error: 'تعذر إنشاء الجلسة' });
      }
      req.session.user = sessionUser;
      const cookieSecure =
        process.env.COOKIE_SECURE === 'true' || process.env.HTTPS === 'true';
      console.log(
        `[auth] LOGIN OK user=${sessionUser.username} origin=${origin} ip=${ip} session=${req.sessionID} cookieSecure=${cookieSecure}`
      );
      if (cookieSecure && !req.secure) {
        console.warn(
          '[auth] WARNING: cookie Secure flag is ON but request is HTTP — browser will NOT save session cookie'
        );
      }
      res.json({ success: true, user: sessionUser });
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.json({ success: true });
  });
});

router.get('/me', requireAuth, async (req, res) => {
  try {
    const user = await findUserById(req.session.user.id);
    if (!user) {
      req.session.destroy();
      return res.status(401).json({ error: 'جلسة غير صالحة' });
    }
    const sanitized = sanitizeUser({ ...user, password_hash: '' });
    req.session.user = sanitized;
    res.json(sanitized);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
