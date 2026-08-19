const express = require('express');
const QRCode = require('qrcode');
const {
  listInvoices,
  getInvoiceById,
  getInvoiceByToken,
  saveInvoice,
  deleteInvoice,
  getReportsSummary,
  INVOICE_TYPES,
} = require('../services/invoiceService');
const { calculateInvoiceTotals, calculateStayDays } = require('../services/calculations');
const { buildInvoiceHtml } = require('../services/pdfService');
const { generatePdfBuffer, generateDocxBuffer } = require('../services/exportService');
const { getLogoUrl } = require('../services/settingsService');
const { requireAuth, requirePermission } = require('../middleware/auth');

const router = express.Router();

router.use(requireAuth);

function getBaseUrl(req) {
  return `${req.protocol}://${req.get('host')}`;
}

router.get('/types', requirePermission('invoices.view'), (req, res) => {
  res.json(INVOICE_TYPES);
});

router.post('/calculate', requirePermission('invoices.view'), (req, res) => {
  const data = req.body;
  if (!data.stay_days && data.admission_date && data.discharge_date) {
    data.stay_days = calculateStayDays(data.admission_date, data.discharge_date);
  }
  res.json(calculateInvoiceTotals(data));
});

router.get('/', requirePermission('invoices.view'), async (req, res) => {
  try {
    const invoices = await listInvoices({
      invoice_type: req.query.type,
      from_date: req.query.from,
      to_date: req.query.to,
      search: req.query.search,
      limit: req.query.limit ? Number(req.query.limit) : undefined,
    });
    res.json(invoices);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/reports/summary', requirePermission('reports.view'), async (req, res) => {
  try {
    res.json(
      await getReportsSummary({
        invoice_type: req.query.type,
        from_date: req.query.from,
        to_date: req.query.to,
        search: req.query.search,
      })
    );
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id', requirePermission('invoices.view'), async (req, res) => {
  try {
    const invoice = await getInvoiceById(Number(req.params.id));
    if (!invoice) return res.status(404).json({ error: 'الفاتورة غير موجودة' });
    res.json(invoice);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', requirePermission('invoices.create'), async (req, res) => {
  try {
    if (!req.body.invoice_type) {
      return res.status(400).json({ error: 'يجب اختيار نوع الفاتورة' });
    }
    const invoice = await saveInvoice(req.body);
    res.status(201).json(invoice);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/:id', requirePermission('invoices.edit'), async (req, res) => {
  try {
    const invoice = await saveInvoice(req.body, Number(req.params.id));
    res.json(invoice);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', requirePermission('invoices.delete'), async (req, res) => {
  try {
    const deleted = await deleteInvoice(Number(req.params.id));
    if (!deleted) return res.status(404).json({ error: 'الفاتورة غير موجودة' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id/qr', requirePermission('invoices.view'), async (req, res) => {
  try {
    const invoice = await getInvoiceById(Number(req.params.id));
    if (!invoice) return res.status(404).json({ error: 'الفاتورة غير موجودة' });

    const baseUrl = getBaseUrl(req);
    const downloadUrl = `${baseUrl}/download/${invoice.qr_token}`;

    const qrDataUrl = await QRCode.toDataURL(downloadUrl, {
      width: 300,
      margin: 1,
      errorCorrectionLevel: 'H',
    });

    res.json({
      qr_data_url: qrDataUrl,
      download_url: downloadUrl,
      serial_number: invoice.serial_number,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id/preview', requirePermission('invoices.view'), async (req, res) => {
  try {
    const invoice = await getInvoiceById(Number(req.params.id));
    if (!invoice) return res.status(404).send('Not found');

    const baseUrl = getBaseUrl(req);
    const logoUrl = await getLogoUrl(baseUrl);
    const downloadUrl = `${baseUrl}/download/${invoice.qr_token}`;
    const qrDataUrl = await QRCode.toDataURL(downloadUrl, { width: 200, margin: 1 });

    const html = buildInvoiceHtml(invoice, { baseUrl, logoUrl, showQr: true, qrDataUrl });
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  } catch (err) {
    res.status(500).send(err.message);
  }
});

router.get('/:id/pdf', requirePermission('invoices.view'), async (req, res) => {
  try {
    const invoice = await getInvoiceById(Number(req.params.id));
    if (!invoice) return res.status(404).json({ error: 'الفاتورة غير موجودة' });

    const baseUrl = getBaseUrl(req);
    const pdf = await generatePdfBuffer(invoice, baseUrl, { encrypt: false });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="invoice-${invoice.serial_number}.pdf"`);
    res.send(pdf);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id/docx', requirePermission('invoices.view'), async (req, res) => {
  try {
    const invoice = await getInvoiceById(Number(req.params.id));
    if (!invoice) return res.status(404).json({ error: 'الفاتورة غير موجودة' });

    const buffer = await generateDocxBuffer(invoice, { encrypt: false });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', `attachment; filename="invoice-${invoice.serial_number}.docx"`);
    res.send(buffer);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
