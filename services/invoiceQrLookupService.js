/**
 * Resolve a scanned invoice QR (or a typed invoice serial) to the invoice and patient.
 * The QR encodes `<server>/download/<uuid token>`. Handheld scanners "type" the code, so on a
 * computer with an Arabic keyboard layout the letters arrive as Arabic characters.
 */
const { query } = require('../database/db');

// Arabic keyboard layout → the Latin key in the same position (only what a QR URL can contain).
const ARABIC_KEY_TO_LATIN = {
  'ض': 'q', 'ص': 'w', 'ث': 'e', 'ق': 'r', 'ف': 't', 'غ': 'y', 'ع': 'u', 'ه': 'i', 'خ': 'o', 'ح': 'p',
  'ش': 'a', 'س': 's', 'ي': 'd', 'ب': 'f', 'ل': 'g', 'ا': 'h', 'ت': 'j', 'ن': 'k', 'م': 'l',
  'ئ': 'z', 'ء': 'x', 'ؤ': 'c', 'ر': 'v', 'ى': 'n', 'ة': 'm', 'و': ',', 'ز': '.', 'ظ': '/',
  '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4', '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9',
};

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

function latinFromArabicKeyboard(text) {
  return String(text || '')
    .replace(/لا/g, 'b')
    .replace(/[؀-ۿ٠-٩]/g, (ch) => ARABIC_KEY_TO_LATIN[ch] ?? ch);
}

function extractQrToken(code) {
  const raw = String(code || '').trim();
  const direct = raw.match(UUID_RE);
  if (direct) return direct[0].toLowerCase();
  const converted = latinFromArabicKeyboard(raw).match(UUID_RE);
  return converted ? converted[0].toLowerCase() : null;
}

function looksLikeInvoiceSerial(code) {
  return /^[A-Z]{2,}-[A-Z]{2,}-\d{4}-\d{3,}$/i.test(String(code || '').trim());
}

async function lookupInvoiceByQr(code) {
  const token = extractQrToken(code);
  let rows = [];
  if (token) {
    ({ rows } = await query(
      `SELECT id, serial_number, status, file_number, patient_name FROM invoices WHERE qr_token = $1 LIMIT 1`,
      [token]
    ));
  }
  if (!rows.length) {
    const serial = String(code || '').trim().toUpperCase();
    if (looksLikeInvoiceSerial(serial)) {
      ({ rows } = await query(
        `SELECT id, serial_number, status, file_number, patient_name FROM invoices WHERE UPPER(serial_number) = $1 LIMIT 1`,
        [serial]
      ));
    }
  }
  const inv = rows[0];
  if (!inv) return null;
  return {
    invoice_id: inv.id,
    serial_number: inv.serial_number,
    status: inv.status,
    file_number: String(inv.file_number || '').trim(),
    patient_name: inv.patient_name || '',
  };
}

module.exports = { lookupInvoiceByQr, extractQrToken, latinFromArabicKeyboard, looksLikeInvoiceSerial };
