/**
 * Client mirror of services/dailySectionBundles.js — one invoice line per daily input screen.
 */
(function (global) {
  const SECTION_TO_BUNDLE = {
    accommodation: 'stay',
    companion: 'stay',
    nursing_point: 'stay',
    patient_assistant: 'stay',
    sessions_date: 'sessions',
    sessions_detail: 'sessions',
    sessions: 'sessions',
    medicines: 'medicines',
    supplies: 'supplies',
    cosmetics: 'supplies',
    consultant_exam: 'exams',
    specialist_exam: 'exams',
    consultation_stamp: 'exams',
    analyses: 'lab',
    analyses_stamp: 'lab',
    xray_type: 'radiology',
    xray_total: 'radiology',
    xray_stamp: 'radiology',
    other: 'other',
    prosthetics: 'other',
    operations: 'operations',
    glasses: 'glasses',
  };

  const BUNDLE_LABELS = {
    stay: 'إقامة ورعاية',
    sessions: 'جلسات',
    medicines: 'الأدوية',
    supplies: 'المستلزمات',
    exams: 'الكشوفات',
    lab: 'التحاليل',
    radiology: 'الأشعة',
    other: 'خدمات متنوعة',
    operations: 'العمليات',
    glasses: 'النظارات',
    __manual__: 'بنود أخرى',
  };

  function inferBundleKey(sectionCode) {
    const code = String(sectionCode || '').trim();
    if (!code) return '__manual__';
    return SECTION_TO_BUNDLE[code] || code;
  }

  function inferBundleKeyFromItem(item) {
    if (item?.is_stay_entry) return 'stay';
    const code = String(item?.section_code || item?.bundle_code || '').trim();
    if (code && BUNDLE_LABELS[code]) return code;
    if (code) return inferBundleKey(code);
    if (!item?.daily_entry_line_id && !item?.daily_entry_id) return '__manual__';
    const desc = String(item?.description || '');
    if (desc.includes('عملية')) return 'operations';
    if (desc.includes('بصريات') || desc.includes('نظارات')) return 'glasses';
    return '__manual__';
  }

  function getBundleLabel(bundleKey, fallbackItem) {
    const key = String(bundleKey || '').trim();
    if (key && BUNDLE_LABELS[key]) return BUNDLE_LABELS[key];
    const fromItem = String(fallbackItem?.section_name || '').trim();
    if (fromItem) return fromItem;
    return key || 'بنود أخرى';
  }

  const STAMP_SECTION_CODES = ['consultation_stamp', 'analyses_stamp', 'xray_stamp'];

  function isStampSectionCode(sectionCode) {
    return STAMP_SECTION_CODES.includes(String(sectionCode || '').trim());
  }

  function isStampLineItem(item = {}) {
    return isStampSectionCode(item?.section_code);
  }

  global.DailySectionBundles = {
    SECTION_TO_BUNDLE,
    BUNDLE_LABELS,
    STAMP_SECTION_CODES,
    inferBundleKey,
    inferBundleKeyFromItem,
    getBundleLabel,
    isStampSectionCode,
    isStampLineItem,
  };
})(typeof window !== 'undefined' ? window : globalThis);
