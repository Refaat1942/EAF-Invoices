const express = require('express');
const { requireAuth, requirePermission } = require('../middleware/auth');
const { listAuditLogs } = require('../services/auditLogService');
const {
  listAlerts,
  getUnreadAlertCount,
  markAlertRead,
  markAllAlertsRead,
  runSystemHealthChecks,
} = require('../services/alertService');

const router = express.Router();
router.use(requireAuth);

router.get('/logs', requirePermission('settings.*'), async (req, res) => {
  try {
    const result = await listAuditLogs({
      action: req.query.action,
      entity_type: req.query.entity_type,
      entity_id: req.query.entity_id,
      user_id: req.query.user_id,
      from: req.query.from,
      to: req.query.to,
      q: req.query.q,
      limit: req.query.limit,
      offset: req.query.offset,
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/alerts', requirePermission('settings.*'), async (req, res) => {
  try {
    const result = await listAlerts({
      unread_only: req.query.unread_only,
      severity: req.query.severity,
      limit: req.query.limit,
      offset: req.query.offset,
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/alerts/count', requirePermission('settings.*'), async (req, res) => {
  try {
    const count = await getUnreadAlertCount();
    res.json({ count });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/alerts/:id/read', requirePermission('settings.*'), async (req, res) => {
  try {
    const row = await markAlertRead(Number(req.params.id), req.user?.id);
    if (!row) return res.status(404).json({ error: 'التنبيه غير موجود' });
    res.json(row);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/alerts/read-all', requirePermission('settings.*'), async (req, res) => {
  try {
    await markAllAlertsRead(req.user?.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/health-check', requirePermission('settings.*'), async (req, res) => {
  try {
    const created = await runSystemHealthChecks();
    const count = await getUnreadAlertCount();
    res.json({ created: created.length, unread_count: count });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
