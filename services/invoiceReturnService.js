const { query, withTransaction } = require('../database/db');
const {
  round2,
  isItemAdminApplicable,
  computeItemAdminFeeRaw,
} = require('./calculations');

function buildReturnLineAudit(invoiceItem, returnQty, discountPercent, adminPercent) {
  const originalQty = round2(invoiceItem.quantity) || 0;
  const unitPrice = round2(invoiceItem.unit_price_snapshot ?? invoiceItem.amount ?? 0);
  const returnAmount = round2(unitPrice * returnQty);
  const ratio = originalQty > 0 ? returnQty / originalQty : 0;

  const unitCost = round2(invoiceItem.cost_price_snapshot ?? 0);
  const costReversal = unitCost > 0 ? round2(unitCost * returnQty) : 0;
  const marginSnapshot = round2(invoiceItem.margin_amount_snapshot ?? 0);
  const marginReversal =
    marginSnapshot > 0 && originalQty > 0 ? round2(marginSnapshot * ratio) : round2(returnAmount - costReversal);

  const adminReversal = isItemAdminApplicable(invoiceItem)
    ? round2(returnAmount * (Number(adminPercent) || 0) / 100)
    : 0;

  const itemDiscountPct = round2(invoiceItem.item_discount_percent ?? discountPercent ?? 0);
  const discountReversal =
    invoiceItem.is_discount_eligible ? round2(returnAmount * (itemDiscountPct / 100)) : 0;

  return {
    return_quantity: returnQty,
    unit_price_snapshot: unitPrice,
    return_amount: returnAmount,
    description_snapshot: invoiceItem.description || invoiceItem.service_name_snapshot || '',
    unit_snapshot: invoiceItem.unit_snapshot || '',
    service_id: invoiceItem.service_id || null,
    service_code_snapshot: invoiceItem.service_code_snapshot || '',
    service_name_snapshot: invoiceItem.service_name_snapshot || invoiceItem.description || '',
    cost_price_snapshot: unitCost > 0 ? unitCost : null,
    markup_percent_snapshot: invoiceItem.markup_percent_snapshot ?? null,
    selling_price_snapshot: unitPrice,
    margin_amount_snapshot: marginReversal,
    admin_fee_reversal_snapshot: adminReversal,
    discount_reversal_snapshot: discountReversal,
  };
}

async function listInvoiceReturns(invoiceId, client = null) {
  const run = client ? client.query.bind(client) : query;
  const { rows: returns } = await run(
    `SELECT * FROM invoice_returns WHERE invoice_id = $1 ORDER BY created_at DESC, id DESC`,
    [Number(invoiceId)]
  );
  if (!returns.length) return [];

  const { rows: lines } = await run(
    `SELECT ir.*, iir.*
     FROM invoice_item_returns iir
     JOIN invoice_returns ir ON ir.id = iir.invoice_return_id
     WHERE ir.invoice_id = $1
     ORDER BY iir.id`,
    [Number(invoiceId)]
  );

  const linesByReturn = new Map();
  for (const line of lines) {
    const key = line.invoice_return_id;
    if (!linesByReturn.has(key)) linesByReturn.set(key, []);
    linesByReturn.get(key).push(line);
  }

  return returns.map((ret) => ({
    ...ret,
    lines: linesByReturn.get(ret.id) || [],
  }));
}

async function recordInvoiceReturns(invoiceId, payload = {}, user = null) {
  const lines = Array.isArray(payload.lines) ? payload.lines : [];
  if (!lines.length) throw new Error('يجب تحديد بنود للإرجاع');

  const { getInvoiceById, recalculateAndPersistInvoiceTotals } = require('./invoiceService');

  return withTransaction(async (client) => {
    const invoice = await getInvoiceById(invoiceId, client);
    if (!invoice) throw new Error('الفاتورة غير موجودة');

    if (invoice.status !== 'approved') {
      const statusLabels = {
        draft: 'مسودة',
        pending_review: 'قيد المراجعة',
      };
      const statusLabel = statusLabels[invoice.status] || invoice.status || 'غير معروفة';
      throw new Error(
        `لا يمكن تسجيل الإرجاع — الإرجاع متاح فقط للفواتير المعتمدة (الحالة الحالية: ${statusLabel})`
      );
    }

    const itemMap = new Map((invoice.items || []).map((item) => [Number(item.id), item]));
    const normalized = [];

    for (const raw of lines) {
      const itemId = Number(raw.invoice_item_id || raw.id);
      const returnQty = round2(raw.return_quantity);
      if (!itemId || returnQty <= 0) {
        throw new Error('كمية الإرجاع غير صالحة');
      }
      const item = itemMap.get(itemId);
      if (!item) throw new Error(`البند #${itemId} غير موجود في الفاتورة`);

      const originalQty = round2(item.quantity) || 0;
      const alreadyReturned = round2(item.returned_quantity) || 0;
      const remainingQty = round2(originalQty - alreadyReturned);

      if (returnQty > remainingQty) {
        throw new Error(
          `لا يمكن إرجاع ${returnQty} من «${item.description || item.service_name_snapshot}» — المتاح للإرجاع ${remainingQty}`
        );
      }

      normalized.push({ item, returnQty });
    }

    const returnDate = payload.return_date || new Date().toISOString().slice(0, 10);
    const notes = String(payload.notes || '').trim();
    const userId = user?.id || null;
    const userName = user?.full_name || user?.username || '';

    const { rows: returnHeader } = await client.query(
      `INSERT INTO invoice_returns (invoice_id, return_date, notes, created_by_user_id, created_by_name)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [Number(invoiceId), returnDate, notes, userId, userName]
    );
    const returnRecord = returnHeader[0];

    const discountPercent = round2(invoice.discount_percent) || 0;
    const adminPercent = round2(invoice.admin_expenses_percent) || 12;

    for (const { item, returnQty } of normalized) {
      const audit = buildReturnLineAudit(item, returnQty, discountPercent, adminPercent);

      await client.query(
        `INSERT INTO invoice_item_returns (
          invoice_return_id, invoice_item_id, return_quantity, unit_price_snapshot, return_amount,
          description_snapshot, unit_snapshot, service_id, service_code_snapshot, service_name_snapshot,
          cost_price_snapshot, markup_percent_snapshot, selling_price_snapshot, margin_amount_snapshot,
          admin_fee_reversal_snapshot, discount_reversal_snapshot
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
        [
          returnRecord.id,
          item.id,
          audit.return_quantity,
          audit.unit_price_snapshot,
          audit.return_amount,
          audit.description_snapshot,
          audit.unit_snapshot,
          audit.service_id,
          audit.service_code_snapshot,
          audit.service_name_snapshot,
          audit.cost_price_snapshot,
          audit.markup_percent_snapshot,
          audit.selling_price_snapshot,
          audit.margin_amount_snapshot,
          audit.admin_fee_reversal_snapshot,
          audit.discount_reversal_snapshot,
        ]
      );

      await client.query(
        `UPDATE invoice_items
         SET returned_quantity = COALESCE(returned_quantity, 0) + $2
         WHERE id = $1`,
        [item.id, returnQty]
      );
    }

    const recalc = await recalculateAndPersistInvoiceTotals(invoiceId, client);
    const returns = await listInvoiceReturns(invoiceId, client);

    return {
      return: returnRecord,
      returns,
      invoice: recalc.invoice,
      totals: recalc.totals,
    };
  });
}

module.exports = {
  buildReturnLineAudit,
  listInvoiceReturns,
  recordInvoiceReturns,
};
