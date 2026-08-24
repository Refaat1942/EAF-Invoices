const QRCode = require('qrcode');
const puppeteer = require('puppeteer');
const { buildInvoiceHtml, buildDailyReportHtml } = require('./pdfService');
const { buildWordDocument } = require('./wordService');

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

async function generatePdfBuffer(invoice, baseUrl, { logoUrl } = {}) {
  const { getLogoUrl } = require('./settingsService');
  const resolvedLogo = logoUrl ?? (await getLogoUrl(baseUrl));
  const downloadUrl = `${baseUrl}/download/${invoice.qr_token}`;
  const qrDataUrl = await QRCode.toDataURL(downloadUrl, { width: 200, margin: 1 });
  const html = buildInvoiceHtml(invoice, { baseUrl, logoUrl: resolvedLogo, showQr: true, qrDataUrl });

  const browser = await getBrowser();
  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: 'networkidle0' });
  await page.evaluate(() => document.fonts.ready);
  const pdfBytes = await page.pdf({
    format: 'A4',
    printBackground: true,
    margin: { top: '0', right: '0', bottom: '0', left: '0' },
  });
  await page.close();

  return Buffer.from(pdfBytes);
}

async function generateDocxBuffer(invoice) {
  const buffer = await buildWordDocument(invoice);
  return Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
}

async function generateDailyItemsPdfBuffer(report, baseUrl, { logoUrl } = {}) {
  const { getLogoUrl } = require('./settingsService');
  const resolvedLogo = logoUrl ?? (await getLogoUrl(baseUrl));
  const html = buildDailyReportHtml(report, { logoUrl: resolvedLogo });

  const browser = await getBrowser();
  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: 'networkidle0' });
  await page.evaluate(() => document.fonts.ready);
  const pdfBytes = await page.pdf({
    format: 'A4',
    printBackground: true,
    margin: { top: '0', right: '0', bottom: '0', left: '0' },
  });
  await page.close();

  return Buffer.from(pdfBytes);
}

module.exports = { generatePdfBuffer, generateDocxBuffer, generateDailyItemsPdfBuffer };
