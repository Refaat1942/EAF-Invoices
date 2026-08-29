#!/usr/bin/env node
/**
 * DOCX price-list import normalization tests.
 * Run: node scripts/test-price-list-import-normalizer.js
 * With DB: node --env-file=.env scripts/test-price-list-import-normalizer.js
 */
const path = require('path');
const fs = require('fs');

const envPath = path.join(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (m && !process.env[m[1].trim()]) process.env[m[1].trim()] = m[2].trim();
  }
}

function assert(cond, msg) {
  if (!cond) {
    console.error(`FAIL ${msg}`);
    process.exit(1);
  }
  console.log(`OK ${msg}`);
}

function assertEq(a, e, msg) {
  if (a !== e) {
    console.error(`FAIL ${msg}: expected ${JSON.stringify(e)}, got ${JSON.stringify(a)}`);
    process.exit(1);
  }
  console.log(`OK ${msg}`);
}

const {
  normalizeDocxImportPayload,
  normalizeArabic,
  isGenericTableHeader,
  isExactConsultantExam,
  isOutpatientAllSpecialtiesExam,
  isSpecialtySpecificExam,
  resolveCanonicalCategoryByName,
} = require('../services/priceListImportNormalizer');
const { mapTablesToPayload } = require('../services/docxPriceListParser');
const { importPriceListPayload } = require('../database/seeds/seedPriceList');

const CONSULTANT_BUNDLE =
  'كشف العيادات الخارجية التخصصية ( أستشارى ) جميع ال تخصص ات';
const SPECIALIST_BUNDLE =
  'كشف العيادات الخارجية التخصصية ( أ خصائى) جميع ال تخصص ات';

function buildGenericExamPayload() {
  return {
    price_list: { name: 'Test', code: 'PL-NORM-TEST' },
    categories: [
      {
        code: 'CAT-قيمة-الكشف',
        name: 'قيمة الكشف',
        sort_order: 5,
        import_chapter: 'الكشوفات الطبية',
      },
    ],
    services: [
      {
        category_code: 'CAT-قيمة-الكشف',
        code: 'SRV-CONSULT-BUNDLE',
        name: CONSULTANT_BUNDLE,
        price: 500,
        unit: 'كشف',
        sort_order: 1,
        import_chapter: 'الكشوفات الطبية',
      },
      {
        category_code: 'CAT-قيمة-الكشف',
        code: 'SRV-SPEC-BUNDLE',
        name: SPECIALIST_BUNDLE,
        price: 350,
        unit: 'كشف',
        sort_order: 2,
        import_chapter: 'الكشوفات الطبية',
      },
    ],
  };
}

// 1. Arabic canonical category name maps to canonical code
const labCat = resolveCanonicalCategoryByName('المعمل والتحاليل الطبية');
assert(labCat && labCat.code === 'LAB', 'Arabic canonical category maps to LAB');

// 2. Generic header resolved via chapter context (not kept as category)
assert(isGenericTableHeader('قيمة الكشف'), 'قيمة الكشف is generic header');
const genericNorm = normalizeDocxImportPayload(buildGenericExamPayload());
assert(
  !genericNorm.categories.some((c) => isGenericTableHeader(c.name)),
  'generic header category removed after normalization'
);
assert(
  genericNorm.categories.some((c) => c.code === 'MEDICAL_EXAMS'),
  'chapter-backed generic header yields MEDICAL_EXAMS category'
);

// 3. Consultant all-specialties → EXAM-CONSULTANT
const consultantSvc = genericNorm.services.find((s) => s.code === 'EXAM-CONSULTANT');
assert(consultantSvc && consultantSvc.category_code === 'MEDICAL_EXAMS', 'consultant bundle → EXAM-CONSULTANT');

// 4. Specialist all-specialties → EXAM-SPECIALIST
const specialistSvc = genericNorm.services.find((s) => s.code === 'EXAM-SPECIALIST');
assert(specialistSvc && specialistSvc.category_code === 'MEDICAL_EXAMS', 'specialist bundle → EXAM-SPECIALIST');

// 5. Specialty-specific كشف does NOT become EXAM-CONSULTANT
const urologyExam = 'كشف عيادة المسالك البولية استشاري';
assert(isSpecialtySpecificExam(urologyExam), 'urology exam is specialty-specific');
const urologyPayload = normalizeDocxImportPayload({
  price_list: { name: 'T', code: 'PL-URO' },
  categories: [{ code: 'CAT-UROLOGY', name: 'المسالك البولية', sort_order: 1 }],
  services: [
    {
      category_code: 'CAT-UROLOGY',
      code: 'SRV-URO-EXAM',
      name: urologyExam,
      price: 400,
      sort_order: 1,
    },
  ],
});
assert(
  !urologyPayload.services.some((s) => s.code === 'EXAM-CONSULTANT'),
  'specialty كشف not mapped to EXAM-CONSULTANT'
);

// 6. Unknown custom category remains CAT-*
const customPayload = normalizeDocxImportPayload({
  price_list: { name: 'T', code: 'PL-CUSTOM' },
  categories: [{ code: 'CAT-وحده-خاصه-غير-معروفه', name: 'وحدة خاصة غير معروفة', sort_order: 99 }],
  services: [
    {
      category_code: 'CAT-وحده-خاصه-غير-معروفه',
      code: 'SRV-CUSTOM-1',
      name: 'خدمة خاصة تجريبية',
      price: 100,
      sort_order: 1,
    },
  ],
});
assert(
  customPayload.categories.some((c) => c.code === 'CAT-وحده-خاصه-غير-معروفه'),
  'custom category remains CAT-*'
);

// 7. Multiple aliases collapse to one canonical category
const aliasPayload = normalizeDocxImportPayload({
  price_list: { name: 'T', code: 'PL-ALIAS' },
  categories: [
    { code: 'CAT-المعمل-والتحاليل-الطبية', name: 'المعمل والتحاليل الطبية', sort_order: 10 },
    { code: 'CAT-LAB-ALT', name: 'المعمل والتحاليل الطبية', sort_order: 11 },
  ],
  services: [
    {
      category_code: 'CAT-المعمل-والتحاليل-الطبية',
      code: 'SRV-LAB-1',
      name: 'تحليل سكر',
      price: 50,
      sort_order: 1,
    },
    {
      category_code: 'CAT-LAB-ALT',
      code: 'SRV-LAB-2',
      name: 'تحليل كرياتينين',
      price: 60,
      sort_order: 2,
    },
  ],
});
const labCategories = aliasPayload.categories.filter((c) => c.code === 'LAB');
assertEq(labCategories.length, 1, 'alias categories merge to single LAB');
assertEq(
  aliasPayload.services.filter((s) => s.category_code === 'LAB').length,
  2,
  'services from merged aliases rewired to LAB'
);

// 8. Deterministic service code normalization
assert(isExactConsultantExam('كشف استشاري'), 'exact consultant exam helper');
assert(
  isOutpatientAllSpecialtiesExam(CONSULTANT_BUNDLE, 'consultant'),
  'VPS-style spaced consultant bundle matches'
);
const codes = genericNorm.services.map((s) => s.code);
assertEq(new Set(codes).size, codes.length, 'service codes unique after normalization');

// 9. JSON import unchanged (normalizer not applied on JSON path — simulate)
const jsonPayload = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'database', 'seeds', 'price-list-2026-2027.json'), 'utf8')
);
assertEq(jsonPayload.categories[1].code, 'MEDICAL_EXAMS', 'seed JSON still has MEDICAL_EXAMS untouched');

// Parser chapter context: section heading before price table
const tables = [
  [['الكشوفات الطبية']],
  [
    ['م', 'قيمة الكشف', 'السعر'],
    ['1', CONSULTANT_BUNDLE, '500'],
    ['2', SPECIALIST_BUNDLE, '350'],
  ],
];
const parsed = mapTablesToPayload(tables);
const parsedNorm = normalizeDocxImportPayload(parsed);
assert(
  parsedNorm.services.some((s) => s.code === 'EXAM-CONSULTANT'),
  'parser chapter + normalize yields EXAM-CONSULTANT'
);

// 12. No duplicate service codes after normalization
const dupCheck = normalizeDocxImportPayload(buildGenericExamPayload());
const dupKeys = dupCheck.services.map((s) => `${s.category_code}::${s.code}`);
assertEq(new Set(dupKeys).size, dupKeys.length, 'no duplicate category_code+service_code');

// Nursing / companion rules
const nursingPayload = normalizeDocxImportPayload({
  price_list: { name: 'T', code: 'PL-NURS' },
  categories: [
    {
      code: 'CAT-النقطة-التمريضية-ومساعد-التمريض',
      name: 'النقطة التمريضية ومساعد التمريض',
      sort_order: 1,
    },
  ],
  services: [
    {
      category_code: 'CAT-النقطة-التمريضية-ومساعد-التمريض',
      code: 'SRV-NP',
      name: 'نقطة تمريض',
      price: 950,
      sort_order: 1,
    },
    {
      category_code: 'CAT-النقطة-التمريضية-ومساعد-التمريض',
      code: 'SRV-AIDE',
      name: 'مساعد تمريض 12 ساعة',
      price: 375,
      sort_order: 2,
    },
  ],
});
assert(
  nursingPayload.services.some((s) => s.code === 'NURSING-POINT' && s.category_code === 'NURSING'),
  'نقطة تمريض → NURSING-POINT'
);
assert(
  !nursingPayload.services.some((s) => s.code === 'NURSING-POINT' && s.name.includes('مساعد')),
  'assistant nursing not mapped to NURSING-POINT'
);

const companionPayload = normalizeDocxImportPayload({
  price_list: { name: 'T', code: 'PL-COMP' },
  categories: [{ code: 'CAT-إقامة-المرافق', name: 'إقامة المرافق', sort_order: 1 }],
  services: [
    {
      category_code: 'CAT-إقامة-المرافق',
      code: 'SRV-CR',
      name: 'مرافق غرفة',
      price: 600,
      sort_order: 1,
    },
    {
      category_code: 'CAT-إقامة-المرافق',
      code: 'SRV-CS',
      name: 'مرافق جناح',
      price: 900,
      sort_order: 2,
    },
  ],
});
assert(
  companionPayload.services.some((s) => s.code === 'COMPANION-ROOM'),
  'companion room canonical code'
);
assert(
  companionPayload.services.some((s) => s.code === 'COMPANION-SUITE'),
  'companion suite canonical code'
);

// Additional canonical categories
const multiPayload = normalizeDocxImportPayload({
  price_list: { name: 'T', code: 'PL-MULTI' },
  categories: [
    { code: 'CAT-العلاج-الطبيعي-والتأهيلي', name: 'العلاج الطبيعي والتأهيلي', sort_order: 1 },
    { code: 'CAT-الأشعة-والتصوير-الطبي', name: 'الأشعة والتصوير الطبي', sort_order: 2 },
    { code: 'CAT-الإقامات-والرعاية-المركزة', name: 'الإقامات والرعاية المركزة', sort_order: 3 },
    { code: 'CAT-الدمغات-الطبية', name: 'الدمغات الطبية', sort_order: 4 },
    { code: 'CAT-مصنع-الأجهزة-التعويضية', name: 'مصنع الأجهزة التعويضية', sort_order: 5 },
    { code: 'CAT-رسوم-عامة-وخدمات-إدارية', name: 'رسوم عامة وخدمات إدارية', sort_order: 6 },
  ],
  services: [
    { category_code: 'CAT-العلاج-الطبيعي-والتأهيلي', code: 'SRV-P1', name: 'جلسة علاج طبيعي', price: 200, sort_order: 1 },
    { category_code: 'CAT-الأشعة-والتصوير-الطبي', code: 'SRV-R1', name: 'أشعة عادية', price: 300, sort_order: 1 },
    { category_code: 'CAT-الإقامات-والرعاية-المركزة', code: 'SRV-A1', name: 'غرفة فردية', price: 1200, sort_order: 1 },
    { category_code: 'CAT-الدمغات-الطبية', code: 'SRV-ST1', name: 'دمغة كشوفات', price: 10, sort_order: 1 },
    { category_code: 'CAT-مصنع-الأجهزة-التعويضية', code: 'SRV-PR1', name: 'جهاز تعويضي', price: 5000, sort_order: 1 },
    { category_code: 'CAT-رسوم-عامة-وخدمات-إدارية', code: 'SRV-G1', name: 'خدمة إدارية', price: 50, sort_order: 1 },
  ],
});
const expectedCodes = ['PHYSIO', 'RADIOLOGY', 'ACCOMMODATION', 'STAMPS', 'PROSTHETICS', 'GENERAL'];
for (const code of expectedCodes) {
  assert(multiPayload.categories.some((c) => c.code === code), `category ${code} normalized`);
}

(async () => {
  if (!process.env.DATABASE_URL) {
    console.log('SKIP DB normalization integration (no DATABASE_URL)');
    console.log('ALL PRICE LIST NORMALIZATION TESTS PASSED');
    return;
  }

  const { initDatabase, query } = require('../database/db');
  const { resolveDefaultServiceForSection } = require('../services/dailyChargeService');
  const { getPriceListById } = require('../services/priceListService');

  await initDatabase();

  const listCode = `PL-NORM-DB-${Date.now()}`;
  const payload = buildGenericExamPayload();
  payload.price_list = { name: 'Norm DB Test', code: listCode };
  const normalized = normalizeDocxImportPayload(payload);

  const result = await importPriceListPayload(normalized, { id: null, name: 'Test' }, { replaceExisting: false });
  const priceList = await getPriceListById(result.price_list_id);

  const consultantSection = {
    code: 'consultant_exam',
    category_code: 'MEDICAL_EXAMS',
    default_service_code: 'EXAM-CONSULTANT',
    input_type: 'amount',
  };
  const specialistSection = {
    code: 'specialist_exam',
    category_code: 'MEDICAL_EXAMS',
    default_service_code: 'EXAM-SPECIALIST',
    input_type: 'amount',
  };

  const resolvedConsultant = await resolveDefaultServiceForSection(consultantSection, priceList);
  const resolvedSpecialist = await resolveDefaultServiceForSection(specialistSection, priceList);

  assert(resolvedConsultant?.code === 'EXAM-CONSULTANT', 'DB: consultant_exam resolves EXAM-CONSULTANT');
  assert(resolvedSpecialist?.code === 'EXAM-SPECIALIST', 'DB: specialist_exam resolves EXAM-SPECIALIST');

  await query('DELETE FROM services WHERE price_list_id = $1', [result.price_list_id]);
  await query('DELETE FROM service_categories WHERE price_list_id = $1', [result.price_list_id]);
  await query('DELETE FROM price_lists WHERE id = $1', [result.price_list_id]);

  console.log('ALL PRICE LIST NORMALIZATION TESTS PASSED');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
