const express = require('express');
const multer = require('multer');
const {
  listSections,
  getSectionsWithServices,
  listAccommodationStayGrades,
  searchDailyPickerItems,
  getDailyPickerItemBySection,
  getEntryByPatientDate,
  listEntries,
  listEntryHistory,
  saveEntry,
  saveEntriesBatch,
  deleteEntry,
  getEntriesForInvoice,
  getInvoiceItemsFromDailyCharges,
} = require('../services/dailyChargeService');
const { upsertPatient, getPatientByFileNumber, searchPatientsForDaily } = require('../services/patientService');
const {
  listOperations,
  saveOperationsForDate,
} = require('../services/patientOperationService');
const {
  getOpenPatientStay,
  openPatientStay,
  listFreeInvoiceItems,
  saveFreeInvoiceItems,
  syncInvoiceAfterDailyChange,
} = require('../services/invoiceService');
const { getDailyPrintReport, resolveDailyPrintKind } = require('../services/reportService');
const { buildDailyReportHtml, wrapDailyItemsPrintPage } = require('../services/pdfService');
const { generateDailyItemsPdfBuffer } = require('../services/exportService');
const { getLogoUrl } = require('../services/settingsService');
const { requireAuth, requirePermission, requireAnyPermission } = require('../middleware/auth');

const catalogManagePerm = requireAnyPermission('settings.*', 'daily_charges.manage');
const {
  CATALOG_CATEGORIES,
  listCatalogItems,
  listCatalogItemsPaginated,
  getCatalogItemById,
  getCatalogStats,
  createCatalogItem,
  updateCatalogItem,
  setCatalogItemActive,
  importCatalogRows,
  analyzeCatalogImportFile,
  confirmCatalogImportFile,
  parseCsvCatalog,
  parseExcelCatalog,
  exportCatalogCsv,
} = require('../services/dailyEntryCatalogService');

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
});

function getBaseUrl(req) {
  return `${req.protocol}://${req.get('host')}`;
}

router.use(requireAuth);

router.get('/sections', requirePermission('daily_charges.view'), async (req, res) => {
  try {
    const withServices = req.query.with_services === '1';
    const { getCurrentBusinessDateString } = require('../services/dailyChargeService');
    const sections = withServices ? await getSectionsWithServices() : await listSections();
    res.json({
      business_date: getCurrentBusinessDateString(),
      sections,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/stay-grades', requirePermission('daily_charges.view'), async (req, res) => {
  try {
    res.json(await listAccommodationStayGrades());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/picker/search', requirePermission('daily_charges.view'), async (req, res) => {
  try {
    const section_code = String(req.query.section_code || '').trim();
    if (!section_code) return res.status(400).json({ error: 'section_code مطلوب' });
    res.json(
      await searchDailyPickerItems({
        section_code,
        search: req.query.search || '',
        page: req.query.page,
        limit: req.query.limit,
      })
    );
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.get('/picker/item', requirePermission('daily_charges.view'), async (req, res) => {
  try {
    const section_code = String(req.query.section_code || '').trim();
    const id = req.query.id;
    if (!section_code || !id) return res.status(400).json({ error: 'section_code و id مطلوبان' });
    res.json(await getDailyPickerItemBySection(section_code, id));
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.get('/catalog', requireAnyPermission('daily_charges.view', 'settings.*'), async (req, res) => {
  try {
    const category = req.query.category || null;
    if (category && !CATALOG_CATEGORIES.includes(category)) {
      return res.status(400).json({ error: 'الفئة غير صالحة (Medicine / Supplies / Cosmetics)' });
    }
    const usePagination = req.query.page != null || req.query.limit != null;
    const filters = {
      category,
      search: req.query.search || null,
      unit: req.query.unit || null,
      sort: req.query.sort || 'name',
      order: req.query.order || 'asc',
    };
    if (req.query.active === '0') filters.active = '0';
    else if (req.query.active === '1') filters.active = '1';
    else if (!usePagination) {
      filters.active_only = req.query.active_only !== '0';
    } else if (req.query.active_only === '0') {
      filters.active_only = false;
    }

    if (usePagination) {
      filters.page = req.query.page || 1;
      filters.limit = req.query.limit || 25;
      res.json(await listCatalogItemsPaginated(filters));
    } else {
      res.json(await listCatalogItems(filters));
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/catalog/stats', requireAnyPermission('daily_charges.view', 'settings.*'), async (req, res) => {
  try {
    res.json(await getCatalogStats());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/catalog/export', catalogManagePerm, async (req, res) => {
  try {
    const csv = await exportCatalogCsv();
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="daily-entry-catalog.csv"');
    res.send('\uFEFF' + csv);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/catalog/import/analyze', catalogManagePerm, upload.single('file'), async (req, res) => {
  try {
    if (!req.file?.buffer?.length) {
      return res.status(400).json({ error: 'الملف مطلوب (CSV أو Excel)' });
    }

    let mappingOverride = null;
    if (req.body.mapping) {
      try {
        mappingOverride = JSON.parse(req.body.mapping);
      } catch {
        return res.status(400).json({ error: 'تعيين الأعمدة غير صالح' });
      }
    }

    const analysis = await analyzeCatalogImportFile(
      req.file.buffer,
      req.file.originalname,
      mappingOverride,
      {
        page: req.body.preview_page || req.query.preview_page || 1,
        limit: req.body.preview_limit || req.query.preview_limit || 50,
      }
    );
    res.json(analysis);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/catalog/import/confirm', catalogManagePerm, upload.single('file'), async (req, res) => {
  try {
    if (!req.file?.buffer?.length) {
      return res.status(400).json({ error: 'الملف مطلوب (CSV أو Excel)' });
    }

    let mapping = null;
    try {
      mapping = JSON.parse(req.body.mapping || '{}');
    } catch {
      return res.status(400).json({ error: 'تعيين الأعمدة غير صالح' });
    }

    const result = await confirmCatalogImportFile(req.file.buffer, req.file.originalname, mapping);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/catalog/import', catalogManagePerm, upload.single('file'), async (req, res) => {
  try {
    if (!req.file?.buffer?.length) {
      return res.status(400).json({ error: 'الملف مطلوب (CSV أو Excel)' });
    }

    const name = String(req.file.originalname || '').toLowerCase();
    let rows;
    if (name.endsWith('.csv') || name.endsWith('.txt')) {
      rows = await parseCsvCatalog(req.file.buffer.toString('utf8'));
    } else if (name.endsWith('.xlsx') || name.endsWith('.xls')) {
      rows = await parseExcelCatalog(req.file.buffer);
    } else {
      return res.status(400).json({ error: 'صيغة غير مدعومة — استخدم CSV أو Excel (.xlsx)' });
    }

    if (!rows.length) {
      return res.status(400).json({ error: 'لم يُعثر على أصناف في الملف — تأكد من الأعمدة: Code, Name, Category, Unit, Price' });
    }

    const result = await importCatalogRows(rows);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get('/catalog/:id', requireAnyPermission('daily_charges.view', 'settings.*'), async (req, res) => {
  try {
    const item = await getCatalogItemById(Number(req.params.id));
    if (!item) return res.status(404).json({ error: 'الصنف غير موجود' });
    res.json(item);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/catalog', catalogManagePerm, async (req, res) => {
  try {
    const item = await createCatalogItem(req.body);
    res.json({ item, stats: await getCatalogStats() });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.put('/catalog/:id', catalogManagePerm, async (req, res) => {
  try {
    const item = await updateCatalogItem(Number(req.params.id), req.body);
    res.json({ item, stats: await getCatalogStats() });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.patch('/catalog/:id/active', catalogManagePerm, async (req, res) => {
  try {
    const isActive = req.body.is_active === true || req.body.is_active === 'true' || req.body.is_active === 1;
    const item = await setCatalogItemActive(Number(req.params.id), isActive);
    res.json({ item, stats: await getCatalogStats() });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get('/entries', requirePermission('daily_charges.view'), async (req, res) => {
  try {
    res.json(
      await listEntries({
        patient_id: req.query.patient_id,
        file_number: req.query.file_number,
        from_date: req.query.from_date,
        to_date: req.query.to_date,
        uninvoiced_only: req.query.uninvoiced_only === '1',
        invoice_id: req.query.invoice_id,
        limit: req.query.limit,
        include_lines: req.query.include_lines === '1',
      })
    );
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/entries/by-date', requirePermission('daily_charges.view'), async (req, res) => {
  try {
    const { file_number, entry_date, patient_name } = req.query;
    if (!file_number || !entry_date) {
      return res.status(400).json({ error: 'file_number و entry_date مطلوبان' });
    }
    const patient = await upsertPatient(file_number, patient_name || '');
    const entry = await getEntryByPatientDate(patient.id, entry_date);
    res.json(entry || { file_number, entry_date, lines: [], daily_total: 0 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/entries/:id/history', requirePermission('daily_charges.view'), async (req, res) => {
  try {
    res.json(await listEntryHistory(Number(req.params.id)));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/open-stay', requirePermission('daily_charges.view'), async (req, res) => {
  try {
    const file_number = req.query.file_number?.trim();
    if (!file_number) return res.status(400).json({ error: 'file_number مطلوب' });
    const stay = await getOpenPatientStay(file_number);
    if (stay) return res.json(stay);
    const patient = await getPatientByFileNumber(file_number);
    return res.json({
      patient: patient || { file_number, name: '', account_balance: 0 },
      invoice: null,
      daily_summary: { entry_count: 0, daily_total_sum: 0 },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/patients', requirePermission('daily_charges.view'), async (req, res) => {
  try {
    const search = req.query.search || '';
    const limit = req.query.limit || 40;
    res.json(await searchPatientsForDaily(search, limit));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/free-items', requirePermission('daily_charges.view'), async (req, res) => {
  try {
    const file_number = req.query.file_number?.trim();
    if (!file_number) return res.status(400).json({ error: 'file_number مطلوب' });
    res.json(await listFreeInvoiceItems(file_number));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/free-items', requirePermission('daily_charges.manage'), async (req, res) => {
  try {
    const file_number = req.body.file_number?.trim();
    if (!file_number) return res.status(400).json({ error: 'file_number مطلوب' });
    const result = await saveFreeInvoiceItems(file_number, req.body.items || [], req.session?.user || null);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/open-stay', requirePermission('daily_charges.manage'), async (req, res) => {
  try {
    const result = await openPatientStay(req.body, req.session?.user || null);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/change-room', requirePermission('daily_charges.manage'), async (req, res) => {
  try {
    const file_number = req.body.file_number?.trim();
    if (!file_number) return res.status(400).json({ error: 'file_number مطلوب' });
    const patient = await getPatientByFileNumber(file_number);
    if (!patient) return res.status(400).json({ error: 'المريض غير موجود' });
    const { changeRoomAssignment } = require('../services/patientRoomService');
    const assignment = await changeRoomAssignment(patient.id, {
      stay_type_id: req.body.stay_type_id,
      floor: req.body.floor,
      companion_amount: req.body.companion_amount,
      nursing_point_amount: req.body.nursing_point_amount,
      patient_assistant_amount: req.body.patient_assistant_amount,
      effective_from: req.body.effective_from,
    });
    if (patient.floor && req.body.floor) {
      await upsertPatient(file_number, { floor: req.body.floor, name: patient.name });
    }
    let backfill = null;
    if (req.body.backfill_stay === true) {
      const { batchPostStayCharges } = require('../services/stayBatchPostingService');
      backfill = await batchPostStayCharges(file_number, {
        from_date: req.body.effective_from,
        skip_existing: true,
        include_today: false,
      }, req.session?.user || null);
    }
    const stay = await getOpenPatientStay(file_number);
    res.json({ assignment, backfill, ...stay });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/stay/batch-post', requirePermission('daily_charges.manage'), async (req, res) => {
  try {
    const file_number = String(req.body.file_number || '').trim();
    if (!file_number) return res.status(400).json({ error: 'file_number مطلوب' });
    const { batchPostStayCharges } = require('../services/stayBatchPostingService');
    const result = await batchPostStayCharges(file_number, {
      from_date: req.body.from_date,
      to_date: req.body.to_date,
      skip_existing: req.body.skip_existing !== false,
      include_today: req.body.include_today === true,
    }, req.session?.user || null);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get('/operations', requirePermission('daily_charges.view'), async (req, res) => {
  try {
    const file_number = String(req.query.file_number || '').trim();
    if (!file_number) return res.status(400).json({ error: 'file_number مطلوب' });
    const patient = await getPatientByFileNumber(file_number);
    if (!patient) return res.json([]);
    const ops = await listOperations(patient.id, req.query.entry_date || null);
    res.json(ops);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/operations', requirePermission('daily_charges.manage'), async (req, res) => {
  try {
    const file_number = String(req.body.file_number || '').trim();
    const entry_date = req.body.entry_date;
    if (!file_number || !entry_date) {
      return res.status(400).json({ error: 'file_number و entry_date مطلوبان' });
    }
    const patient = await getPatientByFileNumber(file_number);
    if (!patient) return res.status(404).json({ error: 'المريض غير موجود' });
    const operations = await saveOperationsForDate(
      patient.id,
      entry_date,
      Array.isArray(req.body.operations) ? req.body.operations : []
    );
    const stay = await getOpenPatientStay(file_number);
    let invoice_id = null;
    let final_total = null;
    if (stay?.invoice?.id) {
      const updated = await syncInvoiceAfterDailyChange(stay.invoice.id, file_number);
      if (updated) {
        invoice_id = updated.id;
        final_total = updated.final_total;
      }
    }
    res.json({ operations, invoice_id, final_total });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/entries', requirePermission('daily_charges.manage'), async (req, res) => {
  try {
    const entry = await saveEntry(req.body, req.session?.user || null);
    res.json(entry);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/entries/batch', requirePermission('daily_charges.manage'), async (req, res) => {
  try {
    const result = await saveEntriesBatch(req.body, req.session?.user || null);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/entries/:id', requirePermission('daily_charges.manage'), async (req, res) => {
  try {
    res.json(await deleteEntry(Number(req.params.id)));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get('/for-invoice', requirePermission('invoices.view'), async (req, res) => {
  try {
    const { file_number, from_date, to_date, invoice_id } = req.query;
    if (!file_number) return res.status(400).json({ error: 'file_number مطلوب' });
    const entries = await getEntriesForInvoice(file_number, from_date, to_date, invoice_id || null);
    const items = await getInvoiceItemsFromDailyCharges(file_number, from_date, to_date, invoice_id || null);
    res.json({
      entries,
      items,
      total: items.reduce((sum, item) => sum + (Number(item.quantity) || 0) * (Number(item.amount) || 0), 0),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/daily-items/print', requirePermission('daily_charges.view'), async (req, res) => {
  try {
    const kind = String(req.query.kind || '').trim();
    if (!resolveDailyPrintKind(kind)) {
      return res.status(400).json({
        error:
          'نوع التقرير غير صالح (medicines / supplies / medicines_supplies / radiology / laboratory)',
      });
    }

    const file_number = req.query.file_number?.trim();
    if (!file_number) {
      return res.status(400).json({ error: 'file_number مطلوب' });
    }

    const report = await getDailyPrintReport(kind, {
      file_number,
      from_date: req.query.from_date || null,
      to_date: req.query.to_date || null,
    });

    const baseUrl = getBaseUrl(req);
    const logoUrl = await getLogoUrl(baseUrl);
    const format = String(req.query.format || 'page').toLowerCase();

    if (format === 'pdf') {
      const pdf = await generateDailyItemsPdfBuffer(report, baseUrl, { logoUrl });
      const safeFile = file_number.replace(/[^\w\-]+/g, '_');
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="daily-report-${kind}-${safeFile}.pdf"`
      );
      return res.send(pdf);
    }

    const html = buildDailyReportHtml(report, { logoUrl });
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(wrapDailyItemsPrintPage(html, report, baseUrl, kind));
  } catch (err) {
    if (req.query.format === 'pdf') {
      return res.status(400).json({ error: err.message });
    }
    res.status(400).send(err.message || 'فشل إنشاء التقرير');
  }
});

module.exports = router;
