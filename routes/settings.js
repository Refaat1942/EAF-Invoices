const express = require('express');
const multer = require('multer');
const { listStayTypes, createStayType, updateStayType, deleteStayType } = require('../services/stayTypeService');
const { getSettings, saveLogo, getLogoUrl } = require('../services/settingsService');

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 3 * 1024 * 1024 },
});

function getBaseUrl(req) {
  return `${req.protocol}://${req.get('host')}`;
}

router.get('/stay-types', async (req, res) => {
  try {
    const activeOnly = req.query.all !== '1';
    res.json(await listStayTypes(activeOnly));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/stay-types', async (req, res) => {
  try {
    const row = await createStayType(req.body.name);
    res.status(201).json(row);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.put('/stay-types/:id', async (req, res) => {
  try {
    const row = await updateStayType(Number(req.params.id), req.body);
    res.json(row);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/stay-types/:id', async (req, res) => {
  try {
    const ok = await deleteStayType(Number(req.params.id));
    if (!ok) return res.status(404).json({ error: 'غير موجود' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/', async (req, res) => {
  try {
    const settings = await getSettings();
    const logo_url = await getLogoUrl(getBaseUrl(req));
    res.json({ ...settings, logo_url });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/logo', upload.single('logo'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'لم يتم اختيار ملف' });
    const filename = await saveLogo(req.file);
    const logo_url = await getLogoUrl(getBaseUrl(req));
    res.json({ success: true, filename, logo_url });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
