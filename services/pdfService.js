const { formatDual, round2, calculateInvoiceTotals } = require('./calculations');
const { aggregateCustomerFacingLines } = require('./invoicePresentationService');

function formatNumber(n) {
  const num = Number(n) || 0;
  return num.toLocaleString('ar-EG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatNumberInt(n) {
  const num = Number(n) || 0;
  return num.toLocaleString('ar-EG', { maximumFractionDigits: 0 });
}

function fmtDual(raw, rounded) {
  const r = Number(raw) || 0;
  const rd = Number(rounded) || 0;
  if (Math.abs(round2(r) - round2(rd)) < 0.001) {
    return `<span class="num-main">${formatNumber(rd)}</span>`;
  }
  return `<span class="dual-wrap"><span class="num-main">${formatNumber(rd)}</span><span class="num-raw">(${formatNumber(r)})</span></span>`;
}

function fmtPlain(n) {
  return formatNumber(n);
}

function formatDate(d) {
  if (!d) return '';
  try {
    const s = String(d).slice(0, 10);
    const [y, m, day] = s.split('-');
    if (y && m && day) return `${day}/${m}/${y}`;
    return new Date(d).toLocaleDateString('ar-EG');
  } catch {
    return d;
  }
}

function escapeHtml(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function isBracketDateOnlyDescription(text) {
  return /^\[\d{2}-\d{2}-\d{4}\]\s*$/.test(String(text || '').trim());
}

function formatInvoiceLineDescription(item) {
  const snapshotName = String(item?.service_name_snapshot || '').trim();
  let desc = String(item?.description || '').trim();

  if (!desc || isBracketDateOnlyDescription(desc)) {
    const dateMatch = desc.match(/^\[(\d{2}-\d{2}-\d{4})\]/);
    if (dateMatch && snapshotName) {
      desc = `[${dateMatch[1]}] ${snapshotName}`;
    } else if (snapshotName) {
      desc = snapshotName;
    }
  }

  if (!desc) {
    desc = snapshotName || String(item?.service_code_snapshot || '').trim();
  }

  const unit = String(item?.unit_snapshot || '').trim();
  if (unit && desc && !desc.includes(unit)) {
    desc = `${desc} (${unit})`;
  }

  return desc;
}

function formatInvoiceLineDescriptionHtml(item) {
  const text = formatInvoiceLineDescription(item);
  if (!text) return '';
  if (/[A-Za-z]/.test(text)) {
    return `<span class="desc-ltr">${escapeHtml(text)}</span>`;
  }
  const dated = text.match(/^(\[\d{2}-\d{2}-\d{4}\])\s*(.+)$/);
  if (dated) {
    return `${escapeHtml(dated[1])}<span class="desc-name">${escapeHtml(dated[2])}</span>`;
  }
  return escapeHtml(text);
}

function hasLatinText(text) {
  return /[A-Za-z]/.test(String(text || ''));
}

function formatDailyReportTextHtml(text) {
  const value = String(text ?? '').trim();
  if (!value) return '';
  if (hasLatinText(value)) {
    return `<span class="cell-ltr">${escapeHtml(value)}</span>`;
  }
  return escapeHtml(value);
}

function dailyReportLatinCellClass(text, baseClass = '') {
  const classes = [baseClass, hasLatinText(text) ? 'ltr-cell' : ''].filter(Boolean);
  return classes.join(' ');
}

function dailyReportItemNameCellClass(text) {
  return dailyReportLatinCellClass(text, 'desc');
}

function dailyReportUnitCellClass(text) {
  return dailyReportLatinCellClass(text, 'unit');
}

function enrichInvoice(invoice) {
  const totals = calculateInvoiceTotals({
    ...invoice,
    items: invoice.items || [],
    payments: invoice.payments || [],
    method_payments: invoice.method_payments || [],
    stay_entries: invoice.stay_entries || [],
  });

  const calcItems = (totals.items || []).filter((item) => !item.is_stay_entry);
  const calcByLineId = new Map(
    calcItems.filter((item) => item.daily_entry_line_id).map((item) => [String(item.daily_entry_line_id), item])
  );
  const calcById = new Map(calcItems.filter((item) => item.id).map((item) => [String(item.id), item]));

  const mergedItems = (invoice.items || []).map((item) => {
    const calc =
      item.daily_entry_line_id && calcByLineId.has(String(item.daily_entry_line_id))
        ? calcByLineId.get(String(item.daily_entry_line_id))
        : item.id && calcById.has(String(item.id))
          ? calcById.get(String(item.id))
          : null;
    if (!calc) {
      return { ...item, description: formatInvoiceLineDescription(item) };
    }
    const merged = {
      ...item,
      ...calc,
      quantity: calc.original_quantity ?? item.quantity,
      total: calc.total,
      total_raw: calc.total_raw,
    };
    merged.description = formatInvoiceLineDescription(merged);
    return merged;
  });

  return {
    ...invoice,
    ...totals,
    items: mergedItems,
    stay_entries: totals.stay_entries || invoice.stay_entries || [],
    invoice_type_label: invoice.invoice_type_label || invoice.invoice_type,
  };
}

function formatItemQuantityDisplay(item) {
  const original = Number(item.original_quantity ?? item.quantity) || 0;
  const returned = Number(item.returned_quantity) || 0;
  const net = Number(item.net_quantity) || Math.max(0, original - returned);
  if (returned > 0) {
    return `${formatNumberInt(original)} (−${formatNumberInt(returned)} = ${formatNumberInt(net)})`;
  }
  if (original) return formatNumberInt(original);
  return '';
}

function buildInvoiceHtml(invoice, options = {}) {
  const { baseUrl = '', logoUrl = '', showQr = true, qrDataUrl = '' } = options;
  const inv = enrichInvoice(invoice);
  const displayItems = aggregateCustomerFacingLines(inv.items || []);

  const realItems = displayItems.filter((i) => {
    if (i._customer_display_aggregate) return true;
    return formatInvoiceLineDescription(i) || i.quantity || i.amount;
  });
  const realPayments = (inv.payments || []).filter((p) => p.amount || p.receipt_number || p.receipt_date);

  const padRows = 2;
  const rowCount = Math.max(realItems.length, realPayments.length, 1) + padRows;
  const items = [...realItems];
  const payments = [...realPayments];
  while (items.length < rowCount) items.push({});
  while (payments.length < rowCount) payments.push({});

  return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8">
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Cairo:wght@700;800;900&display=swap');

    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Cairo', 'Arial', sans-serif;
      font-weight: 700;
      font-size: 11px;
      color: #000;
      background: #fff;
      direction: rtl;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .page {
      width: 210mm;
      min-height: 297mm;
      padding: 8mm 10mm;
      margin: 0 auto;
      position: relative;
    }
    .serial-bar {
      text-align: center;
      font-size: 12px;
      font-weight: 900;
      border: 2px solid #000;
      padding: 5px 8px;
      margin-bottom: 6px;
      background: #f0f0f0;
    }
    .header {
      display: flex;
      direction: ltr;
      justify-content: space-between;
      align-items: flex-start;
      margin-bottom: 10px;
      border-bottom: 2px solid #000;
      padding-bottom: 8px;
      gap: 10px;
    }
    .header-text {
      direction: rtl;
      text-align: center;
      flex: 1;
      line-height: 1.65;
      font-weight: 900;
      font-size: 12px;
    }
    .header-text .line { display: block; }
    .logo-area {
      width: 72px;
      height: 72px;
      border: 2px solid #000;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 8px;
      text-align: center;
      font-weight: 900;
      flex-shrink: 0;
      overflow: hidden;
    }
    .logo-area img { width: 100%; height: 100%; object-fit: cover; }
    .header-spacer { width: 72px; flex-shrink: 0; }
    .qr-area {
      width: 92px;
      flex-shrink: 0;
      text-align: center;
      direction: rtl;
      padding: 5px;
      border: 2px solid #000;
      border-radius: 8px;
      background: #fff;
      align-self: flex-start;
    }
    .qr-area img {
      width: 78px;
      height: 78px;
      display: block;
      margin: 0 auto;
      image-rendering: pixelated;
    }
    .qr-label {
      font-size: 8px;
      font-weight: 900;
      margin-top: 4px;
      line-height: 1.3;
      color: #000;
    }
    .meta-table {
      width: 100%;
      border-collapse: collapse;
      border: 2px solid #000;
      margin-bottom: 6px;
    }
    .meta-table th, .meta-table td {
      border: 1px solid #000;
      text-align: center;
      font-weight: 800;
      padding: 4px 3px;
    }
    .meta-table th {
      background: #e8e8e8;
      font-weight: 900;
      font-size: 9px;
    }
    .meta-table .value {
      min-height: 20px;
      font-size: 10px;
      font-weight: 800;
    }
    table.main-table {
      width: 100%;
      border-collapse: collapse;
      border: 2px solid #000;
      table-layout: fixed;
    }
    table.main-table th, table.main-table td {
      border: 1px solid #000;
      padding: 3px 4px;
      text-align: center;
      vertical-align: middle;
      font-weight: 800;
      font-size: 10px;
    }
    table.main-table th {
      background: #d9d9d9;
      font-weight: 900;
    }
    .col-tot { width: 11%; }
    .col-amt { width: 10%; }
    .col-qty { width: 8%; }
    .col-desc { width: 36%; }
    .col-pay-amt { width: 10%; }
    .col-pay-num { width: 12%; }
    .col-pay-date { width: 13%; }
    .desc {
      text-align: right !important;
      padding-right: 8px !important;
      unicode-bidi: plaintext;
      font-family: Arial, 'Cairo', sans-serif;
      white-space: normal;
      word-break: break-word;
    }
    .desc-ltr-cell {
      direction: ltr;
      text-align: right;
      unicode-bidi: isolate;
      white-space: nowrap;
    }
    .desc-ltr {
      white-space: nowrap;
    }
    .desc-name {
      unicode-bidi: isolate;
      direction: ltr;
    }
    .num { direction: ltr; unicode-bidi: embed; white-space: nowrap; }
    .summary-row td { font-weight: 900 !important; background: #f5f5f5; }
    .summary-label { text-align: right !important; padding-right: 8px !important; font-weight: 900; }
    .empty-row td { height: 22px; }
    .num-main { font-weight: 900; }
    .num-raw { font-size: 8px; color: #666; font-weight: 700; display: block; margin-top: 1px; }
    .dual-wrap { display: inline-block; line-height: 1.2; }
    .bottom-tables {
      display: flex;
      direction: ltr;
      gap: 8px;
      margin-top: 8px;
    }
    .bottom-table-wrap { flex: 1; }
    .bottom-table {
      width: 100%;
      border-collapse: collapse;
      border: 2px solid #000;
      direction: rtl;
    }
    .bottom-table th, .bottom-table td {
      border: 1px solid #000;
      padding: 4px 5px;
      text-align: center;
      font-weight: 800;
      font-size: 10px;
    }
    .bottom-table th { background: #d9d9d9; font-weight: 900; }
    .bottom-table .label-cell { text-align: right; font-weight: 900; }
    .signatures {
      display: flex;
      direction: ltr;
      justify-content: space-between;
      margin-top: 20px;
      padding-top: 10px;
    }
    .sig-block {
      direction: rtl;
      text-align: center;
      font-weight: 900;
      font-size: 10px;
      min-width: 22%;
    }
    .sig-line {
      border-top: 1px solid #000;
      margin-top: 28px;
      padding-top: 4px;
    }
    .created-by-footer {
      direction: rtl;
      text-align: center;
      font-weight: 700;
      font-size: 9px;
      color: #444;
      margin-top: 8px;
    }
    .title-row th {
      font-weight: 900;
      font-size: 11px;
      background: #c0c0c0 !important;
    }
    .stay-table {
      width: 100%;
      border-collapse: collapse;
      border: 2px solid #000;
      direction: rtl;
      margin-bottom: 8px;
    }
    .stay-table th, .stay-table td {
      border: 1px solid #000;
      padding: 4px 5px;
      text-align: center;
      font-weight: 800;
      font-size: 10px;
    }
    .stay-table th { background: #e8e8e8; font-weight: 900; }
  </style>
</head>
<body>
  <div class="page">
    <div class="serial-bar">
      رقم الفاتورة: ${escapeHtml(inv.serial_number)}
      ${inv.fiscal_year_label ? `&nbsp;|&nbsp; السنة المالية: ${escapeHtml(inv.fiscal_year_label)}` : ''}
      &nbsp;|&nbsp; تاريخ الإصدار: ${formatDate(inv.issue_date || inv.created_at)}
      &nbsp;|&nbsp; النوع: ${escapeHtml(inv.invoice_type_label)}
    </div>

    <div class="header">
      <div class="logo-area">
        <img src="${logoUrl || baseUrl + '/assets/logo.svg'}" alt="شعار" onerror="this.parentElement.innerHTML='شعار<br>الخدمات<br>الطبية'">
      </div>
      <div class="header-text">
        <span class="line">وزارة الدفاع</span>
        <span class="line">إدارة الخدمات الطبية</span>
        <span class="line">مركز الطب الطبيعي والتأهيل وعلاج الروماتيزم ق.م</span>
        <span class="line">القسم المالي</span>
      </div>
      ${
        showQr && qrDataUrl
          ? `<div class="qr-area"><img src="${qrDataUrl}" alt="QR"><div class="qr-label">امسح للتحميل</div></div>`
          : `<div class="header-spacer"></div>`
      }
    </div>

    <table class="meta-table">
      <tr>
        <th>نوع الفاتورة</th>
        <th>رقم الملف</th>
        <th>إسم المريض</th>
        <th>تاريخ الدخول</th>
        <th>تاريخ الخروج</th>
        <th>عدد أيام الإقامة</th>
      </tr>
      <tr>
        <td class="value">${escapeHtml(inv.invoice_type_label || inv.invoice_type)}</td>
        <td class="value">${escapeHtml(inv.file_number)}</td>
        <td class="value">${escapeHtml(inv.patient_name)}</td>
        <td class="value">${formatDate(inv.admission_date)}</td>
        <td class="value">${formatDate(inv.discharge_date)}</td>
        <td class="value">${inv.stay_days ?? ''}</td>
      </tr>
      ${
        (inv.invoice_type === 'contracted' || inv.invoice_type === 'non_contracted') &&
        inv.contracted_entity_name
          ? `<tr>
        <th>الجهة</th>
        <th>نسبة الخصم</th>
        <th>جواب التعاقد من</th>
        <th>جواب التعاقد إلى</th>
        <th colspan="2">المعاملة المالية للمريض</th>
      </tr>
      <tr>
        <td class="value">${escapeHtml(inv.contracted_entity_name)}</td>
        <td class="value">${inv.invoice_type === 'contracted' ? inv.discount_percent || 0 : 0}%</td>
        <td class="value">${formatDate(inv.letter_from_date)}</td>
        <td class="value">${formatDate(inv.letter_to_date)}</td>
        <td class="value" colspan="2">${escapeHtml(inv.financial_treatment)}</td>
      </tr>`
          : `<tr>
        <th colspan="6">المعاملة المالية للمريض</th>
      </tr>
      <tr>
        <td class="value" colspan="6">${escapeHtml(inv.financial_treatment)}</td>
      </tr>`
      }
      <tr>
        <th colspan="6">تفاصيل الإقامة</th>
      </tr>
      <tr>
        <td class="value" colspan="6">${escapeHtml(formatStaySummary(inv))}</td>
      </tr>
    </table>

    ${buildStayDetailsTable(inv)}

    <table class="main-table">
      <thead>
        <tr class="title-row">
          <th colspan="4">القيمة المالية</th>
          <th>كشف حساب - البيان</th>
          <th colspan="3">المبالغ المسددة</th>
        </tr>
        <tr>
          <th class="col-tot">الإجمالي</th>
          <th class="col-amt">المبلغ</th>
          <th class="col-qty">عدد</th>
          <th class="col-disc">الخصم%</th>
          <th class="col-desc">البيان</th>
          <th class="col-pay-amt">المبلغ</th>
          <th class="col-pay-num">رقم الإيصال</th>
          <th class="col-pay-date">تاريخ الإيصال</th>
        </tr>
      </thead>
      <tbody>
        ${buildCombinedRows(items, payments)}
        ${buildSummaryRows(inv)}
      </tbody>
    </table>

    <div class="bottom-tables">
      <div class="bottom-table-wrap">
        <table class="bottom-table">
          <thead>
            <tr><th colspan="3">بيان المدفوعات طبقاً لأذونات الدفع</th></tr>
            <tr><th>م</th><th>البيان</th><th>المبلغ</th></tr>
          </thead>
          <tbody>
            ${buildPaymentRows(inv)}
            <tr><td colspan="2" class="label-cell" style="font-weight:900">إجمالي المبالغ المحصلة</td><td class="num" style="font-weight:900">${fmtDual(inv.total_collected_raw, inv.total_collected)}</td></tr>
          </tbody>
        </table>
      </div>
      <div class="bottom-table-wrap">
        <table class="bottom-table">
          <thead>
            <tr><th colspan="3">حركة الرصيد النقدي للمريض</th></tr>
            <tr><th>م</th><th>البيان</th><th>المبلغ</th></tr>
          </thead>
          <tbody>
            <tr><td>1</td><td class="label-cell">إجمالي الفاتورة</td><td class="num">${fmtDual(inv.final_total_raw, inv.final_total)}</td></tr>
            <tr><td>2</td><td class="label-cell">إجمالي المبالغ المحصلة</td><td class="num">${fmtDual(inv.total_collected_raw, inv.total_collected)}</td></tr>
            <tr><td>3</td><td class="label-cell">المتبقي</td><td class="num">${fmtDual(inv.remaining_raw, inv.remaining)}</td></tr>
          </tbody>
        </table>
      </div>
    </div>

    <div class="signatures">
      <div class="sig-block"><div class="sig-line">${escapeHtml(inv.captain_name)}</div></div>
      <div class="sig-block"><div class="sig-line">${escapeHtml(inv.manager_name)}</div></div>
      <div class="sig-block"><div class="sig-line">${escapeHtml(inv.auditor_name || 'المراجع المالي')}</div></div>
      <div class="sig-block"><div class="sig-line">${escapeHtml(inv.employee_name || 'الموظف المختص')}</div></div>
    </div>
    ${inv.created_by_name ? `<div class="created-by-footer">أُنشئت بواسطة: ${escapeHtml(inv.created_by_name)}</div>` : ''}
  </div>
</body>
</html>`;
}

function buildPaymentRows(inv) {
  const methodPayments = (inv.method_payments || []).filter((m) => m.accepts_amount !== false);
  if (methodPayments.length) {
    return methodPayments
      .map(
        (m, i) =>
          `<tr><td>${i + 1}</td><td class="label-cell">${escapeHtml(m.name)}</td><td class="num">${fmtPlain(m.amount)}</td></tr>`
      )
      .join('');
  }

  return `
    <tr><td>1</td><td class="label-cell">دفع نقدي (خاص)</td><td class="num">${fmtPlain(inv.cash_private)}</td></tr>
    <tr><td>2</td><td class="label-cell">تحويل بنكي (خاص)</td><td class="num">${fmtPlain(inv.bank_private)}</td></tr>
    <tr><td>3</td><td class="label-cell">دفع نقدي (جهات خارجية)</td><td class="num">${fmtPlain(inv.cash_external)}</td></tr>
    <tr><td>4</td><td class="label-cell">تحويل بنكي (جهات خارجية)</td><td class="num">${fmtPlain(inv.bank_external)}</td></tr>
  `;
}

function buildCombinedRows(items, payments) {
  let html = '';
  for (let i = 0; i < items.length; i++) {
    const item = items[i] || {};
    const pay = payments[i] || {};
    const isAggregate = Boolean(item._customer_display_aggregate);
    const lineDesc = isAggregate
      ? String(item.description || '').trim()
      : formatInvoiceLineDescription(item);
    const hasItem = !!(lineDesc || item.quantity || item.amount || isAggregate);
    const hasPay = !!(pay.amount || pay.receipt_number || pay.receipt_date);
    const rowClass = !hasItem && !hasPay ? 'empty-row' : '';
    const descClass = hasItem && /[A-Za-z]/.test(lineDesc) ? 'desc desc-ltr-cell' : 'desc';
    const dash = '—';

    html += `<tr class="${rowClass}">
      <td class="num">${hasItem ? fmtPlain(item.total) : ''}</td>
      <td class="num">${hasItem ? (isAggregate ? dash : fmtPlain(item.amount)) : ''}</td>
      <td class="num">${hasItem && !isAggregate && item.quantity !== undefined && item.quantity !== '' ? formatItemQuantityDisplay(item) : hasItem && isAggregate ? dash : ''}</td>
      <td class="num disc-pct">${hasItem ? (isAggregate ? dash : `${item.item_discount_percent || 0}%`) : ''}</td>
      <td class="${descClass}">${hasItem ? (isAggregate ? escapeHtml(lineDesc) : formatInvoiceLineDescriptionHtml(item)) : ''}</td>
      <td class="num">${hasPay ? fmtPlain(pay.amount) : ''}</td>
      <td>${escapeHtml(pay.receipt_number || '')}</td>
      <td>${pay.receipt_date ? formatDate(pay.receipt_date) : ''}</td>
    </tr>`;
  }
  return html;
}

function formatStaySummary(inv) {
  const entries = inv.stay_entries || [];
  if (entries.length) {
    return entries
      .map((entry) => {
        const days = entry.days ?? 0;
        const rate = Number(entry.daily_rate) || 0;
        return `${entry.stay_type_name || '-'}: ${formatDate(entry.from_date)} → ${formatDate(entry.to_date)} (${days} يوم × ${fmtPlain(rate)})`;
      })
      .join(' | ');
  }
  return inv.stay_type || '-';
}

function buildStayDetailsTable(inv) {
  const entries = inv.stay_entries || [];
  if (!entries.length) return '';

  const rows = entries
    .map(
      (entry) => `<tr>
      <td>${escapeHtml(entry.stay_type_name || '-')}</td>
      <td>${formatDate(entry.from_date)}</td>
      <td>${formatDate(entry.to_date)}</td>
      <td class="num">${entry.days ?? 0}</td>
      <td class="num">${fmtPlain(entry.daily_rate)}</td>
      <td class="num">${fmtPlain(entry.total)}</td>
    </tr>`
    )
    .join('');

  return `<table class="stay-table">
    <thead>
      <tr><th colspan="6">بيان تكاليف الإقامة</th></tr>
      <tr>
        <th>نوع الإقامة</th>
        <th>من</th>
        <th>إلى</th>
        <th>الأيام</th>
        <th>سعر اليوم</th>
        <th>الإجمالي</th>
      </tr>
    </thead>
    <tbody>
      ${rows}
      <tr>
        <td colspan="5" style="text-align:right;font-weight:900">إجمالي تكاليف الإقامة</td>
        <td class="num">${fmtDual(inv.stay_subtotal_raw, inv.stay_subtotal)}</td>
      </tr>
    </tbody>
  </table>`;
}

function buildSummaryRows(inv) {
  const adminLabel = `مصروفات إدارية ${inv.admin_expenses_percent || 12}%`;
  const hasDiscount = Number(inv.discount_amount) > 0 || Number(inv.discount_percent) > 0;
  const hasStay = Number(inv.stay_subtotal) > 0;

  const rows = [];
  if (hasStay) {
    rows.push(['إجمالي تكلفة الإقامة', inv.stay_subtotal_raw, inv.stay_subtotal, '']);
  }
  rows.push(
    ['إجمالي البنود', inv.items_subtotal_raw, inv.items_subtotal, ''],
    ['دمغة', inv.stamp_duty_raw, inv.stamp_duty, ''],
    ['مهن', inv.professional_fees_raw, inv.professional_fees, ''],
    ['الإجمالي', inv.subtotal_before_admin_raw, inv.subtotal_before_admin, ''],
    [adminLabel, inv.admin_expenses_raw, inv.admin_expenses, ''],
    ['الإجمالي بعد المصروفات الإدارية', inv.total_after_admin_raw, inv.total_after_admin, '']
  );

  if (hasDiscount) {
    rows.push(
      [`خصم جهة متعاقدة ${inv.discount_percent || 0}%`, inv.discount_amount_raw, inv.discount_amount, ''],
      ['صافي بعد الخصم', inv.net_after_discount_raw ?? inv.items_subtotal_after_discount_raw, inv.net_after_discount ?? inv.items_subtotal_after_discount, '']
    );
  }

  rows.push(
    ['الرصيد', inv.balance_raw, inv.balance, ''],
    ['الإجمالي', inv.final_total_raw, inv.final_total, fmtDual(inv.total_collected_raw, inv.total_collected)]
  );

  return rows
    .map(
      ([label, rawVal, roundedVal, payVal]) => `
    <tr class="summary-row">
      <td class="num">${fmtDual(rawVal, roundedVal)}</td>
      <td></td><td></td><td></td>
      <td class="summary-label">${label}</td>
      <td class="num">${payVal}</td>
      <td></td><td></td>
    </tr>`
    )
    .join('');
}

function buildDailyItemsRows(report) {
  const showSupplies = report.show_supplies_columns;
  return (report.rows || [])
    .map((row) => {
      const suppliesCells = showSupplies
        ? `<td class="num">${row.cost_price != null ? fmtPlain(row.cost_price) : '—'}</td>
           <td class="num">${row.markup_percent != null ? fmtPlain(row.markup_percent) : '—'}</td>
           <td class="num">${row.selling_price != null ? fmtPlain(row.selling_price) : '—'}</td>`
        : '';
      return `<tr>
        <td class="${dailyReportLatinCellClass(row.patient_name)}">${formatDailyReportTextHtml(row.patient_name)}</td>
        <td class="${dailyReportLatinCellClass(row.file_number, 'file-cell')}">${formatDailyReportTextHtml(row.file_number)}</td>
        <td class="date-cell">${formatDate(row.entry_date)}</td>
        <td class="${dailyReportItemNameCellClass(row.item_name)} col-item">${formatDailyReportTextHtml(row.item_name)}</td>
        <td class="desc">${escapeHtml(row.category || '')}</td>
        <td class="num col-qty">${row.quantity ?? ''}</td>
        <td class="${dailyReportUnitCellClass(row.unit)} col-unit">${formatDailyReportTextHtml(row.unit)}</td>
        <td class="num col-price">${fmtPlain(row.unit_price)}</td>
        ${suppliesCells}
        <td class="num col-total">${fmtPlain(row.total)}</td>
      </tr>`;
    })
    .join('');
}

function buildDailyItemsFooter(report) {
  const showSupplies = report.show_supplies_columns;
  const totals = report.totals || {};
  const suppliesCells = showSupplies
    ? `<td class="num">${fmtPlain(totals.total_cost)}</td>
       <td></td>
       <td class="num">${fmtPlain(totals.total_selling)}</td>`
    : '';
  return `<tr class="summary-row">
    <td colspan="8" style="text-align:right;font-weight:900">الإجمالي (${totals.row_count || 0} بند)</td>
    ${suppliesCells}
    <td class="num">${fmtPlain(totals.total_amount)}</td>
  </tr>`;
}

function buildDailyItemsHtml(report, options = {}) {
  const { logoUrl = '' } = options;
  const showSupplies = report.show_supplies_columns;
  const suppliesHeaders = showSupplies
    ? '<th>سعر التكلفة</th><th>نسبة الربح %</th><th>سعر البيع</th>'
    : '';
  const periodLabel =
    report.filters?.from_date || report.filters?.to_date
      ? `${formatDate(report.filters.from_date) || '—'} → ${formatDate(report.filters.to_date) || '—'}`
      : 'كل الفترة';

  return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8">
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Cairo:wght@700;800;900&display=swap');
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Cairo', 'Arial', sans-serif;
      font-weight: 700;
      font-size: 11px;
      color: #000;
      background: #fff;
      direction: rtl;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .page {
      width: 210mm;
      min-height: 297mm;
      padding: 8mm 10mm;
      margin: 0 auto;
    }
    .title-bar {
      text-align: center;
      font-size: 14px;
      font-weight: 900;
      border: 2px solid #000;
      padding: 8px;
      margin-bottom: 8px;
      background: #f0f0f0;
    }
    .header {
      display: flex;
      direction: ltr;
      justify-content: space-between;
      align-items: flex-start;
      margin-bottom: 10px;
      border-bottom: 2px solid #000;
      padding-bottom: 8px;
      gap: 10px;
    }
    .header-text {
      direction: rtl;
      text-align: center;
      flex: 1;
      line-height: 1.65;
      font-weight: 900;
      font-size: 12px;
    }
    .logo-area {
      width: 72px;
      height: 72px;
      border: 2px solid #000;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 8px;
      text-align: center;
      font-weight: 900;
      flex-shrink: 0;
      overflow: hidden;
    }
    .logo-area img { width: 100%; height: 100%; object-fit: cover; }
    .header-spacer { width: 72px; flex-shrink: 0; }
    .meta-table {
      width: 100%;
      border-collapse: collapse;
      border: 2px solid #000;
      margin-bottom: 8px;
    }
    .meta-table th, .meta-table td {
      border: 1px solid #000;
      text-align: center;
      font-weight: 800;
      padding: 5px 4px;
    }
    .meta-table th {
      background: #e8e8e8;
      font-weight: 900;
      font-size: 9px;
    }
    table.items-table {
      width: 100%;
      border-collapse: collapse;
      border: 2px solid #000;
      table-layout: fixed;
    }
    table.items-table th, table.items-table td {
      border: 1px solid #000;
      padding: 4px 3px;
      text-align: center;
      vertical-align: middle;
      font-weight: 800;
      font-size: 9px;
    }
    table.items-table th {
      background: #d9d9d9;
      font-weight: 900;
    }
    table.items-table .desc,
    table.items-table .unit {
      text-align: right;
      padding-right: 4px;
      unicode-bidi: plaintext;
      font-family: Arial, 'Cairo', sans-serif;
      white-space: normal;
      word-break: break-word;
    }
    table.items-table .ltr-cell {
      direction: ltr;
      text-align: right;
      unicode-bidi: isolate;
      white-space: nowrap;
    }
    table.items-table .cell-ltr {
      white-space: nowrap;
    }
    table.items-table .num {
      direction: ltr;
      unicode-bidi: embed;
      white-space: nowrap;
      font-variant-numeric: tabular-nums;
    }
    table.items-table .date-cell {
      white-space: nowrap;
    }
    .col-patient { width: 11%; }
    .col-file { width: 10%; }
    .col-date { width: 8%; }
    .col-item { width: 20%; }
    .col-category { width: 8%; }
    .col-qty { width: 6%; }
    .col-unit { width: 7%; }
    .col-price { width: 9%; }
    .col-total { width: 9%; }
    .summary-row td { background: #fff3cd; font-weight: 900; }
  </style>
</head>
<body>
  <div class="page">
    <div class="header">
      <div class="logo-area">${logoUrl ? `<img src="${escapeHtml(logoUrl)}" alt="">` : 'شعار'}</div>
      <div class="header-text">
        <span class="line">مستشفى القوات المسلحة بالإسماعيلية</span>
        <span class="line">الإدارة المالية</span>
      </div>
      <div class="header-spacer"></div>
    </div>
    <div class="title-bar">${escapeHtml(report.title || 'تقرير الأصناف')}</div>
    <table class="meta-table">
      <tr>
        <th>المريض</th>
        <td>${escapeHtml(report.patient?.name || '')}</td>
        <th>رقم الملف</th>
        <td>${escapeHtml(report.patient?.file_number || '')}</td>
        <th>الفترة</th>
        <td>${periodLabel}</td>
      </tr>
    </table>
    <table class="items-table">
      <thead>
        <tr>
          <th class="col-patient">المريض</th>
          <th class="col-file">رقم الملف</th>
          <th class="col-date">التاريخ</th>
          <th class="col-item">اسم الصنف</th>
          <th class="col-category">الفئة</th>
          <th class="col-qty">الكمية</th>
          <th class="col-unit">الوحدة</th>
          <th class="col-price">سعر الوحدة</th>
          ${suppliesHeaders}
          <th>الإجمالي</th>
        </tr>
      </thead>
      <tbody>
        ${buildDailyItemsRows(report) || '<tr><td colspan="20">لا توجد بنود في الفترة المحددة</td></tr>'}
        ${report.rows?.length ? buildDailyItemsFooter(report) : ''}
      </tbody>
    </table>
  </div>
</body>
</html>`;
}

function buildDailyServiceRows(report) {
  return (report.rows || [])
    .map(
      (row) =>
        `<tr>
        <td class="${dailyReportLatinCellClass(row.patient_name)}">${formatDailyReportTextHtml(row.patient_name)}</td>
        <td class="${dailyReportLatinCellClass(row.file_number, 'file-cell')}">${formatDailyReportTextHtml(row.file_number)}</td>
        <td class="date-cell">${formatDate(row.entry_date)}</td>
        <td class="${dailyReportItemNameCellClass(row.service_name)} col-service">${formatDailyReportTextHtml(row.service_name)}</td>
        <td class="num col-qty">${row.quantity ?? ''}</td>
        <td class="num col-price">${fmtPlain(row.unit_price)}</td>
        <td class="num col-total">${fmtPlain(row.total)}</td>
      </tr>`
    )
    .join('');
}

function buildDailyServiceFooter(report) {
  const totals = report.totals || {};
  return `<tr class="summary-row">
    <td colspan="6" style="text-align:right;font-weight:900">الإجمالي (${totals.row_count || 0} بند)</td>
    <td class="num">${fmtPlain(totals.total_amount)}</td>
  </tr>`;
}

function buildDailyServiceReportHtml(report, options = {}) {
  const { logoUrl = '' } = options;
  const periodLabel =
    report.filters?.from_date || report.filters?.to_date
      ? `${formatDate(report.filters.from_date) || '—'} → ${formatDate(report.filters.to_date) || '—'}`
      : 'كل الفترة';
  const priceListRow = report.price_list_name
    ? `<tr><th>لائحة الأسعار</th><td colspan="5">${escapeHtml(report.price_list_name)}</td></tr>`
    : '';

  return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8">
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Cairo:wght@700;800;900&display=swap');
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Cairo', 'Arial', sans-serif;
      font-weight: 700;
      font-size: 11px;
      color: #000;
      background: #fff;
      direction: rtl;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .page { width: 210mm; min-height: 297mm; padding: 8mm 10mm; margin: 0 auto; }
    .title-bar {
      text-align: center; font-size: 14px; font-weight: 900;
      border: 2px solid #000; padding: 8px; margin-bottom: 8px; background: #f0f0f0;
    }
    .header {
      display: flex; direction: ltr; justify-content: space-between; align-items: flex-start;
      margin-bottom: 10px; border-bottom: 2px solid #000; padding-bottom: 8px; gap: 10px;
    }
    .header-text { direction: rtl; text-align: center; flex: 1; line-height: 1.65; font-weight: 900; font-size: 12px; }
    .logo-area {
      width: 72px; height: 72px; border: 2px solid #000; border-radius: 50%;
      display: flex; align-items: center; justify-content: center; font-size: 8px;
      text-align: center; font-weight: 900; flex-shrink: 0; overflow: hidden;
    }
    .logo-area img { width: 100%; height: 100%; object-fit: cover; }
    .header-spacer { width: 72px; flex-shrink: 0; }
    .meta-table { width: 100%; border-collapse: collapse; border: 2px solid #000; margin-bottom: 8px; }
    .meta-table th, .meta-table td {
      border: 1px solid #000; text-align: center; font-weight: 800; padding: 5px 4px;
    }
    .meta-table th { background: #e8e8e8; font-weight: 900; font-size: 9px; }
    table.items-table {
      width: 100%; border-collapse: collapse; border: 2px solid #000; table-layout: fixed;
    }
    table.items-table th, table.items-table td {
      border: 1px solid #000; padding: 4px 3px; text-align: center;
      vertical-align: middle; font-weight: 800; font-size: 9px;
    }
    table.items-table th { background: #d9d9d9; font-weight: 900; }
    table.items-table .desc,
    table.items-table .unit {
      text-align: right;
      padding-right: 4px;
      unicode-bidi: plaintext;
      font-family: Arial, 'Cairo', sans-serif;
      white-space: normal;
      word-break: break-word;
    }
    table.items-table .ltr-cell {
      direction: ltr;
      text-align: right;
      unicode-bidi: isolate;
      white-space: nowrap;
    }
    table.items-table .cell-ltr {
      white-space: nowrap;
    }
    table.items-table .num {
      direction: ltr;
      unicode-bidi: embed;
      white-space: nowrap;
      font-variant-numeric: tabular-nums;
    }
    table.items-table .date-cell {
      white-space: nowrap;
    }
    .col-patient { width: 14%; }
    .col-file { width: 12%; }
    .col-date { width: 10%; }
    .col-service { width: 28%; }
    .col-qty { width: 8%; }
    .col-price { width: 12%; }
    .col-total { width: 12%; }
    .summary-row td { background: #fff3cd; font-weight: 900; }
  </style>
</head>
<body>
  <div class="page">
    <div class="header">
      <div class="logo-area">${logoUrl ? `<img src="${escapeHtml(logoUrl)}" alt="">` : 'شعار'}</div>
      <div class="header-text">
        <span class="line">مستشفى القوات المسلحة بالإسماعيلية</span>
        <span class="line">الإدارة المالية</span>
      </div>
      <div class="header-spacer"></div>
    </div>
    <div class="title-bar">${escapeHtml(report.title || 'تقرير الخدمات')}</div>
    <table class="meta-table">
      <tr>
        <th>المريض</th>
        <td class="${dailyReportLatinCellClass(report.patient?.name)}">${formatDailyReportTextHtml(report.patient?.name)}</td>
        <th>رقم الملف</th>
        <td class="${dailyReportLatinCellClass(report.patient?.file_number, 'file-cell')}">${formatDailyReportTextHtml(report.patient?.file_number)}</td>
        <th>الفترة</th>
        <td>${periodLabel}</td>
      </tr>
      ${priceListRow}
    </table>
    <table class="items-table">
      <thead>
        <tr>
          <th class="col-patient">المريض</th>
          <th class="col-file">رقم الملف</th>
          <th class="col-date">التاريخ</th>
          <th class="col-service">اسم الخدمة</th>
          <th class="col-qty">الكمية</th>
          <th class="col-price">سعر الوحدة</th>
          <th class="col-total">الإجمالي</th>
        </tr>
      </thead>
      <tbody>
        ${buildDailyServiceRows(report) || '<tr><td colspan="7">لا توجد بنود في الفترة المحددة</td></tr>'}
        ${report.rows?.length ? buildDailyServiceFooter(report) : ''}
      </tbody>
    </table>
  </div>
</body>
</html>`;
}

function buildDailyReportHtml(report, options = {}) {
  if (report.report_type === 'service') return buildDailyServiceReportHtml(report, options);
  return buildDailyItemsHtml(report, options);
}

function wrapDailyItemsPrintPage(reportHtml, report, baseUrl, kind) {
  const title = report.title || 'تقرير الأصناف';
  const params = new URLSearchParams({
    kind,
    file_number: report.filters?.file_number || '',
    from_date: report.filters?.from_date || '',
    to_date: report.filters?.to_date || '',
  });
  const pdfUrl = `${baseUrl}/api/daily-charges/daily-items/print?${params}&format=pdf`;
  const bodyContent = reportHtml.match(/<body[^>]*>([\s\S]*)<\/body>/i)?.[1] || reportHtml;
  return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <link href="https://fonts.googleapis.com/css2?family=Cairo:wght@700;800;900&display=swap" rel="stylesheet">
  <style>
    body { font-family: 'Cairo', sans-serif; background: #f0f2f5; margin: 0; padding: 16px; direction: rtl; }
    .toolbar { max-width: 210mm; margin: 0 auto 12px; display: flex; gap: 8px; flex-wrap: wrap; background: #fff; padding: 12px; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,.1); align-items: center; }
    .toolbar a, .toolbar button { font-family: inherit; font-weight: 800; padding: 10px 20px; border: none; border-radius: 6px; cursor: pointer; text-decoration: none; font-size: 14px; }
    .btn-pdf { background: #c0392b; color: #fff; }
    .btn-print { background: #27ae60; color: #fff; }
    .serial { flex: 1; text-align: center; font-weight: 900; font-size: 15px; }
    @media print { .toolbar { display: none; } body { background: #fff; padding: 0; } }
  </style>
</head>
<body>
  <div class="toolbar">
    <span class="serial">${escapeHtml(title)}</span>
    <a class="btn-pdf" href="${pdfUrl}">تحميل PDF</a>
    <button class="btn-print" onclick="window.print()">طباعة</button>
  </div>
  ${bodyContent}
</body>
</html>`;
}

module.exports = {
  buildInvoiceHtml,
  buildDailyItemsHtml,
  buildDailyServiceReportHtml,
  buildDailyReportHtml,
  wrapDailyItemsPrintPage,
  formatNumber,
  formatDate,
  enrichInvoice,
};
