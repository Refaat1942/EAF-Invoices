const express = require('express');
const QRCode = require('qrcode');
const puppeteer = require('puppeteer');
const { getInvoiceByToken } = require('../services/invoiceService');
const { buildInvoiceHtml } = require('../services/pdfService');
const { buildWordDocument } = require('../services/wordService');

const router = express.Router();

function getBaseUrl(req) {
  return `${req.protocol}://${req.get('host')}`;
}

router.get('/:token', async (req, res) => {
  const invoice = getInvoiceByToken(req.params.token);
  if (!invoice) return res.status(404).send(renderNotFound());

  const format = (req.query.format || 'page').toLowerCase();
  const baseUrl = getBaseUrl(req);

  if (format === 'pdf') {
    try {
      const downloadUrl = `${baseUrl}/download/${invoice.qr_token}?format=pdf`;
      const qrDataUrl = await QRCode.toDataURL(downloadUrl, { width: 200, margin: 1 });
      const html = buildInvoiceHtml(invoice, { baseUrl, showQr: true, qrDataUrl });

      const browser = await puppeteer.launch({
        headless: 'new',
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
      });
      const page = await browser.newPage();
      await page.setContent(html, { waitUntil: 'networkidle0' });
      const pdf = await page.pdf({ format: 'A4', printBackground: true, margin: { top: 0, right: 0, bottom: 0, left: 0 } });
      await browser.close();

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="invoice-${invoice.serial_number}.pdf"`);
      return res.send(pdf);
    } catch (err) {
      return res.status(500).send('خطأ في إنشاء PDF');
    }
  }

  if (format === 'docx' || format === 'word') {
    try {
      const buffer = await buildWordDocument(invoice);
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
      res.setHeader('Content-Disposition', `attachment; filename="invoice-${invoice.serial_number}.docx"`);
      return res.send(buffer);
    } catch (err) {
      return res.status(500).send('خطأ في إنشاء Word');
    }
  }

  const qrDataUrl = await QRCode.toDataURL(`${baseUrl}/download/${invoice.qr_token}`, { width: 200, margin: 1 });
  const html = buildInvoiceHtml(invoice, { baseUrl, showQr: true, qrDataUrl });

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(wrapDownloadPage(html, invoice, baseUrl));
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
    .toolbar {
      max-width: 210mm; margin: 0 auto 12px; display: flex; gap: 8px; flex-wrap: wrap;
      background: #fff; padding: 12px; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,.1);
    }
    .toolbar a, .toolbar button {
      font-family: inherit; font-weight: 800; padding: 10px 20px; border: none; border-radius: 6px;
      cursor: pointer; text-decoration: none; font-size: 14px;
    }
    .btn-pdf { background: #c0392b; color: #fff; }
    .btn-word { background: #2980b9; color: #fff; }
    .btn-print { background: #27ae60; color: #fff; }
    .serial { flex: 1; text-align: center; font-weight: 900; font-size: 16px; align-self: center; }
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
