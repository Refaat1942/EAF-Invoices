const crypto = require('crypto');
const { getSetting } = require('./settingsService');

const APP_SECRET = process.env.APP_SECRET || 'eaf-invoices-secret-key';
const DEFAULT_PW_KEY = 'default_file_password';

function generateFilePassword(serialNumber) {
  return String(serialNumber || '').replace(/-/g, '');
}

async function resolveFilePasswordAsync(invoice) {
  if (invoice?.file_password && String(invoice.file_password).trim()) {
    return String(invoice.file_password).trim();
  }
  const defaultPw = await getSetting(DEFAULT_PW_KEY, '');
  if (defaultPw && String(defaultPw).trim()) {
    return String(defaultPw).trim();
  }
  return generateFilePassword(invoice?.serial_number);
}

function resolveFilePassword(invoice) {
  if (invoice?.file_password && String(invoice.file_password).trim()) {
    return String(invoice.file_password).trim();
  }
  return generateFilePassword(invoice?.serial_number);
}

async function resolveInvoiceFilePassword(data, serialNumber, existingPassword = '') {
  if (data.file_password !== undefined && String(data.file_password).trim()) {
    return String(data.file_password).trim();
  }
  if (existingPassword && String(existingPassword).trim()) {
    return String(existingPassword).trim();
  }
  return resolveFilePasswordAsync({ serial_number: serialNumber, file_password: '' });
}

function createDownloadToken(qrToken, password) {
  return crypto.createHmac('sha256', APP_SECRET).update(`${qrToken}:${password}`).digest('hex');
}

function verifyDownloadToken(qrToken, password, token) {
  if (!token || !password) return false;
  const expected = createDownloadToken(qrToken, password);
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(token));
  } catch {
    return false;
  }
}

function getCookieName(qrToken) {
  return `eaf_dl_${qrToken.slice(0, 12)}`;
}

module.exports = {
  DEFAULT_PW_KEY,
  generateFilePassword,
  resolveFilePassword,
  resolveFilePasswordAsync,
  resolveInvoiceFilePassword,
  createDownloadToken,
  verifyDownloadToken,
  getCookieName,
};
