function formatNumber(n) {
  const num = Number(n) || 0;
  return num.toLocaleString('ar-EG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatDate(d) {
  if (!d) return '';
  try {
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

function buildInvoiceHtml(invoice, options = {}) {
  const { baseUrl = '', showQr = true, qrDataUrl = '' } = options;

  const minRows = 12;
  const items = [...(invoice.items || [])];
  while (items.length < minRows) {
    items.push({ description: '', quantity: '', amount: '', total: '' });
  }

  const minPaymentRows = 8;
  const payments = [...(invoice.payments || [])];
  while (payments.length < minPaymentRows) {
    payments.push({ receipt_date: '', receipt_number: '', amount: '' });
  }

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
      font-size: 14px;
      font-weight: 900;
      border: 2px solid #000;
      padding: 4px 8px;
      margin-bottom: 6px;
      background: #f0f0f0;
      letter-spacing: 1px;
    }
    .header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      margin-bottom: 8px;
      border-bottom: 2px solid #000;
      padding-bottom: 6px;
    }
    .header-text {
      text-align: center;
      flex: 1;
      line-height: 1.6;
      font-weight: 900;
      font-size: 12px;
    }
    .header-text .line { display: block; }
    .logo-area {
      width: 70px;
      height: 70px;
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
    .meta-row {
      display: grid;
      grid-template-columns: repeat(6, 1fr);
      border: 2px solid #000;
      margin-bottom: 6px;
    }
    .meta-cell {
      border-left: 1px solid #000;
      text-align: center;
      padding: 3px 2px;
    }
    .meta-cell:last-child { border-left: none; }
    .meta-label {
      font-weight: 900;
      font-size: 9px;
      border-bottom: 1px solid #000;
      padding: 2px;
      background: #e8e8e8;
    }
    .meta-value {
      min-height: 18px;
      padding: 3px 2px;
      font-weight: 800;
      font-size: 10px;
    }
    .type-badge {
      text-align: center;
      font-weight: 900;
      font-size: 11px;
      margin-bottom: 4px;
      padding: 2px;
      border: 1px solid #000;
      display: inline-block;
      width: 100%;
    }
    table.main-table {
      width: 100%;
      border-collapse: collapse;
      border: 2px solid #000;
      table-layout: fixed;
    }
    table.main-table th, table.main-table td {
      border: 1px solid #000;
      padding: 2px 3px;
      text-align: center;
      vertical-align: middle;
      font-weight: 800;
    }
    table.main-table th {
      background: #d9d9d9;
      font-weight: 900;
      font-size: 10px;
    }
    .col-pay-date { width: 11%; }
    .col-pay-num { width: 10%; }
    .col-pay-amt { width: 10%; }
    .col-desc { width: 38%; }
    .col-qty { width: 8%; }
    .col-amt { width: 11%; }
    .col-tot { width: 12%; }
    .desc { text-align: right !important; padding-right: 6px !important; }
    .num { direction: ltr; unicode-bidi: embed; }
    .summary-row td {
      font-weight: 900 !important;
      background: #f5f5f5;
    }
    .summary-label { text-align: right !important; padding-right: 8px !important; font-weight: 900; }
    .bottom-tables {
      display: flex;
      gap: 8px;
      margin-top: 8px;
    }
    .bottom-table-wrap { flex: 1; }
    .bottom-table {
      width: 100%;
      border-collapse: collapse;
      border: 2px solid #000;
    }
    .bottom-table th, .bottom-table td {
      border: 1px solid #000;
      padding: 3px 5px;
      text-align: center;
      font-weight: 800;
    }
    .bottom-table th {
      background: #d9d9d9;
      font-weight: 900;
    }
    .bottom-table .label-cell { text-align: right; font-weight: 900; }
    .signatures {
      display: flex;
      justify-content: space-between;
      margin-top: 20px;
      padding-top: 10px;
    }
    .sig-block {
      text-align: center;
      font-weight: 900;
      font-size: 10px;
      min-width: 22%;
    }
    .sig-line {
      border-top: 1px solid #000;
      margin-top: 30px;
      padding-top: 4px;
    }
    .qr-section {
      position: absolute;
      top: 8mm;
      left: 10mm;
      text-align: center;
    }
    .qr-section img { width: 70px; height: 70px; }
    .qr-label { font-size: 7px; font-weight: 900; margin-top: 2px; }
    .title-row td {
      font-weight: 900;
      font-size: 12px;
      background: #c0c0c0 !important;
    }
  </style>
</head>
<body>
  <div class="page">
    ${showQr && qrDataUrl ? `<div class="qr-section"><img src="${qrDataUrl}" alt="QR"><div class="qr-label">امسح للتحميل</div></div>` : ''}

    <div class="serial-bar">رقم الفاتورة: ${escapeHtml(invoice.serial_number)} | النوع: ${escapeHtml(invoice.invoice_type_label)}</div>

    <div class="header">
      <div class="logo-area">
        <img src="${baseUrl}/assets/logo.svg" alt="شعار" onerror="this.parentElement.innerHTML='شعار<br>الخدمات<br>الطبية'">
      </div>
      <div class="header-text">
        <span class="line">وزارة الدفاع</span>
        <span class="line">إدارة الخدمات الطبية</span>
        <span class="line">مركز الطب الطبيعي والتأهيل وعلاج الروماتيزم ق.م</span>
        <span class="line">القسم المالي</span>
      </div>
      <div style="width:70px"></div>
    </div>

    <div class="meta-row">
      <div class="meta-cell"><div class="meta-label">إسم المريض</div><div class="meta-value">${escapeHtml(invoice.patient_name)}</div></div>
      <div class="meta-cell"><div class="meta-label">تاريخ الدخول</div><div class="meta-value">${formatDate(invoice.admission_date)}</div></div>
      <div class="meta-cell"><div class="meta-label">تاريخ الخروج</div><div class="meta-value">${formatDate(invoice.discharge_date)}</div></div>
      <div class="meta-cell"><div class="meta-label">عدد أيام الإقامة</div><div class="meta-value">${invoice.stay_days || ''}</div></div>
      <div class="meta-cell"><div class="meta-label">المعاملة المالية للمريض</div><div class="meta-value">${escapeHtml(invoice.financial_treatment)}</div></div>
      <div class="meta-cell"><div class="meta-label">نوع الإقامة</div><div class="meta-value">${escapeHtml(invoice.stay_type)}</div></div>
    </div>

    <table class="main-table">
      <thead>
        <tr class="title-row">
          <th colspan="3">المبالغ المسددة</th>
          <th>كشف حساب</th>
          <th colspan="3">القيمة المالية</th>
        </tr>
        <tr>
          <th class="col-pay-date">تاريخ الإيصال</th>
          <th class="col-pay-num">رقم الإيصال</th>
          <th class="col-pay-amt">المبلغ</th>
          <th class="col-desc">البيان</th>
          <th class="col-qty">عدد</th>
          <th class="col-amt">المبلغ</th>
          <th class="col-tot">الإجمالي</th>
        </tr>
      </thead>
      <tbody>
        ${buildCombinedRows(items, payments)}
        ${buildSummaryRows(invoice)}
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
            <tr><td>1</td><td class="label-cell">دفع نقدي (خاص)</td><td class="num">${formatNumber(invoice.cash_private)}</td></tr>
            <tr><td>2</td><td class="label-cell">تحويل بنكي (خاص)</td><td class="num">${formatNumber(invoice.bank_private)}</td></tr>
            <tr><td>3</td><td class="label-cell">دفع نقدي (جهات خارجية)</td><td class="num">${formatNumber(invoice.cash_external)}</td></tr>
            <tr><td>4</td><td class="label-cell">تحويل بنكي (جهات خارجية)</td><td class="num">${formatNumber(invoice.bank_external)}</td></tr>
            <tr><td colspan="2" class="label-cell" style="font-weight:900">إجمالي المبالغ المحصلة</td><td class="num" style="font-weight:900">${formatNumber(invoice.total_collected)}</td></tr>
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
            <tr><td>1</td><td class="label-cell">إجمالي الفاتورة</td><td class="num">${formatNumber(invoice.final_total)}</td></tr>
            <tr><td>2</td><td class="label-cell">إجمالي المبالغ المحصلة</td><td class="num">${formatNumber(invoice.total_collected)}</td></tr>
            <tr><td>3</td><td class="label-cell">المتبقي</td><td class="num">${formatNumber(invoice.remaining)}</td></tr>
          </tbody>
        </table>
      </div>
    </div>

    <div class="signatures">
      <div class="sig-block"><div class="sig-line">${escapeHtml(invoice.employee_name || 'الموظف المختص')}</div></div>
      <div class="sig-block"><div class="sig-line">${escapeHtml(invoice.auditor_name || 'المراجع المالي')}</div></div>
      <div class="sig-block"><div class="sig-line">${escapeHtml(invoice.captain_name)}</div></div>
      <div class="sig-block"><div class="sig-line">${escapeHtml(invoice.manager_name)}</div></div>
    </div>
  </div>
</body>
</html>`;
}

function buildCombinedRows(items, payments) {
  const maxLen = Math.max(items.length, payments.length, 10);
  let html = '';
  for (let i = 0; i < maxLen; i++) {
    const item = items[i] || {};
    const pay = payments[i] || {};
    html += `<tr>
      <td>${pay.receipt_date ? formatDate(pay.receipt_date) : ''}</td>
      <td>${escapeHtml(pay.receipt_number)}</td>
      <td class="num">${pay.amount ? formatNumber(pay.amount) : ''}</td>
      <td class="desc">${escapeHtml(item.description)}</td>
      <td class="num">${item.quantity !== undefined && item.quantity !== '' ? item.quantity : ''}</td>
      <td class="num">${item.description && item.amount !== undefined ? formatNumber(item.amount) : ''}</td>
      <td class="num">${item.description && item.total !== undefined ? formatNumber(item.total) : ''}</td>
    </tr>`;
  }
  return html;
}

function buildSummaryRows(invoice) {
  const adminLabel = `مصروفات إدارية ${invoice.admin_expenses_percent || 12}%`;
  return `
    <tr class="summary-row">
      <td colspan="3"></td>
      <td class="summary-label">دمغة</td>
      <td></td><td></td>
      <td class="num">${formatNumber(invoice.stamp_duty)}</td>
    </tr>
    <tr class="summary-row">
      <td colspan="3"></td>
      <td class="summary-label">مهن</td>
      <td></td><td></td>
      <td class="num">${formatNumber(invoice.professional_fees)}</td>
    </tr>
    <tr class="summary-row">
      <td colspan="3"></td>
      <td class="summary-label">الإجمالي</td>
      <td></td><td></td>
      <td class="num">${formatNumber((invoice.items_subtotal || 0) + (invoice.stamp_duty || 0) + (invoice.professional_fees || 0))}</td>
    </tr>
    <tr class="summary-row">
      <td colspan="3"></td>
      <td class="summary-label">${adminLabel}</td>
      <td></td><td></td>
      <td class="num">${formatNumber(invoice.admin_expenses)}</td>
    </tr>
    <tr class="summary-row">
      <td colspan="3"></td>
      <td class="summary-label">الإجمالي بعد المصروفات الإدارية</td>
      <td></td><td></td>
      <td class="num">${formatNumber(invoice.total_after_admin)}</td>
    </tr>
    <tr class="summary-row">
      <td colspan="3"></td>
      <td class="summary-label">الرصيد</td>
      <td></td><td></td>
      <td class="num">${formatNumber(invoice.balance)}</td>
    </tr>
    <tr class="summary-row">
      <td colspan="3"></td>
      <td class="summary-label">الإجمالي</td>
      <td></td><td></td>
      <td class="num">${formatNumber(invoice.final_total)}</td>
    </tr>`;
}

module.exports = { buildInvoiceHtml, formatNumber, formatDate };
