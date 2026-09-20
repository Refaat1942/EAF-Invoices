const ExcelJS = require('exceljs');
const { getSetting, setSetting } = require('./settingsService');

const SETTING_KEY = 'exam_specialty_options';

const ALLOWED_SECTION_CODES = new Set(['consultant_exam', 'specialist_exam']);

const DEFAULT_SPECIALTIES = [
  {
    code: 'outpatient_clinic',
    name: 'كشف العيادات الخارجية',
    section_code: 'consultant_exam',
    price: 500,
    sort_order: 1,
    is_active: true,
  },
  {
    code: 'specialist_round',
    name: 'مرور أخصائي',
    section_code: 'specialist_exam',
    price: 450,
    sort_order: 2,
    is_active: true,
  },
];

function inferSectionCode(name = '', provided = '') {
  const code = String(provided || '').trim();
  if (ALLOWED_SECTION_CODES.has(code)) return code;
  const text = String(name || '');
  const norm = text
    .replace(/\u0640/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .toLowerCase();
  if (/استشار|خبير/.test(text) || norm.includes('استشار') || norm.includes('خبير')) {
    return 'consultant_exam';
  }
  if (/أخصائي|اخصائ|مرور/.test(text) || norm.includes('اخصائ') || norm.includes('مرور')) {
    return 'specialist_exam';
  }
  return 'specialist_exam';
}

function slugCode(name, index, existing = new Set()) {
  const trimmed = String(name || '').trim();
  if (!trimmed) return `specialty_${index + 1}`;
  const ascii = trimmed
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_]/g, '')
    .slice(0, 32);
  let base = ascii || `specialty_${index + 1}`;
  let candidate = base;
  let n = 2;
  while (existing.has(candidate)) {
    candidate = `${base}_${n}`;
    n += 1;
  }
  existing.add(candidate);
  return candidate;
}

function normalizeSpecialty(row = {}, index = 0, usedCodes = new Set()) {
  const name = String(row.name || '').trim();
  if (!name) return null;
  const providedCode = String(row.code || '').trim();
  const code = providedCode || slugCode(name, index, usedCodes);
  if (!providedCode) usedCodes.add(code);
  const price = Math.round((Number(row.price ?? row.amount) || 0) * 100) / 100;
  const serviceId = Number(row.service_id) || null;
  return {
    code,
    name,
    section_code: inferSectionCode(name, row.section_code),
    price,
    service_id: serviceId > 0 ? serviceId : null,
    sort_order: Number(row.sort_order) || index + 1,
    is_active: row.is_active !== false && row.is_active !== 0 && row.is_active !== '0',
  };
}

async function getExamSpecialties({ activeOnly = false } = {}) {
  const raw = await getSetting(SETTING_KEY, '');
  let rows = DEFAULT_SPECIALTIES;
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length) {
        const used = new Set();
        rows = parsed
          .map((row, i) => normalizeSpecialty(row, i, used))
          .filter(Boolean)
          .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
      }
    } catch {
      rows = [...DEFAULT_SPECIALTIES];
    }
  }
  if (activeOnly) return rows.filter((row) => row.is_active);
  return rows;
}

async function saveExamSpecialties(specialties = []) {
  const used = new Set();
  const normalized = (specialties || [])
    .map((row, i) => normalizeSpecialty(row, i, used))
    .filter(Boolean);
  if (!normalized.length) throw new Error('يجب إضافة تخصص واحد على الأقل');
  await setSetting(SETTING_KEY, JSON.stringify(normalized));
  return getExamSpecialties();
}

async function buildTemplateWorkbook() {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('exam_specialties');
  ws.addRow(['التخصص', 'كود القسم (consultant_exam / specialist_exam)', 'السعر']);
  ws.addRow(['كشف العيادات الخارجية', 'consultant_exam', 500]);
  ws.addRow(['مرور أخصائي', 'specialist_exam', 450]);
  return wb.xlsx.writeBuffer();
}

function rowToObject(row) {
  const values = row.values || [];
  return {
    name: values[1],
    section_code: values[2],
    price: values[3],
  };
}

async function parseImportBuffer(buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const ws = wb.worksheets[0];
  if (!ws) return [];
  const used = new Set();
  const rows = [];
  ws.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const specialty = normalizeSpecialty(rowToObject(row), rowNumber, used);
    if (specialty) rows.push(specialty);
  });
  return rows;
}

async function importExamSpecialtiesFromBuffer(buffer) {
  const rows = await parseImportBuffer(buffer);
  if (!rows.length) throw new Error('لم يُعثر على صفوف صالحة في الملف');
  return saveExamSpecialties(rows);
}

module.exports = {
  getExamSpecialties,
  saveExamSpecialties,
  buildTemplateWorkbook,
  importExamSpecialtiesFromBuffer,
  DEFAULT_SPECIALTIES,
  ALLOWED_SECTION_CODES,
};
