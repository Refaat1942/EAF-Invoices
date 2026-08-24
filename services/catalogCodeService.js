const { query, withTransaction } = require('../database/db');

const SEVEN_DIGIT_RE = /^[0-9]{7}$/;
const MAX_CODE_NUMBER = 9999999;

function isValidSevenDigitCode(code) {
  return SEVEN_DIGIT_RE.test(String(code || '').trim());
}

function formatSevenDigitCode(n) {
  const num = Number(n);
  if (!Number.isFinite(num) || num < 1 || num > MAX_CODE_NUMBER) {
    throw new Error('تجاوز حد توليد الكود (7 أرقام)');
  }
  return String(num).padStart(7, '0');
}

async function bumpSequenceToAtLeast(codeNumber, client) {
  const run = client ? client.query.bind(client) : query;
  await run(
    `UPDATE daily_entry_catalog_code_sequence
     SET last_number = GREATEST(last_number, $1::bigint)
     WHERE id = 1`,
    [codeNumber]
  );
}

async function allocateNextCatalogCode(client) {
  const run = client.query.bind(client);
  await run(`SELECT id FROM daily_entry_catalog_code_sequence WHERE id = 1 FOR UPDATE`);
  const { rows } = await run(
    `UPDATE daily_entry_catalog_code_sequence
     SET last_number = last_number + 1
     WHERE id = 1
     RETURNING last_number`
  );
  const code = formatSevenDigitCode(rows[0].last_number);
  await run(`INSERT INTO daily_entry_catalog_code_registry (code, catalog_item_id) VALUES ($1, NULL)`, [code]);
  return code;
}

async function reserveCatalogCode(code, catalogItemId, client) {
  const normalized = String(code || '').trim();
  if (!isValidSevenDigitCode(normalized)) {
    throw new Error('الكود يجب أن يكون 7 أرقام');
  }

  const run = client.query.bind(client);
  const registry = await run(
    `SELECT catalog_item_id FROM daily_entry_catalog_code_registry WHERE code = $1`,
    [normalized]
  );

  if (registry.rows.length) {
    const assignedId = registry.rows[0].catalog_item_id;
    if (assignedId && catalogItemId && Number(assignedId) !== Number(catalogItemId)) {
      throw new Error(`الكود «${normalized}» مستخدم بالفعل`);
    }
    if (catalogItemId) {
      await run(
        `UPDATE daily_entry_catalog_code_registry SET catalog_item_id = $2 WHERE code = $1`,
        [normalized, Number(catalogItemId)]
      );
    }
    await bumpSequenceToAtLeast(Number(normalized), client);
    return normalized;
  }

  const dup = await run(
    `SELECT id FROM daily_entry_catalog_items WHERE code = $1 AND ($2::int IS NULL OR id <> $2)`,
    [normalized, catalogItemId || null]
  );
  if (dup.rows.length) {
    throw new Error(`الكود «${normalized}» مستخدم بالفعل`);
  }

  await run(
    `INSERT INTO daily_entry_catalog_code_registry (code, catalog_item_id) VALUES ($1, $2)`,
    [normalized, catalogItemId || null]
  );
  await bumpSequenceToAtLeast(Number(normalized), client);
  return normalized;
}

async function resolveCatalogItemCode(proposedCode, catalogItemId, client) {
  const trimmed = String(proposedCode || '').trim();
  if (trimmed) {
    if (!isValidSevenDigitCode(trimmed)) {
      throw new Error('الكود غير صالح — يجب أن يكون 7 أرقام أو يُترك فارغًا للتوليد التلقائي');
    }
    return reserveCatalogCode(trimmed, catalogItemId, client);
  }
  return allocateNextCatalogCode(client);
}

async function linkCatalogItemCode(code, catalogItemId, client) {
  const normalized = String(code || '').trim();
  if (!isValidSevenDigitCode(normalized)) return;
  const run = client ? client.query.bind(client) : query;
  await run(
    `UPDATE daily_entry_catalog_code_registry SET catalog_item_id = $2 WHERE code = $1`,
    [normalized, Number(catalogItemId)]
  );
}

module.exports = {
  isValidSevenDigitCode,
  formatSevenDigitCode,
  allocateNextCatalogCode,
  reserveCatalogCode,
  resolveCatalogItemCode,
  linkCatalogItemCode,
};
