const express = require('express');
const { login, findUserById, sanitizeUser } = require('../services/authService');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const user = await login(username, password);
    if (!user) return res.status(401).json({ error: 'اسم المستخدم أو كلمة المرور غير صحيحة' });
    req.session.user = user;
    res.json({ success: true, user });
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
