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
const {
  listFinancialTreatments,
  createFinancialTreatment,
  updateFinancialTreatment,
  deleteFinancialTreatment,
} = require('../services/financialTreatmentService');
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
      if (!canAccess(req.session.user, perm)) {
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
    if (!canAccess(req.session.user, perm)) {
      return res.status(403).json({ error: 'ليس لديك صلاحية' });
    }
    res.json(await listContractedEntitiesTree(activeOnly));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
router.get('/discount-exclusions', lookupListHandler(listDiscountExclusions, 'invoices.view'));
router.get('/financial-treatments', lookupListHandler(listFinancialTreatments, 'invoices.view'));

router.post('/financial-treatments', requirePermission('settings.*'), async (req, res) => {
  try {
    const row = await createFinancialTreatment(req.body.name);
    res.status(201).json(row);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.put('/financial-treatments/:id', requirePermission('settings.*'), async (req, res) => {
  try {
    const row = await updateFinancialTreatment(Number(req.params.id), req.body);
    res.json(row);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/financial-treatments/:id', requirePermission('settings.*'), async (req, res) => {
  try {
    const ok = await deleteFinancialTreatment(Number(req.params.id));
    if (!ok) return res.status(404).json({ error: 'غير موجود' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

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

const entityUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 } });

router.get('/contracted-entities/import/template', requirePermission('settings.*'), async (req, res) => {
  try {
    const { exportContractedEntitiesTemplate } = require('../services/contractedEntityImportService');
    const buffer = await exportContractedEntitiesTemplate();
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="contracted-entities-template.xlsx"');
    res.send(Buffer.from(buffer));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/contracted-entities/import', requirePermission('settings.*'), entityUpload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'لم يتم اختيار ملف' });
    const { importContractedEntitiesFromBuffer } = require('../services/contractedEntityImportService');
    res.json(await importContractedEntitiesFromBuffer(req.file.buffer));
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

const { getBackupStatus, runBackup } = require('../services/backupService');

router.get('/backup', requirePermission('settings.*'), async (req, res) => {
  try {
    res.json(await getBackupStatus());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const {
  getCompanionKinds,
  saveCompanionKinds,
  buildTemplateWorkbook,
  importCompanionKindsFromBuffer,
} = require('../services/companionKindService');
const {
  getExamSpecialties,
  saveExamSpecialties,
  buildTemplateWorkbook: buildExamSpecialtyTemplate,
  importExamSpecialtiesFromBuffer,
} = require('../services/examSpecialtyService');

const companionUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
});

router.get('/companion-kinds', lookupListHandler(getCompanionKinds, 'daily_charges.view'));

router.put('/companion-kinds', requirePermission('settings.*'), async (req, res) => {
  try {
    res.json(await saveCompanionKinds(req.body.kinds || req.body || []));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get('/companion-kinds/template', requirePermission('settings.*'), async (req, res) => {
  try {
    const buffer = buildTemplateWorkbook();
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader('Content-Disposition', 'attachment; filename="companion-kinds-template.xlsx"');
    res.send(buffer);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post(
  '/companion-kinds/import',
  requirePermission('settings.*'),
  companionUpload.single('file'),
  async (req, res) => {
    try {
      if (!req.file?.buffer) return res.status(400).json({ error: 'الملف مطلوب' });
      const kinds = await importCompanionKindsFromBuffer(req.file.buffer);
      res.json({ success: true, kinds });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  }
);

router.get('/exam-specialties', lookupListHandler(
  (activeOnly) => getExamSpecialties({ activeOnly }),
  'daily_charges.view'
));

router.put('/exam-specialties', requirePermission('settings.*'), async (req, res) => {
  try {
    res.json(await saveExamSpecialties(req.body.specialties || req.body || []));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get('/exam-specialties/template', requirePermission('settings.*'), async (req, res) => {
  try {
    const buffer = await buildExamSpecialtyTemplate();
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="exam-specialties-template.xlsx"');
    res.send(buffer);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post(
  '/exam-specialties/import',
  requirePermission('settings.*'),
  companionUpload.single('file'),
  async (req, res) => {
    try {
      if (!req.file?.buffer) return res.status(400).json({ error: 'الملف مطلوب' });
      const specialties = await importExamSpecialtiesFromBuffer(req.file.buffer);
      res.json({ success: true, specialties });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  }
);

router.post('/backup/run', requirePermission('settings.*'), async (req, res) => {
  try {
    const result = await runBackup({ trigger: 'manual' });
    const status = await getBackupStatus();
    res.json({ ...result, status });
  } catch (err) {
    console.error('[backup] manual backup error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
