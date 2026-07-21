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
const ROW_H = 16;            // Default table row height (compact, to keep docs on one page)
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
const V_RATIOS = [0.12, 0.12, 0.28, 0.20, 0.28]; // Reg, Make, Model, Chassis, Mileage — Mileage expanded
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

  // ES Module workaround for __dirname
  const __dirname = path.dirname(new URL(import.meta.url).pathname);

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
  doc.font('Helvetica').fontSize(18).fillColor('black');
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
  let cy = y;
  // Insurance invoices are addressed to the insurer; show that prominently above the customer.
  if (customer.billTo) {
    doc.font('Helvetica').fontSize(10).fillColor('black');
    doc.text(`Invoice to: ${customer.billTo}`, M + 30, cy); cy += 14;
    doc.font('Helvetica').fontSize(9).fillColor('#444');
    doc.text(`Re. customer: ${customer.name}`, M + 30, cy); cy += 14;
    doc.fillColor('black');
  } else {
    // Business customers: company name bold on top, contact person beneath. When the record is
    // a pure company (no contact name, so customer.name is the 'Unknown Client' placeholder),
    // show the company alone rather than "Company\nUnknown Client".
    if (customer.company) {
      doc.font('Helvetica-Bold').fontSize(10).fillColor('black');
      doc.text(customer.company, M + 30, cy); cy += 14;
    }
    const namePlaceholder = !customer.name || customer.name === 'Unknown Client';
    if (!(customer.company && namePlaceholder)) {
      doc.font('Helvetica').fontSize(10).fillColor('black');
      doc.text(customer.name, M + 30, cy); cy += 14;
    }
  }
  // Reset to the base body font — a company-only block would otherwise leave Helvetica-Bold
  // active and render the address lines bold.
  doc.font('Helvetica').fontSize(10).fillColor('black');
  for (const line of customer.address_lines || []) {
    doc.text(line, M + 30, cy); cy += 14;
  }
  const custPhones = Array.isArray(customer.phones) ? customer.phones : [];
  if (custPhones.length) {
    for (const p of custPhones) {
      doc.text(p.label ? `${p.label}: ${p.value}` : p.value, M + 30, cy);
      cy += 14;
    }
  } else {
    for (const k of ['tel', 'mobile', 'phone']) {
      if (customer[k]) {
        doc.text(`${k === 'mobile' ? 'Mobile' : 'Tel'}: ${customer[k]}`, M + 30, cy);
        cy += 14;
      }
    }
  }

  // Document type + number (right column)
  doc.font('Helvetica').fontSize(16).fillColor('black');
  doc.text(title, 340, y);
  doc.font('Helvetica').fontSize(14);
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

  // Draw centred text auto-shrunk so it ALWAYS stays on one line within the cell.
  const fitCentered = (text: string, x: number, w: number, yPos: number, max = 8, min = 4.5) => {
    const t = text || '';
    doc.font('Helvetica').fillColor('black');
    let size = max;
    while (size > min && doc.fontSize(size).widthOfString(t) > w - 8) size -= 0.5;
    doc.fontSize(size).text(t, x + 4, yPos + (ROW_H - size) / 2 - 1, { width: w - 8, align: 'center', lineBreak: false });
  };

  const drawRow = (cells: string[], widths: number[], isHeader: boolean, yPos: number) => {
    if (isHeader) filledCell(doc, M, yPos, CW, ROW_H, HEADER_BG);
    else strokedCell(doc, M, yPos, CW, ROW_H);
    cellDividers(doc, M, yPos, ROW_H, widths);
    let cx = M;
    cells.forEach((cell, i) => {
      if (isHeader) doc.font('Helvetica').fontSize(8).fillColor('black').text(cell || '', cx, yPos + 6, { width: widths[i], align: 'center', lineBreak: false });
      else fitCentered(cell, cx, widths[i], yPos);
      cx += widths[i];
    });
  };

  const up = (s: any) => String(s ?? '').toUpperCase();
  const mileage = Number(v.mileage) > 0 ? String(v.mileage) : ''; // blank (not 0) so staff fill it in

  drawRow(['Registration', 'Make', 'Model', 'Chassis Number', 'Mileage'], cw, true, y);
  y += ROW_H;
  drawRow([up(v.reg), up(v.make), up(v.model), up(v.chassis), mileage], cw, false, y);
  y += ROW_H;
  drawRow(['Engine No', 'Engine Code', 'Engine CC', 'Date Reg', 'Colour'], cw, true, y);
  y += ROW_H;
  drawRow([up(v.engine_no), up(v.engine_code), String(v.engine_cc || ''), v.date_reg, up(v.colour)], cw, false, y);
  y += ROW_H;

  // Boxed tech-info row — SAME grey-header style as the rows above. Engine Oil gets the wide
  // column since its spec is long; every value auto-fits to one line.
  const tcw = [0.40, 0.20, 0.20, 0.20].map((r) => CW * r);
  drawRow(['Engine Oil', 'Air Con', 'MOT Expiry', 'Tax'], tcw, true, y);
  y += ROW_H;
  drawRow([up(v.engine_oil), up(v.air_con), v.mot_expiry || '', up(v.tax_info)], tcw, false, y);
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
  doc.font('Helvetica').fontSize(8.5).fillColor('black');
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
  if (Number(totals.sundries) > 0) tRows.push(['Sundries', Number(totals.sundries).toFixed(2), false, false]);
  if (Number(totals.lubricants) > 0) tRows.push(['Lubricants', Number(totals.lubricants).toFixed(2), false, false]);
  if (Number(totals.paint) > 0) tRows.push(['Paint & Mat.', Number(totals.paint).toFixed(2), false, false]);
  tRows.push(['SubTotal', Number(totals.subtotal).toFixed(2), true, false]);
  if (totals.discount != null && Number(totals.discount) > 0) tRows.push(['Discount', '-' + Number(totals.discount).toFixed(2), false, false]);
  tRows.push([`VAT (${totals.vat_rate}%)`, Number(totals.vat).toFixed(2), false, false]);
  if (totals.mot != null) tRows.push(['MOT', Number(totals.mot).toFixed(2), false, false]);
  tRows.push([totalLabel, Number(totals.total).toFixed(2), true, true]);
  if (totals.excess != null && Number(totals.excess) > 0) tRows.push(['Excess', Number(totals.excess).toFixed(2), false, false]);
  if (totals.receipts != null) tRows.push(['Receipts', Number(totals.receipts).toFixed(2), false, false]);
  if (totals.balance != null) tRows.push(['Balance', Number(totals.balance).toFixed(2), true, false]);

  const rowH = 18;
  const totalsW = CW * 0.35;
  const totalsX = PW - M - totalsW;
  const halfW = totalsW / 2;
  const tcW = CW * tcWidthRatio;
  const totalsH = tRows.length * rowH;

  // Pre-calculate TC height
  doc.font('Helvetica').fontSize(7);
  const tcTextH = doc.heightOfString(TC_TEXT, { width: tcW });
  doc.font('Helvetica').fontSize(7);
  const tcBoldH = doc.heightOfString(TC_BOLD, { width: tcW });
  const tcTotalH = tcTextH + tcBoldH + 22; // + signed line + gaps

  const footerH = Math.max(totalsH, tcTotalH) + 5;
  if (checkBreak) y = checkBreak(footerH);

  const footerY = y;

  // ── T&C (left) ──
  doc.font('Helvetica').fontSize(7).fillColor('black');
  doc.text(TC_TEXT, M, footerY, { width: tcW, align: 'justify' });
  const afterRegular = footerY + tcTextH + 2;
  doc.font('Helvetica').fontSize(7);
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

    doc.font(bold ? 'Helvetica' : 'Helvetica').fontSize(9).fillColor('black');
    doc.text(label, totalsX + 6, ty + 4, { width: halfW - 12, align: 'left' });
    const display = value ? (value.startsWith('-') ? '-£' + value.slice(1) : '£' + value) : '';
    doc.text(display, totalsX + halfW + 6, ty + 4, { width: halfW - 12, align: 'right' });
    ty += rowH;
  }

  return Math.max(ty, afterRegular + tcBoldH + 25) + 10;
}

// ═══════════════════════════════════════════════════════════════
// INVOICE
// ═══════════════════════════════════════════════════════════════

// Render a free-text work description with proper width wrapping, so long lines never overrun
// the page or overwrite the next line. Markup understood (kept in sync with the on-screen view):
//   **Heading**  or  # Heading   → a line printed BOLD + UNDERLINED (a title)
//   - bullet / • bullet          → hanging indent so wrapped continuation aligns under the text
//   (blank line)                 → small paragraph gap
function workBlock(doc: InstanceType<typeof PDFDocument>, title: string, items: string[], y: number, newPageTop: () => number): number {
  const INDENT = 11;
  const lines: string[] = [];
  if (title) lines.push(title);
  for (const it of items || []) lines.push(it == null ? '' : String(it));
  const ensure = (h: number) => { if (y + h > PH - BOTTOM) { doc.addPage(); y = newPageTop(); } };

  for (const raw of lines) {
    const text = String(raw);
    if (!text.trim()) { y += 5; continue; }                                  // blank → paragraph gap

    const head = text.match(/^\s*(?:\*\*(.+?)\*\*|#{1,3}\s+(.+?))\s*$/);      // **Heading** or # Heading
    if (head) {
      const t = (head[1] ?? head[2] ?? '').trim();
      doc.font('Helvetica-Bold').fontSize(9);
      const h = doc.heightOfString(t, { width: CW });
      ensure(h);
      doc.font('Helvetica-Bold').fontSize(9).fillColor('black').text(t, M, y, { width: CW, underline: true });
      y += h + 3;
      continue;
    }

    const bul = text.match(/^\s*([-•])\s+(.*)$/);                            // bullet → hanging indent
    if (bul) {
      const body = bul[2];
      doc.font('Helvetica').fontSize(9);
      const h = doc.heightOfString(body, { width: CW - INDENT });
      ensure(h);
      doc.font('Helvetica').fontSize(9).fillColor('black');
      doc.text('-', M, y);
      doc.text(body, M + INDENT, y, { width: CW - INDENT });
      y += h + 1;
      continue;
    }

    doc.font('Helvetica').fontSize(9);                                       // normal paragraph line
    const h = doc.heightOfString(text, { width: CW });
    ensure(h);
    doc.font('Helvetica').fontSize(9).fillColor('black').text(text, M, y, { width: CW });
    y += h + 1;
  }
  return y;
}

export async function generateInvoicePDF(data: any, opts: { customerCopyOnly?: boolean } = {}): Promise<{ content: string; filename: string }> {
  const { doc, finish } = makePDF();
  let y = M;
  let copyLabel = '';

  // Full header (redrawn on every page)
  const fullHeader = (): number => {
    y = M;
    if (copyLabel) doc.font('Helvetica').fontSize(7).fillColor('#999999').text(copyLabel.toUpperCase(), M, 16, { width: PW - 2 * M, align: 'right' });
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

  // Renders one full invoice; called twice (customer + office copy).
  const renderCopy = () => {
    y = fullHeader();

    // Vehicle table
    y = checkBreak(ROW_H * 4);
    y = vehicleTable(doc, data.vehicle, y);
    y += 14;

    // Work description (title + lines) — width-wrapped so long text never overwrites
    y = workBlock(doc, data.work_title, data.work_items, y, fullHeader);
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
        i.unit != null ? '£' + Number(i.unit).toFixed(2) : '', i.d || '',
        i.subtotal != null ? '£' + Number(i.subtotal).toFixed(2) : '',
      ]);
      y = dataTable(doc, ['Labour', 'Qty', 'Unit', 'D', 'Sub Total'], rows, LP_RATIOS, y, checkBreak);
    }

    // Parts table
    if (data.parts && data.parts.length > 0) {
      const rows = data.parts.map((i: any) => [
        i.description, String(i.qty ?? ''),
        i.unit != null ? '£' + Number(i.unit).toFixed(2) : '', i.d || '',
        i.subtotal != null ? '£' + Number(i.subtotal).toFixed(2) : '',
      ]);
      y = dataTable(doc, ['Parts', 'Qty', 'Unit', 'D', 'Sub Total'], rows, LP_RATIOS, y, checkBreak);
    }
    y += 7;

    // T&C + Totals footer
    tcAndTotals(doc, data.totals, y, 'Total', 0.50, checkBreak);
  };

  // Customer copy, then an office copy — unless the caller only wants the customer's copy
  // (e.g. the history bundle the customer receives).
  copyLabel = opts.customerCopyOnly ? '' : 'Customer Copy'; renderCopy();
  if (!opts.customerCopyOnly) {
    doc.addPage();
    copyLabel = 'Office Copy'; renderCopy();
  }

  const buf = await finish();
  return { content: buf.toString('base64'), filename: `${data.invoice?.number || 'Invoice'}.pdf` };
}

// ═══════════════════════════════════════════════════════════════
// ESTIMATE
// ═══════════════════════════════════════════════════════════════

export async function generateEstimatePDF(data: any): Promise<{ content: string; filename: string }> {
  const { doc, finish } = makePDF();
  let y = M;
  let copyLabel = '';

  const fullHeader = (): number => {
    y = M;
    if (copyLabel) doc.font('Helvetica').fontSize(7).fillColor('#999999').text(copyLabel.toUpperCase(), M, 16, { width: PW - 2 * M, align: 'right' });
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

  // Renders one full estimate; called twice (customer + office copy).
  const renderCopy = () => {
    y = fullHeader();

    // Vehicle table
    y = checkBreak(ROW_H * 4);
    y = vehicleTable(doc, data.vehicle, y);
    y += 14;

    // Work description (title + lines) — width-wrapped so long text never overwrites
    y = workBlock(doc, data.work_title, data.work_items, y, fullHeader);
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
        i.unit != null ? '£' + Number(i.unit).toFixed(2) : '', i.d || '',
        i.subtotal != null ? '£' + Number(i.subtotal).toFixed(2) : '',
      ]);
      y = dataTable(doc, ['Labour', 'Qty', 'Unit', 'D', 'Sub Total'], rows, LP_RATIOS, y, checkBreak);
    }

    // Parts table
    if (data.parts && data.parts.length > 0) {
      const rows = data.parts.map((i: any) => [
        i.description, String(i.qty ?? ''),
        i.unit != null ? '£' + Number(i.unit).toFixed(2) : '', i.d || '',
        i.subtotal != null ? '£' + Number(i.subtotal).toFixed(2) : '',
      ]);
      y = dataTable(doc, ['Parts', 'Qty', 'Unit', 'D', 'Sub Total'], rows, LP_RATIOS, y, checkBreak);
    }
    y += 7;

    // T&C + Totals
    tcAndTotals(doc, data.totals, y, 'Estimate Total', 0.55, checkBreak);
  };

  // Always print two copies — one for the customer, one for the office.
  copyLabel = 'Customer Copy'; renderCopy();
  doc.addPage();
  copyLabel = 'Office Copy'; renderCopy();

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
    doc.font('Helvetica').fontSize(20).fillColor('black');
    doc.text('Job Sheet', 0, y, { width: PW, align: 'center' });
    y += 22;

    // Customer (left)
    doc.font('Helvetica').fontSize(10);
    doc.text(data.customer.name, M, y);
    let cy = y + 14;
    for (const line of data.customer.address_lines || []) {
      doc.text(line, M, cy); cy += 14;
    }
    const jsPhones = Array.isArray(data.customer.phones) ? data.customer.phones : [];
    if (jsPhones.length) {
      for (const p of jsPhones) {
        doc.text(p.label ? `${p.label}: ${p.value}` : p.value, M, cy); cy += 14;
      }
    } else if (data.customer.mobile) {
      doc.text(`Mobile: ${data.customer.mobile}`, M, cy); cy += 14;
    } else if (data.customer.tel) {
      doc.text(`Tel: ${data.customer.tel}`, M, cy); cy += 14;
    }

    // Document details (right)
    const dx = 340;
    const rw = PW - M - dx;
    const d = data.doc;
    doc.font('Helvetica').fontSize(12);
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
  y += 12;

  // Acceptable engine-oil grades — printed prominently so the mechanic can see every grade the
  // engine takes (e.g. 5W-30 / 0W-20 / 0W-30) and pick the right one, not just the preferred.
  const oilGrades: string[] = Array.isArray(data.vehicle?.oil_grades) ? data.vehicle.oil_grades : [];
  if (oilGrades.length > 1) {
    const pref: string[] = Array.isArray(data.vehicle?.oil_preferred) ? data.vehicle.oil_preferred : [];
    const cap = data.vehicle?.oil_capacity ? `   ·   Capacity ${data.vehicle.oil_capacity}` : '';
    const line = `Engine Oil — acceptable grades:   ${oilGrades.map((g) => pref.includes(g) ? `${g} (preferred)` : g).join('     ')}${cap}`;
    doc.font('Helvetica-Bold').fontSize(9.5);
    const h = doc.heightOfString(line, { width: CW - 12 }) + 8;
    y = checkBreak(h + 6);
    doc.save().rect(M, y, CW, h).fill('#fff7e6').restore();
    doc.save().rect(M, y, CW, h).lineWidth(0.8).stroke('#d9a441').restore();
    doc.fillColor('black').font('Helvetica-Bold').fontSize(9.5).text(line, M + 6, y + 4, { width: CW - 12 });
    y += h + 10;
  }

  // The work to do is now listed as tick-off rows in the Service / Parts table below
  // (so the mechanic can mark each off as completed), rather than as a plain text block.

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

  const blankRowH = 16;
  let cx = M;
  // A pre-filled, tick-off table: a header, then one row per item (height grows to fit the
  // text), then a few blank rows for anything added on the job. cols = [main, mid?, Done].
  const tickTable = (headers: string[], cols: number[], rows: { main: string; mid?: string }[], blanks: number) => {
    y = checkBreak(ROW_H + blankRowH);
    filledCell(doc, M, y, CW, ROW_H, HEADER_BG);
    cellDividers(doc, M, y, ROW_H, cols);
    doc.font('Helvetica').fontSize(8.5).fillColor('black');
    cx = M;
    headers.forEach((h, i) => { doc.text(h, cx + 6, y + 6, { width: cols[i] - 12, align: 'center' }); cx += cols[i]; });
    y += ROW_H;
    for (const row of rows) {
      doc.font('Helvetica').fontSize(8.5).fillColor('black');
      const rowH = Math.max(blankRowH, doc.heightOfString(row.main, { width: cols[0] - 12 }) + 6);
      y = checkBreak(rowH);
      cx = M;
      for (const w of cols) { doc.save().rect(cx, y, w, rowH).stroke(BORDER).restore(); cx += w; }
      doc.text(row.main, M + 6, y + 4, { width: cols[0] - 12 });
      if (row.mid && cols.length === 3) doc.text(row.mid, M + cols[0] + 6, y + 4, { width: cols[1] - 12 });
      y += rowH;
    }
    for (let r = 0; r < blanks; r++) {
      y = checkBreak(blankRowH);
      cx = M;
      for (const w of cols) { doc.save().rect(cx, y, w, blankRowH).stroke(BORDER).restore(); cx += w; }
      y += blankRowH;
    }
  };

  // ── Service / Labour table ── the work to do (job description), tick-off, plus blank rows
  // for the mechanic to log labour (Tech / Qty / Done).
  const services = (data.work_description || [])
    .map((s: string) => String(s || '').replace(/^[\s•–—-]+/, '').trim())
    .filter(Boolean)
    .map((s: string) => ({ main: s }));
  const lcw = [0.64, 0.12, 0.12, 0.12].map((r) => CW * r);
  tickTable(['Service / Labour', 'Tech', 'Qty', 'Done'], lcw, services, 5);
  y += 5;

  // ── Parts table ── the actual parts on the job, tick-off, plus blank rows for extras.
  const partRows = ((data.parts || []) as any[]).map((p) => ({
    main: `${p.quantity && Number(p.quantity) !== 1 ? `${Number(p.quantity)} x ` : ''}${p.description || ''}`.trim(),
    mid: p.partNumber ? String(p.partNumber) : '',
  }));
  const pcw = [0.64, 0.24, 0.12].map((r) => CW * r);
  tickTable(['Parts', 'Part No.', 'Done'], pcw, partRows, 4);
  y += 4;

  // Car diagram
  const diagram = findImg('car_diagram.png');
  if (diagram) {
    const dw = CW * 0.22;
    const dh = dw * (274 / 355);
    y = checkBreak(dh + 70);
    doc.image(diagram, M, y, { width: dw });
    y += dh + 4;
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
  for (const line of tcLines) { doc.text(line, M, y); y += 8.2; }
  doc.font('Helvetica').fontSize(7);
  doc.text(TC_BOLD, M, y); y += 11;
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

// ═══════════════════════════════════════════════════════════════
// PROFESSIONAL SERVICE HISTORY REPORT
// ═══════════════════════════════════════════════════════════════

export async function generateServiceHistoryPDF(data: any): Promise<{ content: string; filename: string }> {
  const { doc, finish } = makePDF();
  // We paginate manually (checkBreak). Drop pdfkit's bottom margin so a near-bottom draw
  // (e.g. the page footer at PH-30) never triggers an automatic page break — that was
  // inserting a phantom footer-only page after every real page.
  doc.page.margins.bottom = 0;
  const PAGE_M = 40; // 40pt Margins
  const CW = PW - PAGE_M * 2; // Content Width
  const BRAND_BLUE = '#0a2342';
  const LIGHT_GREY = '#f4f6f8';
  const MID_GREY = '#d1d5db';
  const DARK_TEXT = '#1f2937';
  
  let y = PAGE_M;
  let pageNum = 1;

  // Formatting helpers specific to the premium report
  const addDividerLine = (yPos: number, thickness = 1, color = MID_GREY) => {
    doc.save().strokeColor(color).lineWidth(thickness).moveTo(PAGE_M, yPos).lineTo(PW - PAGE_M, yPos).stroke().restore();
  };

  const pageHeader = (): number => {
    y = PAGE_M;

    // Logo & Dealer Name (Right Aligned or Centered?)
    // Let's do a crisp Side-by-Side header
    const logo = findImg('eli_logo_white.png'); // Wait, white logo?
    // In the earlier code: 'eli_logo_white.png' was used, likely meant to be put on a colored background or it's a dark logo.
    // If it's a white logo, it won't show on a white PDF background!
    // I'll assume they have a dark logo, or I'll just write the text beautifully.
    
    // Left: Dealership Info
    doc.font('Helvetica').fontSize(22).fillColor(BRAND_BLUE);
    doc.text((data.company_name || 'ELI MOTORS LIMITED').toUpperCase(), PAGE_M, y);
    doc.font('Helvetica').fontSize(9).fillColor('#6b7280');
    doc.text(data.address || '49 VICTORIA ROAD, HENDON, LONDON, NW4 2RP', PAGE_M, y + 26);
    doc.text(`${data.phone || '020 8203 6449'}  |  ${data.website || 'www.elimotors.co.uk'}`, PAGE_M, y + 38);

    // Right: "CERTIFICATE OF MAINTENANCE"
    doc.font('Helvetica').fontSize(14).fillColor(BRAND_BLUE);
    doc.text('OFFICIAL MAINTENANCE RECORD', PAGE_M, y + 4, { width: CW, align: 'right' });
    doc.font('Helvetica').fontSize(8).fillColor('#9ca3af');
    const now = new Date();
    doc.text(`Generated: ${now.toLocaleDateString('en-GB')} at ${now.toLocaleTimeString('en-GB', { hour: '2-digit', minute:'2-digit' })}`, PAGE_M, y + 20, { width: CW, align: 'right' });
    if (pageNum > 1) {
      doc.text(`Page — ${pageNum}`, PAGE_M, y + 32, { width: CW, align: 'right' });
    }

    y += 65;
    addDividerLine(y, 2, BRAND_BLUE);
    y += 20;

    // Vehicle Detail Hero Block (Only on Page 1)
    if (pageNum === 1) {
      doc.save().roundedRect(PAGE_M, y, CW, 80, 4).fillAndStroke(LIGHT_GREY, MID_GREY).restore();
      
      const vMake = (data.vehicle_make || '').toUpperCase();
      const vModel = (data.vehicle_model || '').toUpperCase();
      const vReg = (data.vehicle_reg || '').toUpperCase();

      doc.font('Helvetica').fontSize(10).fillColor('#6b7280');
      doc.text('VEHICLE IDENTITY', PAGE_M + 15, y + 15);
      
      doc.font('Helvetica').fontSize(24).fillColor(BRAND_BLUE);
      doc.text(`${vMake} ${vModel}`, PAGE_M + 15, y + 30);
      
      doc.font('Helvetica').fontSize(14).fillColor('#4b5563');
      doc.text(`REGISTRATION: ${vReg}`, PAGE_M + 15, y + 55);

      // Financial Summary in the box
      doc.font('Helvetica').fontSize(10).fillColor('#6b7280');
      doc.text('TOTAL SERVICE VISITS', PAGE_M, y + 15, { width: CW - 20, align: 'right' });
      doc.font('Helvetica').fontSize(16).fillColor(BRAND_BLUE);
      doc.text(String(data.total_records || '0'), PAGE_M, y + 28, { width: CW - 20, align: 'right' });
      
      doc.font('Helvetica').fontSize(10).fillColor('#6b7280');
      doc.text('MAINTENANCE INVESTMENT', PAGE_M, y + 50, { width: CW - 20, align: 'right' });
      doc.font('Helvetica').fontSize(12).fillColor(BRAND_BLUE);
      doc.text(data.cumulative_spend || '£0.00', PAGE_M, y + 63, { width: CW - 20, align: 'right' });

      y += 105;
      
      doc.font('Helvetica').fontSize(14).fillColor(DARK_TEXT);
      doc.text('Detailed Service History', PAGE_M, y);
      y += 20;
    }

    return y;
  };

  const checkBreak = (needed: number): number => {
    if (y + needed > PH - 50) {
      // Add footer to current page before breaking
      doc.font('Helvetica').fontSize(7).fillColor('#9ca3af');
      doc.text('Certified by Eli Motors Management Suite', PAGE_M, PH - 30, { width: CW, align: 'center', lineBreak: false });
      doc.addPage();
      doc.page.margins.bottom = 0; // keep auto-pagination off on the new page too
      pageNum++;
      y = pageHeader();
    }
    return y;
  };

  y = pageHeader();
  const entries = data.entries || [];

  if (entries.length === 0) {
    doc.font('Helvetica-Oblique').fontSize(10).fillColor('#6b7280');
    doc.text('No maintenance records found for this vehicle on the digital database.', PAGE_M, y + 20, { width: CW, align: 'center' });
  }

  // \u2500\u2500 A one-row-per-visit overview table (date/ref/mileage/work/total). This is the ONLY
  //    summary layout now \u2014 it's always cleaner as a scannable table than the older "full
  //    itemised" per-visit breakdown was, whether or not full invoice copies also follow it. \u2500\u2500
  {
    const colRef = PAGE_M + 82;
    const colMile = PAGE_M + 140;
    const colWork = PAGE_M + 208;
    const workW = (PW - PAGE_M - 74) - colWork;
    const rowH = 17;

    doc.save().rect(PAGE_M, y, CW, 18).fill(BRAND_BLUE).restore();
    doc.font('Helvetica-Bold').fontSize(8.5).fillColor('#ffffff');
    doc.text('Date', PAGE_M + 6, y + 5);
    doc.text('Ref', colRef, y + 5);
    doc.text('Mileage', colMile, y + 5);
    doc.text('Work carried out', colWork, y + 5);
    doc.text('Total', PAGE_M, y + 5, { width: CW - 6, align: 'right' });
    y += 18;

    entries.forEach((e: any, i: number) => {
      y = checkBreak(rowH + 4);
      if (i % 2 === 1) { doc.save().rect(PAGE_M, y, CW, rowH).fill('#f4f6f8').restore(); }
      doc.font('Helvetica').fontSize(8.5).fillColor('#1f2937');
      const dp = String(e.date || '').split(' ');
      const shortDate = dp.length === 3 ? `${dp[0]} ${dp[1].slice(0, 3)} ${dp[2]}` : (e.date || '');
      doc.text(shortDate, PAGE_M + 6, y + 4, { width: 74, lineBreak: false });
      doc.text(e.doc_ref || '', colRef, y + 4, { width: 56, lineBreak: false });
      doc.text(e.mileage || '', colMile, y + 4, { width: 64, lineBreak: false });
      doc.text(e.title || 'Service', colWork, y + 4, { width: workW, height: 11, ellipsis: true, lineBreak: false });
      doc.font('Helvetica-Bold').text(e.total || '', PAGE_M, y + 4, { width: CW - 6, align: 'right' });
      doc.save().strokeColor('#e5e7eb').lineWidth(0.5).moveTo(PAGE_M, y + rowH).lineTo(PW - PAGE_M, y + rowH).stroke().restore();
      y += rowH;
    });

    y += 4;
    doc.save().strokeColor(MID_GREY).lineWidth(1).moveTo(PAGE_M, y).lineTo(PW - PAGE_M, y).stroke().restore();
    y += 8;
    doc.font('Helvetica-Bold').fontSize(10).fillColor(BRAND_BLUE);
    doc.text('Total invoiced', colWork - 60, y, { width: workW + 60, align: 'right' });
    doc.text(data.cumulative_spend || '', PAGE_M, y, { width: CW - 6, align: 'right' });
    y += 18;
    if (data.invoicesFollow) {
      doc.font('Helvetica-Oblique').fontSize(8.5).fillColor('#6b7280');
      doc.text('A full copy of each invoice is attached on the following pages.', PAGE_M, y, { width: CW });
    }
  }

  // Final Footer string on the last page
  doc.font('Helvetica').fontSize(7).fillColor('#9ca3af');
  doc.text('Certified by Eli Motors Management Suite — Official Digital Record', PAGE_M, PH - 30, { width: CW, align: 'center', lineBreak: false });

  const buf = await finish();
  return { content: buf.toString('base64'), filename: `Vehicle_History_${data.vehicle_reg || 'Report'}.pdf` };
}
