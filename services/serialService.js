const { withTransaction } = require('../database/db');

async function nextSerialNumber(client) {
  const year = new Date().getFullYear();
  const prefix = `EAF-${year}-`;

  await client.query(
    'INSERT INTO invoice_serial_counter (year, last_number) VALUES ($1, 0) ON CONFLICT (year) DO NOTHING',
    [year]
  );

  const { rows } = await client.query(
    'SELECT last_number FROM invoice_serial_counter WHERE year = $1 FOR UPDATE',
    [year]
  );
  const nextNumber = rows[0].last_number + 1;

  await client.query('UPDATE invoice_serial_counter SET last_number = $1 WHERE year = $2', [
    nextNumber,
    year,
  ]);

  const serial = `${prefix}${String(nextNumber).padStart(6, '0')}`;

  const exists = await client.query('SELECT id FROM invoices WHERE serial_number = $1', [serial]);
  if (exists.rows.length) {
    throw new Error('تعارض في رقم الفاتورة - يرجى المحاولة مرة أخرى');
  }

  return serial;
}

async function generateSerialNumber() {
  return withTransaction((client) => nextSerialNumber(client));
}

module.exports = { generateSerialNumber, nextSerialNumber, withTransaction };
