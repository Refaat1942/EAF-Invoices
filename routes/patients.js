const express = require('express');
const {
  getPatientByFileNumber,
  setPatientBalance,
  listPatients,
  upsertPatient,
  peekNextPatientFileNumber,
  checkFileNumberAvailability,
} = require('../services/patientService');
const { requireAuth, requirePermission, requireAnyPermission } = require('../middleware/auth');

const router = express.Router();

router.use(requireAuth);

router.get('/', requirePermission('patients.view'), async (req, res) => {
  try {
    res.json(await listPatients());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/check-file-number', requireAnyPermission('patients.view', 'daily_charges.manage'), async (req, res) => {
  try {
    const fileNumber = req.query.file_number || '';
    res.json(await checkFileNumberAvailability(fileNumber));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Registration: is this national ID / passport number already on another patient's file?
router.get('/by-identity', requireAnyPermission('patients.view', 'daily_charges.manage'), async (req, res) => {
  try {
    const { query } = require('../database/db');
    const number = String(req.query.number || '')
      .replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660))
      .replace(/\s+/g, '')
      .trim();
    if (number.length < 4) return res.json([]);
    const { rows } = await query(
      `SELECT file_number, name, patient_type, id_type FROM patients
       WHERE UPPER(REPLACE(COALESCE(id_number, ''), ' ', '')) = UPPER($1)
         AND TRIM(file_number) <> TRIM($2)
       ORDER BY updated_at DESC NULLS LAST LIMIT 5`,
      [number, String(req.query.exclude || '')]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/next-file-number', requireAnyPermission('patients.view', 'daily_charges.manage'), async (req, res) => {
  try {
    const patientType = req.query.patient_type || 'internal';
    res.json(await peekNextPatientFileNumber(patientType));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/by-file/:fileNumber', requirePermission('patients.view'), async (req, res) => {
  try {
    const patient = await getPatientByFileNumber(req.params.fileNumber);
    if (!patient) {
      return res.json({ file_number: req.params.fileNumber, account_balance: 0, name: '' });
    }
    res.json(patient);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/balance', requirePermission('patients.manage'), async (req, res) => {
  try {
    const { file_number, name, account_balance } = req.body;
    const patient = await setPatientBalance(file_number, account_balance, name, req.session.user);
    res.json(patient);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/upsert', requirePermission('patients.manage'), async (req, res) => {
  try {
    const patient = await upsertPatient(req.body.file_number, req.body.name);
    res.json(patient);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
