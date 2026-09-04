const express = require('express');
const { requireAuth, requirePermission } = require('../middleware/auth');
const { getAnalyticsDashboard } = require('../services/analyticsService');

const router = express.Router();
router.use(requireAuth);

router.get('/dashboard', requirePermission('reports.view'), async (req, res) => {
  try {
    const data = await getAnalyticsDashboard({
      from_date: req.query.from || null,
      to_date: req.query.to || null,
      invoice_type: req.query.invoice_type || null,
    });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
