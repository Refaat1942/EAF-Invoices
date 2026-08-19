const express = require('express');
const QRCode = require('qrcode');
const { getInvoiceByToken } = require('../services/invoiceService');
const { buildInvoiceHtml } = require('../services/pdfService');
const { generatePdfBuffer, generateDocxBuffer } = require('../services/exportService');
const { getLogoUrl } = require('../services/settingsService');
const { resolveFilePasswordAsync, createDownloadToken, verifyDownloadToken, getCookieName } = require('../services/passwordService');

const router = express.Router();

function getBaseUrl(req) {
  return `${req.protocol}://${req.get('host')}`;
}

async function isAuthorized(req, invoice) {
  const cookieName = getCookieName(invoice.qr_token);
  const token = req.cookies?.[cookieName] || req.query.auth;
  const password = await resolveFilePasswordAsync(invoice);
  return verifyDownloadToken(invoice.qr_token, password, token);
}

router.post('/:token/verify', express.urlencoded({ extended: true }), async (req, res) => {
  try {
    const invoice = await getInvoiceByToken(req.params.token);
    if (!invoice) return res.status(404).json({ error: 'الفاتورة غير موجودة' });

    const submitted = String(req.body.password || '').trim();
    const expected = await resolveFilePasswordAsync(invoice);

    if (submitted !== expected) {
      return res.status(401).json({ error: 'كلمة المرور غير صحيحة' });
    }

    const authToken = createDownloadToken(invoice.qr_token, expected);
    const cookieName = getCookieName(invoice.qr_token);
    res.cookie(cookieName, authToken, {
      httpOnly: true,
      maxAge: 60 * 60 * 1000,
      sameSite: 'lax',
    });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:token', async (req, res) => {
  try {
    const invoice = await getInvoiceByToken(req.params.token);
    if (!invoice) return res.status(404).send(renderNotFound());

    const format = (req.query.format || 'page').toLowerCase();
    const baseUrl = getBaseUrl(req);
    const logoUrl = await getLogoUrl(baseUrl);
    const authorized = await isAuthorized(req, invoice);

    if ((format === 'pdf' || format === 'docx' || format === 'word') && !authorized) {
      return res.status(401).send(renderPasswordPage(invoice, baseUrl, 'يجب إدخال كلمة المرور أولاً'));
    }

    if (format === 'pdf') {
      const pdf = await generatePdfBuffer(invoice, baseUrl, { encrypt: true, logoUrl });
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="invoice-${invoice.serial_number}.pdf"`);
      return res.send(pdf);
    }

    if (format === 'docx' || format === 'word') {
      const buffer = await generateDocxBuffer(invoice, { encrypt: true });
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
      res.setHeader('Content-Disposition', `attachment; filename="invoice-${invoice.serial_number}.docx"`);
      return res.send(buffer);
    }

    if (!authorized) {
      return res.send(await renderPasswordPage(invoice, baseUrl));
    }

    const qrDataUrl = await QRCode.toDataURL(`${baseUrl}/download/${invoice.qr_token}`, { width: 200, margin: 1 });
    const html = buildInvoiceHtml(invoice, { baseUrl, logoUrl, showQr: true, qrDataUrl });
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(await wrapDownloadPage(html, invoice, baseUrl));
  } catch (err) {
    res.status(500).send('خطأ في الخادم');
  }
});

function renderPasswordPage(invoice, baseUrl, errorMsg = '') {
  return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>كلمة مرور الفاتورة</title>
  <link href="https://fonts.googleapis.com/css2?family=Cairo:wght@700;800;900&display=swap" rel="stylesheet">
  <style>
    body { font-family: 'Cairo', sans-serif; background: #eef1f6; margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center; direction: rtl; }
    .card { background: #fff; padding: 32px; border-radius: 12px; box-shadow: 0 4px 20px rgba(0,0,0,.1); width: min(400px, 90vw); text-align: center; }
    h1 { font-size: 1.3rem; font-weight: 900; margin: 0 0 8px; }
    .serial { color: #0d6efd; font-weight: 900; margin-bottom: 20px; }
    label { display: block; font-weight: 800; margin-bottom: 8px; text-align: right; }
    input { width: 100%; padding: 12px; font-size: 1.1rem; font-weight: 800; border: 2px solid #ccc; border-radius: 8px; text-align: center; letter-spacing: 1px; box-sizing: border-box; }
    button { width: 100%; margin-top: 16px; padding: 14px; background: #0d6efd; color: #fff; border: none; border-radius: 8px; font-family: inherit; font-weight: 900; font-size: 1rem; cursor: pointer; }
    .error { color: #dc3545; font-weight: 800; margin-top: 12px; }
    .hint { color: #666; font-size: 0.85rem; margin-top: 16px; font-weight: 700; }
  </style>
</head>
<body>
  <div class="card">
    <h1>🔒 فاتورة محمية</h1>
    <div class="serial">${invoice.serial_number}</div>
    <form id="pw-form">
      <label for="password">كلمة مرور الملف</label>
      <input type="password" id="password" name="password" placeholder="أدخل كلمة المرور" required autofocus>
      <button type="submit">فتح الفاتورة</button>
    </form>
    ${errorMsg ? `<div class="error">${errorMsg}</div>` : ''}
    <p class="hint">كلمة المرور = رقم الفاتورة بدون شرطات<br><strong>مثال: EAF-2026-000001 ← EAF2026000001</strong></p>
  </div>
  <script>
    document.getElementById('pw-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const password = document.getElementById('password').value;
      const res = await fetch('${baseUrl}/download/${invoice.qr_token}/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'password=' + encodeURIComponent(password)
      });
      if (res.ok) {
        window.location.href = '${baseUrl}/download/${invoice.qr_token}';
      } else {
        const data = await res.json();
        alert(data.error || 'كلمة المرور غير صحيحة');
      }
    });
  </script>
</body>
</html>`;
}

async function wrapDownloadPage(invoiceHtml, invoice, baseUrl) {
  const password = await resolveFilePasswordAsync(invoice);
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
    .pw-note { width: 100%; text-align: center; font-weight: 800; color: #666; font-size: 0.85rem; }
    @media print { .toolbar { display: none; } body { background: #fff; padding: 0; } }
  </style>
</head>
<body>
  <div class="toolbar">
    <span class="serial">رقم الفاتورة: ${invoice.serial_number}</span>
    <a class="btn-pdf" href="${baseUrl}/download/${invoice.qr_token}?format=pdf">تحميل PDF 🔒</a>
    <a class="btn-word" href="${baseUrl}/download/${invoice.qr_token}?format=docx">تحميل Word 🔒</a>
    <button class="btn-print" onclick="window.print()">طباعة</button>
    <div class="pw-note">كلمة مرور الملف: <strong>${password}</strong></div>
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
