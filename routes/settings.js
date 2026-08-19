const express = require('express');
const multer = require('multer');
const { listStayTypes, createStayType, updateStayType, deleteStayType } = require('../services/stayTypeService');
const {
  listInvoiceTypes,
  createInvoiceType,
  updateInvoiceType,
  deleteInvoiceType,
} = require('../services/invoiceTypeService');
const {
  listPaymentMethods,
  createPaymentMethod,
  updatePaymentMethod,
  deletePaymentMethod,
} = require('../services/paymentMethodService');
const {
  listContractedEntities,
  listContractedEntitiesTree,
  createContractedEntity,
  updateContractedEntity,
  deleteContractedEntity,
} = require('../services/contractedEntityService');
const {
  listDiscountExclusions,
  createDiscountExclusion,
  updateDiscountExclusion,
  deleteDiscountExclusion,
} = require('../services/discountExclusionService');
const { getSettings, saveLogo, getLogoUrl, saveGeneralSettings } = require('../services/settingsService');
const { canAccess } = require('../services/authService');

const { requireAuth, requirePermission } = require('../middleware/auth');

const router = express.Router();

router.use(requireAuth);
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 3 * 1024 * 1024 },
});

function getBaseUrl(req) {
  return `${req.protocol}://${req.get('host')}`;
}

function lookupListHandler(listFn, viewPerm) {
  return async (req, res) => {
    try {
      const activeOnly = req.query.all !== '1';
      const perm = activeOnly ? viewPerm : 'settings.*';
      if (!canAccess(req.session.user.role, perm)) {
        return res.status(403).json({ error: 'ليس لديك صلاحية' });
      }
      res.json(await listFn(activeOnly));
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  };
}

router.get('/stay-types', lookupListHandler(listStayTypes, 'invoices.view'));
router.get('/invoice-types', lookupListHandler(listInvoiceTypes, 'invoices.view'));
router.get('/payment-methods', lookupListHandler(listPaymentMethods, 'invoices.view'));
router.get('/contracted-entities', lookupListHandler(listContractedEntities, 'invoices.view'));
router.get('/contracted-entities/tree', async (req, res) => {
  try {
    const activeOnly = req.query.all !== '1';
    const perm = activeOnly ? 'invoices.view' : 'settings.*';
    if (!canAccess(req.session.user.role, perm)) {
      return res.status(403).json({ error: 'ليس لديك صلاحية' });
    }
    res.json(await listContractedEntitiesTree(activeOnly));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
router.get('/discount-exclusions', lookupListHandler(listDiscountExclusions, 'invoices.view'));

router.post('/stay-types', requirePermission('settings.*'), async (req, res) => {
  try {
    const row = await createStayType(req.body.name, req.body.daily_rate);
    res.status(201).json(row);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.put('/stay-types/:id', requirePermission('settings.*'), async (req, res) => {
  try {
    const row = await updateStayType(Number(req.params.id), req.body);
    res.json(row);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/stay-types/:id', requirePermission('settings.*'), async (req, res) => {
  try {
    const ok = await deleteStayType(Number(req.params.id));
    if (!ok) return res.status(404).json({ error: 'غير موجود' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/invoice-types', requirePermission('settings.*'), async (req, res) => {
  try {
    const row = await createInvoiceType(req.body);
    res.status(201).json(row);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.put('/invoice-types/:id', requirePermission('settings.*'), async (req, res) => {
  try {
    const row = await updateInvoiceType(Number(req.params.id), req.body);
    res.json(row);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/invoice-types/:id', requirePermission('settings.*'), async (req, res) => {
  try {
    const ok = await deleteInvoiceType(Number(req.params.id));
    if (!ok) return res.status(404).json({ error: 'غير موجود' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/payment-methods', requirePermission('settings.*'), async (req, res) => {
  try {
    const row = await createPaymentMethod(req.body);
    res.status(201).json(row);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.put('/payment-methods/:id', requirePermission('settings.*'), async (req, res) => {
  try {
    const row = await updatePaymentMethod(Number(req.params.id), req.body);
    res.json(row);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/payment-methods/:id', requirePermission('settings.*'), async (req, res) => {
  try {
    const ok = await deletePaymentMethod(Number(req.params.id));
    if (!ok) return res.status(404).json({ error: 'غير موجود' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/contracted-entities', requirePermission('settings.*'), async (req, res) => {
  try {
    const row = await createContractedEntity(req.body);
    res.status(201).json(row);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.put('/contracted-entities/:id', requirePermission('settings.*'), async (req, res) => {
  try {
    const row = await updateContractedEntity(Number(req.params.id), req.body);
    res.json(row);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/contracted-entities/:id', requirePermission('settings.*'), async (req, res) => {
  try {
    const ok = await deleteContractedEntity(Number(req.params.id));
    if (!ok) return res.status(404).json({ error: 'غير موجود' });
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/discount-exclusions', requirePermission('settings.*'), async (req, res) => {
  try {
    const row = await createDiscountExclusion(req.body);
    res.status(201).json(row);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.put('/discount-exclusions/:id', requirePermission('settings.*'), async (req, res) => {
  try {
    const row = await updateDiscountExclusion(Number(req.params.id), req.body);
    res.json(row);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/discount-exclusions/:id', requirePermission('settings.*'), async (req, res) => {
  try {
    const ok = await deleteDiscountExclusion(Number(req.params.id));
    if (!ok) return res.status(404).json({ error: 'غير موجود' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/', requirePermission('settings.*'), async (req, res) => {
  try {
    const settings = await getSettings();
    const logo_url = await getLogoUrl(getBaseUrl(req));
    res.json({ ...settings, logo_url });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/logo', requirePermission('settings.*'), upload.single('logo'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'لم يتم اختيار ملف' });
    const filename = await saveLogo(req.file);
    const logo_url = await getLogoUrl(getBaseUrl(req));
    res.json({ success: true, filename, logo_url });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.put('/general', requirePermission('settings.*'), async (req, res) => {
  try {
    const settings = await saveGeneralSettings(req.body);
    res.json(settings);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
