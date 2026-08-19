const { formatDual, round2, calculateInvoiceTotals } = require('./calculations');

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
    return `<span class="num-main">${formatNumberInt(rd)}</span>`;
  }
  return `<span class="dual-wrap"><span class="num-main">${formatNumberInt(rd)}</span><span class="num-raw">(${formatNumber(r)})</span></span>`;
}

function fmtPlain(n) {
  const num = Number(n) || 0;
  if (Math.abs(num - Math.round(num)) < 0.001) return formatNumberInt(num);
  return formatNumber(num);
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

function enrichInvoice(invoice) {
  const totals = calculateInvoiceTotals({
    ...invoice,
    items: invoice.items || [],
    payments: invoice.payments || [],
  });

  return {
    ...invoice,
    ...totals,
    invoice_type_label: invoice.invoice_type_label || invoice.invoice_type,
  };
}

function buildInvoiceHtml(invoice, options = {}) {
  const { baseUrl = '', logoUrl = '', showQr = true, qrDataUrl = '' } = options;
  const inv = enrichInvoice(invoice);

  const realItems = (inv.items || []).filter((i) => i.description || i.quantity || i.amount);
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
    .desc { text-align: right !important; padding-right: 8px !important; }
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
    .title-row th {
      font-weight: 900;
      font-size: 11px;
      background: #c0c0c0 !important;
    }
  </style>
</head>
<body>
  <div class="page">
    <div class="serial-bar">
      رقم الفاتورة: ${escapeHtml(inv.serial_number)}
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
        <th>رقم الملف</th>
        <th>إسم المريض</th>
        <th>تاريخ الدخول</th>
        <th>تاريخ الخروج</th>
        <th>عدد أيام الإقامة</th>
        <th>المعاملة المالية للمريض</th>
      </tr>
      <tr>
        <td class="value">${escapeHtml(inv.file_number)}</td>
        <td class="value">${escapeHtml(inv.patient_name)}</td>
        <td class="value">${formatDate(inv.admission_date)}</td>
        <td class="value">${formatDate(inv.discharge_date)}</td>
        <td class="value">${inv.stay_days ?? ''}</td>
        <td class="value">${escapeHtml(inv.financial_treatment)}</td>
      </tr>
      <tr>
        <th colspan="6">أنواع الإقامة</th>
      </tr>
      <tr>
        <td class="value" colspan="6">${escapeHtml(inv.stay_type)}</td>
      </tr>
    </table>

    <table class="main-table">
      <thead>
        <tr class="title-row">
          <th colspan="3">القيمة المالية</th>
          <th>كشف حساب - البيان</th>
          <th colspan="3">المبالغ المسددة</th>
        </tr>
        <tr>
          <th class="col-tot">الإجمالي</th>
          <th class="col-amt">المبلغ</th>
          <th class="col-qty">عدد</th>
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
            <tr><td>1</td><td class="label-cell">دفع نقدي (خاص)</td><td class="num">${fmtPlain(inv.cash_private)}</td></tr>
            <tr><td>2</td><td class="label-cell">تحويل بنكي (خاص)</td><td class="num">${fmtPlain(inv.bank_private)}</td></tr>
            <tr><td>3</td><td class="label-cell">دفع نقدي (جهات خارجية)</td><td class="num">${fmtPlain(inv.cash_external)}</td></tr>
            <tr><td>4</td><td class="label-cell">تحويل بنكي (جهات خارجية)</td><td class="num">${fmtPlain(inv.bank_external)}</td></tr>
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
  </div>
</body>
</html>`;
}

function buildCombinedRows(items, payments) {
  let html = '';
  for (let i = 0; i < items.length; i++) {
    const item = items[i] || {};
    const pay = payments[i] || {};
    const hasItem = !!(item.description || item.quantity || item.amount);
    const hasPay = !!(pay.amount || pay.receipt_number || pay.receipt_date);
    const rowClass = !hasItem && !hasPay ? 'empty-row' : '';

    html += `<tr class="${rowClass}">
      <td class="num">${hasItem ? fmtPlain(item.total) : ''}</td>
      <td class="num">${hasItem ? fmtPlain(item.amount) : ''}</td>
      <td class="num">${hasItem && item.quantity !== undefined && item.quantity !== '' ? item.quantity : ''}</td>
      <td class="desc">${escapeHtml(item.description || '')}</td>
      <td class="num">${hasPay ? fmtPlain(pay.amount) : ''}</td>
      <td>${escapeHtml(pay.receipt_number || '')}</td>
      <td>${pay.receipt_date ? formatDate(pay.receipt_date) : ''}</td>
    </tr>`;
  }
  return html;
}

function buildSummaryRows(inv) {
  const adminLabel = `مصروفات إدارية ${inv.admin_expenses_percent || 12}%`;

  const rows = [
    ['دمغة', inv.stamp_duty_raw, inv.stamp_duty, ''],
    ['مهن', inv.professional_fees_raw, inv.professional_fees, ''],
    ['الإجمالي', inv.subtotal_before_admin_raw, inv.subtotal_before_admin, ''],
    [adminLabel, inv.admin_expenses_raw, inv.admin_expenses, ''],
    ['الإجمالي بعد المصروفات الإدارية', inv.total_after_admin_raw, inv.total_after_admin, ''],
    ['الرصيد', inv.balance_raw, inv.balance, ''],
    ['الإجمالي', inv.final_total_raw, inv.final_total, fmtDual(inv.total_collected_raw, inv.total_collected)],
  ];

  return rows
    .map(
      ([label, rawVal, roundedVal, payVal]) => `
    <tr class="summary-row">
      <td class="num">${fmtDual(rawVal, roundedVal)}</td>
      <td></td><td></td>
      <td class="summary-label">${label}</td>
      <td class="num">${payVal}</td>
      <td></td><td></td>
    </tr>`
    )
    .join('');
}

module.exports = { buildInvoiceHtml, formatNumber, formatDate, enrichInvoice };
