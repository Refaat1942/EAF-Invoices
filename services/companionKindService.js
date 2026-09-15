const ExcelJS = require('exceljs');
const { getSetting, setSetting } = require('./settingsService');

const SETTING_KEY = 'companion_kind_options';

const DEFAULT_KINDS = [
  { code: 'none', name: 'بدون', amount: 0, section_code: '', sort_order: 0 },
  { code: 'nursing_point', name: 'نقطة تمريض', amount: 0, section_code: 'nursing_point', sort_order: 1 },
];

function normalizeKind(row = {}, index = 0) {
  const code = String(row.code || row.name || `kind_${index + 1}`)
    .trim()
    .replace(/\s+/g, '_')
    .slice(0, 40);
  const name = String(row.name || '').trim();
  if (!name || code === 'none') return null;
  const section_code = ['companion', 'nursing_point', 'patient_assistant', ''].includes(row.section_code)
    ? row.section_code
    : 'companion';
  return {
    code,
    name,
    amount: Math.round((Number(row.amount) || 0) * 100) / 100,
    section_code,
    sort_order: Number(row.sort_order) || index + 10,
  };
}

async function getCompanionKinds() {
  const raw = await getSetting(SETTING_KEY, '');
  if (!raw) return [...DEFAULT_KINDS];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || !parsed.length) return [...DEFAULT_KINDS];
    const custom = parsed
      .map((row, i) => normalizeKind(row, i))
      .filter(Boolean)
      .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
    return [...DEFAULT_KINDS.filter((d) => d.code === 'none'), ...custom.filter((c) => c.code !== 'none')];
  } catch {
    return [...DEFAULT_KINDS];
  }
}

async function saveCompanionKinds(kinds = []) {
  const custom = (kinds || [])
    .map((row, i) => normalizeKind(row, i))
    .filter((row) => row && row.code !== 'none' && row.code !== 'nursing_point');
  await setSetting(SETTING_KEY, JSON.stringify(custom));
  return getCompanionKinds();
}

async function buildTemplateWorkbook() {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('companion_kinds');
  ws.addRow(['الاسم', 'المبلغ', 'القسم (companion / nursing_point)']);
  ws.addRow(['مرافق غرفة', 150, 'companion']);
  ws.addRow(['مرافق جناح', 250, 'companion']);
  return wb.xlsx.writeBuffer();
}

function rowToObject(row) {
  const values = row.values || [];
  return {
    name: values[1],
    amount: values[2],
    section_code: values[3],
  };
}

async function parseImportBuffer(buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const ws = wb.worksheets[0];
  if (!ws) return [];
  const kinds = [];
  ws.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const kind = normalizeKind(rowToObject(row), rowNumber);
    if (kind) kinds.push(kind);
  });
  return kinds;
}

async function importCompanionKindsFromBuffer(buffer) {
  const kinds = await parseImportBuffer(buffer);
  if (!kinds.length) throw new Error('لم يُعثر على صفوف صالحة في الملف');
  return saveCompanionKinds(kinds);
}

module.exports = {
  getCompanionKinds,
  saveCompanionKinds,
  buildTemplateWorkbook,
  importCompanionKindsFromBuffer,
  DEFAULT_KINDS,
};
