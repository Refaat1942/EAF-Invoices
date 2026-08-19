const express = require('express');
const { listUsers, createUser, updateUser, deleteUser, ROLES } = require('../services/authService');
const { requireAuth, requirePermission } = require('../middleware/auth');

const router = express.Router();

router.use(requireAuth);

router.get('/roles', (req, res) => {
  res.json(
    Object.entries(ROLES).map(([key, val]) => ({ id: key, label: val.label, level: val.level }))
  );
});

router.get('/', requirePermission('users.*'), async (req, res) => {
  try {
    res.json(await listUsers());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', requirePermission('users.*'), async (req, res) => {
  try {
    const user = await createUser(req.body);
    res.status(201).json(user);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.put('/:id', requirePermission('users.*'), async (req, res) => {
  try {
    const user = await updateUser(Number(req.params.id), req.body, req.user.role);
    res.json(user);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/:id', requirePermission('users.*'), async (req, res) => {
  try {
    const ok = await deleteUser(Number(req.params.id));
    if (!ok) return res.status(404).json({ error: 'لا يمكن حذف هذا المستخدم' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
