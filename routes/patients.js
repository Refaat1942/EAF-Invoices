const express = require('express');
const {
  getPatientByFileNumber,
  setPatientBalance,
  listPatients,
  upsertPatient,
} = require('../services/patientService');
const { requireAuth, requirePermission } = require('../middleware/auth');

const router = express.Router();

router.use(requireAuth);

router.get('/', requirePermission('patients.view'), async (req, res) => {
  try {
    res.json(await listPatients());
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
    const patient = await setPatientBalance(file_number, account_balance, name);
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
