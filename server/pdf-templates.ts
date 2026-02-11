/**
 * ELI MOTORS LIMITED - PDF Templates
 * Faithful PDFKit port of GA4 Python/ReportLab templates.
 * Supports: Invoice, Estimate, Job Sheet, Service History.
 */
import PDFDocument from 'pdfkit';
import * as fs from 'fs';
import * as path from 'path';

// ═══════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════
const PW = 595.28;           // A4 width in points
const PH = 841.89;           // A4 height in points
const M = 30;                // Page margin
const CW = PW - M * 2;      // Content width
const ROW_H = 20;            // Default table row height
const BOTTOM = 40;           // Bottom margin for page breaks

// Colours
const HEADER_BG = '#d9d9d9';
const BORDER = '#cccccc';
const ACCENT_BLUE = '#3b5998';
const ACCENT_RED = '#cc0000';
const LIGHT_BG = '#f7f8fa';
const PARTS_BG = '#eef2f7';
const BADGE_COLOR = '#4a6fa5';
const MUTED = '#888888';
const PARTS_ACCENT = '#5a7fb5';

// Column width ratios
const V_RATIOS = [0.18, 0.15, 0.22, 0.28, 0.17];
const LP_RATIOS = [0.52, 0.10, 0.14, 0.10, 0.14];

// T&C wording
const TC_TEXT =
  'I agree to pay for all work and parts required for the repairs described above at your ' +
  'retail charge. It is understood that any estimate given is provisional and all repairs are ' +
  'undertaken on a cash basis unless prior arrangements for credit have been approved. ' +
  'Any additional work found to be necessary must be authorised by myself prior to ' +
  'commencement. All goods shall remain the property of the seller until paid for in full. ' +
  'I have read and accept your terms and conditions.';
const TC_BOLD =
  'Nothing herein is designed to nor will it affect a customers statutory rights';

// ═══════════════════════════════════════════════════════════════
// LOW-LEVEL HELPERS
// ═══════════════════════════════════════════════════════════════

function findImg(name: string): string | null {
  // Check multiple possible locations for image assets.
  // In production (Vercel), cwd or __dirname-relative paths work.
  // When compiled to a different dir, we search upward for templates/.
  const candidates = [
    path.join(process.cwd(), 'templates', name),
    path.join(process.cwd(), name),
    path.resolve(__dirname, '..', 'templates', name),
    path.resolve(__dirname, 'templates', name),
    path.resolve(__dirname, '..', '..', 'templates', name),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function makePDF(): { doc: InstanceType<typeof PDFDocument>; finish: () => Promise<Buffer> } {
  const doc = new PDFDocument({ margin: M, size: 'A4' });
  const bufs: Buffer[] = [];
  doc.on('data', (c: Buffer) => bufs.push(c));
  const finish = (): Promise<Buffer> =>
    new Promise((resolve) => {
      doc.on('end', () => resolve(Buffer.concat(bufs)));
      doc.end();
    });
  return { doc, finish };
}

/** Fill rect then stroke its border in one go. */
function filledCell(doc: InstanceType<typeof PDFDocument>, x: number, y: number, w: number, h: number, fill: string) {
  doc.save();
  doc.rect(x, y, w, h).fillAndStroke(fill, BORDER);
  doc.restore();
}

/** Stroke-only cell. */
function strokedCell(doc: InstanceType<typeof PDFDocument>, x: number, y: number, w: number, h: number) {
  doc.save();
  doc.rect(x, y, w, h).stroke(BORDER);
  doc.restore();
}

/** Draw vertical dividers for a row of cells. */
function cellDividers(doc: InstanceType<typeof PDFDocument>, x: number, y: number, h: number, widths: number[]) {
  let cx = x;
  doc.save().strokeColor(BORDER).lineWidth(0.5);
  for (let i = 1; i < widths.length; i++) {
    cx += widths[i - 1];
    doc.moveTo(cx, y).lineTo(cx, y + h).stroke();
  }
  doc.restore();
}

// ═══════════════════════════════════════════════════════════════
// SHARED SECTION RENDERERS
// ═══════════════════════════════════════════════════════════════

/** Company header with logo. Returns new y. */
function companyHeader(doc: InstanceType<typeof PDFDocument>, company: any, y: number): number {
  const startY = y;
  doc.font('Helvetica-Bold').fontSize(18).fillColor('black');
  doc.text(company.name, M, y); y += 22;
  doc.font('Helvetica').fontSize(8);
  doc.text(company.address_line1, M, y); y += 11;
  doc.text(company.phone, M, y); y += 11;
  doc.text(company.website, M, y); y += 11;
  doc.text(`VAT ${company.vat}`, M, y);

  let logoBottom = y + 22;
  const logo = findImg('eli_logo_white.png');
  if (logo) {
    const lw = 120;
    const lh = lw * (865 / 1930);     // logo is 1930×865
    doc.image(logo, PW - M - lw, startY, { width: lw });
    logoBottom = startY + lh + 8;     // ensure we clear the logo area
  }

  return Math.max(y + 22, logoBottom);
}

/** Customer info (left) + document details (right). Returns new y. */
function customerAndDoc(
  doc: InstanceType<typeof PDFDocument>,
  customer: any,
  title: string,
  number: string | number,
  details: [string, string][],
  y: number,
): number {
  const rw = PW - M - 340;

  // Customer (left column)
  doc.font('Helvetica').fontSize(10).fillColor('black');
  doc.text(customer.name, M + 30, y);
  let cy = y + 14;
  for (const line of customer.address_lines || []) {
    doc.text(line, M + 30, cy); cy += 14;
  }
  for (const k of ['tel', 'mobile', 'phone']) {
    if (customer[k]) {
      doc.text(`${k === 'mobile' ? 'Mobile' : 'Tel'}: ${customer[k]}`, M + 30, cy);
      cy += 14;
    }
  }

  // Document type + number (right column)
  doc.font('Helvetica-Bold').fontSize(16).fillColor('black');
  doc.text(title, 340, y);
  doc.font('Helvetica-Bold').fontSize(14);
  doc.text(String(number), 340, y, { width: rw, align: 'right' });

  doc.font('Helvetica').fontSize(9);
  let dy = y + 22;
  for (const [label, value] of details) {
    doc.text(label, 340, dy);
    doc.text(value || '', 340, dy, { width: rw, align: 'right' });
    dy += 13;
  }

  return Math.max(cy + 10, dy + 10);
}

/** Vehicle information table (4 rows). Returns new y. */
function vehicleTable(doc: InstanceType<typeof PDFDocument>, v: any, y: number): number {
  const cw = V_RATIOS.map((r) => CW * r);

  const drawRow = (cells: string[], isHeader: boolean, yPos: number) => {
    if (isHeader) {
      filledCell(doc, M, yPos, CW, ROW_H, HEADER_BG);
      doc.font('Helvetica-Bold').fontSize(8).fillColor('black');
    } else {
      strokedCell(doc, M, yPos, CW, ROW_H);
      doc.font('Helvetica').fontSize(8).fillColor('black');
    }
    cellDividers(doc, M, yPos, ROW_H, cw);
    let cx = M;
    cells.forEach((cell, i) => {
      doc.text(cell || '', cx, yPos + 6, { width: cw[i], align: 'center' });
      cx += cw[i];
    });
  };

  drawRow(['Registration', 'Make', 'Model', 'Chassis Number', 'Mileage'], true, y);
  y += ROW_H;
  drawRow([v.reg, v.make, v.model, v.chassis, String(v.mileage || '')], false, y);
  y += ROW_H;
  drawRow(['Engine No', 'Engine Code', 'Engine CC', 'Date Reg', 'Colour'], true, y);
  y += ROW_H;
  drawRow([v.engine_no, v.engine_code, String(v.engine_cc || ''), v.date_reg, v.colour], false, y);
  y += ROW_H;

  return y;
}

/** Generic data table (Labour / Parts / MOT). Returns new y. */
function dataTable(
  doc: InstanceType<typeof PDFDocument>,
  headers: string[],
  rows: string[][],
  ratios: number[],
  startY: number,
  checkBreak?: (n: number) => number,
): number {
  const cw = ratios.map((r) => CW * r);
  let y = startY;
  if (checkBreak) y = checkBreak(ROW_H * (1 + rows.length));

  // Header row
  filledCell(doc, M, y, CW, ROW_H, HEADER_BG);
  cellDividers(doc, M, y, ROW_H, cw);
  doc.font('Helvetica-Bold').fontSize(8.5).fillColor('black');
  let cx = M;
  headers.forEach((h, i) => {
    doc.text(h, cx + 6, y + 6, { width: cw[i] - 12, align: 'center' });
    cx += cw[i];
  });
  y += ROW_H;

  // Data rows
  doc.font('Helvetica').fontSize(8.5).fillColor('black');
  for (const row of rows) {
    strokedCell(doc, M, y, CW, ROW_H);
    cellDividers(doc, M, y, ROW_H, cw);
    cx = M;
    row.forEach((cell, i) => {
      doc.text(cell || '', cx + 6, y + 6, { width: cw[i] - 12, align: i === 0 ? 'left' : 'right' });
      cx += cw[i];
    });
    y += ROW_H;
  }
  return y + 8;
}

/**
 * Terms & Conditions (left) + Totals table (right) rendered side-by-side.
 * Returns new y.
 */
function tcAndTotals(
  doc: InstanceType<typeof PDFDocument>,
  totals: any,
  y: number,
  totalLabel: string,
  tcWidthRatio: number,
  checkBreak?: (n: number) => number,
): number {
  // Build totals rows: [label, value, bold?, highlight?]
  const tRows: [string, string, boolean, boolean][] = [];
  if (Number(totals.labour) > 0) tRows.push(['Labour', Number(totals.labour).toFixed(2), false, false]);
  if (Number(totals.parts) > 0) tRows.push(['Parts', Number(totals.parts).toFixed(2), false, false]);
  tRows.push(['SubTotal', Number(totals.subtotal).toFixed(2), true, false]);
  tRows.push([`VAT (${totals.vat_rate}%)`, Number(totals.vat).toFixed(2), false, false]);
  if (totals.mot != null) tRows.push(['MOT', Number(totals.mot).toFixed(2), false, false]);
  tRows.push([totalLabel, Number(totals.total).toFixed(2), true, true]);
  if (totals.balance != null) tRows.push(['Balance', Number(totals.balance).toFixed(2), false, false]);

  const rowH = 18;
  const totalsW = CW * 0.35;
  const totalsX = PW - M - totalsW;
  const halfW = totalsW / 2;
  const tcW = CW * tcWidthRatio;
  const totalsH = tRows.length * rowH;

  // Pre-calculate TC height
  doc.font('Helvetica').fontSize(7);
  const tcTextH = doc.heightOfString(TC_TEXT, { width: tcW });
  doc.font('Helvetica-Bold').fontSize(7);
  const tcBoldH = doc.heightOfString(TC_BOLD, { width: tcW });
  const tcTotalH = tcTextH + tcBoldH + 22; // + signed line + gaps

  const footerH = Math.max(totalsH, tcTotalH) + 5;
  if (checkBreak) y = checkBreak(footerH);

  const footerY = y;

  // ── T&C (left) ──
  doc.font('Helvetica').fontSize(7).fillColor('black');
  doc.text(TC_TEXT, M, footerY, { width: tcW, align: 'justify' });
  const afterRegular = footerY + tcTextH + 2;
  doc.font('Helvetica-Bold').fontSize(7);
  doc.text(TC_BOLD, M, afterRegular, { width: tcW });
  doc.font('Helvetica').fontSize(7);
  doc.text('Signed ________________    Date ________________', M, afterRegular + tcBoldH + 8);

  // ── Totals (right) ──
  let ty = footerY;
  for (const [label, value, bold, bg] of tRows) {
    if (bg) {
      filledCell(doc, totalsX, ty, totalsW, rowH, '#e8e8e8');
    } else {
      strokedCell(doc, totalsX, ty, totalsW, rowH);
    }
    // Divider
    doc.save().moveTo(totalsX + halfW, ty).lineTo(totalsX + halfW, ty + rowH).stroke(BORDER).restore();

    doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(9).fillColor('black');
    doc.text(label, totalsX + 6, ty + 4, { width: halfW - 12, align: 'left' });
    doc.text(value, totalsX + halfW + 6, ty + 4, { width: halfW - 12, align: 'right' });
    ty += rowH;
  }

  return Math.max(ty, afterRegular + tcBoldH + 25) + 10;
}

// ═══════════════════════════════════════════════════════════════
// INVOICE
// ═══════════════════════════════════════════════════════════════

export async function generateInvoicePDF(data: any): Promise<{ content: string; filename: string }> {
  const { doc, finish } = makePDF();
  let y = M;

  // Full header (redrawn on every page)
  const fullHeader = (): number => {
    y = M;
    y = companyHeader(doc, data.company, y);
    const inv = data.invoice;
    y = customerAndDoc(doc, data.customer, 'Invoice', inv.number, [
      ['Invoice Date:', inv.invoice_date || ''],
      ['Account No:', inv.account_no || ''],
      ['Order Ref:', inv.order_ref || ''],
      ['Date of Work', inv.date_of_work || ''],
      ['Payment Date:', inv.payment_date || ''],
      ['Payment Method:', inv.payment_method || ''],
    ], y);
    return y;
  };

  const checkBreak = (needed: number): number => {
    if (y + needed > PH - BOTTOM) { doc.addPage(); y = fullHeader(); }
    return y;
  };

  y = fullHeader();

  // Vehicle table
  y = checkBreak(ROW_H * 4);
  y = vehicleTable(doc, data.vehicle, y);
  y += 30;

  // Work description title (underlined)
  if (data.work_title) {
    y = checkBreak(20);
    doc.font('Helvetica-Bold').fontSize(10).fillColor('black');
    const tw = doc.widthOfString(data.work_title);
    doc.text(data.work_title, M, y);
    doc.save().moveTo(M, y + 13).lineTo(M + tw, y + 13).lineWidth(0.5).stroke('black').restore();
    y += 18;
  }

  // Work items
  doc.font('Helvetica').fontSize(9).fillColor('black');
  for (const item of data.work_items || []) {
    y = checkBreak(14);
    doc.text(`- ${item}`, M, y);
    y += 13;
  }
  y += 10;

  // MOT table (optional)
  if (data.mot && data.mot.length > 0) {
    const motRows = data.mot.map((m: any) => [m.description, String(m.qty ?? ''), String(m.status ?? '')]);
    y = dataTable(doc, ['MOT', 'Qty', 'Status'], motRows, [0.72, 0.14, 0.14], y, checkBreak);
  }

  // Labour table
  if (data.labour && data.labour.length > 0) {
    const rows = data.labour.map((i: any) => [
      i.description, String(i.qty ?? ''),
      i.unit != null ? Number(i.unit).toFixed(2) : '', i.d || '',
      i.subtotal != null ? Number(i.subtotal).toFixed(2) : '',
    ]);
    y = dataTable(doc, ['Labour', 'Qty', 'Unit', 'D', 'Sub Total'], rows, LP_RATIOS, y, checkBreak);
  }

  // Parts table
  if (data.parts && data.parts.length > 0) {
    const rows = data.parts.map((i: any) => [
      i.description, String(i.qty ?? ''),
      i.unit != null ? Number(i.unit).toFixed(2) : '', i.d || '',
      i.subtotal != null ? Number(i.subtotal).toFixed(2) : '',
    ]);
    y = dataTable(doc, ['Parts', 'Qty', 'Unit', 'D', 'Sub Total'], rows, LP_RATIOS, y, checkBreak);
  }
  y += 7;

  // T&C + Totals footer
  tcAndTotals(doc, data.totals, y, 'Total', 0.50, checkBreak);

  const buf = await finish();
  return { content: buf.toString('base64'), filename: `${data.invoice?.number || 'Invoice'}.pdf` };
}

// ═══════════════════════════════════════════════════════════════
// ESTIMATE
// ═══════════════════════════════════════════════════════════════

export async function generateEstimatePDF(data: any): Promise<{ content: string; filename: string }> {
  const { doc, finish } = makePDF();
  let y = M;

  const fullHeader = (): number => {
    y = M;
    y = companyHeader(doc, data.company, y);
    const est = data.estimate;
    y = customerAndDoc(doc, data.customer, 'Estimate', String(est.number), [
      ['Estimate Date:', est.date || ''],
      ['Account No:', est.account_no || ''],
      ['Order Ref:', est.order_ref || ''],
      ['Estimate Valid to:', est.valid_to || ''],
    ], y);
    return y;
  };

  const checkBreak = (needed: number): number => {
    if (y + needed > PH - BOTTOM) { doc.addPage(); y = fullHeader(); }
    return y;
  };

  y = fullHeader();

  // Vehicle table
  y = checkBreak(ROW_H * 4);
  y = vehicleTable(doc, data.vehicle, y);
  y += 30;

  // Work description title (underlined)
  if (data.work_title) {
    y = checkBreak(20);
    doc.font('Helvetica-Bold').fontSize(10).fillColor('black');
    const tw = doc.widthOfString(data.work_title);
    doc.text(data.work_title, M, y);
    doc.save().moveTo(M, y + 13).lineTo(M + tw, y + 13).lineWidth(0.5).stroke('black').restore();
    y += 18;
  }

  // Work items (bullet points with •)
  doc.font('Helvetica').fontSize(9).fillColor('black');
  for (const item of data.work_items || []) {
    y = checkBreak(14);
    doc.text(`\u2022   ${item}`, M, y);
    y += 13;
  }
  y += 10;

  // Car diagram (after work description)
  const diagram = findImg('car_diagram.png');
  if (diagram) {
    const dw = CW * 0.48;
    const dh = dw * (274 / 355);
    y += 6;
    y = checkBreak(dh);
    doc.image(diagram, M, y, { width: dw });
    y += dh + 10;
  }

  // Labour table
  if (data.labour && data.labour.length > 0) {
    const rows = data.labour.map((i: any) => [
      i.description, String(i.qty ?? ''),
      i.unit != null ? Number(i.unit).toFixed(2) : '', i.d || '',
      i.subtotal != null ? Number(i.subtotal).toFixed(2) : '',
    ]);
    y = dataTable(doc, ['Labour', 'Qty', 'Unit', 'D', 'Sub Total'], rows, LP_RATIOS, y, checkBreak);
  }

  // Parts table
  if (data.parts && data.parts.length > 0) {
    const rows = data.parts.map((i: any) => [
      i.description, String(i.qty ?? ''),
      i.unit != null ? Number(i.unit).toFixed(2) : '', i.d || '',
      i.subtotal != null ? Number(i.subtotal).toFixed(2) : '',
    ]);
    y = dataTable(doc, ['Parts', 'Qty', 'Unit', 'D', 'Sub Total'], rows, LP_RATIOS, y, checkBreak);
  }
  y += 7;

  // T&C + Totals
  tcAndTotals(doc, data.totals, y, 'Estimate Total', 0.55, checkBreak);

  const buf = await finish();
  return { content: buf.toString('base64'), filename: `Estimate_${data.estimate?.number || ''}.pdf` };
}

// ═══════════════════════════════════════════════════════════════
// JOB SHEET
// ═══════════════════════════════════════════════════════════════

export async function generateJobSheetPDF(data: any): Promise<{ content: string; filename: string }> {
  const { doc, finish } = makePDF();
  let y = M;

  const jsHeader = (): number => {
    y = M;
    // Centred title
    doc.font('Helvetica-Bold').fontSize(20).fillColor('black');
    doc.text('Job Sheet', 0, y, { width: PW, align: 'center' });
    y += 30;

    // Customer (left)
    doc.font('Helvetica').fontSize(10);
    doc.text(data.customer.name, M, y);
    let cy = y + 14;
    for (const line of data.customer.address_lines || []) {
      doc.text(line, M, cy); cy += 14;
    }
    if (data.customer.mobile) {
      doc.text(`Mobile: ${data.customer.mobile}`, M, cy); cy += 14;
    } else if (data.customer.tel) {
      doc.text(`Tel: ${data.customer.tel}`, M, cy); cy += 14;
    }

    // Document details (right)
    const dx = 340;
    const rw = PW - M - dx;
    const d = data.doc;
    doc.font('Helvetica-Bold').fontSize(12);
    doc.text('Doc Reference', dx, y);
    doc.text(d.reference, dx, y, { width: rw, align: 'right' });

    doc.font('Helvetica').fontSize(9);
    let dy = y + 16;
    for (const [label, value] of [
      ['Account No:', d.account_no || ''],
      ['Order Ref:', d.order_ref || ''],
      ['Receive Date:', d.receive_date || ''],
      ['Due Date:', d.due_date || ''],
      ['Status:', d.status || ''],
      ['Technician:', d.technician || ''],
    ] as [string, string][]) {
      doc.text(label, dx, dy);
      doc.text(value, dx, dy, { width: rw, align: 'right' });
      dy += 13;
    }

    // Checkboxes
    dy += 8;
    const cbX1 = dx + 40;
    doc.save().rect(cbX1, dy, 10, 10).stroke('black').restore();
    doc.font('Helvetica').fontSize(9).fillColor('black').text('In Progress', cbX1 + 14, dy + 1);
    const cbX2 = PW - M - 80;
    doc.save().rect(cbX2, dy, 10, 10).stroke('black').restore();
    doc.text('Completed', cbX2 + 14, dy + 1);

    y = Math.max(cy, dy + 18) + 10;
    return y;
  };

  const checkBreak = (needed: number): number => {
    if (y + needed > PH - BOTTOM) { doc.addPage(); y = jsHeader(); }
    return y;
  };

  y = jsHeader();

  // Vehicle table
  y = checkBreak(ROW_H * 4);
  y = vehicleTable(doc, data.vehicle, y);
  y += 30;

  // Work description lines
  doc.font('Helvetica').fontSize(9).fillColor('black');
  for (const line of data.work_description || []) {
    y = checkBreak(14);
    if (line) doc.text(line, M, y);
    y += 13;
  }
  y -= 2;

  // Oil specs
  if (data.oil_specs && data.oil_specs.length > 0) {
    for (const spec of data.oil_specs) {
      y = checkBreak(14);
      doc.text(
        `All Temperatures    ${spec.viscosity}    ${spec.fiat_ref}    ${spec.category}`,
        M, y,
      );
      y += 13;
    }
  }
  y += 4;

  // ── Blank Labour table ──
  const numLabour = data.labour_rows || 5;
  const blankRowH = 22;
  y = checkBreak(ROW_H + numLabour * blankRowH);
  const lcw = [0.64, 0.12, 0.12, 0.12].map((r) => CW * r);

  filledCell(doc, M, y, CW, ROW_H, HEADER_BG);
  cellDividers(doc, M, y, ROW_H, lcw);
  doc.font('Helvetica-Bold').fontSize(8.5).fillColor('black');
  let cx = M;
  ['Labour', 'Tech', 'Qty', 'Done'].forEach((h, i) => {
    doc.text(h, cx + 6, y + 6, { width: lcw[i] - 12, align: 'center' });
    cx += lcw[i];
  });
  y += ROW_H;

  for (let r = 0; r < numLabour; r++) {
    cx = M;
    for (const w of lcw) {
      doc.save().rect(cx, y, w, blankRowH).stroke(BORDER).restore();
      cx += w;
    }
    y += blankRowH;
  }
  y += 8;

  // ── Blank Parts table ──
  const numParts = data.parts_rows || 5;
  y = checkBreak(ROW_H + numParts * blankRowH);
  const pcw = [0.64, 0.24, 0.12].map((r) => CW * r);

  filledCell(doc, M, y, CW, ROW_H, HEADER_BG);
  cellDividers(doc, M, y, ROW_H, pcw);
  doc.font('Helvetica-Bold').fontSize(8.5).fillColor('black');
  cx = M;
  ['Parts', 'Part No.', 'Done'].forEach((h, i) => {
    doc.text(h, cx + 6, y + 6, { width: pcw[i] - 12, align: 'center' });
    cx += pcw[i];
  });
  y += ROW_H;

  for (let r = 0; r < numParts; r++) {
    cx = M;
    for (const w of pcw) {
      doc.save().rect(cx, y, w, blankRowH).stroke(BORDER).restore();
      cx += w;
    }
    y += blankRowH;
  }
  y += 6;

  // Car diagram
  const diagram = findImg('car_diagram.png');
  if (diagram) {
    const dw = CW * 0.28;
    const dh = dw * (274 / 355);
    y = checkBreak(dh + 80);
    doc.image(diagram, M, y, { width: dw });
    y += dh + 6;
  }

  // T&C
  y = checkBreak(80);
  const tcLines = [
    'I agree to pay for all work and parts required for the repairs described above at your',
    'retail charge. It is understood that any estimate given is provisional and all repairs are',
    'undertaken on a cash basis unless prior arrangements for credit have been approved.',
    'Any additional work found to be necessary must be authorised by myself prior to',
    'commencement.  All goods shall remain the property of the seller until paid for in full.',
    'I have read and accept your terms and conditions.',
  ];
  doc.font('Helvetica').fontSize(7).fillColor('black');
  for (const line of tcLines) { doc.text(line, M, y); y += 9; }
  doc.font('Helvetica-Bold').fontSize(7);
  doc.text(TC_BOLD, M, y); y += 12;
  doc.font('Helvetica').fontSize(7.5);
  doc.text('Signed ________________          Date ________________', M, y);

  const buf = await finish();
  return { content: buf.toString('base64'), filename: `${data.doc?.reference || 'JobSheet'}.pdf` };
}

// ═══════════════════════════════════════════════════════════════
// SERVICE HISTORY - DESCRIPTION PARSER
// ═══════════════════════════════════════════════════════════════

function cleanPart(raw: string): string | null {
  let p = raw.trim().replace(/\.$/, '');
  p = p.split(
    /\s+(?:And\s+)?(?:Carried|Checked|Topped|Adjusted|Cleared|Reset|Prepare|Carry Out|Re-?Grease|Re-?Test|Re-?Fill|Re-?Calibrate|Re-?Fit)/i,
  )[0].trim();
  p = p.replace(/\s+And\s+(?:Adjust|Re-?\w+)$/i, '');
  p = p.replace(/\s+And$/i, '').trim();
  p = p.replace(/^Broken\s+/i, '');
  if (!p || p.length < 4) return null;
  if (['new unit', 'unit', 'bulbs as necessary', 'new'].includes(p.toLowerCase())) return null;
  return p;
}

export function parseDescription(text: string): { workItems: string[]; parts: string[] } {
  if (!text || !text.trim()) return { workItems: [], parts: [] };

  // Split on ' - '
  let chunks: string[] = [];
  for (const chunk of text.trim().split(' - ')) {
    if (!chunk.trim()) continue;
    for (let s of chunk.split(/\.\s+/)) {
      s = s.trim().replace(/\.$/, '');
      if (s) chunks.push(s);
    }
  }

  // Split on 'To <ActionVerb>'
  let expanded: string[] = [];
  for (const chunk of chunks) {
    const sub = chunk.split(/\s+(?=To (?:Supply|Carry|Prepare|Replace|Fit|Remove|Check|Investigate))/i);
    for (const s of sub) if (s.trim()) expanded.push(s.trim());
  }

  // Split comma-separated independent actions
  const startsAction =
    /^(?:Carried|Changed|Checked|Replaced|Supplied|Fitted|Removed|Adjusted|Topped|Refilled|Reassembled|Investigated|Confirmed|Drilled|Ran|Freed|Cleared|Reset|Prepared|Refitted|Re-?[A-Z])/i;
  let finalItems: string[] = [];
  for (const item of expanded) {
    const parts = item.split(/,\s+(?=[A-Z])/);
    if (parts.length > 1) {
      let buffer = parts[0];
      for (let i = 1; i < parts.length; i++) {
        if (startsAction.test(parts[i]) && buffer.length > 15) {
          finalItems.push(buffer.trim());
          buffer = parts[i];
        } else {
          buffer += ', ' + parts[i];
        }
      }
      finalItems.push(buffer.trim());
    } else {
      finalItems.push(item);
    }
  }

  // Extract parts from action patterns
  const partsFound: string[] = [];
  for (const item of finalItems) {
    let m = item.match(/(?:Supply|Supplied)\s+And\s+Fit(?:ted)?\s+(.+)/i);
    if (m) { const p = cleanPart(m[1]); if (p) partsFound.push(p); continue; }
    m = item.match(/Replace[d]?\s+(.+)/i);
    if (m) { const p = cleanPart(m[1]); if (p) partsFound.push(p); continue; }
    m = item.match(/^(?:Supplied\s+And\s+)?Fit(?:ted)?\s+(?:New\s+)?(.+)/i);
    if (m && !/^Re-?Fit/i.test(item)) { const p = cleanPart(m[1]); if (p) partsFound.push(p); continue; }
  }

  // Deduplicate
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const p of partsFound) {
    const key = p.toLowerCase();
    if (!seen.has(key)) { seen.add(key); unique.push(p); }
  }

  return { workItems: finalItems, parts: unique };
}

// ═══════════════════════════════════════════════════════════════
// SERVICE HISTORY
// ═══════════════════════════════════════════════════════════════

export async function generateServiceHistoryPDF(data: any): Promise<{ content: string; filename: string }> {
  const { doc, finish } = makePDF();
  const SM = 35;                   // slightly wider margins
  const SCW = PW - SM * 2;
  let y = SM;
  let pageNum = 1;

  const pageHeader = (): number => {
    y = SM;

    // Company header
    doc.font('Helvetica-Bold').fontSize(18).fillColor('black');
    doc.text(data.company_name || 'ELI MOTORS LIMITED', SM, y); y += 20;
    doc.font('Helvetica').fontSize(8);
    doc.text(data.address || '49 VICTORIA ROAD, HENDON, LONDON, NW4 2RP', SM, y); y += 11;
    doc.text(data.phone || '020 8203 6449, Sales 07950 250970', SM, y); y += 11;
    doc.text(data.website || 'www.elimotors.co.uk', SM, y);

    const logo = findImg('eli_logo_white.png');
    if (logo) {
      const lw = 120;
      doc.image(logo, PW - SM - lw, SM, { width: lw });
    }
    y += 18;

    // Blue + red accent lines
    doc.save().strokeColor(ACCENT_BLUE).lineWidth(2).moveTo(SM, y).lineTo(PW - SM, y).stroke().restore();
    y += 5;
    doc.save().strokeColor(ACCENT_RED).lineWidth(1).moveTo(SM, y).lineTo(PW - SM, y).stroke().restore();
    y += 18;

    // Title
    doc.font('Helvetica-Bold').fontSize(16).fillColor('black');
    doc.text('VEHICLE SERVICE HISTORY', SM, y);

    if (data.vehicle_reg) {
      doc.font('Helvetica-Bold').fontSize(12);
      doc.text(data.vehicle_reg, SM, y, { width: SCW, align: 'right' });
      const vm = `${data.vehicle_make || ''} ${data.vehicle_model || ''}`.trim();
      if (vm) {
        doc.font('Helvetica').fontSize(9).fillColor(MUTED);
        doc.text(vm, SM, y + 16, { width: SCW, align: 'right' });
        doc.fillColor('black');
      }
    }
    y += 20;

    doc.font('Helvetica').fontSize(8).fillColor(MUTED);
    doc.text('Complete Maintenance Record', SM, y);
    if (pageNum > 1) doc.text(`Page ${pageNum}`, SM, y, { width: SCW, align: 'right' });
    doc.fillColor('black');
    y += 18;

    return y;
  };

  const checkBreak = (needed: number): number => {
    if (y + needed > PH - 50) {
      doc.addPage();
      pageNum++;
      y = pageHeader();
    }
    return y;
  };

  y = pageHeader();

  const timelineX = SM + 8;
  const contentX = SM + 24;
  const boxW = PW - SM - contentX - 7;
  const innerW = boxW - 16;
  const entries = data.entries || [];

  for (let idx = 0; idx < entries.length; idx++) {
    const entry = entries[idx];
    const { workItems, parts: partsList } = parseDescription(entry.description || '');

    // ── Estimate entry height ──
    doc.font('Helvetica').fontSize(8);
    let workH = 0;
    for (const item of workItems) {
      workH += doc.heightOfString(`\u2022  ${item}`, { width: innerW }) + 2;
    }

    let partsH = 0;
    if (partsList.length > 0) {
      partsH = 18; // label
      doc.font('Helvetica').fontSize(7.5);
      for (const part of partsList) {
        partsH += doc.heightOfString(`\u25B8  ${part}`, { width: innerW - 8 }) + 2;
      }
      partsH += 8;
    }

    const descLabelH = 14;
    const boxPad = 12;
    let boxH = descLabelH + workH + partsH + boxPad;
    if (workItems.length === 0 && partsList.length === 0) boxH = descLabelH + boxPad;

    const entryH = 40 + boxH + 20;
    y = checkBreak(entryH);

    // ── Timeline dot ──
    doc.save().circle(timelineX, y + 3, 4).fill(ACCENT_BLUE).restore();

    // ── Date ──
    doc.font('Helvetica-Bold').fontSize(11).fillColor('black');
    doc.text(entry.date, contentX, y);
    const dateW = doc.widthOfString(entry.date);

    // ── Invoice badge ──
    const badgeText = `INVOICE  ${entry.invoice_number}`;
    doc.font('Helvetica-Bold').fontSize(7);
    const badgeW = doc.widthOfString(badgeText) + 12;
    const badgeX = contentX + dateW + 12;
    doc.save().roundedRect(badgeX, y - 1, badgeW, 14, 3).fill(BADGE_COLOR).restore();
    doc.font('Helvetica-Bold').fontSize(7).fillColor('white');
    doc.text(badgeText, badgeX + 6, y + 2);
    doc.fillColor('black');

    // ── Total (right-aligned) ──
    doc.font('Helvetica-Bold').fontSize(11);
    doc.text(`Total: ${entry.total}`, contentX, y, { width: PW - SM - contentX, align: 'right' });

    doc.font('Helvetica').fontSize(6.5).fillColor(MUTED);
    doc.text('RECORDED ENTRY', contentX, y + 13, { width: PW - SM - contentX, align: 'right' });
    doc.fillColor('black');
    y += 16;

    // ── Mileage ──
    if (entry.mileage) {
      doc.font('Helvetica').fontSize(8.5).fillColor(MUTED);
      doc.text(`MILEAGE: ${entry.mileage}`, contentX, y);
      doc.fillColor('black');
      y += 14;
    } else {
      y += 6;
    }

    // ── Description box ──
    const boxX = contentX + 2;
    const boxTop = y;

    // Background + border
    doc.save().roundedRect(boxX, boxTop, boxW, boxH, 5).fillAndStroke(LIGHT_BG, BORDER).restore();

    // "JOB DESCRIPTION" label
    doc.font('Helvetica-Bold').fontSize(6.5).fillColor(ACCENT_BLUE);
    doc.text('J O B   D E S C R I P T I O N', boxX + 8, boxTop + 6);
    doc.fillColor('black');

    // Work items
    let drawY = boxTop + descLabelH + 2;
    doc.font('Helvetica').fontSize(8).fillColor('#333333');
    for (const item of workItems) {
      const h = doc.heightOfString(`\u2022  ${item}`, { width: innerW });
      doc.text(`\u2022  ${item}`, boxX + 8, drawY, { width: innerW });
      drawY += h + 2;
    }

    // Parts sub-section
    if (partsList.length > 0) {
      const partsTop = drawY + 4;
      doc.save()
        .roundedRect(boxX + 4, partsTop, boxW - 8, partsH, 3)
        .fillAndStroke(PARTS_BG, PARTS_ACCENT)
        .restore();

      doc.font('Helvetica-Bold').fontSize(6).fillColor(PARTS_ACCENT);
      doc.text('P A R T S   U S E D', boxX + 10, partsTop + 5);

      let partY = partsTop + 18;
      doc.font('Helvetica').fontSize(7.5).fillColor('#444444');
      for (const part of partsList) {
        const h = doc.heightOfString(`\u25B8  ${part}`, { width: innerW - 8 });
        doc.text(`\u25B8  ${part}`, boxX + 12, partY, { width: innerW - 8 });
        partY += h + 2;
      }
    }
    doc.fillColor('black');

    y = boxTop + boxH;

    // ── Timeline line connecting entries ──
    const lineTop = boxTop - 14;
    if (idx < entries.length - 1) {
      y += 10;
      doc.save().strokeColor(BORDER).lineWidth(1.5)
        .moveTo(timelineX, lineTop).lineTo(timelineX, y + 6).stroke().restore();
      y += 10;
    } else {
      doc.save().strokeColor(BORDER).lineWidth(1.5)
        .moveTo(timelineX, lineTop).lineTo(timelineX, y + 4).stroke().restore();
      y += 15;
    }
  }

  // ═══ Summary Footer ═══
  y = checkBreak(70);
  doc.save().strokeColor(BORDER).lineWidth(1)
    .moveTo(SM + 20, y).lineTo(PW - SM - 20, y).stroke().restore();
  y += 25;

  const mid = PW / 2;
  doc.font('Helvetica-Bold').fontSize(7).fillColor(MUTED);
  doc.text('T O T A L   R E C O R D S', mid - 120, y, { width: 100, align: 'center' });
  doc.text('C U M U L A T I V E   S P E N D', mid + 20, y, { width: 100, align: 'center' });

  y += 16;
  doc.font('Helvetica-Bold').fontSize(18).fillColor('black');
  doc.text(String(data.total_records ?? entries.length), mid - 120, y, { width: 100, align: 'center' });
  doc.text(data.cumulative_spend || '', mid + 20, y, { width: 100, align: 'center' });

  y += 30;
  doc.font('Helvetica-Oblique').fontSize(7).fillColor(MUTED);
  const now = new Date();
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const h = now.getHours(); const mi = now.getMinutes(); const s = now.getSeconds();
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 || 12;
  const ts = `${months[now.getMonth()]} ${String(now.getDate()).padStart(2, '0')}, ${now.getFullYear()}, ${h12}:${String(mi).padStart(2, '0')}:${String(s).padStart(2, '0')} ${ampm}`;
  doc.text(`Generated by Eli Motors Management Suite on ${ts}`, 0, y, { width: PW, align: 'center' });

  const buf = await finish();
  return { content: buf.toString('base64'), filename: `Service_History_${data.vehicle_reg || ''}.pdf` };
}
