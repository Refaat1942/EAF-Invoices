const crypto = require('crypto');

const APP_SECRET = process.env.APP_SECRET || 'eaf-invoices-secret-key';

function generateFilePassword(serialNumber) {
  // Default: serial number without dashes (easy to type)
  return String(serialNumber || '').replace(/-/g, '');
}

function resolveFilePassword(invoice, customPassword) {
  if (customPassword && String(customPassword).trim()) {
    return String(customPassword).trim();
  }
  if (invoice.file_password) {
    return invoice.file_password;
  }
  return generateFilePassword(invoice.serial_number);
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
  generateFilePassword,
  resolveFilePassword,
  createDownloadToken,
  verifyDownloadToken,
  getCookieName,
};
