const ExcelJS = require('exceljs');
const { query, withTransaction } = require('../database/db');
const {
  readTabularFile,
  detectColumnMapping,
  applyColumnMapping,
  buildImportFieldList,
  validateMapping,
} = require('./importService');

function normalizeDoctorText(value) {
  return String(value || '')
    .replace(/\uFEFF/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function doctorIdentityKey(department, specialty, name) {
  return [
    normalizeDoctorText(department).toLowerCase(),
    normalizeDoctorText(specialty).toLowerCase(),
    normalizeDoctorText(name).toLowerCase(),
  ].join('|');
}

const DOCTOR_IMPORT_SCHEMA = {
  serial: { aliases: ['م', 'رقم', 'serial', 'no', '#'], required: false },
  department: { aliases: ['القسم', 'قسم', 'department', 'dept'], required: true },
  specialty: { aliases: ['التخصص', 'تخصص', 'specialty'], required: true },
  name: { aliases: ['الاسم', 'اسم', 'name', 'doctor', 'طبيب'], required: true },
};

function validateDoctorPayload(data = {}) {
  const department = normalizeDoctorText(data.department);
  const specialty = normalizeDoctorText(data.specialty);
  const name = normalizeDoctorText(data.name);
  if (!department) throw new Error('القسم مطلوب');
  if (!specialty) throw new Error('التخصص مطلوب');
  if (!name) throw new Error('اسم الطبيب مطلوب');
  const code = normalizeDoctorText(data.code);
  return { department, specialty, name, code: code || null };
}

async function findDoctorByIdentity(department, specialty, name, client = null) {
  const run = client ? client.query.bind(client) : query;
  const { rows } = await run(
    `SELECT * FROM doctors
     WHERE LOWER(TRIM(department)) = LOWER(TRIM($1))
       AND LOWER(TRIM(specialty)) = LOWER(TRIM($2))
       AND LOWER(TRIM(name)) = LOWER(TRIM($3))
     LIMIT 1`,
    [department, specialty, name]
  );
  return rows[0] || null;
}

async function listDoctors(filters = {}) {
  let sql = `SELECT * FROM doctors WHERE 1=1`;
  const params = [];
  let i = 1;

  if (filters.active === '0' || filters.active === false) {
    sql += ` AND is_active = FALSE`;
  } else if (filters.active_only && filters.include_doctor_id) {
    sql += ` AND (is_active = TRUE OR id = $${i++})`;
    params.push(Number(filters.include_doctor_id));
  } else if (filters.active_only || filters.active === '1' || filters.active === true) {
    sql += ` AND is_active = TRUE`;
  }
  if (filters.department) {
    sql += ` AND LOWER(TRIM(department)) = LOWER(TRIM($${i++}))`;
    params.push(filters.department);
  }
  if (filters.specialty) {
    sql += ` AND LOWER(TRIM(specialty)) = LOWER(TRIM($${i++}))`;
    params.push(filters.specialty);
  }
  if (filters.search) {
    sql += ` AND (name ILIKE $${i} OR specialty ILIKE $${i} OR department ILIKE $${i} OR code ILIKE $${i})`;
    params.push(`%${filters.search.trim()}%`);
    i++;
  }

  sql += ` ORDER BY department, specialty, name`;
  if (filters.limit) {
    sql += ` LIMIT $${i++}`;
    params.push(Number(filters.limit));
  }

  const { rows } = await query(sql, params);
  return rows;
}

function buildDoctorOrderClause(sort, order) {
  const direction = order === 'desc' ? 'DESC' : 'ASC';
  switch (sort) {
    case 'specialty':
      return `ORDER BY specialty ${direction}, name ASC, id ASC`;
    case 'department':
      return `ORDER BY department ${direction}, name ASC, id ASC`;
    default:
      return `ORDER BY name ${direction}, id ASC`;
  }
}

async function listDoctorsPaginated(filters = {}) {
  const page = Math.max(1, Number(filters.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(filters.limit) || 25));
  const offset = (page - 1) * limit;
  const sort = filters.sort || 'name';
  const order = filters.order || 'asc';

  let where = `WHERE 1=1`;
  const params = [];
  let i = 1;

  if (filters.active === '0' || filters.active === false) {
    where += ` AND is_active = FALSE`;
  } else if (filters.active === '1' || filters.active === true) {
    where += ` AND is_active = TRUE`;
  }
  if (filters.department) {
    where += ` AND LOWER(TRIM(department)) = LOWER(TRIM($${i++}))`;
    params.push(filters.department);
  }
  if (filters.specialty) {
    where += ` AND LOWER(TRIM(specialty)) = LOWER(TRIM($${i++}))`;
    params.push(filters.specialty);
  }
  if (filters.search) {
    where += ` AND (name ILIKE $${i} OR specialty ILIKE $${i} OR department ILIKE $${i} OR code ILIKE $${i})`;
    params.push(`%${filters.search.trim()}%`);
    i++;
  }

  const countSql = `SELECT COUNT(*)::int AS total FROM doctors ${where}`;
  const countRes = await query(countSql, params);
  const total = countRes.rows[0]?.total || 0;

  const dataSql = `SELECT * FROM doctors ${where} ${buildDoctorOrderClause(sort, order)} LIMIT $${i++} OFFSET $${i++}`;
  const dataParams = [...params, limit, offset];
  const { rows } = await query(dataSql, dataParams);

  return {
    rows,
    total,
    page,
    limit,
    totalPages: Math.max(1, Math.ceil(total / limit)),
  };
}

async function listSpecialties(activeOnly = true) {
  let sql = `SELECT DISTINCT specialty FROM doctors WHERE TRIM(specialty) <> ''`;
  if (activeOnly) sql += ` AND is_active = TRUE`;
  sql += ` ORDER BY specialty`;
  const { rows } = await query(sql);
  return rows.map((r) => r.specialty);
}

async function listDepartments(activeOnly = true) {
  let sql = `SELECT DISTINCT department FROM doctors WHERE TRIM(department) <> ''`;
  if (activeOnly) sql += ` AND is_active = TRUE`;
  sql += ` ORDER BY department`;
  const { rows } = await query(sql);
  return rows.map((r) => r.department);
}

async function getDoctorById(id, client = null) {
  const run = client ? client.query.bind(client) : query;
  const { rows } = await run(`SELECT * FROM doctors WHERE id = $1`, [Number(id)]);
  return rows[0] || null;
}

async function createDoctor(data) {
  const payload = validateDoctorPayload(data);
  const existing = await findDoctorByIdentity(payload.department, payload.specialty, payload.name);
  if (existing) {
    throw new Error(`الطبيب «${payload.name}» موجود بالفعل في ${payload.specialty}`);
  }
  if (payload.code) {
    const dup = await query(`SELECT id FROM doctors WHERE code = $1`, [payload.code]);
    if (dup.rows.length) throw new Error('كود الطبيب مستخدم مسبقًا');
  }
  const { rows } = await query(
    `INSERT INTO doctors (code, name, department, specialty, is_active, updated_at)
     VALUES ($1,$2,$3,$4,$5,NOW())
     RETURNING *`,
    [payload.code, payload.name, payload.department, payload.specialty, data.is_active !== false]
  );
  return rows[0];
}

async function updateDoctor(id, data) {
  const existing = await getDoctorById(id);
  if (!existing) throw new Error('الطبيب غير موجود');

  const department = data.department !== undefined ? normalizeDoctorText(data.department) : existing.department;
  const specialty = data.specialty !== undefined ? normalizeDoctorText(data.specialty) : existing.specialty;
  const name = data.name !== undefined ? normalizeDoctorText(data.name) : existing.name;
  if (!department || !specialty || !name) throw new Error('القسم والتخصص والاسم مطلوبان');

  const conflict = await findDoctorByIdentity(department, specialty, name);
  if (conflict && conflict.id !== Number(id)) {
    throw new Error(`طبيب آخر بنفس الاسم في ${specialty}`);
  }

  const code =
    data.code !== undefined ? normalizeDoctorText(data.code) || null : existing.code;
  if (code) {
    const dup = await query(`SELECT id FROM doctors WHERE code = $1 AND id <> $2`, [code, id]);
    if (dup.rows.length) throw new Error('كود الطبيب مستخدم مسبقًا');
  }

  const { rows } = await query(
    `UPDATE doctors SET code = $2, name = $3, department = $4, specialty = $5, updated_at = NOW()
     WHERE id = $1 RETURNING *`,
    [Number(id), code, name, department, specialty]
  );
  return rows[0];
}

async function setDoctorActive(id, isActive) {
  const { rows } = await query(
    `UPDATE doctors SET is_active = $2, updated_at = NOW() WHERE id = $1 RETURNING *`,
    [Number(id), !!isActive]
  );
  if (!rows.length) throw new Error('الطبيب غير موجود');
  return rows[0];
}

async function enrichDoctorImportPreview(previewRows, client = null) {
  for (const row of previewRows) {
    try {
      const payload = validateDoctorPayload(row);
      const existing = await findDoctorByIdentity(
        payload.department,
        payload.specialty,
        payload.name,
        client
      );
      if (existing) {
        row.import_status = 'existing';
        row.import_message = 'موجود مسبقًا — سيُتخطى';
        row.existing_doctor_id = existing.id;
      } else {
        row.import_status = 'new';
        row.import_message = 'سيتم إضافته';
      }
    } catch (err) {
      row.import_status = 'invalid';
      row.import_message = err.message;
    }
  }
}

async function analyzeDoctorImportFile(buffer, originalName, mappingOverride = null) {
  const table = await readTabularFile(buffer, originalName);
  if (!table.headers.length) throw new Error('لم يُعثر على أعمدة في الملف');

  const detection = detectColumnMapping(table.headers, DOCTOR_IMPORT_SCHEMA);
  const mapping = mappingOverride || detection.mapping;
  if (mappingOverride) validateMapping(mapping, DOCTOR_IMPORT_SCHEMA);

  const mappedRows = applyColumnMapping(table.rows, table.headers, mapping, DOCTOR_IMPORT_SCHEMA);
  const preview_rows = [];
  const duplicate_rows = [];
  const invalid_rows = [];
  const seen = new Map();

  for (const row of mappedRows) {
    const dept = normalizeDoctorText(row.department);
    const spec = normalizeDoctorText(row.specialty);
    const name = normalizeDoctorText(row.name);
    if (!dept && !spec && !name) continue;

    try {
      validateDoctorPayload(row);
      const key = doctorIdentityKey(dept, spec, name);
      if (seen.has(key)) {
        duplicate_rows.push({ ...row, import_status: 'duplicate', import_message: 'مكرر في الملف' });
        continue;
      }
      seen.set(key, row.row_number);
      preview_rows.push({ ...row, department: dept, specialty: spec, name });
    } catch (err) {
      invalid_rows.push({ ...row, import_status: 'invalid', import_message: err.message });
    }
  }

  await enrichDoctorImportPreview(preview_rows);

  return {
    headers: table.headers,
    fields: buildImportFieldList(DOCTOR_IMPORT_SCHEMA),
    suggested_mapping: detection.mapping,
    mapping,
    confidence: detection.confidence,
    needs_manual_mapping: mappingOverride ? false : detection.needs_manual_mapping,
    missing_required: detection.missing_required,
    unmapped_headers: detection.unmapped_headers,
    preview_rows: preview_rows.slice(0, 100),
    duplicate_rows,
    invalid_rows,
    total_rows: mappedRows.length,
    new_count: preview_rows.filter((r) => r.import_status === 'new').length,
    existing_count: preview_rows.filter((r) => r.import_status === 'existing').length,
  };
}

async function importDoctorRowsTransactional(rows = []) {
  const result = { inserted: 0, skipped: 0, errors: [] };
  const seen = new Set();

  await withTransaction(async (client) => {
    for (const raw of rows) {
      const rowNumber = raw.row_number;
      try {
        const payload = validateDoctorPayload(raw);
        const key = doctorIdentityKey(payload.department, payload.specialty, payload.name);
        if (seen.has(key)) {
          result.skipped += 1;
          continue;
        }
        seen.add(key);

        const existing = await findDoctorByIdentity(
          payload.department,
          payload.specialty,
          payload.name,
          client
        );
        if (existing) {
          result.skipped += 1;
          continue;
        }

        await client.query(
          `INSERT INTO doctors (code, name, department, specialty, is_active, updated_at)
           VALUES ($1,$2,$3,$4,TRUE,NOW())`,
          [payload.code, payload.name, payload.department, payload.specialty]
        );
        result.inserted += 1;
      } catch (err) {
        result.errors.push({ row: rowNumber, message: err.message });
        throw err;
      }
    }
  });

  return result;
}

async function confirmDoctorImportFile(buffer, originalName, mappingOverride = null) {
  const table = await readTabularFile(buffer, originalName);
  const detection = detectColumnMapping(table.headers, DOCTOR_IMPORT_SCHEMA);
  const mapping = mappingOverride || detection.mapping;
  validateMapping(mapping, DOCTOR_IMPORT_SCHEMA);
  const mappedRows = applyColumnMapping(table.rows, table.headers, mapping, DOCTOR_IMPORT_SCHEMA);
  return importDoctorRowsTransactional(mappedRows);
}

async function exportDoctorsExcel() {
  const doctors = await listDoctors({});
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('الأطباء');
  sheet.columns = [
    { header: 'م', key: 'serial', width: 8 },
    { header: 'القسم', key: 'department', width: 20 },
    { header: 'التخصص', key: 'specialty', width: 20 },
    { header: 'الاسم', key: 'name', width: 40 },
    { header: 'كود', key: 'code', width: 12 },
    { header: 'نشط', key: 'active', width: 8 },
  ];
  doctors.forEach((doc, index) => {
    sheet.addRow({
      serial: index + 1,
      department: doc.department,
      specialty: doc.specialty,
      name: doc.name,
      code: doc.code || '',
      active: doc.is_active ? 'نعم' : 'لا',
    });
  });
  return workbook.xlsx.writeBuffer();
}

async function exportDoctorImportTemplate() {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('قالب الأطباء');
  sheet.columns = [
    { header: 'م', key: 'serial', width: 8 },
    { header: 'القسم', key: 'department', width: 20 },
    { header: 'التخصص', key: 'specialty', width: 20 },
    { header: 'الاسم', key: 'name', width: 40 },
  ];
  sheet.addRow({ serial: 1, department: 'أطباء', specialty: 'مسالك', name: 'حاتم سلطان عطية سيد محمد' });
  return workbook.xlsx.writeBuffer();
}

function buildDoctorReportFilters(filters = {}) {
  const params = [];
  let i = 1;
  let sql = `
    FROM patient_daily_entries e
    JOIN patients p ON p.id = e.patient_id
    JOIN patient_daily_entry_lines l ON l.entry_id = e.id
    LEFT JOIN daily_charge_sections dcs ON dcs.code = l.section_code
    WHERE COALESCE(l.amount, 0) > 0
      AND dcs.input_type IS DISTINCT FROM 'date'
      AND dcs.input_type IS DISTINCT FROM 'text'`;

  if (filters.from_date) {
    sql += ` AND e.entry_date >= $${i++}`;
    params.push(filters.from_date);
  }
  if (filters.to_date) {
    sql += ` AND e.entry_date <= $${i++}`;
    params.push(filters.to_date);
  }
  if (filters.department) {
    sql += ` AND LOWER(TRIM(e.doctor_department_snapshot)) = LOWER(TRIM($${i++}))`;
    params.push(filters.department);
  }
  if (filters.specialty) {
    sql += ` AND LOWER(TRIM(e.doctor_specialty)) = LOWER(TRIM($${i++}))`;
    params.push(filters.specialty);
  }
  if (filters.doctor_id) {
    sql += ` AND e.doctor_id = $${i++}`;
    params.push(Number(filters.doctor_id));
  }
  if (filters.file_number) {
    sql += ` AND p.file_number ILIKE $${i++}`;
    params.push(`%${String(filters.file_number).trim()}%`);
  }

  return { sql, params };
}

async function getDoctorReportSummary(filters = {}) {
  const { sql, params } = buildDoctorReportFilters(filters);
  const { rows } = await query(
    `SELECT
        e.doctor_id,
        e.doctor_name_snapshot AS doctor_name,
        e.doctor_specialty AS specialty,
        e.doctor_department_snapshot AS department,
        COUNT(DISTINCT e.id)::int AS visit_count,
        COUNT(l.id)::int AS service_count,
        COALESCE(SUM(l.amount), 0)::numeric AS total_value
     ${sql}
       AND e.doctor_id IS NOT NULL
     GROUP BY e.doctor_id, e.doctor_name_snapshot, e.doctor_specialty, e.doctor_department_snapshot
     ORDER BY total_value DESC, doctor_name`,
    params
  );
  return {
    filters,
    rows,
    totals: {
      visit_count: rows.reduce((s, r) => s + Number(r.visit_count || 0), 0),
      service_count: rows.reduce((s, r) => s + Number(r.service_count || 0), 0),
      total_value: rows.reduce((s, r) => s + Number(r.total_value || 0), 0),
    },
  };
}

async function getDoctorReportDetailed(filters = {}) {
  const { sql, params } = buildDoctorReportFilters(filters);
  const { rows } = await query(
    `SELECT
        e.entry_date,
        p.file_number,
        p.name AS patient_name,
        e.doctor_name_snapshot AS doctor_name,
        e.doctor_specialty AS specialty,
        e.doctor_department_snapshot AS department,
        COALESCE(l.description, dcs.name, l.section_code) AS service_description,
        l.quantity,
        l.unit_price,
        l.amount AS line_total,
        e.doctor_id
     ${sql}
       AND e.doctor_id IS NOT NULL
     ORDER BY e.entry_date, e.id, l.sort_order, l.id`,
    params
  );
  return { filters, rows };
}

async function exportDoctorReportExcel(filters = {}, detailed = false) {
  const workbook = new ExcelJS.Workbook();
  if (detailed) {
    const report = await getDoctorReportDetailed(filters);
    const sheet = workbook.addWorksheet('تفاصيل الأطباء');
    sheet.columns = [
      { header: 'التاريخ', key: 'entry_date', width: 14 },
      { header: 'رقم الملف', key: 'file_number', width: 14 },
      { header: 'المريض', key: 'patient_name', width: 24 },
      { header: 'الطبيب', key: 'doctor_name', width: 30 },
      { header: 'التخصص', key: 'specialty', width: 16 },
      { header: 'القسم', key: 'department', width: 16 },
      { header: 'الخدمة', key: 'service_description', width: 30 },
      { header: 'الكمية', key: 'quantity', width: 10 },
      { header: 'السعر', key: 'unit_price', width: 12 },
      { header: 'الإجمالي', key: 'line_total', width: 12 },
    ];
    for (const row of report.rows) {
      sheet.addRow({
        entry_date: row.entry_date,
        file_number: row.file_number,
        patient_name: row.patient_name,
        doctor_name: row.doctor_name,
        specialty: row.specialty,
        department: row.department,
        service_description: row.service_description,
        quantity: Number(row.quantity),
        unit_price: Number(row.unit_price),
        line_total: Number(row.line_total),
      });
    }
  } else {
    const report = await getDoctorReportSummary(filters);
    const sheet = workbook.addWorksheet('تقرير الأطباء');
    sheet.columns = [
      { header: 'الطبيب', key: 'doctor_name', width: 30 },
      { header: 'التخصص', key: 'specialty', width: 16 },
      { header: 'القسم', key: 'department', width: 16 },
      { header: 'عدد الزيارات', key: 'visit_count', width: 12 },
      { header: 'عدد الخدمات', key: 'service_count', width: 12 },
      { header: 'إجمالي القيمة', key: 'total_value', width: 14 },
    ];
    for (const row of report.rows) {
      sheet.addRow({
        doctor_name: row.doctor_name,
        specialty: row.specialty,
        department: row.department,
        visit_count: Number(row.visit_count),
        service_count: Number(row.service_count),
        total_value: Number(row.total_value),
      });
    }
  }
  return workbook.xlsx.writeBuffer();
}

module.exports = {
  normalizeDoctorText,
  doctorIdentityKey,
  DOCTOR_IMPORT_SCHEMA,
  listDoctors,
  listDoctorsPaginated,
  listSpecialties,
  listDepartments,
  getDoctorById,
  createDoctor,
  updateDoctor,
  setDoctorActive,
  findDoctorByIdentity,
  analyzeDoctorImportFile,
  confirmDoctorImportFile,
  importDoctorRowsTransactional,
  exportDoctorsExcel,
  exportDoctorImportTemplate,
  getDoctorReportSummary,
  getDoctorReportDetailed,
  exportDoctorReportExcel,
};
