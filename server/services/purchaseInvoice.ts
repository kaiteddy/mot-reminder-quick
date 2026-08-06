/**
 * Reading a car purchase invoice so a bought car can be logged from the PDF rather than typed.
 *
 * Auction invoices are generated PDFs with a real text layer, so the text comes straight out of
 * the file's compressed streams — no OCR, no PDF library, no AI. Deterministic parsing also
 * means a change in the supplier's layout shows up as "couldn't read this" rather than as a
 * plausible-looking wrong number in the margin figures.
 */
import zlib from "zlib";

export type ParsedFees = Record<string, number>;

export type ParsedPurchaseInvoice = {
  supplier: "BCA" | null;
  branch?: string | null;
  invoiceNumber?: string | null;
  documentDate?: string | null;   // as printed, dd/mm/yy
  accountRef?: string | null;
  lotRef?: string | null;

  registration?: string | null;
  make?: string | null;
  model?: string | null;
  variant?: string | null;
  colour?: string | null;
  vin?: string | null;
  engineNumber?: string | null;

  mileage?: number | null;
  mileageWarranted?: boolean;
  firstRegistered?: string | null;  // dd/mm/yy as printed
  motExpiry?: string | null;        // dd/mm/yy as printed

  marginScheme?: boolean;
  purchaseCost?: number | null;
  fees?: ParsedFees;
  feesTotal?: number;
  totalDue?: number | null;
  /** Does cost + fees equal the invoice total? A mismatch means something wasn't read. */
  reconciles?: boolean;

  warnings: string[];
};

/**
 * Pull the visible text out of a PDF. Every string is inside a content stream, usually
 * Flate-compressed, written as `(text) Tj`. Good enough for machine-generated invoices; it
 * returns nothing useful for a scan, which the caller reports rather than guessing at.
 */
export function extractPdfText(buf: Buffer): string[] {
  const runs: string[] = [];
  const marker = Buffer.from("stream");
  const endMarker = Buffer.from("endstream");

  let i = 0;
  while (i < buf.length) {
    const start = buf.indexOf(marker, i);
    if (start < 0) break;
    const end = buf.indexOf(endMarker, start);
    if (end < 0) break;

    // skip the EOL that must follow the `stream` keyword
    let s = start + marker.length;
    if (buf[s] === 0x0d) s++;
    if (buf[s] === 0x0a) s++;

    let chunk = buf.subarray(s, end);
    try { chunk = zlib.inflateSync(chunk); } catch { /* already plain, or not text */ }

    const text = chunk.toString("latin1");
    const re = /\((?:[^()\\]|\\.)*\)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      const val = m[0].slice(1, -1).replace(/\\([()\\])/g, "$1").trim();
      if (val) runs.push(val);
    }
    i = end + endMarker.length;
  }
  return runs;
}

const MONEY = /^[\d,]+\.\d{2}$/;
const REG = /\b([A-Z]{2}\d{2}\s?[A-Z]{3})\b/;
const COLOURS = ["SILVER", "BLACK", "WHITE", "BLUE", "RED", "GREY", "GRAY", "GREEN", "YELLOW", "ORANGE", "BROWN", "BEIGE", "GOLD", "PURPLE", "BRONZE"];

/** Is this a BCA invoice? */
function isBca(runs: string[]): boolean {
  return runs.some((r) => /BRITISH CAR AUCTIONS/i.test(r));
}

/**
 * Parse a BCA purchase invoice.
 *
 * The money is a positional column rather than sitting beside its label: all the PRICE values
 * come first, then all the VAT values, then the TOTAL column. So amounts are matched to the
 * vehicle and each fee by ORDER, and the result is only trusted if cost + fees equals the
 * printed total.
 */
export function parseBcaInvoice(runs: string[]): ParsedPurchaseInvoice {
  const warnings: string[] = [];
  const amounts = runs.filter((r) => MONEY.test(r)).map((r) => Number(r.replace(/,/g, "")));

  const vehLine = runs.find((r) => REG.test(r) && !/ODOMETER/i.test(r)) || "";
  const specLine = runs.find((r) => /ODOMETER/i.test(r)) || "";
  const idLine = runs.find((r) => /\bCH:/.test(r)) || "";

  const veh = vehLine.match(/^(\S+)\s+([A-Z]{2}\d{2}\s?[A-Z]{3})\s+(\S+)\s+(\S+)\s+(.*)$/);
  const [, lotRef, registration, make, model, rest] = veh ?? [];
  const colour = COLOURS.find((c) => (rest || "").toUpperCase().includes(c)) ?? null;
  // strip the trailing auction flags (grade, ASSURED, colour) off the trim description
  const variant = (rest || "").replace(/\s+\d+\s+ASSURED.*$/i, "").replace(new RegExp(`\\s*${colour}\\s*$`, "i"), "").trim() || null;

  // fee rows, ignoring the small print about late payment and storage
  const feeLabels = runs.filter((r) => /(Fee|Charge)/i.test(r) && !/Late payment|Storage|VAT\/day/i.test(r));
  const prices = amounts.slice(0, 1 + feeLabels.length);
  const purchaseCost = prices[0] ?? null;

  const fees: ParsedFees = {};
  feeLabels.forEach((label, idx) => {
    const amt = prices[idx + 1];
    if (amt != null) fees[label.replace(/\s*\(Business\)/i, "").trim()] = amt;
  });
  const feesTotal = Object.values(fees).reduce((a, b) => a + b, 0);

  const totalDue = amounts.length ? amounts[amounts.length - 1] : null;
  const reconciles = purchaseCost != null && totalDue != null
    && Math.abs(purchaseCost + feesTotal - totalDue) < 0.005;

  if (!registration) warnings.push("Couldn't find a registration on this invoice.");
  if (purchaseCost == null) warnings.push("Couldn't find the purchase price.");
  if (!reconciles) warnings.push("Purchase price plus fees doesn't equal the invoice total — check the figures before saving.");

  const grab = (re: RegExp, line: string) => line.match(re)?.[1] ?? null;

  return {
    supplier: "BCA",
    branch: runs.find((r) => /^BCA\s+\w/.test(r)) ?? null,
    invoiceNumber: runs.find((r) => /^INVOICE\s+\S+/.test(r))?.split(/\s+/).pop() ?? null,
    documentDate: runs.find((r) => /^\d{1,2}\/\d{2}\/\d{2}$/.test(r)) ?? null,
    accountRef: runs.find((r) => /^[A-Z]\d+\/[A-Z]+$/.test(r)) ?? null,
    lotRef: lotRef ?? null,
    registration: registration ? registration.replace(/\s+/g, " ").toUpperCase() : null,
    make: make ?? null,
    model: model ?? null,
    variant,
    colour,
    vin: grab(/CH:([A-Z0-9]+)/, idLine),
    engineNumber: grab(/EN:([A-Z0-9]+)/, idLine),
    mileage: specLine.match(/ODOMETER:(\d+)/) ? Number(specLine.match(/ODOMETER:(\d+)/)![1]) : null,
    mileageWarranted: /WARRANTED/i.test(specLine),
    firstRegistered: grab(/1ST REG:(\d{2}\/\d{2}\/\d{2,4})/, specLine),
    motExpiry: grab(/MOT:(\d{2}\/\d{2}\/\d{2,4})/, specLine),
    marginScheme: /MARGIN/i.test(idLine) || runs.some((r) => /Margin Scheme/i.test(r)),
    purchaseCost,
    fees,
    feesTotal,
    totalDue,
    reconciles,
    warnings,
  };
}

/** Read a purchase invoice PDF. Recognises BCA; anything else is reported, not guessed at. */
export function parsePurchaseInvoice(buf: Buffer): ParsedPurchaseInvoice {
  const runs = extractPdfText(buf);
  if (!runs.length) {
    return { supplier: null, fees: {}, warnings: ["No text found in this PDF — it may be a scan, which can't be read automatically."] };
  }
  if (!isBca(runs)) {
    return { supplier: null, fees: {}, warnings: ["This doesn't look like a BCA invoice. Only BCA is recognised so far — send one over and it can be added."] };
  }
  return parseBcaInvoice(runs);
}

/** dd/mm/yy (or yyyy) as printed on the invoice -> Date. Two-digit years are 2000s. */
export function ukDateToDate(s?: string | null): Date | null {
  if (!s) return null;
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (!m) return null;
  const [, d, mo, y] = m;
  const year = y.length === 2 ? 2000 + Number(y) : Number(y);
  const dt = new Date(Date.UTC(year, Number(mo) - 1, Number(d)));
  return isNaN(dt.getTime()) ? null : dt;
}
