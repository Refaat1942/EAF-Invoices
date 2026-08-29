#!/usr/bin/env node
const path = require('path');
const fs = require('fs');

const { initDatabase } = require('../database/db');
const { parseDocxPriceList } = require('../services/docxPriceListParser');
const { normalizeDocxImportPayload } = require('../services/priceListImportNormalizer');
const { importPriceListPayload } = require('../database/seeds/seedPriceList');

async function main() {
  const fileArg = process.argv[2];
  const defaultPath = path.join(__dirname, '..', 'data', 'price-list.docx');
  const filePath = fileArg ? path.resolve(fileArg) : defaultPath;

  if (!fs.existsSync(filePath)) {
    console.error(`❌ الملف غير موجود: ${filePath}`);
    console.error('ضع ملف اللائحة في: data/price-list.docx');
    console.error('أو شغّل: node scripts/import-price-list.js "C:\\path\\to\\file.docx"');
    process.exit(1);
  }

  await initDatabase();
  console.log(`📄 جاري استيراد: ${filePath}`);
  const payload = await parseDocxPriceList(filePath, {
    name: 'لائحة 2026-2027',
    code: 'PL-2026-2027',
  });
  const normalizedPayload = normalizeDocxImportPayload(payload);
  const result = await importPriceListPayload(normalizedPayload, { id: null, name: 'Import Script' }, { replaceExisting: true });
  console.log('✅ تم الاستيراد بنجاح');
  console.log(JSON.stringify(result, null, 2));
  process.exit(0);
}

main().catch((err) => {
  console.error('❌ فشل الاستيراد:', err.message);
  process.exit(1);
});
