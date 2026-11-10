const express = require('express');
const QRCode = require('qrcode');
const { getInvoiceByToken } = require('../services/invoiceService');
const { buildInvoiceHtml } = require('../services/pdfService');
const { generatePdfBuffer, generateDocxBuffer } = require('../services/exportService');
const { getLogoUrl } = require('../services/settingsService');
const { cairoFontFaceCss } = require('../services/embeddedFonts');
const { getPublicBaseUrl, invoiceQrUrl } = require('../services/publicUrl');

const router = express.Router();

function getBaseUrl(req) {
  return `${req.protocol}://${req.get('host')}`;
}

// Scanning the printed QR opens the invoice as a PDF (shown in the phone's browser).
// ?format=page shows the web page with PDF / Word / print buttons, ?format=docx gives Word.
router.get('/:token', async (req, res) => {
  try {
    const invoice = await getInvoiceByToken(req.params.token);
    if (!invoice) return res.status(404).send(renderNotFound());
    // The printed QR shows only the issued invoice (or its cancellation): while it is back
    // in correction (returned / reopened) its content is not final and is not published.
    if (!['approved', 'cancelled'].includes(invoice.status)) {
      return res.status(409).send(renderUnderReview(invoice.serial_number));
    }

    const format = (req.query.format || 'pdf').toLowerCase();
    const baseUrl = getBaseUrl(req);
    const qrBaseUrl = getPublicBaseUrl(req);
    const logoUrl = await getLogoUrl(baseUrl);
    let pdfError = '';

    if (format === 'pdf') {
      try {
        const pdf = await generatePdfBuffer(invoice, baseUrl, { logoUrl, qrBaseUrl });
        const disposition = req.query.download === '1' ? 'attachment' : 'inline';
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `${disposition}; filename="invoice-${invoice.serial_number}.pdf"`);
        return res.send(pdf);
      } catch (err) {
        console.error('[download] PDF failed, showing the page instead:', err.message);
        pdfError = 'تعذر تجهيز ملف PDF على السيرفر — هذه نسخة الفاتورة للعرض والطباعة.';
      }
    }

    if (format === 'docx' || format === 'word') {
      const buffer = await generateDocxBuffer(invoice);
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
      res.setHeader('Content-Disposition', `attachment; filename="invoice-${invoice.serial_number}.docx"`);
      return res.send(buffer);
    }

    const qrDataUrl = await QRCode.toDataURL(invoiceQrUrl(qrBaseUrl, invoice.qr_token), { width: 200, margin: 1 });
    const html = await buildInvoiceHtml(invoice, { baseUrl, logoUrl, showQr: true, qrDataUrl });
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(wrapDownloadPage(html, invoice, baseUrl, pdfError));
  } catch (err) {
    res.status(500).send('خطأ في الخادم');
  }
});

function wrapDownloadPage(invoiceHtml, invoice, baseUrl, notice = '') {
  return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>فاتورة ${invoice.serial_number}</title>
  <style>${cairoFontFaceCss()}</style>
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
    <a class="btn-pdf" href="${baseUrl}/download/${invoice.qr_token}?format=pdf&download=1">تحميل PDF</a>
    <a class="btn-word" href="${baseUrl}/download/${invoice.qr_token}?format=docx">تحميل Word</a>
    <button class="btn-print" onclick="window.print()">طباعة</button>
  </div>
  ${notice ? `<div class="toolbar" style="color:#b45309;font-weight:800">${notice}</div>` : ''}
  ${invoiceHtml.match(/<body[^>]*>([\s\S]*)<\/body>/i)?.[1] || invoiceHtml}
</body>
</html>`;
}

function renderUnderReview(serial) {
  const safe = String(serial || '').replace(/[<>&"']/g, '');
  return `<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="UTF-8"><title>قيد المراجعة</title></head>
<body style="font-family:sans-serif;text-align:center;padding:40px;direction:rtl"><h1>الفاتورة ${safe} قيد المراجعة</h1>
<p>أُعيدت الفاتورة للتصحيح وستظهر هنا بعد اعتمادها من جديد.</p></body></html>`;
}

function renderNotFound() {
  return `<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="UTF-8"><title>غير موجود</title></head>
<body style="font-family:sans-serif;text-align:center;padding:40px;direction:rtl"><h1>الفاتورة غير موجودة</h1></body></html>`;
}

module.exports = router;
