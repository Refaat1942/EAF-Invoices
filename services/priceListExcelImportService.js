const ExcelJS = require('exceljs');
const { query } = require('../database/db');
const {
  listCategories,
  createService,
  updateService,
  createCategory,
} = require('./serviceCatalogService');

/** Categories created on demand when importing section Excel files. */
const IMPORT_CATEGORY_DEFINITIONS = {
  MEDICAL_EXAMS: { name: 'الكشوفات الطبية', sort_order: 2 },
  LAB: { name: 'المعمل والتحاليل الطبية', sort_order: 39 },
  RADIOLOGY: { name: 'الأشعة والتصوير الطبي', sort_order: 38 },
  RF_INJECTION: { name: 'وحدة التردد الحراري والحقن', sort_order: 20 },
  SPINE_CENTER: { name: 'عمليات العمود الفقري – حالات المركز', sort_order: 16 },
  PHYSIO: { name: 'العلاج الطبيعي والتأهيلي', sort_order: 8 },
  SPINE_BUILDING: { name: 'الخدمات الطبية بمبنى العمود الفقري', sort_order: 18 },
  ACCOMMODATION: { name: 'الإقامات والرعاية المركزة', sort_order: 4 },
  GENERAL: { name: 'رسوم عامة وخدمات إدارية', sort_order: 41 },
};

function resolveMedicalServiceCategoryCode(name) {
  const n = normalizeArabic(name);
  if (
    n.includes('اشعه') ||
    n.includes('دوبلكس') ||
    n.includes('سونار') ||
    n.includes('موجاتصوت') ||
    n.includes('رسمقلب') ||
    n.includes('تصوير') ||
    n.includes('اكو') ||
    n.includes('echo')
  ) {
    return 'RADIOLOGY';
  }
  return 'SPINE_BUILDING';
}

const GENERIC_CATEGORY_NAMES = new Set([
  'نوع الخدمة',
  'البيان',
  'الخدمة',
  'م',
  'قسم',
  'قسم التقييم',
]);

const GENERIC_SECTION_TEMPLATE = {
  headers: ['م', 'البيان', 'السعر (ج.م)'],
  unit: 'مرة',
};

function customTemplateKey(categoryCode) {
  return `custom_${String(categoryCode || '').trim()}`;
}

function isCustomTemplateKey(key) {
  return String(key || '').startsWith('custom_');
}

function builtinTemplateCategoryCodes() {
  return new Set(Object.values(EXCEL_TEMPLATES).map((t) => t.category_code));
}

function resolveTemplate(templateKey, options = {}) {
  if (EXCEL_TEMPLATES[templateKey]) {
    const t = EXCEL_TEMPLATES[templateKey];
    return { ...t, key: templateKey, category_code: t.category_code, custom: false };
  }
  if (isCustomTemplateKey(templateKey)) {
    const categoryCode = templateKey.slice('custom_'.length);
    if (!categoryCode) return null;
    return {
      key: templateKey,
      label: options.category_name || categoryCode,
      category_code: categoryCode,
      headers: GENERIC_SECTION_TEMPLATE.headers,
      unit: GENERIC_SECTION_TEMPLATE.unit,
      custom: true,
    };
  }
  return null;
}

const EXCEL_TEMPLATES = {
  medical_exams: {
    label: 'الكشوفات الطبية',
    category_code: 'MEDICAL_EXAMS',
    headers: ['م', 'البيان', 'السعر (ج.م)'],
    unit: 'كشف',
  },
  lab: {
    label: 'التحاليل',
    category_code: 'LAB',
    headers: ['م', 'البيان (التحليل)', 'السعر بالجنيه'],
    unit: 'تحليل',
  },
  radiology: {
    label: 'الأشعة',
    category_code: 'RADIOLOGY',
    headers: ['م', 'البيان (الأشعة)', 'السعر بالجنيه'],
    unit: 'أشعة',
  },
  rf_injection: {
    label: 'إجراءات وحقن الألم',
    category_code: 'RF_INJECTION',
    headers: ['م', 'نوع الإجراء / الحقن', 'السعر (جنيه)'],
    unit: 'إجراء',
  },
  spine_operations: {
    label: 'العمليات الجراحية',
    category_code: 'SPINE_CENTER',
    headers: [
      'م',
      'العملية الجراحية',
      'أجر الجراح',
      'المساعد',
      'التخدير',
      'العمليات',
      'الإقامة',
      'المستهلكات',
      'الإجمالي (جنيه)',
    ],
    unit: 'عملية',
    composite: true,
  },
  physio: {
    label: 'العلاج الطبيعي',
    category_code: 'PHYSIO',
    headers: ['م', 'الخدمة / الجلسة', 'السعر (جنيه)', 'التصنيف'],
    unit: 'جلسة',
  },
  medical_services: {
    label: 'الخدمات الطبية',
    category_code: 'SPINE_BUILDING',
    headers: ['م', 'الخدمة الطبية', 'السعر (جنيه)', 'ملاحظات'],
    unit: 'مرة',
  },
  accommodation: {
    label: 'الإقامات والرعاية',
    category_code: 'ACCOMMODATION',
    headers: ['المبنى / الدور', 'الدرجة', 'السعر اليومي (ج.م)'],
    unit: 'يوم',
    layout: 'accommodation',
  },
};

function normalizeArabic(text) {
  return String(text || '')
    .replace(/\u0640/g, '')
    .replace(/[\u064B-\u065F]/g, '')
    .replace(/\s+/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .toLowerCase();
}

function parseAmount(value) {
  const n = Number(String(value ?? '').replace(/,/g, '').trim());
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

function cellText(value) {
  if (value == null) return '';
  if (typeof value === 'object' && value.text) return String(value.text).trim();
  return String(value).trim();
}

function detectTemplateFromFilename(filename) {
  const n = normalizeArabic(filename);
  if (n.includes('كشوف')) return 'medical_exams';
  if (n.includes('تحاليل')) return 'lab';
  if (n.includes('اشعه') || n.includes('اشعة')) return 'radiology';
  if (n.includes('حقن') || n.includes('اجراءات')) return 'rf_injection';
  if (n.includes('عمليات')) return 'spine_operations';
  if (n.includes('علاج') && n.includes('طبيعي')) return 'physio';
  if (n.includes('خدمات') && n.includes('طبيه')) return 'medical_services';
  if (n.includes('اقامات') || n.includes('رعايه')) return 'accommodation';
  return null;
}

/** كود الخدمة داخل القسم فقط: 1، 2، 3… حسب ترتيب الصف في الشيت (لا علاقة لأقسام أخرى). */
function serialCode(_serial, rowIndex) {
  return String(rowIndex);
}

async function parseExcelBuffer(buffer, options = {}) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const sheet = workbook.worksheets[0];
  if (!sheet) throw new Error('الملف لا يحتوي على أوراق');

  const templateKey =
    options.template_key || detectTemplateFromFilename(options.filename || '') || null;
  const template = resolveTemplate(templateKey, { category_name: options.category_name });
  if (!template) {
    throw new Error(
      'تعذر تحديد نوع القالب — اختر القسم من القائمة ثم ارفع ملف Excel بنفس تنسيق القالب'
    );
  }
  const services = [];
  let rowIndex = 0;

  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const cells = row.values.slice(1).map(cellText);
    if (!cells.some((c) => c)) return;

    rowIndex += 1;

    if (template.layout === 'accommodation') {
      const building = cells[0] || '';
      const grade = cells[1] || '';
      const price = parseAmount(cells[2]);
      const name = [building, grade].filter(Boolean).join(' — ');
      if (!name || price <= 0) return;
      services.push({
        code: serialCode(cells[0], rowIndex),
        name,
        unit: template.unit,
        price,
        price_type: 'fixed',
        notes: building ? `المبنى/الدور: ${building}` : '',
        category_code: template.category_code,
      });
      return;
    }

    if (template.composite) {
      const serial = cells[0];
      const name = cells[1] || '';
      const total = parseAmount(cells[8]) || parseAmount(cells[cells.length - 1]);
      if (!name) return;
      const components = [
        { code: 'surgeon', name: 'أجر الجراح', amount: parseAmount(cells[2]) },
        { code: 'assistant', name: 'المساعد', amount: parseAmount(cells[3]) },
        { code: 'anesthesia', name: 'التخدير', amount: parseAmount(cells[4]) },
        { code: 'operations', name: 'العمليات', amount: parseAmount(cells[5]) },
        { code: 'stay', name: 'الإقامة', amount: parseAmount(cells[6]) },
        { code: 'consumables', name: 'المستهلكات', amount: parseAmount(cells[7]) },
        { code: 'total', name: 'الإجمالي', amount: total, is_total: true },
      ].filter((c) => c.amount > 0 || c.is_total);
      const price = total > 0 ? total : components.reduce((s, c) => s + (c.is_total ? 0 : c.amount), 0);
      if (price <= 0) return;
      services.push({
        code: serialCode(serial, rowIndex),
        name,
        unit: template.unit,
        price,
        price_type: 'composite',
        components,
        category_code: template.category_code,
      });
      return;
    }

    const serial = cells[0];
    const name = cells[1] || '';
    const price = parseAmount(cells[2]);
    const extra = cells[3] || '';
    if (!name || (price <= 0 && !extra)) return;
    if (/^(م|البيان|نوع)/i.test(name) && price <= 0) return;

    const svc = {
      code: serialCode(serial, rowIndex),
      name,
      unit: template.unit,
      price,
      price_type: 'fixed',
      notes: extra ? String(extra) : '',
      category_code: template.category_code,
    };
    if (templateKey === 'medical_services') {
      svc.category_code = resolveMedicalServiceCategoryCode(name);
    }
    if (templateKey === 'physio' && extra) {
      svc.metadata = { physio_group: extra };
    }
    if (templateKey === 'medical_services' && extra) {
      svc.notes = extra;
    }
    services.push(svc);
  });

  return {
    template_key: templateKey,
    template_label: template.label,
    category_code: template.category_code,
    services,
    parsed_rows: services.length,
  };
}

async function getCategoryId(priceListId, categoryCode) {
  const { rows } = await query(
    `SELECT id FROM service_categories WHERE price_list_id = $1 AND code = $2 LIMIT 1`,
    [priceListId, categoryCode]
  );
  return rows[0]?.id || null;
}

async function ensureImportCategory(priceListId, categoryCode, actor = null) {
  const code = String(categoryCode || '').trim();
  if (!code) throw new Error('كود القسم غير معروف');

  let categoryId = await getCategoryId(priceListId, code);
  if (categoryId) return categoryId;

  const def = IMPORT_CATEGORY_DEFINITIONS[code] || { name: code, sort_order: 99 };
  const created = await createCategory(priceListId, {
    name: def.name,
    code,
    sort_order: def.sort_order || 99,
    is_active: true,
    notes: 'أُنشئ تلقائياً عند استيراد ملف القسم',
  });
  return created.id;
}

async function removeGenericCategories(priceListId) {
  const cats = await listCategories(priceListId);
  let removed = 0;
  for (const cat of cats) {
    const name = String(cat.name || '').trim();
    if (!GENERIC_CATEGORY_NAMES.has(name)) continue;
    await query('DELETE FROM services WHERE price_list_id = $1 AND category_id = $2', [priceListId, cat.id]);
    await query('DELETE FROM service_categories WHERE id = $1', [cat.id]);
    removed += 1;
  }
  return removed;
}

async function importParsedExcel(priceListId, parsed, actor = null, options = {}) {
  const { category_code, services, template_key, template_label } = parsed;
  if (!services?.length) throw new Error('لا توجد صفوف صالحة في الملف');

  await removeGenericCategories(priceListId);

  const touchedCategories = new Set();
  const clearedCategories = new Set();
  let imported = 0;
  let updated = 0;
  let rowSeq = 0;

  for (const svc of services) {
    rowSeq += 1;
    const catCode = svc.category_code || category_code;
    const categoryId = await ensureImportCategory(priceListId, catCode, actor);
    touchedCategories.add(catCode);

    if (options.replaceExisting && !clearedCategories.has(catCode)) {
      await query('DELETE FROM services WHERE price_list_id = $1 AND category_id = $2', [
        priceListId,
        categoryId,
      ]);
      clearedCategories.add(catCode);
    }

    const { rows } = await query(
      `SELECT id FROM services
       WHERE price_list_id = $1 AND category_id = $2
         AND (code = $3 OR LOWER(TRIM(name)) = LOWER(TRIM($4)))
       LIMIT 1`,
      [priceListId, categoryId, svc.code, svc.name]
    );
    const payload = {
      price_list_id: priceListId,
      category_id: categoryId,
      name: svc.name,
      unit: svc.unit || 'مرة',
      price: svc.price,
      price_type: svc.price_type || 'fixed',
      discountable: true,
      administrative_fee_applicable: true,
      is_active: true,
      notes: svc.notes || '',
      metadata: svc.metadata || {},
      components: svc.components,
      sort_order: rowSeq,
    };
    if (rows.length) {
      await updateService(rows[0].id, payload, actor);
      updated += 1;
    } else {
      await createService(
        {
          ...payload,
          code: `__IMP_${categoryId}_${rowSeq}_${Date.now()}`,
        },
        actor
      );
      imported += 1;
    }
  }

  const { renumberServiceCodes } = require('./catalogMaintenanceService');
  let renumbered = 0;
  for (const catCode of touchedCategories) {
    const categoryId = await getCategoryId(priceListId, catCode);
    if (categoryId) {
      const result = await renumberServiceCodes(priceListId, categoryId);
      renumbered += result.renumbered || 0;
    }
  }

  return {
    template_key,
    template_label,
    category_code,
    imported,
    updated,
    total: imported + updated,
    parsed_rows: services.length,
    categories: [...touchedCategories],
    renumbered,
  };
}

async function buildTemplateExcel(templateKey, options = {}) {
  const template = resolveTemplate(templateKey, { category_name: options.category_name });
  if (!template) throw new Error('قالب غير معروف');

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(template.label, { views: [{ rightToLeft: true }] });
  sheet.addRow(template.headers);
  sheet.getRow(1).font = { bold: true };

  if (templateKey === 'medical_exams') {
    sheet.addRow(['1', 'كشف أخصائي', '350']);
    sheet.addRow(['2', 'كشف استشاري', '500']);
  } else if (templateKey === 'lab') {
    sheet.addRow(['1', 'مثال: CBC', '150']);
  } else if (templateKey === 'accommodation') {
    sheet.addRow(['الدور الأول', 'غرفة فردية', '1200']);
  } else if (templateKey === 'spine_operations') {
    sheet.addRow(['1', 'مثال عملية', '30000', '2500', '4500', '2500', '1500', '7000', '48000']);
  } else {
    sheet.addRow(['1', 'مثال خدمة', '100', '']);
  }

  sheet.columns.forEach((col) => {
    col.width = 18;
  });
  return workbook.xlsx.writeBuffer();
}

function listExcelTemplates() {
  return Object.entries(EXCEL_TEMPLATES).map(([key, t]) => ({
    key,
    label: t.label,
    category_code: t.category_code,
    custom: false,
  }));
}

async function listExcelTemplatesForPriceList(priceListId) {
  const staticTemplates = listExcelTemplates();
  const usedCodes = builtinTemplateCategoryCodes();
  const categories = await listCategories(priceListId, false);
  const customTemplates = categories
    .filter((cat) => cat.code && !usedCodes.has(cat.code))
    .map((cat) => ({
      key: customTemplateKey(cat.code),
      label: cat.name,
      category_code: cat.code,
      category_id: cat.id,
      custom: true,
    }));
  return [...staticTemplates, ...customTemplates];
}

module.exports = {
  EXCEL_TEMPLATES,
  IMPORT_CATEGORY_DEFINITIONS,
  detectTemplateFromFilename,
  parseExcelBuffer,
  importParsedExcel,
  buildTemplateExcel,
  listExcelTemplates,
  listExcelTemplatesForPriceList,
  customTemplateKey,
  isCustomTemplateKey,
  resolveTemplate,
  removeGenericCategories,
  ensureImportCategory,
  resolveMedicalServiceCategoryCode,
};
