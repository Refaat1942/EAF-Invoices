const fs = require('fs');
const path = require('path');

const CANONICAL_SEED_PATH = path.join(__dirname, '..', 'database', 'seeds', 'price-list-2026-2027.json');

/** Table header labels — not standalone price-list categories. */
const GENERIC_TABLE_HEADERS = [
  'البيان',
  'قيمة الكشف',
  'درجة الإقامة',
  'نوع الخدمة',
  'نوع الجلسة',
  'الجلسة',
  'قسم التقييم',
  'قسم',
  'الخدمة',
  'م',
];

let cachedRegistry = null;

function normalizeArabic(text) {
  return String(text || '')
    .replace(/\u0640/g, '')
    .replace(/[\u064B-\u065F]/g, '')
    .replace(/\s+/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/[^\u0600-\u06FFa-zA-Z0-9]/g, '')
    .toLowerCase();
}

function loadCanonicalRegistry() {
  if (cachedRegistry) return cachedRegistry;

  const payload = JSON.parse(fs.readFileSync(CANONICAL_SEED_PATH, 'utf8'));
  const categories = payload.categories || [];
  const services = payload.services || [];

  const nameToCategory = new Map();
  const codeToCategory = new Map();

  for (const cat of categories) {
    const entry = {
      code: cat.code,
      name: cat.name,
      sort_order: cat.sort_order || 0,
    };
    codeToCategory.set(cat.code, entry);
    const key = normalizeArabic(cat.name);
    if (key) nameToCategory.set(key, entry);
    // Partial TOC titles often drop suffixes — register significant prefix keys once.
    const words = String(cat.name || '').split(/\s+/).filter(Boolean);
    if (words.length >= 2) {
      const prefixKey = normalizeArabic(words.slice(0, 2).join(' '));
      if (prefixKey && !nameToCategory.has(prefixKey)) {
        nameToCategory.set(prefixKey, entry);
      }
    }
  }

  const serviceRules = buildServiceRules(services);

  cachedRegistry = { nameToCategory, codeToCategory, serviceRules, seedServices: services };
  return cachedRegistry;
}

function buildServiceRules(seedServices) {
  const rules = [
    {
      code: 'EXAM-CONSULTANT',
      category_code: 'MEDICAL_EXAMS',
      priority: 10,
      match: (name) => isExactConsultantExam(name) || isOutpatientAllSpecialtiesExam(name, 'consultant'),
    },
    {
      code: 'EXAM-SPECIALIST',
      category_code: 'MEDICAL_EXAMS',
      priority: 10,
      match: (name) => isExactSpecialistExam(name) || isOutpatientAllSpecialtiesExam(name, 'specialist'),
    },
    {
      code: 'NURSING-POINT',
      category_code: 'NURSING',
      priority: 20,
      match: (name) => isNursingPointService(name),
    },
    {
      code: 'COMPANION-ROOM',
      category_code: 'COMPANION',
      priority: 30,
      match: (name) => isCompanionRoomService(name),
    },
    {
      code: 'COMPANION-SUITE',
      category_code: 'COMPANION',
      priority: 30,
      match: (name) => isCompanionSuiteService(name),
    },
    {
      code: 'FILE-OPENING',
      category_code: 'GENERAL',
      priority: 40,
      match: (name) => normalizeArabic(name) === normalizeArabic('رسوم فتح الملف أول زيارة'),
    },
    {
      code: 'AMBULANCE-CAIRO',
      category_code: 'GENERAL',
      priority: 40,
      match: (name) => normalizeArabic(name).includes(normalizeArabic('إيجار سيارة الإسعاف داخل القاهرة')),
    },
  ];

  for (const svc of seedServices) {
    if (rules.some((r) => r.code === svc.code)) continue;
    if (!svc.code || !svc.category_code || !svc.name) continue;
  }

  const stayRules = [
    { code: 'STAY-ICU-SUITE', category_code: 'ACCOMMODATION', match: (n) => includesAll(n, ['رعايه', 'مركزه', 'جناح']) },
    { code: 'STAY-ICU-ROOM', category_code: 'ACCOMMODATION', match: (n) => includesAll(n, ['رعايه', 'مركزه', 'غرفه']) && !includesAll(n, ['جناح']) },
    { code: 'STAY-PALLIATIVE-SUITE', category_code: 'ACCOMMODATION', match: (n) => includesAll(n, ['رعايه', 'تلطيفيه', 'جناح']) },
    { code: 'STAY-PALLIATIVE-ROOM', category_code: 'ACCOMMODATION', match: (n) => includesAll(n, ['رعايه', 'تلطيفيه', 'غرفه']) },
    { code: 'STAY-VIP', category_code: 'ACCOMMODATION', match: (n) => n === 'vip' || n.includes('vip') },
    { code: 'STAY-LARGE-SUITE-PREMIUM', category_code: 'ACCOMMODATION', match: (n) => includesAll(n, ['جناح', 'كبير', 'مميز']) },
    { code: 'STAY-PREMIUM-ROOM', category_code: 'ACCOMMODATION', match: (n) => includesAll(n, ['غرفه', 'مميزه']) && !n.includes('جناح') },
    { code: 'STAY-LARGE-SUITE', category_code: 'ACCOMMODATION', match: (n) => includesAll(n, ['جناح', 'كبير']) && !n.includes('مميز') },
    { code: 'STAY-SMALL-SUITE', category_code: 'ACCOMMODATION', match: (n) => includesAll(n, ['جناح', 'صغير']) },
    { code: 'STAY-SINGLE-ROOM', category_code: 'ACCOMMODATION', match: (n) => includesAll(n, ['غرفه', 'فرديه']) },
    { code: 'STAY-DOUBLE-ROOM', category_code: 'ACCOMMODATION', match: (n) => includesAll(n, ['غرفه', 'مزدوجه']) },
  ];

  for (const rule of stayRules) {
    rules.push({ ...rule, priority: 25 });
  }

  return rules.sort((a, b) => a.priority - b.priority);
}

function includesAll(normalizedName, parts) {
  return parts.every((p) => normalizedName.includes(p));
}

function isExactConsultantExam(name) {
  return normalizeArabic(name) === normalizeArabic('كشف استشاري');
}

function isExactSpecialistExam(name) {
  return normalizeArabic(name) === normalizeArabic('كشف أخصائي');
}

function isOutpatientAllSpecialtiesExam(name, role) {
  const n = normalizeArabic(name);
  if (!n.includes('عياداتالخارجيه')) return false;
  if (!n.includes('التخصصيه')) return false;
  if (!n.includes('جميعالتخصصات')) return false;
  if (role === 'consultant') {
    return n.includes('استشاري');
  }
  return n.includes('اخصائي');
}

function isSpecialtySpecificExam(name) {
  const n = normalizeArabic(name);
  if (!n.includes('كشف')) return false;
  if (isExactConsultantExam(name) || isExactSpecialistExam(name)) return false;
  if (isOutpatientAllSpecialtiesExam(name, 'consultant') || isOutpatientAllSpecialtiesExam(name, 'specialist')) {
    return false;
  }
  return n.includes('كشف');
}

function isNursingPointService(name) {
  const n = normalizeArabic(name);
  if (n.includes('مساعد')) return false;
  return n.includes('نقطهتمريض') || n === normalizeArabic('نقطة تمريض');
}

function isCompanionRoomService(name) {
  const n = normalizeArabic(name);
  return n.includes('مرافق') && n.includes('غرفه') && !n.includes('جناح');
}

function isCompanionSuiteService(name) {
  const n = normalizeArabic(name);
  return n.includes('مرافق') && n.includes('جناح');
}

function isGenericTableHeader(name) {
  const key = normalizeArabic(name);
  return GENERIC_TABLE_HEADERS.some((header) => normalizeArabic(header) === key);
}

function resolveCanonicalCategoryByName(name) {
  const registry = loadCanonicalRegistry();
  const key = normalizeArabic(name);
  if (!key) return null;
  return registry.nameToCategory.get(key) || null;
}

function resolveCanonicalCategoryFromChapter(chapterName) {
  if (!chapterName) return null;
  return resolveCanonicalCategoryByName(chapterName);
}

function resolveCategoryTarget(parsedCategoryName, chapterName, servicesInCategory = []) {
  if (isGenericTableHeader(parsedCategoryName)) {
    const fromChapter = resolveCanonicalCategoryFromChapter(chapterName);
    if (fromChapter) return fromChapter;

    const serviceTargets = new Set();
    for (const svc of servicesInCategory) {
      const rule = matchServiceRule(svc.name);
      if (rule?.category_code) serviceTargets.add(rule.category_code);
    }
    if (serviceTargets.size === 1) {
      const code = serviceTargets.values().next().value;
      return loadCanonicalRegistry().codeToCategory.get(code) || null;
    }
    return null;
  }

  const direct = resolveCanonicalCategoryByName(parsedCategoryName);
  if (direct) return direct;

  const fromChapter = resolveCanonicalCategoryFromChapter(chapterName);
  if (fromChapter && isGenericTableHeader(parsedCategoryName)) return fromChapter;

  return null;
}

function matchServiceRule(name) {
  const registry = loadCanonicalRegistry();
  for (const rule of registry.serviceRules) {
    if (rule.match(name)) return rule;
  }
  return null;
}

function assignCanonicalServiceCode(service) {
  if (isSpecialtySpecificExam(service.name)) return null;
  const rule = matchServiceRule(service.name);
  if (!rule) return null;
  return { code: rule.code, category_code: rule.category_code };
}

function mergeCategories(categories) {
  const merged = new Map();
  const slugToCanonical = new Map();

  for (const cat of categories) {
    const key = cat.code;
    if (!merged.has(key)) {
      merged.set(key, { ...cat });
      continue;
    }
    const existing = merged.get(key);
    existing.sort_order = Math.min(existing.sort_order || 0, cat.sort_order || 0);
    if (!existing.notes && cat.notes) existing.notes = cat.notes;
  }

  return { categories: Array.from(merged.values()), slugToCanonical };
}

function normalizeDocxImportPayload(payload) {
  if (!payload || !Array.isArray(payload.categories) || !Array.isArray(payload.services)) {
    return payload;
  }

  const registry = loadCanonicalRegistry();
  const servicesByParsedCategory = new Map();

  for (const svc of payload.services) {
    const parsedCode = svc.category_code;
    if (!servicesByParsedCategory.has(parsedCode)) servicesByParsedCategory.set(parsedCode, []);
    servicesByParsedCategory.get(parsedCode).push(svc);
  }

  const categoryCodeRemap = new Map();
  const normalizedCategories = [];

  for (const cat of payload.categories) {
    const chapter = cat.import_chapter || svcChapterHint(servicesByParsedCategory.get(cat.code));
    const servicesInCat = servicesByParsedCategory.get(cat.code) || [];
    const target = resolveCategoryTarget(cat.name, chapter, servicesInCat);

    if (target && target.code !== cat.code) {
      categoryCodeRemap.set(cat.code, target.code);
      const existing = normalizedCategories.find((c) => c.code === target.code);
      if (!existing) {
        normalizedCategories.push({
          code: target.code,
          name: target.name,
          sort_order: Math.min(target.sort_order || 0, cat.sort_order || 0),
          notes: cat.notes || '',
        });
      } else {
        existing.sort_order = Math.min(existing.sort_order || 0, cat.sort_order || 0, target.sort_order || 0);
      }
    } else if (!target && !isGenericTableHeader(cat.name)) {
      normalizedCategories.push({ ...cat });
      categoryCodeRemap.set(cat.code, cat.code);
    } else if (target && target.code === cat.code) {
      normalizedCategories.push({
        ...cat,
        name: target.name,
        sort_order: Math.min(target.sort_order || 0, cat.sort_order || 0),
      });
      categoryCodeRemap.set(cat.code, cat.code);
    } else {
      // Generic header with no chapter — defer; may resolve via service rules below.
      categoryCodeRemap.set(cat.code, cat.code);
      if (!normalizedCategories.find((c) => c.code === cat.code)) {
        normalizedCategories.push({ ...cat });
      }
    }
  }

  const normalizedServices = [];

  for (const svc of payload.services) {
    const parsedCategoryCode = svc.category_code;
    let categoryCode = categoryCodeRemap.get(parsedCategoryCode) || parsedCategoryCode;

    const canonicalAssignment = assignCanonicalServiceCode(svc);
    if (canonicalAssignment) {
      categoryCode = canonicalAssignment.category_code;
      if (!normalizedCategories.find((c) => c.code === categoryCode)) {
        const catEntry = registry.codeToCategory.get(categoryCode);
        if (catEntry) {
          normalizedCategories.push({
            code: catEntry.code,
            name: catEntry.name,
            sort_order: catEntry.sort_order,
            notes: '',
          });
        }
      }
    }

    const out = { ...svc, category_code: categoryCode };
    if (canonicalAssignment) {
      out.code = canonicalAssignment.code;
      out.metadata = { ...(svc.metadata || {}), import_normalized: true, import_original_code: svc.code };
    }

    normalizedServices.push(out);
  }

  // Re-resolve generic-only categories whose services moved to canonical buckets.
  const usedCategoryCodes = new Set(normalizedServices.map((s) => s.category_code));
  const finalCategories = normalizedCategories.filter(
    (cat) => usedCategoryCodes.has(cat.code) || !isGenericTableHeader(cat.name)
  );

  for (const code of usedCategoryCodes) {
    if (!finalCategories.find((c) => c.code === code)) {
      const entry = registry.codeToCategory.get(code);
      if (entry) {
        finalCategories.push({
          code: entry.code,
          name: entry.name,
          sort_order: entry.sort_order,
          notes: '',
        });
      }
    }
  }

  const dedupedServices = dedupeServices(normalizedServices);
  const mergedCategories = mergeCategories(finalCategories).categories;

  mergedCategories.sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0) || a.code.localeCompare(b.code));

  return {
    ...payload,
    categories: mergedCategories,
    services: dedupedServices,
    import_meta: {
      ...(payload.import_meta || {}),
      source: 'docx',
      normalized: true,
      normalization_version: 1,
    },
  };
}

function svcChapterHint(services = []) {
  for (const svc of services) {
    if (svc.import_chapter) return svc.import_chapter;
  }
  return null;
}

function dedupeServices(services) {
  const seen = new Map();
  const result = [];

  for (const svc of services) {
    const key = `${svc.category_code}::${svc.code}`;
    if (seen.has(key)) {
      const existing = seen.get(key);
      if ((svc.sort_order || 0) < (existing.sort_order || 0)) {
        const idx = result.indexOf(existing);
        if (idx >= 0) result[idx] = svc;
        seen.set(key, svc);
      }
      continue;
    }
    seen.set(key, svc);
    result.push(svc);
  }

  return result;
}

module.exports = {
  normalizeDocxImportPayload,
  normalizeArabic,
  loadCanonicalRegistry,
  isGenericTableHeader,
  isExactConsultantExam,
  isExactSpecialistExam,
  isOutpatientAllSpecialtiesExam,
  isSpecialtySpecificExam,
  resolveCanonicalCategoryByName,
  matchServiceRule,
  GENERIC_TABLE_HEADERS,
};
