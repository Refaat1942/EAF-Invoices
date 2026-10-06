/**
 * Settings «سجل الحركات اليومية»: read-only browser of daily entries for any patient and
 * any date range, without opening the patient on the daily screen.
 */
const DAILY_LOG_API = '/api/daily-charges/entries';
// Without a patient filter a wide range could return every entry in the system.
const DAILY_LOG_MAX_ENTRIES = 2000;

let dailyLogRows = [];
let dailyLogBound = false;

function dailyLogEscape(text) {
  if (typeof escapeHtml === 'function') return escapeHtml(text);
  return String(text ?? '');
}

function dailyLogFmt(value) {
  const n = Number(value) || 0;
  if (typeof window.fmt === 'function') return window.fmt(n);
  return n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

function dailyLogDate(value) {
  if (!value) return '';
  if (typeof fmtDate === 'function') return fmtDate(value);
  return String(value).slice(0, 10);
}

function dailyLogLocalDate(offsetDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function dailyLogInvoiceBadge(entry) {
  if (!entry.invoice_id) return '<span class="text-muted">—</span>';
  const badges = typeof STATUS_BADGES === 'object' ? STATUS_BADGES : {};
  const badge = badges[entry.invoice_status] || { text: entry.invoice_status || '', class: 'bg-light text-dark' };
  const serial = entry.invoice_serial_number || `#${entry.invoice_id}`;
  return `<span class="small">${dailyLogEscape(serial)}</span> <span class="badge ${badge.class}">${dailyLogEscape(badge.text)}</span>`;
}

function dailyLogItemName(line) {
  return (
    line.catalog_item_name ||
    line.service_name ||
    line.description ||
    line.extra_text ||
    line.section_name ||
    line.section_code ||
    ''
  );
}

function dailyLogFlattenLines(entries) {
  const rows = [];
  for (const entry of entries) {
    for (const line of entry.lines || []) {
      const amount = Number(line.amount) || 0;
      if (amount <= 0 && !(Number(line.quantity) > 0 && line.catalog_item_id)) continue;
      rows.push({ entry, line, amount });
    }
  }
  return rows;
}

function dailyLogSelectedSection() {
  return document.getElementById('daily-log-section')?.value || '';
}

function dailyLogNormalizeText(text) {
  return String(text || '')
    .trim()
    .toLowerCase()
    .replace(/[أإآ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/\s+/g, ' ');
}

function dailyLogItemQuery() {
  return dailyLogNormalizeText(document.getElementById('daily-log-item')?.value);
}

// Section + item filters, shared by the table, the totals and the Excel export.
function dailyLogFilteredRows() {
  const section = dailyLogSelectedSection();
  const item = dailyLogItemQuery();
  return dailyLogFlattenLines(dailyLogRows).filter(
    (row) =>
      (!section || row.line.section_code === section) &&
      (!item || dailyLogNormalizeText(dailyLogItemName(row.line)).includes(item))
  );
}

function populateDailyLogItems() {
  const list = document.getElementById('daily-log-item-options');
  if (!list) return;
  const section = dailyLogSelectedSection();
  const names = new Set();
  for (const { line } of dailyLogFlattenLines(dailyLogRows)) {
    if (section && line.section_code !== section) continue;
    const name = String(dailyLogItemName(line)).trim();
    if (name) names.add(name);
  }
  list.innerHTML = [...names]
    .sort((a, b) => a.localeCompare(b, 'ar'))
    .map((name) => `<option value="${dailyLogEscape(name)}"></option>`)
    .join('');
}

function populateDailyLogSections(rows) {
  const select = document.getElementById('daily-log-section');
  if (!select) return;
  const current = select.value;
  const names = new Map();
  for (const { line } of rows) {
    if (!names.has(line.section_code)) names.set(line.section_code, line.section_name || line.section_code);
  }
  select.innerHTML =
    '<option value="">كل الأقسام</option>' +
    [...names.entries()]
      .sort((a, b) => String(a[1]).localeCompare(String(b[1]), 'ar'))
      .map(([code, name]) => `<option value="${dailyLogEscape(code)}">${dailyLogEscape(name)}</option>`)
      .join('');
  if (current && names.has(current)) select.value = current;
}

function renderDailyLogTable() {
  const body = document.getElementById('daily-log-body');
  const summary = document.getElementById('daily-log-summary');
  if (!body) return;

  const rows = dailyLogFilteredRows();

  if (!rows.length) {
    body.innerHTML = '<tr><td colspan="10" class="text-center text-muted py-3">لا توجد حركات في هذه الفترة</td></tr>';
    if (summary) summary.textContent = '';
    return;
  }

  let html = '';
  let lastDate = '';
  let dayTotal = 0;
  let grandTotal = 0;
  const closeDay = () => {
    if (!lastDate) return;
    html += `<tr class="table-light fw-bold"><td colspan="7" class="text-start">إجمالي يوم <bdi dir="ltr">${dailyLogEscape(lastDate)}</bdi></td>
      <td class="text-nowrap">${dailyLogFmt(dayTotal)}</td><td colspan="2"></td></tr>`;
  };

  for (const { entry, line, amount } of rows) {
    const date = dailyLogDate(entry.entry_date);
    if (date !== lastDate) {
      closeDay();
      lastDate = date;
      dayTotal = 0;
    }
    dayTotal += amount;
    grandTotal += amount;
    const extraDate = line.extra_date ? dailyLogDate(line.extra_date) : '';
    html += `<tr>
      <td class="text-nowrap">${dailyLogEscape(date)}${
        extraDate && extraDate !== date ? `<div class="small text-muted">${dailyLogEscape(extraDate)}</div>` : ''
      }</td>
      <td class="text-nowrap">${dailyLogEscape(entry.file_number)}</td>
      <td>${dailyLogEscape(entry.patient_name)}</td>
      <td class="small">${dailyLogEscape(line.section_name || line.section_code)}</td>
      <td>${dailyLogEscape(dailyLogItemName(line))}${
        line.catalog_unit ? ` <span class="small text-muted">(${dailyLogEscape(line.catalog_unit)})</span>` : ''
      }</td>
      <td class="text-nowrap">${dailyLogFmt(line.quantity || 1)}</td>
      <td class="text-nowrap">${dailyLogFmt(line.unit_price || amount)}</td>
      <td class="text-nowrap fw-bold">${dailyLogFmt(amount)}</td>
      <td class="small">${dailyLogEscape(entry.doctor_name_snapshot || '')}</td>
      <td class="text-nowrap">${dailyLogInvoiceBadge(entry)}</td>
    </tr>`;
  }
  closeDay();
  html += `<tr class="table-secondary fw-black"><td colspan="7" class="text-start">الإجمالي</td>
    <td class="text-nowrap">${dailyLogFmt(grandTotal)}</td><td colspan="2"></td></tr>`;
  body.innerHTML = html;

  if (summary) {
    const patients = new Set(rows.map((row) => row.entry.patient_id)).size;
    const days = new Set(rows.map((row) => dailyLogDate(row.entry.entry_date))).size;
    summary.textContent = `${rows.length} بند — ${patients} مريض — ${days} يوم — الإجمالي ${dailyLogFmt(grandTotal)}`;
  }
}

async function loadDailyLogEntries() {
  const body = document.getElementById('daily-log-body');
  const warning = document.getElementById('daily-log-warning');
  const from = document.getElementById('daily-log-from')?.value || '';
  const to = document.getElementById('daily-log-to')?.value || '';
  const search = document.getElementById('daily-log-search')?.value.trim() || '';
  if (from && to && from > to) {
    if (typeof showToast === 'function') showToast('تاريخ «من» بعد تاريخ «إلى»', 'warning');
    return;
  }

  if (body) body.innerHTML = '<tr><td colspan="10" class="text-center text-muted py-3">جاري التحميل…</td></tr>';
  if (warning) warning.classList.add('d-none');

  const params = new URLSearchParams({ include_lines: '1', limit: String(DAILY_LOG_MAX_ENTRIES) });
  if (from) params.set('from_date', from);
  if (to) params.set('to_date', to);
  if (search) params.set('search', search);

  try {
    const res = await apiFetch(`${DAILY_LOG_API}?${params}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'تعذر تحميل الحركات');
    dailyLogRows = Array.isArray(data) ? data : [];
    if (warning && dailyLogRows.length >= DAILY_LOG_MAX_ENTRIES) {
      warning.textContent = `تم عرض أول ${DAILY_LOG_MAX_ENTRIES} حركة فقط — ضيّق الفترة أو ابحث برقم الملف`;
      warning.classList.remove('d-none');
    }
    populateDailyLogSections(dailyLogFlattenLines(dailyLogRows));
    populateDailyLogItems();
    renderDailyLogTable();
  } catch (err) {
    dailyLogRows = [];
    const msg = typeof sanitizeApiErrorMessage === 'function' ? sanitizeApiErrorMessage(err.message) : err.message;
    if (body) body.innerHTML = `<tr><td colspan="10" class="text-center text-danger py-3">${dailyLogEscape(msg)}</td></tr>`;
  }
}

function exportDailyLogCsv() {
  const rows = dailyLogFilteredRows();
  if (!rows.length) {
    if (typeof showToast === 'function') showToast('لا توجد بيانات للتصدير', 'warning');
    return;
  }
  const cell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const header = ['التاريخ', 'رقم الملف', 'المريض', 'القسم', 'البند', 'الكمية', 'السعر', 'الإجمالي', 'الطبيب', 'الفاتورة'];
  const lines = rows.map(({ entry, line, amount }) =>
    [
      dailyLogDate(entry.entry_date),
      entry.file_number,
      entry.patient_name,
      line.section_name || line.section_code,
      dailyLogItemName(line),
      Number(line.quantity) || 1,
      Number(line.unit_price) || amount,
      amount,
      entry.doctor_name_snapshot || '',
      entry.invoice_serial_number || '',
    ]
      .map(cell)
      .join(',')
  );
  const csv = '﻿' + [header.map(cell).join(','), ...lines].join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const link = document.createElement('a');
  const from = document.getElementById('daily-log-from')?.value || '';
  const to = document.getElementById('daily-log-to')?.value || '';
  link.href = URL.createObjectURL(blob);
  link.download = `daily-entries_${from || 'start'}_${to || 'end'}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

function bindDailyLogSection() {
  if (dailyLogBound) return;
  dailyLogBound = true;
  document.getElementById('daily-log-load-btn')?.addEventListener('click', loadDailyLogEntries);
  document.getElementById('daily-log-export-btn')?.addEventListener('click', exportDailyLogCsv);
  document.getElementById('daily-log-section')?.addEventListener('change', () => {
    populateDailyLogItems();
    renderDailyLogTable();
  });
  let itemTimer = null;
  document.getElementById('daily-log-item')?.addEventListener('input', () => {
    clearTimeout(itemTimer);
    itemTimer = setTimeout(renderDailyLogTable, 200);
  });
  document.getElementById('daily-log-search')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      loadDailyLogEntries();
    }
  });
}

// Entries are dated by the server's business day (Cairo), which can differ from this
// computer's date around midnight — default the range from it.
async function dailyLogBusinessDate() {
  try {
    const res = await apiFetch('/api/daily-charges/business-date');
    const data = await res.json();
    if (res.ok && /^\d{4}-\d{2}-\d{2}$/.test(data?.business_date || '')) return data.business_date;
  } catch {
    /* fall back to the local date */
  }
  return dailyLogLocalDate(0);
}

function dailyLogShiftDate(dateText, days) {
  const [y, m, d] = dateText.split('-').map(Number);
  const date = new Date(y, m - 1, d + days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

async function loadDailyLogSection() {
  bindDailyLogSection();
  const from = document.getElementById('daily-log-from');
  const to = document.getElementById('daily-log-to');
  if ((from && !from.value) || (to && !to.value)) {
    const today = await dailyLogBusinessDate();
    if (from && !from.value) from.value = dailyLogShiftDate(today, -6);
    if (to && !to.value) to.value = today;
  }
  await loadDailyLogEntries();
}

window.loadDailyLogSection = loadDailyLogSection;
