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
const { resolveFilePassword } = require('../services/passwordService');

const router = express.Router();

function getBaseUrl(req) {
  const host = req.get('host');
  const protocol = req.protocol;
  return `${protocol}://${host}`;
}

router.get('/types', (req, res) => {
  res.json(INVOICE_TYPES);
});

router.post('/calculate', (req, res) => {
  const data = req.body;
  if (!data.stay_days && data.admission_date && data.discharge_date) {
    data.stay_days = calculateStayDays(data.admission_date, data.discharge_date);
  }
  res.json(calculateInvoiceTotals(data));
});

router.get('/', (req, res) => {
  const invoices = listInvoices({
    invoice_type: req.query.type,
    from_date: req.query.from,
    to_date: req.query.to,
    search: req.query.search,
    limit: req.query.limit ? Number(req.query.limit) : undefined,
  });
  res.json(invoices);
});

router.get('/reports/summary', (req, res) => {
  res.json(
    getReportsSummary({
      invoice_type: req.query.type,
      from_date: req.query.from,
      to_date: req.query.to,
      search: req.query.search,
    })
  );
});

router.get('/:id', (req, res) => {
  const invoice = getInvoiceById(Number(req.params.id));
  if (!invoice) return res.status(404).json({ error: 'الفاتورة غير موجودة' });
  res.json(invoice);
});

router.post('/', (req, res) => {
  try {
    if (!req.body.invoice_type) {
      return res.status(400).json({ error: 'يجب اختيار نوع الفاتورة' });
    }
    const invoice = saveInvoice(req.body);
    res.status(201).json(invoice);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/:id', (req, res) => {
  try {
    const invoice = saveInvoice(req.body, Number(req.params.id));
    res.json(invoice);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', (req, res) => {
  const deleted = deleteInvoice(Number(req.params.id));
  if (!deleted) return res.status(404).json({ error: 'الفاتورة غير موجودة' });
  res.json({ success: true });
});

router.get('/:id/qr', async (req, res) => {
  try {
    const invoice = getInvoiceById(Number(req.params.id));
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
      file_password: resolveFilePassword(invoice),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id/preview', async (req, res) => {
  try {
    const invoice = getInvoiceById(Number(req.params.id));
    if (!invoice) return res.status(404).send('Not found');

    const baseUrl = getBaseUrl(req);
    const downloadUrl = `${baseUrl}/download/${invoice.qr_token}`;
    const qrDataUrl = await QRCode.toDataURL(downloadUrl, { width: 200, margin: 1 });

    const html = buildInvoiceHtml(invoice, { baseUrl, showQr: true, qrDataUrl });
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  } catch (err) {
    res.status(500).send(err.message);
  }
});

router.get('/:id/pdf', async (req, res) => {
  try {
    const invoice = getInvoiceById(Number(req.params.id));
    if (!invoice) return res.status(404).json({ error: 'الفاتورة غير موجودة' });

    const baseUrl = getBaseUrl(req);
    const pdf = await generatePdfBuffer(invoice, baseUrl, { encrypt: true });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="invoice-${invoice.serial_number}.pdf"`
    );
    res.send(pdf);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id/docx', async (req, res) => {
  try {
    const invoice = getInvoiceById(Number(req.params.id));
    if (!invoice) return res.status(404).json({ error: 'الفاتورة غير موجودة' });

    const buffer = await generateDocxBuffer(invoice, { encrypt: true });
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    );
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="invoice-${invoice.serial_number}.docx"`
    );
    res.send(buffer);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
