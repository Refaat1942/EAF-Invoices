const crypto = require('crypto');
const { getSetting } = require('./settingsService');

const APP_SECRET = process.env.APP_SECRET || 'eaf-invoices-secret-key';
const DEFAULT_PW_KEY = 'default_file_password';

function generateFilePassword(serialNumber) {
  return String(serialNumber || '').replace(/-/g, '');
}

async function resolveFilePasswordAsync(invoice) {
  const defaultPw = await getSetting(DEFAULT_PW_KEY, '');
  if (defaultPw && String(defaultPw).trim()) {
    return String(defaultPw).trim();
  }
  return generateFilePassword(invoice?.serial_number);
}

async function resolveStoredFilePassword(serialNumber) {
  return resolveFilePasswordAsync({ serial_number: serialNumber });
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
  resolveFilePasswordAsync,
  resolveStoredFilePassword,
  createDownloadToken,
  verifyDownloadToken,
  getCookieName,
};
