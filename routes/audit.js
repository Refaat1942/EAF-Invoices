const express = require('express');
const { requireAuth, requirePermission, requireAnyPermission } = require('../middleware/auth');
const { listAuditLogs } = require('../services/auditLogService');
const {
  listAlerts,
  getUnreadAlertCount,
  markAlertRead,
  markAllAlertsRead,
  runSystemHealthChecks,
  cleanupOrphanedAlerts,
} = require('../services/alertService');
const { getLiveActivity, getApprovalsQueue, getApprovalsCount } = require('../services/opsCenterService');

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

router.get('/alerts', requireAnyPermission('invoices.view', 'daily_charges.view', 'settings.*'), async (req, res) => {
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

router.get('/alerts/count', requireAnyPermission('invoices.view', 'daily_charges.view', 'settings.*'), async (req, res) => {
  try {
    const count = await getUnreadAlertCount();
    res.json({ count });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/alerts/:id/read', requireAnyPermission('invoices.view', 'daily_charges.view', 'settings.*'), async (req, res) => {
  try {
    const row = await markAlertRead(Number(req.params.id), req.user?.id);
    if (!row) return res.status(404).json({ error: 'التنبيه غير موجود' });
    res.json(row);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/alerts/read-all', requireAnyPermission('invoices.view', 'daily_charges.view', 'settings.*'), async (req, res) => {
  try {
    await markAllAlertsRead(req.user?.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/health-check', requirePermission('settings.*'), async (req, res) => {
  try {
    const { created, orphaned_cleaned } = await runSystemHealthChecks();
    const count = await getUnreadAlertCount();
    res.json({ created: created.length, orphaned_cleaned, unread_count: count });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/live-activity', requirePermission('settings.*'), async (req, res) => {
  try {
    res.json(await getLiveActivity({ hours: req.query.hours, limit: req.query.limit }));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/approvals', requireAnyPermission('invoices.approve', 'settings.*'), async (req, res) => {
  try {
    res.json(await getApprovalsQueue({ limit: req.query.limit }));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/approvals/count', requireAnyPermission('invoices.approve', 'settings.*'), async (req, res) => {
  try {
    const count = await getApprovalsCount();
    res.json({ count });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/alerts/cleanup-orphans', requirePermission('settings.*'), async (req, res) => {
  try {
    const cleaned = await cleanupOrphanedAlerts();
    const count = await getUnreadAlertCount();
    res.json({ cleaned, unread_count: count });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
