const { v4: uuidv4 } = require('uuid');
const { query, withTransaction } = require('../database/db');
const { calculateInvoiceTotals, calculateStayDays, validatePaymentBalance, validateInvoiceCalculations } = require('./calculations');
const { nextSerialNumber, formatFiscalYearLabel } = require('./serialService');
const { getInvoiceTypesMap } = require('./invoiceTypeService');
const { getContractedEntityById, getEffectiveDiscountPercent } = require('./contractedEntityService');
const { listDiscountExclusions } = require('./discountExclusionService');
const { upsertPatient, applyPatientCredit } = require('./patientService');
const { getSummaryReport, STATUS_LABELS } = require('./reportService');

const { getStayTypeById } = require('./stayTypeService');
const { resolveServiceForInvoice } = require('./serviceCatalogService');
const { getSetting } = require('./settingsService');

async function enrichItemsWithServices(items = []) {
  const enriched = [];
  for (const item of items) {
    if (item.service_id) {
      try {
        const resolved = await resolveServiceForInvoice(Number(item.service_id), {
          tier_key: item.tier_key,
          unit: item.unit,
        });
        enriched.push({
          ...item,
          description: item.description || resolved.description,
          amount: item.amount ?? resolved.amount,
          ...resolved,
        });
        continue;
      } catch {
        /* keep original item */
      }
    }
    enriched.push(item);
  }
  return enriched;
}

async function prepareCalculationData(data) {
  const calcData = { ...data };
  const { ensurePatientCreditMethod, getPaymentMethodIdByCode } = require('./paymentMethodService');
  await ensurePatientCreditMethod();
  calcData.patient_credit_method_id = await getPaymentMethodIdByCode('patient_credit');
  calcData.discount_exclusions = await listDiscountExclusions(true);
  calcData.administrative_fee_rate = Number(await getSetting('administrative_fee_rate', '12')) || 12;
  if (calcData.admin_expenses_percent === undefined || calcData.admin_expenses_percent === '') {
    calcData.admin_expenses_percent = calcData.administrative_fee_rate;
  }

  if (Array.isArray(calcData.items)) {
    calcData.items = await enrichItemsWithServices(calcData.items);
  }

  if (Array.isArray(calcData.stay_entries)) {
    calcData.stay_entries = await Promise.all(
      calcData.stay_entries.map(async (entry) => {
        const next = { ...entry };
        if (next.stay_type_id) {
          const stayType = await getStayTypeById(Number(next.stay_type_id));
          if (stayType) {
            next.stay_type_name = stayType.name;
            if (next.daily_rate === undefined || next.daily_rate === '' || next.daily_rate === null) {
              next.daily_rate = stayType.daily_rate;
            }
          }
        }
        return next;
      })
    );
  }

  if (calcData.invoice_type === 'contracted' && calcData.contracted_entity_id) {
    const entity = await getContractedEntityById(Number(calcData.contracted_entity_id));
    if (entity) {
      calcData.contracted_entity_name = entity.name;
      if (!calcData.discount_percent) {
        calcData.discount_percent = await getEffectiveDiscountPercent(entity.id);
      }
    }
  } else {
    calcData.contracted_entity_id = null;
    calcData.contracted_entity_name = '';
    calcData.discount_percent = 0;
  }

  if (
    calcData.file_number &&
    calcData.admission_date &&
    calcData.discharge_date &&
    calcData.include_daily_charges !== false
  ) {
    const { getInvoiceItemsFromDailyCharges } = require('./dailyChargeService');
    const dailyItems = await getInvoiceItemsFromDailyCharges(
      calcData.file_number,
      calcData.admission_date,
      calcData.discharge_date,
      calcData.invoice_id || calcData.id || null
    );
    if (dailyItems.length) {
      const existing = Array.isArray(calcData.items) ? calcData.items : [];
      const linkedLineIds = new Set(
        existing.filter((item) => item.daily_entry_line_id).map((item) => Number(item.daily_entry_line_id))
      );
      const merged = dailyItems.filter((item) => !linkedLineIds.has(Number(item.daily_entry_line_id)));
      if (merged.length) calcData.items = [...existing, ...merged];
    }
  }

  return calcData;
}

async function saveDiscountFields(client, invoiceId, data, totals, createdBy = null) {
  await client.query(
    `UPDATE invoices SET
      contracted_entity_id = $2,
      contracted_entity_name = $3,
      discount_percent = $4,
      discount_eligible_subtotal = $5,
      discount_eligible_subtotal_raw = $6,
      discount_amount = $7,
      discount_amount_raw = $8,
      items_subtotal_after_discount = $9,
      items_subtotal_after_discount_raw = $10,
      letter_from_date = $11,
      letter_to_date = $12,
      created_by_user_id = COALESCE(created_by_user_id, $13),
      created_by_name = CASE WHEN COALESCE(created_by_name, '') = '' THEN $14 ELSE created_by_name END
     WHERE id = $1`,
    [
      invoiceId,
      data.contracted_entity_id ? Number(data.contracted_entity_id) : null,
      data.contracted_entity_name || '',
      totals.discount_percent || 0,
      totals.discount_eligible_subtotal || 0,
      totals.discount_eligible_subtotal_raw || 0,
      totals.discount_amount || 0,
      totals.discount_amount_raw || 0,
      totals.net_after_discount ?? totals.items_subtotal_after_discount ?? 0,
      totals.net_after_discount_raw ?? totals.items_subtotal_after_discount_raw ?? 0,
      data.letter_from_date || null,
      data.letter_to_date || null,
      createdBy?.id || null,
      createdBy?.name || '',
    ]
  );
}

async function attachInvoiceLabels(invoice, typeMap) {
  const labels = typeMap || (await getInvoiceTypesMap());
  const fiscalYear = invoice.fiscal_year;
  return {
    ...invoice,
    invoice_type_label: labels[invoice.invoice_type] || invoice.invoice_type,
    fiscal_year_label: fiscalYear ? formatFiscalYearLabel(fiscalYear) : null,
    status_label: STATUS_LABELS[invoice.status] || invoice.status || '',
  };
}

async function loadMethodPayments(invoiceId, client = null) {
  const run = client ? client.query.bind(client) : query;
  const { rows } = await run(
    `SELECT ipa.amount, pm.id AS payment_method_id, pm.code, pm.name, pm.accepts_amount
     FROM invoice_payment_amounts ipa
     JOIN payment_methods pm ON pm.id = ipa.payment_method_id
     WHERE ipa.invoice_id = $1
     ORDER BY pm.sort_order, pm.name`,
    [invoiceId]
  );
  return rows;
}

async function saveMethodPayments(client, invoiceId, methodPayments = []) {
  const { getPaymentMethodIdByCode } = require('./paymentMethodService');
  await client.query('DELETE FROM invoice_payment_amounts WHERE invoice_id = $1', [invoiceId]);
  for (const entry of methodPayments) {
    const amount = Number(entry.amount) || 0;
    if (amount === 0) continue;
    let methodId = entry.payment_method_id;
    if (!methodId && entry.code) {
      methodId = await getPaymentMethodIdByCode(entry.code, client);
    }
    if (!methodId) continue;
    await client.query(
      `INSERT INTO invoice_payment_amounts (invoice_id, payment_method_id, amount)
       VALUES ($1, $2, $3)
       ON CONFLICT (invoice_id, payment_method_id) DO UPDATE SET amount = EXCLUDED.amount`,
      [invoiceId, methodId, amount]
    );
  }
}
async function resolveStayTypes(client, data) {
  let ids = [];
  if (Array.isArray(data.stay_entries) && data.stay_entries.length) {
    ids = data.stay_entries.map((entry) => Number(entry.stay_type_id)).filter(Boolean);
  } else if (Array.isArray(data.stay_type_ids) && data.stay_type_ids.length) {
    ids = data.stay_type_ids.map(Number).filter(Boolean);
  } else if (data.stay_type_id) {
    ids = [Number(data.stay_type_id)];
  }

  if (!ids.length) {
    return { ids: [], names: data.stay_type || '', firstId: null };
  }

  const st = await client.query(
    'SELECT id, name FROM stay_types WHERE id = ANY($1::int[]) ORDER BY sort_order, name',
    [ids]
  );
  const orderedIds = st.rows.map((r) => r.id);
  const names = st.rows.map((r) => r.name).join('، ');
  return { ids: orderedIds, names, firstId: orderedIds[0] || null };
}

async function loadStayEntries(invoiceId, client = null) {
  const run = client ? client.query.bind(client) : query;
  const { rows } = await run(
    'SELECT * FROM invoice_stay_entries WHERE invoice_id = $1 ORDER BY sort_order, id',
    [invoiceId]
  );
  return rows;
}

async function saveStayEntries(client, invoiceId, stayEntries = []) {
  await client.query('DELETE FROM invoice_stay_entries WHERE invoice_id = $1', [invoiceId]);
  for (let index = 0; index < stayEntries.length; index++) {
    const entry = stayEntries[index];
    await client.query(
      `INSERT INTO invoice_stay_entries (
        invoice_id, stay_type_id, stay_type_name, from_date, to_date, days,
        daily_rate, total, total_raw, sort_order
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        invoiceId,
        entry.stay_type_id ? Number(entry.stay_type_id) : null,
        entry.stay_type_name || '',
        entry.from_date || null,
        entry.to_date || null,
        entry.days || 0,
        entry.daily_rate || 0,
        entry.total || 0,
        entry.total_raw || 0,
        index,
      ]
    );
  }
}

async function getInvoiceById(id, client = null) {
  const run = client ? client.query.bind(client) : query;
  const { rows } = await run('SELECT * FROM invoices WHERE id = $1', [id]);
  if (!rows.length) return null;
  const invoice = rows[0];

  const items = await run(
    'SELECT * FROM invoice_items WHERE invoice_id = $1 ORDER BY sort_order, id',
    [id]
  );
  const payments = await run(
    'SELECT * FROM invoice_payments WHERE invoice_id = $1 ORDER BY sort_order, id',
    [id]
  );
  const methodPayments = await loadMethodPayments(id, client);
  const stayEntries = await loadStayEntries(id, client);
  const typeMap = await getInvoiceTypesMap();

  return {
    ...(await attachInvoiceLabels(invoice, typeMap)),
    items: items.rows,
    payments: payments.rows,
    method_payments: methodPayments,
    stay_entries: stayEntries,
  };
}

async function getInvoiceByToken(token) {
  const { rows } = await query('SELECT id FROM invoices WHERE qr_token = $1', [token]);
  if (!rows.length) return null;
  return getInvoiceById(rows[0].id);
}

async function listInvoices(filters = {}) {
  let sql = 'SELECT * FROM invoices WHERE 1=1';
  const params = [];
  let i = 1;

  if (filters.invoice_type) {
    sql += ` AND invoice_type = $${i++}`;
    params.push(filters.invoice_type);
  }
  if (filters.from_date) {
    sql += ` AND COALESCE(issue_date, created_at::date) >= $${i++}::date`;
    params.push(filters.from_date);
  }
  if (filters.to_date) {
    sql += ` AND COALESCE(issue_date, created_at::date) <= $${i++}::date`;
    params.push(filters.to_date);
  }
  if (filters.search) {
    sql += ` AND (patient_name ILIKE $${i} OR serial_number ILIKE $${i} OR file_number ILIKE $${i})`;
    params.push(`%${filters.search}%`);
    i++;
  }
  if (filters.status) {
    sql += ` AND status = $${i++}`;
    params.push(filters.status);
  }

  sql += ' ORDER BY created_at DESC';

  if (filters.limit) {
    sql += ` LIMIT $${i++}`;
    params.push(Number(filters.limit));
  }

  const { rows } = await query(sql, params);
  const typeMap = await getInvoiceTypesMap();
  return Promise.all(rows.map((row) => attachInvoiceLabels(row, typeMap)));
}

async function saveInvoice(data, existingId = null, createdBy = null, options = {}) {
  const saveMode = options.save_mode || data.save_mode || 'draft';
  const calcData = await prepareCalculationData(data);
  const totals = calculateInvoiceTotals(calcData);

  const calcValidation = totals.calculation_validation || validateInvoiceCalculations(calcData, totals);
  if (!calcValidation.is_valid) {
    throw new Error(`خطأ في حسابات الفاتورة:\n${calcValidation.errors.join('\n')}`);
  }

  const isDraftSave = saveMode === 'draft';
  if (!isDraftSave) {
    const paymentValidation = validatePaymentBalance(totals);
    if (paymentValidation.has_payments && !paymentValidation.is_balanced) {
      const diff = Math.abs(paymentValidation.difference_raw);
      const direction =
        paymentValidation.status === 'overpaid'
          ? `زيادة ${diff.toLocaleString('ar-EG')}`
          : `نقص ${diff.toLocaleString('ar-EG')}`;
      throw new Error(
        `مجموع طرق الدفع (${paymentValidation.total_collected_raw.toLocaleString('ar-EG')}) لا يساوي إجمالي الفاتورة (${paymentValidation.final_total_raw.toLocaleString('ar-EG')}) — ${direction}`
      );
    }
  }

  const patientCreditApplied =
    Math.round((Number(totals.patient_credit_applied ?? data.patient_credit_applied) || 0) * 100) / 100;
  data.method_payments = totals.method_payments || data.method_payments || [];
  const nextStatus = saveMode === 'submit' ? 'pending_review' : 'draft';

  let stayDays =
    calcData.stay_days !== undefined && calcData.stay_days !== ''
      ? Number(calcData.stay_days)
      : calculateStayDays(calcData.admission_date, calcData.discharge_date);
  if (totals.stay_entries?.length) {
    stayDays = totals.stay_entries.reduce((sum, entry) => sum + (Number(entry.days) || 0), 0);
  }

  const manualItems = totals.items.filter((item) => !item.is_stay_entry);

  if (data.file_number?.trim()) {
    await upsertPatient(data.file_number, data.patient_name || '');
  }

  return withTransaction(async (client) => {
    let serialNumber = null;
    let fiscalYear = null;
    let serialSequence = null;
    let qrToken = null;
    let invoiceId = existingId;
    let invoiceStatus = nextStatus;

    const { ids: stayTypeIds, names: stayTypeName, firstId: stayTypeId } = await resolveStayTypes(
      client,
      calcData
    );
    const stayTypeIdsJson = JSON.stringify(stayTypeIds);

    if (existingId) {
      const existing = await client.query(
        `SELECT serial_number, qr_token, file_password, fiscal_year, serial_sequence, status, patient_credit_deducted
         FROM invoices WHERE id = $1`,
        [existingId]
      );
      if (!existing.rows.length) throw new Error('الفاتورة غير موجودة');

      const current = existing.rows[0];
      if (current.status === 'approved') {
        throw new Error('لا يمكن تعديل فاتورة معتمدة — تواصل مع المراجع');
      }

      serialNumber = current.serial_number;
      fiscalYear = current.fiscal_year;
      serialSequence = current.serial_sequence;
      qrToken = current.qr_token;
      invoiceStatus = nextStatus;
      const filePassword = '';

      await client.query(
        `UPDATE invoices SET
          invoice_type = $1, patient_name = $2, file_number = $3, issue_date = $4, admission_date = $5, discharge_date = $6,
          stay_days = $7, financial_treatment = $8, stay_type = $9, stay_type_id = $10, stay_type_ids = $11::jsonb,
          stamp_duty = $12, stamp_duty_raw = $13, professional_fees = $14, professional_fees_raw = $15,
          items_subtotal = $16, items_subtotal_raw = $17,
          stay_subtotal = $18, stay_subtotal_raw = $19,
          admin_expenses_percent = $20, admin_expenses = $21, admin_expenses_raw = $22,
          total_after_admin = $23, total_after_admin_raw = $24,
          balance = $25, balance_raw = $26, final_total = $27, final_total_raw = $28,
          cash_private = $29, bank_private = $30, cash_external = $31, bank_external = $32,
          total_collected = $33, total_collected_raw = $34, remaining = $35, remaining_raw = $36,
          employee_name = $37, auditor_name = $38, captain_name = $39, manager_name = $40,
          file_password = $41, notes = $42,
          status = $43, submitted_at = CASE WHEN $43 = 'pending_review' THEN NOW() ELSE submitted_at END,
          patient_credit_applied = $44,
          updated_at = NOW()
        WHERE id = $45`,
        [
          data.invoice_type,
          data.patient_name || '',
          data.file_number || '',
          data.issue_date || null,
          data.admission_date || null,
          data.discharge_date || null,
          stayDays,
          data.financial_treatment || '',
          stayTypeName,
          stayTypeId,
          stayTypeIdsJson,
          totals.stamp_duty,
          totals.stamp_duty_raw,
          totals.professional_fees,
          totals.professional_fees_raw,
          totals.items_subtotal,
          totals.items_subtotal_raw,
          totals.stay_subtotal,
          totals.stay_subtotal_raw,
          totals.admin_expenses_percent,
          totals.admin_expenses,
          totals.admin_expenses_raw,
          totals.total_after_admin,
          totals.total_after_admin_raw,
          totals.balance,
          totals.balance_raw,
          totals.final_total,
          totals.final_total_raw,
          totals.cash_private,
          totals.bank_private,
          totals.cash_external,
          totals.bank_external,
          totals.total_collected,
          totals.total_collected_raw,
          totals.remaining,
          totals.remaining_raw,
          data.employee_name || '',
          data.auditor_name || '',
          data.captain_name || 'نقيب / عمرو صالح محمد',
          data.manager_name || 'رائد / جمال عبد الناصر - المدير المالي',
          filePassword,
          data.notes || '',
          invoiceStatus,
          patientCreditApplied,
          existingId,
        ]
      );

      await client.query('DELETE FROM invoice_items WHERE invoice_id = $1', [existingId]);
      await client.query('DELETE FROM invoice_payments WHERE invoice_id = $1', [existingId]);
      await client.query('DELETE FROM invoice_stay_entries WHERE invoice_id = $1', [existingId]);
      await saveDiscountFields(client, existingId, calcData, totals);
    } else {
      const issueDate = data.issue_date || new Date().toISOString().slice(0, 10);
      const filePassword = '';

      const inserted = await client.query(
        `INSERT INTO invoices (
          serial_number, fiscal_year, serial_sequence, issue_date, invoice_type, patient_name, file_number, admission_date, discharge_date,
          stay_days, financial_treatment, stay_type, stay_type_id, stay_type_ids,
          stamp_duty, stamp_duty_raw, professional_fees, professional_fees_raw,
          items_subtotal, items_subtotal_raw, stay_subtotal, stay_subtotal_raw, admin_expenses_percent,
          admin_expenses, admin_expenses_raw, total_after_admin, total_after_admin_raw,
          balance, balance_raw, final_total, final_total_raw,
          cash_private, bank_private, cash_external, bank_external,
          total_collected, total_collected_raw, remaining, remaining_raw,
          employee_name, auditor_name, captain_name, manager_name, qr_token, file_password, notes,
          status, submitted_at, patient_credit_applied
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35,$36,$37,$38,$39,$40,$41,$42,$43,$44,$45,$46,$47,$48,$49)
        RETURNING id`,
        [
          serialNumber,
          fiscalYear,
          serialSequence,
          issueDate,
          data.invoice_type,
          data.patient_name || '',
          data.file_number || '',
          data.admission_date || null,
          data.discharge_date || null,
          stayDays,
          data.financial_treatment || '',
          stayTypeName,
          stayTypeId,
          stayTypeIdsJson,
          totals.stamp_duty,
          totals.stamp_duty_raw,
          totals.professional_fees,
          totals.professional_fees_raw,
          totals.items_subtotal,
          totals.items_subtotal_raw,
          totals.stay_subtotal,
          totals.stay_subtotal_raw,
          totals.admin_expenses_percent,
          totals.admin_expenses,
          totals.admin_expenses_raw,
          totals.total_after_admin,
          totals.total_after_admin_raw,
          totals.balance,
          totals.balance_raw,
          totals.final_total,
          totals.final_total_raw,
          totals.cash_private,
          totals.bank_private,
          totals.cash_external,
          totals.bank_external,
          totals.total_collected,
          totals.total_collected_raw,
          totals.remaining,
          totals.remaining_raw,
          data.employee_name || '',
          data.auditor_name || '',
          data.captain_name || 'نقيب / عمرو صالح محمد',
          data.manager_name || 'رائد / جمال عبد الناصر - المدير المالي',
          qrToken,
          filePassword,
          data.notes || '',
          invoiceStatus,
          invoiceStatus === 'pending_review' ? new Date() : null,
          patientCreditApplied,
        ]
      );

      invoiceId = inserted.rows[0]?.id;
      if (!invoiceId) throw new Error('فشل إنشاء الفاتورة');
      await saveDiscountFields(client, invoiceId, calcData, totals, createdBy);
    }

    for (let index = 0; index < manualItems.length; index++) {
      const item = manualItems[index];
      const adminPercent = totals.admin_expenses_percent || 0;
      const adminFeeAmount =
        item.administrative_fee_applicable_snapshot !== false && item.is_stay_entry !== true
          ? Math.round(((Number(item.total_raw) || 0) * adminPercent) / 100 * 100) / 100
          : 0;
      await client.query(
        `INSERT INTO invoice_items (
          invoice_id, description, quantity, amount, total,
          is_discount_eligible, item_discount_percent, discount_exclusion_id, sort_order,
          service_id, service_code_snapshot, service_name_snapshot, unit_snapshot, unit_price_snapshot,
          price_type_snapshot, tier_key_snapshot, discountable_snapshot, administrative_fee_applicable_snapshot,
          admin_fee_amount_snapshot, admin_fee_percent_snapshot, price_list_id_snapshot, price_list_name_snapshot,
          composite_components_snapshot, patient_credit_applied
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23::jsonb,$24)`,
        [
          invoiceId,
          item.description || item.service_name_snapshot || '',
          item.quantity || 0,
          item.amount || item.unit_price_snapshot || 0,
          item.total || 0,
          item.is_discount_eligible !== false,
          item.item_discount_percent || 0,
          item.discount_exclusion_id || null,
          index,
          item.service_id || null,
          item.service_code_snapshot || '',
          item.service_name_snapshot || item.description || '',
          item.unit_snapshot || '',
          item.unit_price_snapshot ?? item.amount ?? 0,
          item.price_type_snapshot || '',
          item.tier_key_snapshot || '',
          item.discountable_snapshot ?? null,
          item.administrative_fee_applicable_snapshot ?? null,
          adminFeeAmount,
          adminPercent,
          item.price_list_id_snapshot || null,
          item.price_list_name_snapshot || '',
          JSON.stringify(item.composite_components_snapshot || []),
          item.patient_credit_applied || 0,
        ]
      );
    }

    for (let index = 0; index < totals.payments.length; index++) {
      const payment = totals.payments[index];
      await client.query(
        `INSERT INTO invoice_payments (invoice_id, receipt_date, receipt_number, amount, sort_order)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          invoiceId,
          payment.receipt_date || null,
          payment.receipt_number || '',
          payment.amount || 0,
          index,
        ]
      );
    }

    await saveStayEntries(client, invoiceId, totals.stay_entries || []);
    await saveMethodPayments(client, invoiceId, data.method_payments || []);

    if (data.file_number && data.admission_date && data.discharge_date) {
      const { linkEntriesToInvoice } = require('./dailyChargeService');
      await linkEntriesToInvoice(
        invoiceId,
        data.file_number,
        data.admission_date,
        data.discharge_date,
        client
      );
    }

    return getInvoiceById(invoiceId, client);
  });
}

async function approveInvoice(id, reviewer) {
  return withTransaction(async (client) => {
    const { rows } = await client.query('SELECT * FROM invoices WHERE id = $1 FOR UPDATE', [id]);
    if (!rows.length) throw new Error('الفاتورة غير موجودة');
    const invoice = rows[0];

    if (invoice.status === 'approved') {
      throw new Error('الفاتورة معتمدة بالفعل');
    }
    if (invoice.status === 'draft') {
      throw new Error('يجب إرسال الفاتورة للمراجعة أولًا');
    }

    const calcData = await getInvoiceById(id, client);
    const totals = calculateInvoiceTotals(calcData);
    const paymentValidation = validatePaymentBalance(totals);
    if (paymentValidation.has_payments && !paymentValidation.is_balanced) {
      throw new Error('مجموع طرق الدفع لا يساوي إجمالي الفاتورة — راجع المدفوعات قبل الاعتماد');
    }

    const issueDate = invoice.issue_date || new Date().toISOString().slice(0, 10);
    const serialInfo = await nextSerialNumber(client, issueDate);
    const qrToken = uuidv4();
    const reviewerName = reviewer?.full_name || reviewer?.username || '';

    await client.query(
      `UPDATE invoices SET
        serial_number = $2,
        fiscal_year = $3,
        serial_sequence = $4,
        qr_token = $5,
        status = 'approved',
        reviewed_at = NOW(),
        reviewed_by_user_id = $6,
        reviewed_by_name = $7,
        auditor_name = CASE WHEN COALESCE(auditor_name, '') = '' THEN $7 ELSE auditor_name END,
        updated_at = NOW()
       WHERE id = $1`,
      [id, serialInfo.serial_number, serialInfo.fiscal_year, serialInfo.serial_sequence, qrToken, reviewer?.id || null, reviewerName]
    );

    const updated = {
      ...invoice,
      id,
      patient_credit_applied: totals.patient_credit_applied ?? invoice.patient_credit_applied,
      patient_credit_deducted: invoice.patient_credit_deducted,
    };
    await applyPatientCredit(client, updated);

    return getInvoiceById(id, client);
  });
}

async function deleteInvoice(id) {
  const { rows } = await query('SELECT status FROM invoices WHERE id = $1', [id]);
  if (rows.length && rows[0].status === 'approved') {
    throw new Error('لا يمكن حذف فاتورة معتمدة');
  }
  const { rowCount } = await query('DELETE FROM invoices WHERE id = $1', [id]);
  return rowCount > 0;
}

async function getReportsSummary(filters = {}) {
  return getSummaryReport(filters);
}

module.exports = {
  getInvoiceById,
  getInvoiceByToken,
  listInvoices,
  saveInvoice,
  approveInvoice,
  deleteInvoice,
  getReportsSummary,
  prepareCalculationData,
};
