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

function normalizeSerialScope(patientType) {
  return String(patientType || '').trim().toLowerCase() === 'external' ? 'external' : 'internal';
}

function formatSerialNumber(fiscalYearStart, sequence, patientScope = 'internal') {
  const scope = normalizeSerialScope(patientScope);
  const scopeTag = scope === 'external' ? 'EXT' : 'INT';
  return `EAF-${scopeTag}-${fiscalYearStart}-${String(sequence).padStart(6, '0')}`;
}

function parseSerialNumber(serial) {
  const scoped = String(serial || '').match(/^EAF-(INT|EXT)-(\d{4})-(\d+)$/i);
  if (scoped) {
    return {
      fiscal_year: Number(scoped[2]),
      serial_sequence: Number(scoped[3]),
      serial_scope: scoped[1].toUpperCase() === 'EXT' ? 'external' : 'internal',
    };
  }
  const legacy = String(serial || '').match(/^EAF-(\d{4})-(\d+)$/i);
  if (!legacy) return null;
  return {
    fiscal_year: Number(legacy[1]),
    serial_sequence: Number(legacy[2]),
    serial_scope: 'legacy',
  };
}

async function nextSerialNumber(client, referenceDate = new Date(), patientScope = 'internal') {
  const fiscalYear = getFiscalYearStart(referenceDate);
  const scope = normalizeSerialScope(patientScope);

  await client.query(
    `INSERT INTO invoice_serial_counters (fiscal_year, patient_scope, last_number)
     VALUES ($1, $2, 0) ON CONFLICT (fiscal_year, patient_scope) DO NOTHING`,
    [fiscalYear, scope]
  );

  const { rows } = await client.query(
    `SELECT last_number FROM invoice_serial_counters
     WHERE fiscal_year = $1 AND patient_scope = $2 FOR UPDATE`,
    [fiscalYear, scope]
  );
  const nextNumber = rows[0].last_number + 1;
  const serial = formatSerialNumber(fiscalYear, nextNumber, scope);

  const exists = await client.query(
    `SELECT id FROM invoices
     WHERE fiscal_year = $1 AND serial_sequence = $2 AND COALESCE(serial_scope, 'legacy') = $3`,
    [fiscalYear, nextNumber, scope]
  );
  if (exists.rows.length) {
    throw new Error('تعارض في رقم الفاتورة داخل السنة المالية - يرجى المحاولة مرة أخرى');
  }

  const serialExists = await client.query('SELECT id FROM invoices WHERE serial_number = $1', [serial]);
  if (serialExists.rows.length) {
    throw new Error('تعارض في رقم الفاتورة - يرجى المحاولة مرة أخرى');
  }

  await client.query(
    `UPDATE invoice_serial_counters SET last_number = $1
     WHERE fiscal_year = $2 AND patient_scope = $3`,
    [nextNumber, fiscalYear, scope]
  );

  return {
    serial_number: serial,
    fiscal_year: fiscalYear,
    serial_sequence: nextNumber,
    serial_scope: scope,
    fiscal_year_label: formatFiscalYearLabel(fiscalYear),
  };
}

async function peekNextSerialNumber(referenceDate = new Date(), patientScope = 'internal') {
  const fiscalYear = getFiscalYearStart(referenceDate);
  const scope = normalizeSerialScope(patientScope);
  const { rows } = await query(
    `SELECT last_number FROM invoice_serial_counters
     WHERE fiscal_year = $1 AND patient_scope = $2`,
    [fiscalYear, scope]
  );
  const nextNumber = (rows[0]?.last_number || 0) + 1;
  return {
    serial_number: formatSerialNumber(fiscalYear, nextNumber, scope),
    fiscal_year: fiscalYear,
    serial_sequence: nextNumber,
    serial_scope: scope,
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
        WHEN serial_number ~ '^EAF-(INT|EXT)-[0-9]{4}-[0-9]+$'
          THEN (regexp_match(serial_number, '^EAF-(?:INT|EXT)-([0-9]{4})-'))[1]::int
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
        WHEN serial_number ~ '^EAF-(INT|EXT)-[0-9]{4}-[0-9]+$'
          THEN (regexp_match(serial_number, '-([0-9]+)$'))[1]::int
        WHEN serial_number ~ '^EAF-[0-9]{4}-[0-9]+$'
          THEN (regexp_match(serial_number, '-([0-9]+)$'))[1]::int
        ELSE NULL
      END,
      serial_scope = CASE
        WHEN serial_scope IS NOT NULL THEN serial_scope
        WHEN serial_number ~* '^EAF-EXT-' THEN 'external'
        WHEN serial_number ~* '^EAF-INT-' THEN 'internal'
        WHEN serial_number ~ '^EAF-[0-9]{4}-[0-9]+$' THEN 'legacy'
        ELSE serial_scope
      END
    WHERE fiscal_year IS NULL OR serial_sequence IS NULL OR serial_scope IS NULL
  `);

  await run(`
    INSERT INTO invoice_serial_counters (fiscal_year, patient_scope, last_number)
    SELECT fiscal_year,
      CASE
        WHEN COALESCE(serial_scope, 'legacy') = 'external' THEN 'external'
        ELSE 'internal'
      END,
      MAX(serial_sequence)::int
    FROM invoices
    WHERE fiscal_year IS NOT NULL AND serial_sequence IS NOT NULL
      AND COALESCE(serial_scope, 'legacy') <> 'legacy'
    GROUP BY fiscal_year,
      CASE
        WHEN COALESCE(serial_scope, 'legacy') = 'external' THEN 'external'
        ELSE 'internal'
      END
    ON CONFLICT (fiscal_year, patient_scope) DO UPDATE
      SET last_number = GREATEST(invoice_serial_counters.last_number, EXCLUDED.last_number)
  `);

  await run(`
    INSERT INTO invoice_serial_counter (year, last_number)
    SELECT fiscal_year, MAX(serial_sequence)::int
    FROM invoices
    WHERE fiscal_year IS NOT NULL AND serial_sequence IS NOT NULL
      AND COALESCE(serial_scope, 'legacy') = 'legacy'
    GROUP BY fiscal_year
    ON CONFLICT (year) DO UPDATE
      SET last_number = GREATEST(invoice_serial_counter.last_number, EXCLUDED.last_number)
  `);
}

async function syncPatientFileCountersFromPatients(client = null) {
  const run = client ? client.query.bind(client) : query;
  await run(`
    INSERT INTO patient_file_counter (patient_type, last_number)
    SELECT patient_type,
      COALESCE(MAX(
        CASE WHEN TRIM(file_number) ~ '^[0-9]+$' THEN TRIM(file_number)::int ELSE 0 END
      ), 0)::int
    FROM patients
    GROUP BY patient_type
    ON CONFLICT (patient_type) DO UPDATE
      SET last_number = GREATEST(patient_file_counter.last_number, EXCLUDED.last_number)
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
  normalizeSerialScope,
  nextSerialNumber,
  peekNextSerialNumber,
  syncSerialCountersFromInvoices,
  syncPatientFileCountersFromPatients,
  generateSerialNumber,
  withTransaction,
};
