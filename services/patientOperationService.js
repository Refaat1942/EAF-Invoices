const { query } = require('../database/db');

function fmtDateOnly(value) {
  if (!value) return null;
  const s = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

function parseAmount(value) {
  const n = Number(String(value ?? '').replace(/,/g, '').trim());
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

function parseOptionalTime(value) {
  const s = String(value ?? '').trim();
  if (!s) return '';
  const m = s.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (!m) return '';
  const hours = Number(m[1]);
  const minutes = Number(m[2]);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes) || hours > 23 || minutes > 59) return '';
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

function timeToMinutes(value) {
  const t = parseOptionalTime(value);
  if (!t) return null;
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

function computeDurationHours(startTime, endTime, fallbackHours = 0) {
  const start = timeToMinutes(startTime);
  const end = timeToMinutes(endTime);
  if (start != null && end != null && end >= start) {
    return Math.round(((end - start) / 60) * 100) / 100;
  }
  return parseAmount(fallbackHours);
}

async function listOperations(patientId, entryDate) {
  const pid = Number(patientId);
  if (!pid) return [];
  const params = [pid];
  let sql = `SELECT * FROM patient_operations WHERE patient_id = $1`;
  if (entryDate) {
    sql += ` AND entry_date = $2::date`;
    params.push(fmtDateOnly(entryDate));
  }
  sql += ' ORDER BY id';
  const { rows } = await query(sql, params);
  return rows;
}

async function saveOperationsForDate(patientId, entryDate, operations = []) {
  const pid = Number(patientId);
  const date = fmtDateOnly(entryDate);
  if (!pid || !date) throw new Error('المريض والتاريخ مطلوبان');

  await query(`DELETE FROM patient_operations WHERE patient_id = $1 AND entry_date = $2::date`, [pid, date]);

  const saved = [];
  for (const op of operations || []) {
    const name = String(op.operation_name || '').trim();
    const amount = parseAmount(op.amount);
    if (!name && amount <= 0) continue;
    const startTime = parseOptionalTime(op.operation_start_time);
    const endTime = parseOptionalTime(op.operation_end_time);
    const durationHours = computeDurationHours(startTime, endTime, op.duration_hours);
    const { rows } = await query(
      `INSERT INTO patient_operations (
         patient_id, entry_date, operation_name, duration_hours,
         operation_start_time, operation_end_time,
         surgeon_name, doctor_name, anesthesia_doctor, assistant_surgeon,
         case_type, amount, updated_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,NOW()) RETURNING *`,
      [
        pid,
        date,
        name,
        durationHours,
        startTime,
        endTime,
        String(op.surgeon_name || '').trim(),
        String(op.doctor_name || '').trim(),
        String(op.anesthesia_doctor || '').trim(),
        String(op.assistant_surgeon || '').trim(),
        String(op.case_type || 'special').trim() || 'special',
        amount,
      ]
    );
    saved.push(rows[0]);
  }
  return saved;
}

async function getOperationsTotal(patientId, entryDate) {
  const ops = await listOperations(patientId, entryDate);
  return ops.reduce((sum, op) => sum + parseAmount(op.amount), 0);
}

async function listOperationsInRange(patientId, fromDate, toDate) {
  const pid = Number(patientId);
  if (!pid) return [];
  const from = fmtDateOnly(fromDate);
  const to = fmtDateOnly(toDate);
  const params = [pid];
  let sql = `SELECT * FROM patient_operations WHERE patient_id = $1`;
  if (from) {
    sql += ` AND entry_date >= $${params.length + 1}::date`;
    params.push(from);
  }
  if (to) {
    sql += ` AND entry_date <= $${params.length + 1}::date`;
    params.push(to);
  }
  sql += ' ORDER BY entry_date, id';
  const { rows } = await query(sql, params);
  return rows;
}

module.exports = {
  listOperations,
  saveOperationsForDate,
  getOperationsTotal,
  listOperationsInRange,
  parseOptionalTime,
  computeDurationHours,
};
