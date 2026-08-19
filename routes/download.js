const express = require('express');
const QRCode = require('qrcode');
const { getInvoiceByToken } = require('../services/invoiceService');
const { buildInvoiceHtml } = require('../services/pdfService');
const { generatePdfBuffer, generateDocxBuffer } = require('../services/exportService');
const { getLogoUrl } = require('../services/settingsService');

const router = express.Router();

function getBaseUrl(req) {
  return `${req.protocol}://${req.get('host')}`;
}

router.get('/:token', async (req, res) => {
  try {
    const invoice = await getInvoiceByToken(req.params.token);
    if (!invoice) return res.status(404).send(renderNotFound());

    const format = (req.query.format || 'page').toLowerCase();
    const baseUrl = getBaseUrl(req);
    const logoUrl = await getLogoUrl(baseUrl);

    if (format === 'pdf') {
      const pdf = await generatePdfBuffer(invoice, baseUrl, { encrypt: false, logoUrl });
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="invoice-${invoice.serial_number}.pdf"`);
      return res.send(pdf);
    }

    if (format === 'docx' || format === 'word') {
      const buffer = await generateDocxBuffer(invoice, { encrypt: false });
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
      res.setHeader('Content-Disposition', `attachment; filename="invoice-${invoice.serial_number}.docx"`);
      return res.send(buffer);
    }

    const qrDataUrl = await QRCode.toDataURL(`${baseUrl}/download/${invoice.qr_token}`, { width: 200, margin: 1 });
    const html = buildInvoiceHtml(invoice, { baseUrl, logoUrl, showQr: true, qrDataUrl });
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(wrapDownloadPage(html, invoice, baseUrl));
  } catch (err) {
    res.status(500).send('خطأ في الخادم');
  }
});

function wrapDownloadPage(invoiceHtml, invoice, baseUrl) {
  return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>فاتورة ${invoice.serial_number}</title>
  <link href="https://fonts.googleapis.com/css2?family=Cairo:wght@700;800;900&display=swap" rel="stylesheet">
  <style>
    body { font-family: 'Cairo', sans-serif; background: #f0f2f5; margin: 0; padding: 16px; direction: rtl; }
    .toolbar { max-width: 210mm; margin: 0 auto 12px; display: flex; gap: 8px; flex-wrap: wrap; background: #fff; padding: 12px; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,.1); align-items: center; }
    .toolbar a, .toolbar button { font-family: inherit; font-weight: 800; padding: 10px 20px; border: none; border-radius: 6px; cursor: pointer; text-decoration: none; font-size: 14px; }
    .btn-pdf { background: #c0392b; color: #fff; } .btn-word { background: #2980b9; color: #fff; } .btn-print { background: #27ae60; color: #fff; }
    .serial { flex: 1; text-align: center; font-weight: 900; font-size: 16px; }
    @media print { .toolbar { display: none; } body { background: #fff; padding: 0; } }
  </style>
</head>
<body>
  <div class="toolbar">
    <span class="serial">رقم الفاتورة: ${invoice.serial_number}</span>
    <a class="btn-pdf" href="${baseUrl}/download/${invoice.qr_token}?format=pdf">تحميل PDF</a>
    <a class="btn-word" href="${baseUrl}/download/${invoice.qr_token}?format=docx">تحميل Word</a>
    <button class="btn-print" onclick="window.print()">طباعة</button>
  </div>
  ${invoiceHtml.match(/<body[^>]*>([\s\S]*)<\/body>/i)?.[1] || invoiceHtml}
</body>
</html>`;
}

function renderNotFound() {
  return `<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="UTF-8"><title>غير موجود</title></head>
<body style="font-family:sans-serif;text-align:center;padding:40px;direction:rtl"><h1>الفاتورة غير موجودة</h1></body></html>`;
}

module.exports = router;
