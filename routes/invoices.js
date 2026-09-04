const express = require('express');
const QRCode = require('qrcode');
const {
  listInvoices,
  getInvoiceById,
  getInvoiceByToken,
  saveInvoice,
  approveInvoice,
  deleteInvoice,
  getReportsSummary,
  prepareCalculationData,
} = require('../services/invoiceService');
const { listInvoiceTypes } = require('../services/invoiceTypeService');
const { calculateInvoiceTotals, calculateStayDays } = require('../services/calculations');
const { exportExcelBuffer } = require('../services/reportService');
const { buildInvoiceHtml } = require('../services/pdfService');
const { generatePdfBuffer, generateDocxBuffer } = require('../services/exportService');
const { getLogoUrl } = require('../services/settingsService');
const { requireAuth, requirePermission } = require('../middleware/auth');

const router = express.Router();

router.use(requireAuth);

function getBaseUrl(req) {
  return `${req.protocol}://${req.get('host')}`;
}

function reportFilters(req) {
  return {
    invoice_type: req.query.type,
    from_date: req.query.from,
    to_date: req.query.to,
    search: req.query.search,
    status: req.query.status,
    approved_only:
      req.query.approved_only === 'true'
        ? true
        : req.query.approved_only === 'false'
          ? false
          : undefined,
    file_number: req.query.file_number,
    patient_search: req.query.patient_search,
    pick_file_number: req.query.pick_file_number,
    patient_type: req.query.patient_type,
    nationality: req.query.nationality,
  };
}

router.get('/types', requirePermission('invoices.view'), async (req, res) => {
  try {
    const types = await listInvoiceTypes(true);
    const map = {};
    types.forEach((t) => {
      map[t.code] = t.name;
    });
    res.json(map);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/calculate', requirePermission('invoices.view'), async (req, res) => {
  try {
    const data = req.body;
    if (!data.stay_days && data.admission_date && data.discharge_date) {
      data.stay_days = calculateStayDays(data.admission_date, data.discharge_date);
    }
    const calcData = await prepareCalculationData(data);
    res.json(calculateInvoiceTotals(calcData));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/reports/summary', requirePermission('reports.view'), async (req, res) => {
  try {
    res.json(await getReportsSummary(reportFilters(req)));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/reports/payments', requirePermission('reports.view'), async (req, res) => {
  try {
    const { getPaymentsReport } = require('../services/reportService');
    res.json(await getPaymentsReport(reportFilters(req)));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/reports/remaining', requirePermission('reports.view'), async (req, res) => {
  try {
    const { getRemainingReport } = require('../services/reportService');
    res.json(await getRemainingReport(reportFilters(req)));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/reports/invoices', requirePermission('reports.view'), async (req, res) => {
  try {
    const { getInvoicesReport } = require('../services/reportService');
    res.json(await getInvoicesReport(reportFilters(req)));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/reports/patient-status', requirePermission('reports.view'), async (req, res) => {
  try {
    const { getPatientStatusReport } = require('../services/reportService');
    res.json(await getPatientStatusReport(reportFilters(req)));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get('/reports/supplies-markup', requirePermission('reports.view'), async (req, res) => {
  try {
    const { getSuppliesMarkupReport } = require('../services/reportService');
    res.json(await getSuppliesMarkupReport(reportFilters(req)));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/reports/reconciliation', requirePermission('reports.view'), async (req, res) => {
  try {
    const { getReconciliationReport } = require('../services/reportService');
    res.json(await getReconciliationReport(reportFilters(req)));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/reports/export', requirePermission('reports.export'), async (req, res) => {
  try {
    const reportType = req.query.report || 'summary';
    const allowed = ['summary', 'invoices', 'payments', 'remaining', 'patient_status', 'supplies_markup', 'reconciliation'];
    if (!allowed.includes(reportType)) {
      return res.status(400).json({ error: 'نوع التقرير غير صالح' });
    }
    const buffer = await exportExcelBuffer(reportType, reportFilters(req));
    const from = req.query.from || 'all';
    const to = req.query.to || 'all';
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="eaf-report-${reportType}-${from}-${to}.xlsx"`);
    res.send(Buffer.from(buffer));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/', requirePermission('invoices.view'), async (req, res) => {
  try {
    const invoices = await listInvoices({
      invoice_type: req.query.type,
      from_date: req.query.from,
      to_date: req.query.to,
      search: req.query.search,
      status: req.query.status,
      limit: req.query.limit ? Number(req.query.limit) : undefined,
    });
    res.json(invoices);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', requirePermission('invoices.create'), async (req, res) => {
  try {
    if (!req.body.invoice_type) {
      return res.status(400).json({ error: 'يجب اختيار نوع الفاتورة' });
    }
    const user = req.session.user;
    const createdBy = user ? { id: user.id, name: user.full_name || user.username } : null;
    const saveMode = req.body.save_mode === 'submit' ? 'submit' : 'draft';
    if (saveMode === 'submit' && !req.body.save_mode) {
      // default POST is draft unless explicitly submit
    }
    const invoice = await saveInvoice(req.body, null, createdBy, { save_mode: saveMode, actor: user });
    res.status(201).json(invoice);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:id/submit', requirePermission('invoices.submit'), async (req, res) => {
  try {
    const data = req.body || {};
    data.save_mode = 'submit';
    const invoice = await saveInvoice(data, Number(req.params.id), null, { save_mode: 'submit', actor: req.session.user });
    res.json(invoice);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/:id/approve', requirePermission('invoices.approve'), async (req, res) => {
  try {
    const invoice = await approveInvoice(Number(req.params.id), req.session.user);
    res.json(invoice);
  } catch (err) {
    console.warn(`[invoice] approval failed id=${req.params.id}: ${err.message}`);
    res.status(400).json({ error: err.message });
  }
});

router.get('/:id', requirePermission('invoices.view'), async (req, res) => {
  try {
    const invoice = await getInvoiceById(Number(req.params.id));
    if (!invoice) return res.status(404).json({ error: 'الفاتورة غير موجودة' });
    res.json(invoice);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id/returns', requirePermission('invoices.view'), async (req, res) => {
  try {
    const { listInvoiceReturns } = require('../services/invoiceReturnService');
    const returns = await listInvoiceReturns(Number(req.params.id));
    res.json(returns);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:id/returns', requirePermission('invoices.edit'), async (req, res) => {
  try {
    const { recordInvoiceReturns } = require('../services/invoiceReturnService');
    const result = await recordInvoiceReturns(Number(req.params.id), req.body, req.user);
    res.json(result);
  } catch (err) {
    console.warn(`[invoice] return failed id=${req.params.id}: ${err.message}`);
    res.status(400).json({ error: err.message });
  }
});

router.put('/:id', requirePermission('invoices.edit'), async (req, res) => {
  try {
    const saveMode = req.body.save_mode === 'submit' ? 'submit' : 'draft';
    const invoice = await saveInvoice(req.body, Number(req.params.id), null, {
      save_mode: saveMode,
      actor: req.session.user,
    });
    res.json(invoice);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', requirePermission('invoices.delete'), async (req, res) => {
  try {
    const deleted = await deleteInvoice(Number(req.params.id));
    if (!deleted) return res.status(404).json({ error: 'الفاتورة غير موجودة' });
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get('/:id/qr', requirePermission('invoices.view'), async (req, res) => {
  try {
    const invoice = await getInvoiceById(Number(req.params.id));
    if (!invoice) return res.status(404).json({ error: 'الفاتورة غير موجودة' });
    if (!invoice.qr_token) {
      return res.status(400).json({ error: 'QR متاح فقط للفواتير المعتمدة' });
    }

    const baseUrl = getBaseUrl(req);
    const downloadUrl = `${baseUrl}/download/${invoice.qr_token}`;

    const qrDataUrl = await QRCode.toDataURL(downloadUrl, {
      width: 300,
      margin: 1,
      errorCorrectionLevel: 'H',
    });

    res.json({
      qr_data_url: qrDataUrl,
      download_url: downloadUrl,
      serial_number: invoice.serial_number,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id/preview', requirePermission('invoices.view'), async (req, res) => {
  try {
    const invoice = await getInvoiceById(Number(req.params.id));
    if (!invoice) return res.status(404).send('Not found');

    const baseUrl = getBaseUrl(req);
    const logoUrl = await getLogoUrl(baseUrl);
    const showQr = Boolean(invoice.qr_token);
    let qrDataUrl = null;
    if (showQr) {
      const downloadUrl = `${baseUrl}/download/${invoice.qr_token}`;
      qrDataUrl = await QRCode.toDataURL(downloadUrl, { width: 200, margin: 1 });
    }

    const html = buildInvoiceHtml(invoice, { baseUrl, logoUrl, showQr, qrDataUrl });
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  } catch (err) {
    res.status(500).send(err.message);
  }
});

router.get('/:id/pdf', requirePermission('invoices.view'), async (req, res) => {
  try {
    const invoice = await getInvoiceById(Number(req.params.id));
    if (!invoice) return res.status(404).json({ error: 'الفاتورة غير موجودة' });
    if (!invoice.serial_number) {
      return res.status(400).json({ error: 'PDF متاح فقط للفواتير المعتمدة' });
    }

    const baseUrl = getBaseUrl(req);
    const pdf = await generatePdfBuffer(invoice, baseUrl);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="invoice-${invoice.serial_number}.pdf"`);
    res.send(pdf);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id/docx', requirePermission('invoices.view'), async (req, res) => {
  try {
    const invoice = await getInvoiceById(Number(req.params.id));
    if (!invoice) return res.status(404).json({ error: 'الفاتورة غير موجودة' });
    if (!invoice.serial_number) {
      return res.status(400).json({ error: 'Word متاح فقط للفواتير المعتمدة' });
    }

    const buffer = await generateDocxBuffer(invoice);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', `attachment; filename="invoice-${invoice.serial_number}.docx"`);
    res.send(buffer);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
