const { query, withTransaction } = require('../database/db');

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

async function getAssignmentForDate(patientId, date) {
  const pid = Number(patientId);
  const d = fmtDateOnly(date);
  if (!pid || !d) return null;
  const { rows } = await query(
    `SELECT a.*, st.name AS stay_type_name, st.daily_rate
     FROM patient_room_assignments a
     LEFT JOIN stay_types st ON st.id = a.stay_type_id
     WHERE a.patient_id = $1
       AND a.effective_from <= $2::date
       AND (a.effective_to IS NULL OR a.effective_to >= $2::date)
     ORDER BY a.effective_from DESC, a.id DESC
     LIMIT 1`,
    [pid, d]
  );
  return rows[0] || null;
}

async function listAssignments(patientId) {
  const pid = Number(patientId);
  if (!pid) return [];
  const { rows } = await query(
    `SELECT a.*, st.name AS stay_type_name
     FROM patient_room_assignments a
     LEFT JOIN stay_types st ON st.id = a.stay_type_id
     WHERE a.patient_id = $1
     ORDER BY a.effective_from DESC, a.id DESC`,
    [pid]
  );
  return rows;
}

async function insertAssignment(client, patientId, data) {
  const effectiveFrom = fmtDateOnly(data.effective_from);
  if (!effectiveFrom) throw new Error('تاريخ بداية الإقامة مطلوب');

  const { rows } = await client.query(
    `INSERT INTO patient_room_assignments (
       patient_id, stay_type_id, floor, companion_amount, nursing_point_amount,
       patient_assistant_amount, effective_from, effective_to
     ) VALUES ($1, $2, $3, $4, $5, $6, $7::date, $8::date)
     RETURNING *`,
    [
      patientId,
      data.stay_type_id ? Number(data.stay_type_id) : null,
      String(data.floor || '').trim(),
      parseAmount(data.companion_amount),
      parseAmount(data.nursing_point_amount),
      parseAmount(data.patient_assistant_amount),
      effectiveFrom,
      fmtDateOnly(data.effective_to) || null,
    ]
  );
  return rows[0];
}

async function createInitialAssignment(patientId, data) {
  const pid = Number(patientId);
  if (!pid) return null;
  const effectiveFrom = fmtDateOnly(data.effective_from);
  if (!effectiveFrom) return null;

  const existing = await getAssignmentForDate(pid, effectiveFrom);
  if (existing && fmtDateOnly(existing.effective_from) === effectiveFrom) {
    const { rows } = await query(
      `UPDATE patient_room_assignments SET
         stay_type_id = $2,
         floor = $3,
         companion_amount = $4,
         nursing_point_amount = $5,
         patient_assistant_amount = $6
       WHERE id = $1 RETURNING *`,
      [
        existing.id,
        data.stay_type_id ? Number(data.stay_type_id) : null,
        String(data.floor || '').trim(),
        parseAmount(data.companion_amount),
        parseAmount(data.nursing_point_amount),
        parseAmount(data.patient_assistant_amount),
      ]
    );
    return rows[0];
  }

  return withTransaction(async (client) => {
    await client.query(
      `UPDATE patient_room_assignments
       SET effective_to = ($2::date - INTERVAL '1 day')::date
       WHERE patient_id = $1
         AND effective_from < $2::date
         AND (effective_to IS NULL OR effective_to >= $2::date)`,
      [pid, effectiveFrom]
    );
    return insertAssignment(client, pid, { ...data, effective_from: effectiveFrom, effective_to: null });
  });
}

async function changeRoomAssignment(patientId, data) {
  const pid = Number(patientId);
  const effectiveFrom = fmtDateOnly(data.effective_from);
  if (!pid) throw new Error('المريض غير موجود');
  if (!effectiveFrom) throw new Error('تاريخ بداية الغرفة الجديدة مطلوب');
  if (!data.stay_type_id) throw new Error('اختر الغرفة أو الجناح');

  return withTransaction(async (client) => {
    await client.query(
      `UPDATE patient_room_assignments
       SET effective_to = ($2::date - INTERVAL '1 day')::date
       WHERE patient_id = $1
         AND effective_from < $2::date
         AND (effective_to IS NULL OR effective_to >= $2::date)`,
      [pid, effectiveFrom]
    );
    await client.query(
      `DELETE FROM patient_room_assignments
       WHERE patient_id = $1 AND effective_from >= $2::date`,
      [pid, effectiveFrom]
    );
    return insertAssignment(client, pid, { ...data, effective_from: effectiveFrom, effective_to: null });
  });
}

module.exports = {
  getAssignmentForDate,
  listAssignments,
  createInitialAssignment,
  changeRoomAssignment,
  fmtDateOnly,
};
