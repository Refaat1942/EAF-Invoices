const {
  Document,
  Packer,
  Paragraph,
  Table,
  TableRow,
  TableCell,
  TextRun,
  WidthType,
  AlignmentType,
  VerticalAlign,
} = require('docx');
const { CENTER_NAME } = require('../config/branding');

const { formatAmountAr } = require('./amountFormat');

function formatNumber(n) {
  return formatAmountAr(n, 2);
}

function formatDate(d) {
  if (!d) return '-';
  const date = new Date(d);
  if (Number.isNaN(date.getTime())) return String(d);
  return date.toLocaleDateString('ar-EG');
}

function cell(text, opts = {}) {
  return new TableCell({
    width: opts.width ? { size: opts.width, type: WidthType.PERCENTAGE } : undefined,
    verticalAlign: VerticalAlign.CENTER,
    shading: opts.shading ? { fill: opts.shading } : undefined,
    columnSpan: opts.colSpan,
    children: [
      new Paragraph({
        alignment: opts.align || AlignmentType.CENTER,
        bidirectional: true,
        children: [
          new TextRun({
            text: String(text ?? ''),
            bold: opts.bold !== false,
            size: opts.size || 20,
            rightToLeft: true,
          }),
        ],
      }),
    ],
  });
}

function buildSummaryRows(invoice) {
  const adminLabel = `مصروفات إدارية ${invoice.admin_expenses_percent || 12}%`;
  const hasDiscount = Number(invoice.discount_amount) > 0 || Number(invoice.discount_percent) > 0;
  const hasStay = Number(invoice.stay_subtotal) > 0;

  const entries = [];
  if (hasStay) entries.push(['إجمالي تكلفة الإقامة', invoice.stay_subtotal]);
  entries.push(
    ['إجمالي البنود', invoice.items_subtotal],
    ['دمغة', invoice.stamp_duty],
    ['مهن', invoice.professional_fees],
    ['الإجمالي', invoice.subtotal_before_admin],
    [adminLabel, invoice.admin_expenses],
    ['الإجمالي بعد المصروفات الإدارية', invoice.total_after_admin]
  );

  if (hasDiscount) {
    entries.push(
      [`خصم جهة متعاقدة ${invoice.discount_percent || 0}%`, invoice.discount_amount],
      ['صافي بعد الخصم', invoice.net_after_discount ?? invoice.items_subtotal_after_discount]
    );
  }

  entries.push(['الرصيد', invoice.balance], ['الإجمالي', invoice.final_total]);

  return entries.map(
    ([label, value]) =>
      new TableRow({
        children: [
          cell('', { colSpan: 3, bold: false }),
          cell(label, { align: AlignmentType.RIGHT, shading: 'F5F5F5' }),
          cell('', { bold: false }),
          cell('', { bold: false }),
          cell(formatNumber(value), { shading: 'F5F5F5' }),
        ],
      })
  );
}

function buildStayDetailsTable(invoice) {
  const entries = invoice.stay_entries || [];
  if (!entries.length) return null;

  const rows = [
    new TableRow({
      children: [cell('بيان تكاليف الإقامة', { colSpan: 6, shading: 'D9D9D9', size: 22 })],
    }),
    new TableRow({
      children: [
        cell('نوع الإقامة', { shading: 'E8E8E8' }),
        cell('من', { shading: 'E8E8E8' }),
        cell('إلى', { shading: 'E8E8E8' }),
        cell('الأيام', { shading: 'E8E8E8' }),
        cell('سعر اليوم', { shading: 'E8E8E8' }),
        cell('الإجمالي', { shading: 'E8E8E8' }),
      ],
    }),
    ...entries.map(
      (entry) =>
        new TableRow({
          children: [
            cell(entry.stay_type_name || '-', { align: AlignmentType.RIGHT }),
            cell(formatDate(entry.from_date)),
            cell(formatDate(entry.to_date)),
            cell(entry.days ?? 0),
            cell(formatNumber(entry.daily_rate)),
            cell(formatNumber(entry.total)),
          ],
        })
    ),
    new TableRow({
      children: [
        cell('إجمالي تكاليف الإقامة', { colSpan: 5, align: AlignmentType.RIGHT, shading: 'F5F5F5' }),
        cell(formatNumber(invoice.stay_subtotal), { shading: 'F5F5F5' }),
      ],
    }),
  ];

  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows,
  });
}

function buildWordDocument(invoice) {
  const items = invoice.items || [];
  const payments = invoice.payments || [];
  const maxLen = Math.max(items.length, payments.length, 10);

  const dataRows = [];
  for (let i = 0; i < maxLen; i++) {
    const item = items[i] || {};
    const pay = payments[i] || {};
    const hasItem = !!(item.description || item.quantity || item.amount);
    dataRows.push(
      new TableRow({
        children: [
          cell(pay.receipt_date ? formatDate(pay.receipt_date) : '', { size: 18 }),
          cell(pay.receipt_number || '', { size: 18 }),
          cell(pay.amount ? formatNumber(pay.amount) : '', { size: 18 }),
          cell(item.description || '', { align: AlignmentType.RIGHT, size: 18 }),
          cell(hasItem && item.item_discount_percent !== undefined ? `${item.item_discount_percent || 0}%` : '', { size: 18 }),
          cell(item.quantity ?? '', { size: 18 }),
          cell(hasItem && item.amount !== undefined ? formatNumber(item.amount) : '', { size: 18 }),
          cell(hasItem && item.total !== undefined ? formatNumber(item.total) : '', { size: 18 }),
        ],
      })
    );
  }

  const summaryRows = buildSummaryRows(invoice);

  const mainTable = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({
        children: [
          cell('المبالغ المسددة', { colSpan: 3, shading: 'C0C0C0', size: 22 }),
          cell('كشف حساب', { shading: 'C0C0C0', size: 22 }),
          cell('القيمة المالية', { colSpan: 4, shading: 'C0C0C0', size: 22 }),
        ],
      }),
      new TableRow({
        children: [
          cell('تاريخ الإيصال', { shading: 'D9D9D9' }),
          cell('رقم الإيصال', { shading: 'D9D9D9' }),
          cell('المبلغ', { shading: 'D9D9D9' }),
          cell('البيان', { shading: 'D9D9D9' }),
          cell('الخصم%', { shading: 'D9D9D9' }),
          cell('عدد', { shading: 'D9D9D9' }),
          cell('المبلغ', { shading: 'D9D9D9' }),
          cell('الإجمالي', { shading: 'D9D9D9' }),
        ],
      }),
      ...dataRows,
      ...summaryRows,
    ],
  });

  const metaLines = [
    `رقم الملف: ${invoice.file_number || '-'} | المريض: ${invoice.patient_name}`,
    `الدخول: ${formatDate(invoice.admission_date)} | الخروج: ${formatDate(invoice.discharge_date)} | الإصدار: ${formatDate(invoice.issue_date || invoice.created_at)} | الأيام: ${invoice.stay_days ?? '-'}`,
  ];

  if (invoice.invoice_type === 'contracted' && invoice.contracted_entity_name) {
    metaLines.push(
      `الجهة المتعاقدة: ${invoice.contracted_entity_name} | خصم: ${invoice.discount_percent || 0}% | خطاب من: ${formatDate(invoice.letter_from_date)} | خطاب إلى: ${formatDate(invoice.letter_to_date)}`
    );
  }

  if (invoice.stay_entries?.length) {
    metaLines.push(
      `تفاصيل الإقامة: ${invoice.stay_entries
        .map(
          (entry) =>
            `${entry.stay_type_name || '-'} (${formatDate(entry.from_date)} → ${formatDate(entry.to_date)}, ${entry.days ?? 0} يوم)`
        )
        .join(' | ')}`
    );
  } else if (invoice.stay_type) {
    metaLines.push(`أنواع الإقامة: ${invoice.stay_type}`);
  }

  const stayTable = buildStayDetailsTable(invoice);

  const doc = new Document({
    sections: [
      {
        properties: {
          page: {
            margin: { top: 720, right: 720, bottom: 720, left: 720 },
          },
        },
        children: [
          new Paragraph({
            alignment: AlignmentType.CENTER,
            bidirectional: true,
            children: [
              new TextRun({
                text: `رقم الفاتورة: ${invoice.serial_number} | النوع: ${invoice.invoice_type_label || invoice.invoice_type}`,
                bold: true,
                size: 28,
                rightToLeft: true,
              }),
            ],
          }),
          new Paragraph({ text: '' }),
          new Paragraph({
            alignment: AlignmentType.CENTER,
            bidirectional: true,
            children: [
              new TextRun({ text: 'وزارة الدفاع', bold: true, size: 24, rightToLeft: true }),
            ],
          }),
          new Paragraph({
            alignment: AlignmentType.CENTER,
            bidirectional: true,
            children: [
              new TextRun({ text: 'إدارة الخدمات الطبية', bold: true, size: 24, rightToLeft: true }),
            ],
          }),
          new Paragraph({
            alignment: AlignmentType.CENTER,
            bidirectional: true,
            children: [
              new TextRun({
                text: CENTER_NAME,
                bold: true,
                size: 24,
                rightToLeft: true,
              }),
            ],
          }),
          new Paragraph({
            alignment: AlignmentType.CENTER,
            bidirectional: true,
            children: [
              new TextRun({ text: 'القسم المالي', bold: true, size: 24, rightToLeft: true }),
            ],
          }),
          new Paragraph({ text: '' }),
          ...metaLines.map(
            (line) =>
              new Paragraph({
                bidirectional: true,
                children: [new TextRun({ text: line, bold: true, size: 20, rightToLeft: true })],
              })
          ),
          new Paragraph({ text: '' }),
          ...(stayTable ? [stayTable, new Paragraph({ text: '' })] : []),
          mainTable,
          new Paragraph({ text: '' }),
          new Paragraph({
            bidirectional: true,
            children: [
              new TextRun({
                text: `${invoice.employee_name || 'الموظف المختص'}          ${invoice.auditor_name || 'المراجع المالي'}          ${invoice.captain_name}          ${invoice.manager_name}`,
                bold: true,
                size: 18,
                rightToLeft: true,
              }),
            ],
          }),
          ...(invoice.created_by_name
            ? [
                new Paragraph({ text: '' }),
                new Paragraph({
                  alignment: AlignmentType.CENTER,
                  bidirectional: true,
                  children: [
                    new TextRun({
                      text: `أُنشئت بواسطة: ${invoice.created_by_name}`,
                      bold: true,
                      size: 16,
                      rightToLeft: true,
                    }),
                  ],
                }),
              ]
            : []),
        ],
      },
    ],
  });

  return Packer.toBuffer(doc);
}

module.exports = { buildWordDocument };
