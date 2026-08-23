const express = require('express');
const {
  listSections,
  getSectionsWithServices,
  getEntryByPatientDate,
  listEntries,
  listEntryHistory,
  saveEntry,
  getEntriesForInvoice,
  getInvoiceItemsFromDailyCharges,
} = require('../services/dailyChargeService');
const { upsertPatient } = require('../services/patientService');
const { requireAuth, requirePermission } = require('../middleware/auth');

const router = express.Router();

router.use(requireAuth);

router.get('/sections', requirePermission('daily_charges.view'), async (req, res) => {
  try {
    const withServices = req.query.with_services === '1';
    res.json(withServices ? await getSectionsWithServices() : await listSections());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/entries', requirePermission('daily_charges.view'), async (req, res) => {
  try {
    res.json(
      await listEntries({
        patient_id: req.query.patient_id,
        file_number: req.query.file_number,
        from_date: req.query.from_date,
        to_date: req.query.to_date,
        uninvoiced_only: req.query.uninvoiced_only === '1',
        invoice_id: req.query.invoice_id,
        limit: req.query.limit,
      })
    );
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/entries/by-date', requirePermission('daily_charges.view'), async (req, res) => {
  try {
    const { file_number, entry_date, patient_name } = req.query;
    if (!file_number || !entry_date) {
      return res.status(400).json({ error: 'file_number و entry_date مطلوبان' });
    }
    const patient = await upsertPatient(file_number, patient_name || '');
    const entry = await getEntryByPatientDate(patient.id, entry_date);
    res.json(entry || { file_number, entry_date, lines: [], daily_total: 0 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/entries/:id/history', requirePermission('daily_charges.view'), async (req, res) => {
  try {
    res.json(await listEntryHistory(Number(req.params.id)));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/entries', requirePermission('daily_charges.manage'), async (req, res) => {
  try {
    const entry = await saveEntry(req.body, req.session?.user || null);
    res.json(entry);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get('/for-invoice', requirePermission('invoices.view'), async (req, res) => {
  try {
    const { file_number, from_date, to_date, invoice_id } = req.query;
    if (!file_number) return res.status(400).json({ error: 'file_number مطلوب' });
    const entries = await getEntriesForInvoice(file_number, from_date, to_date, invoice_id || null);
    const items = await getInvoiceItemsFromDailyCharges(file_number, from_date, to_date, invoice_id || null);
    res.json({
      entries,
      items,
      total: items.reduce((sum, item) => sum + (Number(item.quantity) || 0) * (Number(item.amount) || 0), 0),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
