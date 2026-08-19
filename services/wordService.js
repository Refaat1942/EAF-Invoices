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
  BorderStyle,
  VerticalAlign,
} = require('docx');

function formatNumber(n) {
  const num = Number(n) || 0;
  return num.toLocaleString('ar-EG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
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

function buildWordDocument(invoice) {
  const items = invoice.items || [];
  const payments = invoice.payments || [];
  const maxLen = Math.max(items.length, payments.length, 10);

  const dataRows = [];
  for (let i = 0; i < maxLen; i++) {
    const item = items[i] || {};
    const pay = payments[i] || {};
    dataRows.push(
      new TableRow({
        children: [
          cell(pay.receipt_date || '', { size: 18 }),
          cell(pay.receipt_number || '', { size: 18 }),
          cell(pay.amount ? formatNumber(pay.amount) : '', { size: 18 }),
          cell(item.description || '', { align: AlignmentType.RIGHT, size: 18 }),
          cell(item.quantity ?? '', { size: 18 }),
          cell(item.description && item.amount !== undefined ? formatNumber(item.amount) : '', { size: 18 }),
          cell(item.description && item.total !== undefined ? formatNumber(item.total) : '', { size: 18 }),
        ],
      })
    );
  }

  const summaryRows = [
    ['دمغة', invoice.stamp_duty],
    ['مهن', invoice.professional_fees],
    [
      'الإجمالي',
      (invoice.items_subtotal || 0) + (invoice.stamp_duty || 0) + (invoice.professional_fees || 0),
    ],
    [`مصروفات إدارية ${invoice.admin_expenses_percent || 12}%`, invoice.admin_expenses],
    ['الإجمالي بعد المصروفات الإدارية', invoice.total_after_admin],
    ['الرصيد', invoice.balance],
    ['الإجمالي', invoice.final_total],
  ].map(
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

  const mainTable = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({
        children: [
          cell('المبالغ المسددة', { colSpan: 3, shading: 'C0C0C0', size: 22 }),
          cell('كشف حساب', { shading: 'C0C0C0', size: 22 }),
          cell('القيمة المالية', { colSpan: 3, shading: 'C0C0C0', size: 22 }),
        ],
      }),
      new TableRow({
        children: [
          cell('تاريخ الإيصال', { shading: 'D9D9D9' }),
          cell('رقم الإيصال', { shading: 'D9D9D9' }),
          cell('المبلغ', { shading: 'D9D9D9' }),
          cell('البيان', { shading: 'D9D9D9' }),
          cell('عدد', { shading: 'D9D9D9' }),
          cell('المبلغ', { shading: 'D9D9D9' }),
          cell('الإجمالي', { shading: 'D9D9D9' }),
        ],
      }),
      ...dataRows,
      ...summaryRows,
    ],
  });

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
                text: `رقم الفاتورة: ${invoice.serial_number} | النوع: ${invoice.invoice_type_label}`,
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
                text: 'مركز الطب الطبيعي والتأهيل وعلاج الروماتيزم ق.م',
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
          new Paragraph({
            bidirectional: true,
            children: [
              new TextRun({
                text: `المريض: ${invoice.patient_name} | الدخول: ${invoice.admission_date || '-'} | الخروج: ${invoice.discharge_date || '-'} | الأيام: ${invoice.stay_days}`,
                bold: true,
                size: 20,
                rightToLeft: true,
              }),
            ],
          }),
          new Paragraph({ text: '' }),
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
        ],
      },
    ],
  });

  return Packer.toBuffer(doc);
}

module.exports = { buildWordDocument };
