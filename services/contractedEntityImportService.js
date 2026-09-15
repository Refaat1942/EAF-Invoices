const ExcelJS = require('exceljs');
const {
  listContractedEntities,
  createContractedEntity,
  updateContractedEntity,
} = require('./contractedEntityService');

function normalizeHeader(value) {
  return String(value || '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

function parseYesNo(value) {
  const text = String(value || '').trim().toLowerCase();
  if (!text) return true;
  if (['لا', 'no', '0', 'false'].includes(text)) return false;
  return true;
}

async function exportContractedEntitiesTemplate() {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('الجهات المتعاقدة');
  sheet.columns = [
    { header: 'م', key: 'serial', width: 6 },
    { header: 'اسم الجهة', key: 'name', width: 36 },
    { header: 'الجهة الأم', key: 'parent_name', width: 28 },
    { header: 'نسبة الخصم %', key: 'discount_percent', width: 14 },
    { header: 'نشط', key: 'active', width: 10 },
  ];
  sheet.addRow({
    serial: 1,
    name: 'شركة مثال للتأمين',
    parent_name: '',
    discount_percent: 15,
    active: 'نعم',
  });
  sheet.addRow({
    serial: 2,
    name: 'فرع القاهرة',
    parent_name: 'شركة مثال للتأمين',
    discount_percent: 10,
    active: 'نعم',
  });
  return workbook.xlsx.writeBuffer();
}

async function importContractedEntitiesFromBuffer(buffer) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const sheet = workbook.worksheets[0];
  if (!sheet) throw new Error('الملف لا يحتوي على بيانات');

  const headerRow = sheet.getRow(1);
  const headerMap = {};
  headerRow.eachCell((cell, col) => {
    const key = normalizeHeader(cell.value);
    if (key.includes('اسم') && key.includes('جه')) headerMap.name = col;
    else if (key.includes('جهه') && key.includes('ام')) headerMap.parent = col;
    else if (key.includes('خصم')) headerMap.discount = col;
    else if (key.includes('نشط')) headerMap.active = col;
    else if (key === 'اسم الجهة' || key === 'الجهة') headerMap.name = col;
    else if (!headerMap.name && (key.includes('اسم') || key === 'name')) headerMap.name = col;
  });
  if (!headerMap.name) {
    headerMap.name = 2;
    headerMap.parent = 3;
    headerMap.discount = 4;
    headerMap.active = 5;
  }

  const existing = await listContractedEntities(false);
  const byName = new Map(existing.map((row) => [String(row.name).trim().toLowerCase(), row]));
  const created = [];
  const updated = [];
  const errors = [];

  for (let r = 2; r <= sheet.rowCount; r++) {
    const row = sheet.getRow(r);
    const name = String(row.getCell(headerMap.name).value || '').trim();
    if (!name) continue;
    const parentName = headerMap.parent
      ? String(row.getCell(headerMap.parent).value || '').trim()
      : '';
    const discountRaw = headerMap.discount ? row.getCell(headerMap.discount).value : 0;
    const discountPercent = Number(String(discountRaw || '0').replace(/,/g, '')) || 0;
    const isActive = headerMap.active ? parseYesNo(row.getCell(headerMap.active).value) : true;

    let parentId = null;
    if (parentName) {
      const parent = byName.get(parentName.toLowerCase());
      if (!parent) {
        errors.push(`صف ${r}: الجهة الأم «${parentName}» غير موجودة`);
        continue;
      }
      parentId = parent.id;
    }

    const key = name.toLowerCase();
    const match = byName.get(key);
    try {
      if (match) {
        const saved = await updateContractedEntity(match.id, {
          name,
          parent_id: parentId,
          discount_percent: discountPercent,
          is_active: isActive,
        });
        byName.set(key, saved);
        updated.push(saved);
      } else {
        const saved = await createContractedEntity({
          name,
          parent_id: parentId,
          discount_percent: discountPercent,
        });
        if (!isActive) {
          await updateContractedEntity(saved.id, { is_active: false });
          saved.is_active = false;
        }
        byName.set(key, saved);
        created.push(saved);
      }
    } catch (err) {
      errors.push(`صف ${r}: ${err.message}`);
    }
  }

  return {
    created_count: created.length,
    updated_count: updated.length,
    errors,
  };
}

module.exports = {
  exportContractedEntitiesTemplate,
  importContractedEntitiesFromBuffer,
};
