const { withTransaction, query } = require('../database/db');

const FISCAL_YEAR_START_MONTH = 6; // July (0 = Jan)

function getFiscalYearStart(referenceDate = new Date()) {
  let d;
  if (typeof referenceDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(referenceDate)) {
    const [y, m, day] = referenceDate.split('-').map(Number);
    d = new Date(y, m - 1, day);
  } else {
    d = referenceDate instanceof Date ? new Date(referenceDate) : new Date(referenceDate);
  }
  if (Number.isNaN(d.getTime())) {
    return getFiscalYearStart(new Date());
  }
  const month = d.getMonth();
  const year = d.getFullYear();
  return month >= FISCAL_YEAR_START_MONTH ? year : year - 1;
}

function getFiscalYearEnd(startYear) {
  return Number(startYear) + 1;
}

function formatFiscalYearLabel(startYear) {
  const start = Number(startYear);
  return `${start}/${start + 1}`;
}

function formatSerialNumber(fiscalYearStart, sequence) {
  return `EAF-${fiscalYearStart}-${String(sequence).padStart(6, '0')}`;
}

function parseSerialNumber(serial) {
  const match = String(serial || '').match(/^EAF-(\d{4})-(\d+)$/i);
  if (!match) return null;
  return {
    fiscal_year: Number(match[1]),
    serial_sequence: Number(match[2]),
  };
}

async function nextSerialNumber(client, referenceDate = new Date()) {
  const fiscalYear = getFiscalYearStart(referenceDate);

  await client.query(
    'INSERT INTO invoice_serial_counter (year, last_number) VALUES ($1, 0) ON CONFLICT (year) DO NOTHING',
    [fiscalYear]
  );

  const { rows } = await client.query(
    'SELECT last_number FROM invoice_serial_counter WHERE year = $1 FOR UPDATE',
    [fiscalYear]
  );
  const nextNumber = rows[0].last_number + 1;
  const serial = formatSerialNumber(fiscalYear, nextNumber);

  const exists = await client.query(
    'SELECT id FROM invoices WHERE fiscal_year = $1 AND serial_sequence = $2',
    [fiscalYear, nextNumber]
  );
  if (exists.rows.length) {
    throw new Error('تعارض في رقم الفاتورة داخل السنة المالية - يرجى المحاولة مرة أخرى');
  }

  const serialExists = await client.query('SELECT id FROM invoices WHERE serial_number = $1', [serial]);
  if (serialExists.rows.length) {
    throw new Error('تعارض في رقم الفاتورة - يرجى المحاولة مرة أخرى');
  }

  await client.query('UPDATE invoice_serial_counter SET last_number = $1 WHERE year = $2', [
    nextNumber,
    fiscalYear,
  ]);

  return {
    serial_number: serial,
    fiscal_year: fiscalYear,
    serial_sequence: nextNumber,
    fiscal_year_label: formatFiscalYearLabel(fiscalYear),
  };
}

async function peekNextSerialNumber(referenceDate = new Date()) {
  const fiscalYear = getFiscalYearStart(referenceDate);
  const { rows } = await query(
    'SELECT last_number FROM invoice_serial_counter WHERE year = $1',
    [fiscalYear]
  );
  const nextNumber = (rows[0]?.last_number || 0) + 1;
  return {
    serial_number: formatSerialNumber(fiscalYear, nextNumber),
    fiscal_year: fiscalYear,
    serial_sequence: nextNumber,
    fiscal_year_label: formatFiscalYearLabel(fiscalYear),
  };
}

async function syncSerialCountersFromInvoices(client = null) {
  const run = client ? client.query.bind(client) : query;
  await run(`
    UPDATE invoices
    SET
      fiscal_year = CASE
        WHEN fiscal_year IS NOT NULL THEN fiscal_year
        WHEN serial_number ~ '^EAF-[0-9]{4}-[0-9]+$'
          THEN (regexp_match(serial_number, '^EAF-([0-9]{4})-'))[1]::int
        WHEN COALESCE(issue_date, created_at::date) IS NOT NULL THEN
          CASE
            WHEN EXTRACT(MONTH FROM COALESCE(issue_date, created_at::date)) >= 7
              THEN EXTRACT(YEAR FROM COALESCE(issue_date, created_at::date))::int
            ELSE EXTRACT(YEAR FROM COALESCE(issue_date, created_at::date))::int - 1
          END
        ELSE NULL
      END,
      serial_sequence = CASE
        WHEN serial_sequence IS NOT NULL THEN serial_sequence
        WHEN serial_number ~ '^EAF-[0-9]{4}-[0-9]+$'
          THEN (regexp_match(serial_number, '-([0-9]+)$'))[1]::int
        ELSE NULL
      END
    WHERE fiscal_year IS NULL OR serial_sequence IS NULL
  `);

  await run(`
    INSERT INTO invoice_serial_counter (year, last_number)
    SELECT fiscal_year, MAX(serial_sequence)::int
    FROM invoices
    WHERE fiscal_year IS NOT NULL AND serial_sequence IS NOT NULL
    GROUP BY fiscal_year
    ON CONFLICT (year) DO UPDATE
      SET last_number = GREATEST(invoice_serial_counter.last_number, EXCLUDED.last_number)
  `);
}

async function generateSerialNumber(referenceDate = new Date()) {
  return withTransaction((client) => nextSerialNumber(client, referenceDate));
}

module.exports = {
  FISCAL_YEAR_START_MONTH,
  getFiscalYearStart,
  getFiscalYearEnd,
  formatFiscalYearLabel,
  formatSerialNumber,
  parseSerialNumber,
  nextSerialNumber,
  peekNextSerialNumber,
  syncSerialCountersFromInvoices,
  generateSerialNumber,
  withTransaction,
};
