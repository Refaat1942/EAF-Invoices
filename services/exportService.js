const QRCode = require('qrcode');
const puppeteer = require('puppeteer');
const { buildInvoiceHtml } = require('./pdfService');
const { buildWordDocument } = require('./wordService');
const { encryptPdfBuffer } = require('./pdfEncrypt');
const { encryptDocxBuffer } = require('./wordEncrypt');
const { resolveFilePasswordAsync } = require('./passwordService');

let browserInstance = null;

async function getBrowser() {
  if (!browserInstance || !browserInstance.isConnected()) {
    browserInstance = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--font-render-hinting=none'],
    });
  }
  return browserInstance;
}

async function generatePdfBuffer(invoice, baseUrl, { encrypt = true, logoUrl } = {}) {
  const { getLogoUrl } = require('./settingsService');
  const resolvedLogo = logoUrl || (await getLogoUrl(baseUrl));
  const downloadUrl = `${baseUrl}/download/${invoice.qr_token}`;
  const qrDataUrl = await QRCode.toDataURL(downloadUrl, { width: 200, margin: 1 });
  const html = buildInvoiceHtml(invoice, { baseUrl, logoUrl: resolvedLogo, showQr: true, qrDataUrl });

  const browser = await getBrowser();
  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: 'networkidle0' });
  let pdf = await page.pdf({
    format: 'A4',
    printBackground: true,
    margin: { top: '0', right: '0', bottom: '0', left: '0' },
  });
  await page.close();

  if (encrypt) {
    const password = await resolveFilePasswordAsync(invoice);
    pdf = encryptPdfBuffer(pdf, password);
  }

  return pdf;
}

async function generateDocxBuffer(invoice, { encrypt = true } = {}) {
  let buffer = await buildWordDocument(invoice);
  if (encrypt) {
    const password = await resolveFilePasswordAsync(invoice);
    buffer = await encryptDocxBuffer(buffer, password);
  }
  return buffer;
}

module.exports = { generatePdfBuffer, generateDocxBuffer };
