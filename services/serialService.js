const db = require('../database/db');

function withTransaction(fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

function nextSerialNumber() {
  const year = new Date().getFullYear();
  const prefix = `EAF-${year}-`;

  db.prepare(
    'INSERT INTO invoice_serial_counter (year, last_number) VALUES (?, 0) ON CONFLICT(year) DO NOTHING'
  ).run(year);

  const row = db.prepare('SELECT last_number FROM invoice_serial_counter WHERE year = ?').get(year);
  const nextNumber = row.last_number + 1;

  db.prepare('UPDATE invoice_serial_counter SET last_number = ? WHERE year = ?').run(nextNumber, year);

  const serial = `${prefix}${String(nextNumber).padStart(6, '0')}`;

  const exists = db.prepare('SELECT id FROM invoices WHERE serial_number = ?').get(serial);
  if (exists) {
    throw new Error('تعارض في رقم الفاتورة - يرجى المحاولة مرة أخرى');
  }

  return serial;
}

function generateSerialNumber() {
  return withTransaction(nextSerialNumber);
}

module.exports = { generateSerialNumber, nextSerialNumber, withTransaction };
