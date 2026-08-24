const express = require('express');
const { login, findUserById, sanitizeUser } = require('../services/authService');
const { requireAuth } = require('../middleware/auth');
const { loginRateLimit } = require('../middleware/rateLimit');

const router = express.Router();

router.post('/login', loginRateLimit, async (req, res) => {
  try {
    const { username, password } = req.body;
    const user = await login(username, password);
    if (!user) {
      console.warn(`[auth] login failed for username attempt: ${String(username || '').trim().toLowerCase()}`);
      return res.status(401).json({ error: 'اسم المستخدم أو كلمة المرور غير صحيحة' });
    }
    const sessionUser = user;
    req.session.regenerate((regenErr) => {
      if (regenErr) {
        console.error('[auth] session regenerate failed:', regenErr.message);
        return res.status(500).json({ error: 'تعذر إنشاء الجلسة' });
      }
      req.session.user = sessionUser;
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
