const fs = require('fs');
const QRCode = require('qrcode');
const puppeteer = require('puppeteer');
const { buildInvoiceHtml, buildDailyReportHtml } = require('./pdfService');
const { buildWordDocument } = require('./wordService');

let browserInstance = null;

// Browsers already installed on the machine — used when puppeteer's own Chrome was not
// downloaded (offline install). Edge ships with Windows, so Windows servers always have one.
const SYSTEM_BROWSER_PATHS = [
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/snap/bin/chromium',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
];

function resolveBrowserExecutablePath() {
  const fromEnv = String(process.env.PUPPETEER_EXECUTABLE_PATH || process.env.CHROME_PATH || '').trim();
  if (fromEnv) return fromEnv;
  try {
    const bundled = puppeteer.executablePath();
    if (bundled && fs.existsSync(bundled)) return undefined; // puppeteer's own Chrome
  } catch {
    /* not downloaded */
  }
  return SYSTEM_BROWSER_PATHS.find((candidate) => fs.existsSync(candidate));
}

async function getBrowser() {
  if (!browserInstance || !browserInstance.isConnected()) {
    const executablePath = resolveBrowserExecutablePath();
    browserInstance = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--font-render-hinting=none'],
      ...(executablePath ? { executablePath } : {}),
    });
  }
  return browserInstance;
}

async function generatePdfBuffer(invoice, baseUrl, { logoUrl } = {}) {
  const { getLogoUrl } = require('./settingsService');
  const resolvedLogo = logoUrl ?? (await getLogoUrl(baseUrl));
  const downloadUrl = `${baseUrl}/download/${invoice.qr_token}`;
  const qrDataUrl = await QRCode.toDataURL(downloadUrl, { width: 200, margin: 1 });
  const html = await buildInvoiceHtml(invoice, { baseUrl, logoUrl: resolvedLogo, showQr: true, qrDataUrl });

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
