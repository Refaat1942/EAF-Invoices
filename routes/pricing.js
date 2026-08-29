const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const {
  listPriceLists,
  getDefaultPriceList,
  getPriceListById,
  clonePriceList,
  setDefaultPriceList,
  getPricingSettings,
  savePricingSettings,
} = require('../services/priceListService');
const {
  listCategories,
  createCategory,
  updateCategory,
  listServices,
  getServiceById,
  createService,
  updateService,
  bulkUpdatePrices,
  exportServicesExcel,
  exportServicesCsv,
  importServicesCsv,
  parseCsvServices,
} = require('../services/serviceCatalogService');
const { importPriceListPayload, getPriceListStats } = require('../database/seeds/seedPriceList');
const { parseDocxPriceList } = require('../services/docxPriceListParser');
const { normalizeDocxImportPayload } = require('../services/priceListImportNormalizer');
const { requireAuth, requirePermission } = require('../middleware/auth');

const router = express.Router();
const IMPORT_DIR = path.join(__dirname, '..', 'data', 'imports');
const MAX_IMPORT_MB = 100;

const upload = multer({
  storage: multer.diskStorage({
    destination(_req, _file, cb) {
      fs.mkdirSync(IMPORT_DIR, { recursive: true });
      cb(null, IMPORT_DIR);
    },
    filename(_req, file, cb) {
      const ext = path.extname(file.originalname || '').toLowerCase() || '.bin';
      cb(null, `import-${Date.now()}${ext}`);
    },
  }),
  limits: { fileSize: MAX_IMPORT_MB * 1024 * 1024 },
});

function handleUpload(fieldName) {
  return (req, res, next) => {
    upload.single(fieldName)(req, res, (err) => {
      if (err?.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ error: `حجم الملف كبير جداً — الحد الأقصى ${MAX_IMPORT_MB} MB` });
      }
      if (err) return res.status(400).json({ error: err.message || 'فشل رفع الملف' });
      next();
    });
  };
}

function readUploadedFile(req) {
  if (req.file?.path) return fs.readFileSync(req.file.path);
  if (req.file?.buffer) return req.file.buffer;
  return null;
}

function cleanupUploadedFile(req) {
  if (req.file?.path && fs.existsSync(req.file.path)) {
    try {
      fs.unlinkSync(req.file.path);
    } catch {
      /* ignore */
    }
  }
}

router.use(requireAuth);

function actor(req) {
  const user = req.session.user;
  return user ? { id: user.id, name: user.full_name || user.username } : null;
}

router.get('/settings', requirePermission('settings.*'), async (req, res) => {
  try {
    res.json(await getPricingSettings());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/settings', requirePermission('settings.*'), async (req, res) => {
  try {
    res.json(await savePricingSettings(req.body));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get('/lists', requirePermission('invoices.view'), async (req, res) => {
  try {
    res.json(await listPriceLists(req.query.all !== '1'));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/lists/default', requirePermission('invoices.view'), async (req, res) => {
  try {
    const list = await getDefaultPriceList();
    if (!list) return res.status(404).json({ error: 'لا توجد لائحة أسعار' });
    const stats = await getPriceListStats(list.id);
    res.json({ ...list, ...stats });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/lists/:id/clone', requirePermission('settings.*'), async (req, res) => {
  try {
    res.status(201).json(await clonePriceList(Number(req.params.id), req.body, actor(req)));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/lists/:id/default', requirePermission('settings.*'), async (req, res) => {
  try {
    res.json(await setDefaultPriceList(Number(req.params.id)));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get('/categories', requirePermission('invoices.view'), async (req, res) => {
  try {
    const list = req.query.price_list_id
      ? await getPriceListById(Number(req.query.price_list_id))
      : await getDefaultPriceList();
    if (!list) return res.json([]);
    res.json(await listCategories(list.id, req.query.all !== '1'));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/categories', requirePermission('settings.*'), async (req, res) => {
  try {
    const list = req.body.price_list_id
      ? await getPriceListById(Number(req.body.price_list_id))
      : await getDefaultPriceList();
    if (!list) return res.status(400).json({ error: 'لا توجد لائحة أسعار' });
    res.status(201).json(await createCategory(list.id, req.body));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.put('/categories/:id', requirePermission('settings.*'), async (req, res) => {
  try {
    res.json(await updateCategory(Number(req.params.id), req.body));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get('/services', requirePermission('invoices.view'), async (req, res) => {
  try {
    res.json(
      await listServices({
        price_list_id: req.query.price_list_id ? Number(req.query.price_list_id) : undefined,
        category_id: req.query.category_id ? Number(req.query.category_id) : undefined,
        search: req.query.search,
        discountable: req.query.discountable,
        active_only: req.query.all !== '1',
        limit: req.query.limit ? Number(req.query.limit) : undefined,
      })
    );
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/services/:id', requirePermission('invoices.view'), async (req, res) => {
  try {
    const service = await getServiceById(Number(req.params.id));
    if (!service) return res.status(404).json({ error: 'الخدمة غير موجودة' });
    res.json(service);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/services', requirePermission('settings.*'), async (req, res) => {
  try {
    const list = req.body.price_list_id
      ? await getPriceListById(Number(req.body.price_list_id))
      : await getDefaultPriceList();
    if (!list) return res.status(400).json({ error: 'لا توجد لائحة أسعار' });
    res.status(201).json(await createService({ ...req.body, price_list_id: list.id }, actor(req)));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.put('/services/:id', requirePermission('settings.*'), async (req, res) => {
  try {
    res.json(await updateService(Number(req.params.id), req.body, actor(req)));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/services/bulk-update', requirePermission('settings.*'), async (req, res) => {
  try {
    res.json(await bulkUpdatePrices(req.body.updates || [], actor(req)));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get('/services-export', requirePermission('settings.*'), async (req, res) => {
  try {
    const list = req.query.price_list_id
      ? await getPriceListById(Number(req.query.price_list_id))
      : await getDefaultPriceList();
    if (!list) return res.status(404).json({ error: 'لا توجد لائحة' });
    if (req.query.format === 'csv') {
      const csv = await exportServicesCsv(list.id);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="eaf-prices-${list.code}.csv"`);
      return res.send(csv);
    }
    const buffer = await exportServicesExcel(list.id);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="eaf-prices-${list.code}.xlsx"`);
    res.send(Buffer.from(buffer));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/import-csv', requirePermission('settings.*'), handleUpload('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'الملف مطلوب' });
    const list = req.body.price_list_id
      ? await getPriceListById(Number(req.body.price_list_id))
      : await getDefaultPriceList();
    if (!list) return res.status(400).json({ error: 'لا توجد لائحة أسعار' });
    const buffer = readUploadedFile(req);
    const rows = await parseCsvServices(buffer.toString('utf8'));
    const result = await importServicesCsv(list.id, rows, actor(req));
    cleanupUploadedFile(req);
    res.json(result);
  } catch (err) {
    cleanupUploadedFile(req);
    res.status(400).json({ error: err.message });
  }
});

router.post('/import-json', requirePermission('settings.*'), async (req, res) => {
  try {
    const result = await importPriceListPayload(req.body, actor(req), { replaceExisting: !!req.body.replace_existing });
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/import-docx', requirePermission('settings.*'), handleUpload('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'الملف مطلوب' });
    const tempPath = req.file.path;
    const payload = await parseDocxPriceList(tempPath, req.body || {});
    const normalizedPayload = normalizeDocxImportPayload(payload);
    const result = await importPriceListPayload(normalizedPayload, actor(req), { replaceExisting: req.body?.replace_existing === 'true' });
    cleanupUploadedFile(req);
    res.json({ ...result, parse_stats: payload.parse_stats || null });
  } catch (err) {
    cleanupUploadedFile(req);
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
