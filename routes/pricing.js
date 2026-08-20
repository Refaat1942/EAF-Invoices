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
const { requireAuth, requirePermission } = require('../middleware/auth');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

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

router.post('/import-csv', requirePermission('settings.*'), upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'الملف مطلوب' });
    const list = req.body.price_list_id
      ? await getPriceListById(Number(req.body.price_list_id))
      : await getDefaultPriceList();
    if (!list) return res.status(400).json({ error: 'لا توجد لائحة أسعار' });
    const rows = await parseCsvServices(req.file.buffer.toString('utf8'));
    const result = await importServicesCsv(list.id, rows, actor(req));
    res.json(result);
  } catch (err) {
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

router.post('/import-docx', requirePermission('settings.*'), upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'الملف مطلوب' });
    const tempPath = path.join(__dirname, '..', 'data', `import-${Date.now()}.docx`);
    fs.mkdirSync(path.dirname(tempPath), { recursive: true });
    fs.writeFileSync(tempPath, req.file.buffer);
    const payload = await parseDocxPriceList(tempPath, req.body || {});
    const result = await importPriceListPayload(payload, actor(req), { replaceExisting: req.body?.replace_existing === 'true' });
    fs.unlinkSync(tempPath);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
