const express = require('express');
const multer = require('multer');
const { requireAuth, requirePermission, requireAnyPermission } = require('../middleware/auth');
const {
  listDoctors,
  listSpecialties,
  listDepartments,
  getDoctorById,
  createDoctor,
  updateDoctor,
  setDoctorActive,
  analyzeDoctorImportFile,
  confirmDoctorImportFile,
  exportDoctorsExcel,
  exportDoctorImportTemplate,
  getDoctorReportSummary,
  getDoctorReportDetailed,
  exportDoctorReportExcel,
} = require('../services/doctorService');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

router.use(requireAuth);

const managePerm = requirePermission('settings.*');
const viewDailyPerm = requireAnyPermission('daily_charges.view', 'settings.*');
const reportViewPerm = requirePermission('reports.view');
const reportExportPerm = requirePermission('reports.export');

router.get('/specialties', viewDailyPerm, async (req, res) => {
  try {
    const activeOnly = req.query.all !== '1';
    res.json(await listSpecialties(activeOnly));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/departments', viewDailyPerm, async (req, res) => {
  try {
    const activeOnly = req.query.all !== '1';
    res.json(await listDepartments(activeOnly));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/for-daily', viewDailyPerm, async (req, res) => {
  try {
    const specialty = req.query.specialty || '';
    const includeDoctorId = req.query.include_doctor_id || null;
    const doctors = await listDoctors({
      specialty,
      active_only: true,
      include_doctor_id: includeDoctorId,
    });
    res.json(doctors);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/export/template', managePerm, async (req, res) => {
  try {
    const buffer = await exportDoctorImportTemplate();
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="doctors-import-template.xlsx"');
    res.send(Buffer.from(buffer));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/export', managePerm, async (req, res) => {
  try {
    const buffer = await exportDoctorsExcel();
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="doctors-export.xlsx"');
    res.send(Buffer.from(buffer));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/import/analyze', managePerm, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'لم يتم اختيار ملف' });
    let mappingOverride = null;
    if (req.body.mapping) {
      mappingOverride = JSON.parse(req.body.mapping);
    }
    res.json(
      await analyzeDoctorImportFile(req.file.buffer, req.file.originalname, mappingOverride)
    );
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/import/confirm', managePerm, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'لم يتم اختيار ملف' });
    let mappingOverride = null;
    if (req.body.mapping) {
      mappingOverride = JSON.parse(req.body.mapping);
    }
    res.json(await confirmDoctorImportFile(req.file.buffer, req.file.originalname, mappingOverride));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get('/reports/summary', reportViewPerm, async (req, res) => {
  try {
    res.json(await getDoctorReportSummary(req.query));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/reports/detailed', reportViewPerm, async (req, res) => {
  try {
    res.json(await getDoctorReportDetailed(req.query));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/reports/export', reportExportPerm, async (req, res) => {
  try {
    const detailed = req.query.detailed === '1';
    const buffer = await exportDoctorReportExcel(req.query, detailed);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="doctor-report-${detailed ? 'detailed' : 'summary'}.xlsx"`
    );
    res.send(Buffer.from(buffer));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/', viewDailyPerm, async (req, res) => {
  try {
    const activeOnly = req.query.all !== '1';
    const doctors = await listDoctors({
      department: req.query.department || '',
      specialty: req.query.specialty || '',
      search: req.query.search || '',
      active_only: activeOnly,
      include_doctor_id: req.query.include_doctor_id || null,
    });
    res.json(doctors);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id', viewDailyPerm, async (req, res) => {
  try {
    const doctor = await getDoctorById(req.params.id);
    if (!doctor) return res.status(404).json({ error: 'غير موجود' });
    res.json(doctor);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', managePerm, async (req, res) => {
  try {
    res.status(201).json(await createDoctor(req.body));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.put('/:id', managePerm, async (req, res) => {
  try {
    res.json(await updateDoctor(Number(req.params.id), req.body));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.patch('/:id/active', managePerm, async (req, res) => {
  try {
    res.json(await setDoctorActive(Number(req.params.id), req.body.is_active));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
