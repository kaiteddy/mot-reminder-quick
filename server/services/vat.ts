/** VAT — each quarter the way the return is filed, and what breaks the rules.
 *
 *  Ravi files one workshop line per month from a sales summary, car sales at full price
 *  zero-rated with the margin's VAT as a journal, and the bank feed coded line by line. This
 *  gives the same shape from the web app's own documents, so the figures he is sent can be
 *  compared box for box. Once a quarter is recorded as filed it keeps a snapshot, so anything
 *  that later lands in, leaves, or changes inside a filed period shows up as an adjustment for
 *  the next return instead of drifting silently — that is how the Harris excess went unfiled.
 *
 *  Rules the exceptions are judged by: an MOT is always zero-rated; everything else is 20%
 *  unless a line says otherwise; the tax point is the web app's issue date; a draft is not a
 *  sale; an insurance excess carries the VAT for the whole repair.
 */
import { sql } from "drizzle-orm";
import { getDb, ukInstant } from "../db";
import { getReconciliation } from "./expenditure";

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const num = (v: any) => (v == null ? 0 : Number(v) || 0);
/** Every document timestamp is a UTC instant; the range and the month buckets are UK dates.
 *  Passed as text so the driver's own timezone never gets a say. */
const naiveUtc = (wall: string) => ukInstant(wall).toISOString().replace("T", " ").replace("Z", "");
const UK_DATE = (col: string) => sql.raw(`to_char((${col} AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/London', 'YYYY-MM-DD')`);
const UK_MONTH = (col: string) => sql.raw(`to_char((${col} AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/London', 'YYYY-MM')`);

export type VatDoc = {
  id: number; docNo: string | null; docType: string; status: string | null; date: string | null; month: string;
  created: string | null; customer: string | null; registration: string | null; source: "web" | "ga4";
  ga4Number: string | null; poolStatus: string | null; motStatus: string | null;
  /** Issued here and present in the old system too — a filled pool entry, or a GA4-sourced copy under the same number. */
  inGa4: boolean;
  /** What the invoice's own lines add up to in VAT, when it has lines. */
  lineCount: number; lineTax: number;
  net: number; tax: number; gross: number; motNet: number; motTax: number;
};
export type VatException = VatDoc & { kind: "motVat" | "high" | "low" | "excess" | "duplicate"; expectedTax: number; reason: string };
export type VatDraft = { id: number; docNo: string | null; docType: string; status: string | null; created: string | null; ageDays: number; customer: string | null; registration: string | null; gross: number; tax: number; source: "web" | "ga4" };

function monthsBetween(from: string, to: string): string[] {
  const out: string[] = [];
  let [y, m] = from.slice(0, 7).split("-").map(Number);
  const end = to.slice(0, 7);
  for (let i = 0; i < 36; i++) {
    const key = `${y}-${String(m).padStart(2, "0")}`;
    out.push(key);
    if (key >= end) break;
    m++; if (m > 12) { m = 1; y++; }
  }
  return out;
}
export const monthLabel = (m: string) => new Date(Number(m.slice(0, 4)), Number(m.slice(5, 7)) - 1, 1).toLocaleDateString("en-GB", { month: "short", year: "numeric" });

async function loadDocs(db: any, from: string, to: string): Promise<VatDoc[]> {
  const rows: any = await db.execute(sql`
    SELECT sh.id, sh."docNo", sh."docType", sh."docStatus" AS status, sh."externalId", sh."ga4Number",
      ${UK_DATE('sh."dateIssued"')} AS date, ${UK_MONTH('sh."dateIssued"')} AS month,
      to_char(sh."createdAt", 'YYYY-MM-DD') AS created,
      COALESCE(sh."totalNet", 0) AS net, COALESCE(sh."totalTax", 0) AS tax, COALESCE(sh."totalGross", 0) AS gross,
      CASE WHEN COALESCE(sh."subMotNet", 0) > 0 THEN sh."subMotNet" ELSE COALESCE(li.net, 0) END AS mot_net,
      CASE WHEN COALESCE(sh."subMotNet", 0) > 0 THEN COALESCE(sh."subMotTax", 0) ELSE COALESCE(li.tax, 0) END AS mot_tax,
      sh.registration, c.name AS customer, p.status AS pool_status, NULLIF(TRIM(COALESCE(sh."motStatus", '')), '') AS mot_status,
      COALESCE(la.n, 0) AS line_count, COALESCE(la.tax, 0) AS line_tax,
      EXISTS (SELECT 1 FROM "serviceHistory" t WHERE t."docNo" = sh."ga4Number" AND t.id <> sh.id
                AND (t."externalId" IS NULL OR t."externalId" NOT LIKE 'WEB-%')) AS ga4_twin
    FROM "serviceHistory" sh
    LEFT JOIN (SELECT "documentId", SUM(COALESCE("subNet", 0)) AS net, SUM(COALESCE("taxAmount", 0)) AS tax
               FROM "serviceLineItems" WHERE "itemType" = 'MOT' GROUP BY "documentId") li ON li."documentId" = sh.id
    LEFT JOIN (SELECT "documentId", COUNT(*)::int AS n, SUM(COALESCE("taxAmount", 0)) AS tax
               FROM "serviceLineItems" GROUP BY "documentId") la ON la."documentId" = sh.id
    LEFT JOIN customers c ON c.id = sh."customerId"
    LEFT JOIN LATERAL (SELECT status FROM "ga4NumberPool" WHERE "claimedByDocId" = sh.id ORDER BY id DESC LIMIT 1) p ON TRUE
    WHERE sh."docType" IN ('SI', 'XS', 'CR')
      AND COALESCE(sh."docStatus", '') <> '3' AND LOWER(COALESCE(sh."docStatus", '')) <> 'void'
      AND sh."dateIssued" >= ${naiveUtc(from + "T00:00:00")}::timestamp
      AND sh."dateIssued" <= ${naiveUtc(to + "T23:59:59.999")}::timestamp
    ORDER BY sh."dateIssued", sh.id`);
  return (rows.rows || []).map((r: any): VatDoc => {
    const sign = r.docType === "CR" ? -1 : 1;
    return {
      id: r.id, docNo: r.docNo, docType: r.docType, status: r.status, date: r.date, month: r.month, created: r.created,
      customer: r.customer, registration: r.registration,
      source: String(r.externalId || "").startsWith("WEB-") ? "web" : "ga4",
      ga4Number: r.ga4Number, poolStatus: r.pool_status, motStatus: r.mot_status,
      inGa4: r.pool_status === "filled" || !!r.ga4_twin,
      lineCount: num(r.line_count), lineTax: sign * num(r.line_tax),
      net: sign * num(r.net), tax: sign * num(r.tax), gross: sign * num(r.gross), motNet: sign * num(r.mot_net), motTax: sign * num(r.mot_tax),
    };
  });
}

async function loadDrafts(db: any, from: string, to: string): Promise<VatDraft[]> {
  const rows: any = await db.execute(sql`
    SELECT sh.id, sh."docNo", sh."docType", sh."docStatus" AS status, sh."externalId",
      ${UK_DATE('sh."dateCreated"')} AS created,
      GREATEST(0, (CURRENT_DATE - sh."dateCreated"::date))::int AS age_days,
      COALESCE(sh."totalGross", 0) AS gross, COALESCE(sh."totalTax", 0) AS tax, sh.registration, c.name AS customer
    FROM "serviceHistory" sh LEFT JOIN customers c ON c.id = sh."customerId"
    WHERE sh."docType" IN ('SI', 'XS', 'CR') AND sh."dateIssued" IS NULL
      AND COALESCE(sh."docStatus", '') <> '3' AND LOWER(COALESCE(sh."docStatus", '')) <> 'void'
      -- GA4's copy of an invoice the web app has already issued is a mirror, not unbilled work:
      -- the pool worker fills it days later and the retire step reconciles the pair overnight.
      AND NOT (COALESCE(sh."externalId", '') NOT LIKE 'WEB-%' AND sh."docNo" IS NOT NULL
               AND EXISTS (SELECT 1 FROM "serviceHistory" w WHERE w."externalId" LIKE 'WEB-%' AND w."docType" = 'SI'
                           AND w."ga4Number" = sh."docNo" AND w."dateIssued" IS NOT NULL))
      AND sh."dateCreated" >= ${naiveUtc(from + "T00:00:00")}::timestamp
      AND sh."dateCreated" <= ${naiveUtc(to + "T23:59:59.999")}::timestamp
    ORDER BY sh."dateCreated"`);
  return (rows.rows || []).map((r: any): VatDraft => ({
    id: r.id, docNo: r.docNo, docType: r.docType, status: r.status, created: r.created, ageDays: num(r.age_days),
    customer: r.customer, registration: r.registration, gross: num(r.gross), tax: num(r.tax),
    source: String(r.externalId || "").startsWith("WEB-") ? "web" : "ga4",
  }));
}

/** Sold cars by sale date. Margin scheme: output VAT is a sixth of the vehicle margin; the full
 *  selling price still counts as a zero-rated sale for Box 6. A deal flagged stdRated pays VAT
 *  on the whole price instead. Same arithmetic as the Profit & Cashbook page. */
async function loadCars(db: any, from: string, to: string) {
  const rows: any = await db.execute(sql`
    SELECT d.id, d.registration, d."saleDate"::date::text AS sale_date, COALESCE(d."salePrice", 0) AS sale_price,
      CASE WHEN COALESCE(d."stdRated", 0) = 1 THEN COALESCE(d."salePrice", 0)
           ELSE GREATEST(COALESCE(d."salePrice", 0) - COALESCE(d."purchaseCost", 0), 0) END AS base
    FROM "carDeals" d
    WHERE d.status = 'sold' AND d."saleDate"::date >= ${from}::date AND d."saleDate"::date <= ${to}::date
    ORDER BY d."saleDate", d.id`);
  const cars = (rows.rows || []).map((r: any) => ({ id: r.id, registration: r.registration, saleDate: r.sale_date, salePrice: num(r.sale_price), base: num(r.base), vat: round2(num(r.base) / 6) }));
  return {
    cars,
    count: cars.length,
    sales: round2(cars.reduce((s: number, c: any) => s + c.salePrice, 0)),
    base: round2(cars.reduce((s: number, c: any) => s + c.base, 0)),
    vat: round2(cars.reduce((s: number, c: any) => s + c.vat, 0)),
  };
}

/** The standard/zero-rated split off a document's own totals — the same rule the Sales Summary
 *  uses, so the two agree: whatever the VAT covers at 20% is standard-rated, the rest is zero. */
function split(doc: { net: number; tax: number }) {
  const std = doc.tax !== 0 ? Math.min(Math.abs(doc.net), Math.abs(round2(doc.tax * 5))) * Math.sign(doc.net || 1) : 0;
  return { stdNet: round2(std), zeroNet: round2(doc.net - std) };
}

function judge(d: VatDoc, excessByReg: Map<string, VatDoc[]>): VatException | null {
  // 0. An insurer's invoice: the repair's VAT is charged on the customer's separate excess invoice,
  //    so its own VAT is nil by design while its lines still carry the full 20%. Point at the excess.
  if (d.docType === "SI" && d.tax === 0 && d.lineCount > 0 && d.lineTax > 2) {
    const reg = String(d.registration || "").replace(/\s+/g, "").toUpperCase();
    const twin = (excessByReg.get(reg) || []).find((x) => Math.abs(x.tax - d.lineTax) <= 2);
    if (twin) return null;
  }
  // 1. The invoice's own lines are the evidence. When the stored totals disagree with them, the
  //    totals were rewritten after the fact — the nightly GA4 import did this to 24 invoices in
  //    May–July 2026 (net = gross ÷ 1.2, so the MOT was taxed) — and the lines still hold the truth.
  //    Lines round VAT per line and the totals round once, so they drift by up to about a pound
  //    on an ordinary invoice; only a bigger gap is a rewrite. A taxed £45 MOT shows as £7.50
  //    (£8.33 at £50), plus that drift.
  if (d.lineCount > 0 && Math.abs(d.tax - d.lineTax) > 2) {
    const diff = round2(d.tax - d.lineTax);
    const motLike = !!d.motStatus && Math.abs(diff) >= 7 && Math.abs(diff) <= 9.5;
    return motLike
      ? { ...d, kind: "motVat", expectedTax: d.lineTax, reason: `MOT ${d.motStatus!.toLowerCase()}, but the totals tax the fee — the lines carry £${d.lineTax.toFixed(2)} VAT, the invoice says £${d.tax.toFixed(2)}.` }
      : { ...d, kind: diff > 0 ? "high" : "low", expectedTax: d.lineTax, reason: `Totals disagree with the lines — the lines carry £${d.lineTax.toFixed(2)} VAT, the invoice says £${d.tax.toFixed(2)}.` };
  }
  // 2. Otherwise judge the split itself: everything but the MOT at 20%, on the gross the customer
  //    actually paid (gross is the invariant whichever way the totals were built).
  const motGross = d.motNet > 0 ? round2(d.motNet + d.motTax) : 0;
  const expected = round2((d.gross - motGross) / 6);
  const gap = round2(d.tax - expected);
  if (d.docType === "XS") {
    if (Math.abs(gap) <= 0.05) return null;
    return d.tax === 0
      ? { ...d, kind: "excess", expectedTax: expected, reason: `Excess invoiced without VAT — right only if the insurer's invoice carries the VAT for the repair.` }
      : { ...d, kind: "excess", expectedTax: expected, reason: `Insurance excess — £${d.tax.toFixed(2)} VAT charged here on £${d.net.toFixed(2)} of excess. Right when the insurer's invoice carries no VAT; check it doesn't.` };
  }
  if (d.motTax > 0.005) return { ...d, kind: "motVat", expectedTax: expected, reason: `MOT charged with £${d.motTax.toFixed(2)} VAT — an MOT is always zero-rated.` };
  if (Math.abs(gap) <= 0.05) return null;
  if (d.motNet > 0 && Math.abs(gap - round2(motGross / 6)) <= 0.05) return { ...d, kind: "motVat", expectedTax: expected, reason: `MOT recorded zero-rated, but the invoice totals tax it (£${round2(motGross / 6).toFixed(2)} too much VAT).` };
  if (gap > 0) return { ...d, kind: "high", expectedTax: expected, reason: `VAT is £${gap.toFixed(2)} more than 20% of everything but the MOT.` };
  return { ...d, kind: "low", expectedTax: expected, reason: `VAT is £${Math.abs(gap).toFixed(2)} less than 20% of everything but the MOT — zero-rated content, or under-charged.` };
}

type Snapshot = {
  takenAt: string;
  docs: { id: number; docNo: string | null; docType: string; month: string; net: number; tax: number; gross: number }[];
  cars: { id: number; registration: string | null; salePrice: number; base: number }[];
  totals: { vat: number; stdNet: number; zeroNet: number; gross: number; carsVat: number; carsSales: number };
};

let ensured: Promise<void> | null = null;
function ensureTable(db: any) {
  return ensured ??= db.execute(sql`CREATE TABLE IF NOT EXISTS "vatFilings" (
    id SERIAL PRIMARY KEY,
    "periodFrom" DATE NOT NULL, "periodTo" DATE NOT NULL,
    "filedAt" TIMESTAMP NOT NULL DEFAULT NOW(),
    boxes JSONB, notes TEXT, snapshot JSONB NOT NULL,
    "createdAt" TIMESTAMP NOT NULL DEFAULT NOW())`).then(() => undefined);
}

async function assemble(from: string, to: string) {
  const db = await getDb();
  if (!db) throw new Error("no db");
  await ensureTable(db);
  const [docs, drafts, carsInfo] = await Promise.all([loadDocs(db, from, to), loadDrafts(db, from, to), loadCars(db, from, to)]);
  const months = monthsBetween(from, to).map((m) => ({ month: m, label: monthLabel(m), count: 0, credits: 0, stdNet: 0, vat: 0, zeroNet: 0, motNet: 0, motCount: 0, gross: 0, drafts: 0, notInGa4: 0 }));
  const byMonth = Object.fromEntries(months.map((r) => [r.month, r]));
  for (const d of docs) {
    const row = byMonth[d.month]; if (!row) continue;
    const { stdNet, zeroNet } = split(d);
    if (d.docType === "CR") row.credits++; else row.count++;
    row.stdNet = round2(row.stdNet + stdNet); row.vat = round2(row.vat + d.tax); row.zeroNet = round2(row.zeroNet + zeroNet);
    row.motNet = round2(row.motNet + d.motNet); if (d.motNet > 0) row.motCount++;
    row.gross = round2(row.gross + d.gross);
    if (d.source === "web" && !d.inGa4) row.notInGa4++;
  }
  for (const dr of drafts) { const row = byMonth[(dr.created || "").slice(0, 7)]; if (row) row.drafts++; }
  const totals = months.reduce((t, r) => ({
    count: t.count + r.count, credits: t.credits + r.credits, stdNet: round2(t.stdNet + r.stdNet), vat: round2(t.vat + r.vat),
    zeroNet: round2(t.zeroNet + r.zeroNet), motNet: round2(t.motNet + r.motNet), motCount: t.motCount + r.motCount, gross: round2(t.gross + r.gross),
  }), { count: 0, credits: 0, stdNet: 0, vat: 0, zeroNet: 0, motNet: 0, motCount: 0, gross: 0 });
  return { db, docs, drafts, carsInfo, months, totals };
}

function snapshotOf(a: Awaited<ReturnType<typeof assemble>>): Snapshot {
  return {
    takenAt: new Date().toISOString(),
    docs: a.docs.map((d) => ({ id: d.id, docNo: d.docNo, docType: d.docType, month: d.month, net: d.net, tax: d.tax, gross: d.gross })),
    cars: a.carsInfo.cars.map((c: any) => ({ id: c.id, registration: c.registration, salePrice: c.salePrice, base: c.base })),
    totals: { vat: a.totals.vat, stdNet: a.totals.stdNet, zeroNet: a.totals.zeroNet, gross: a.totals.gross, carsVat: a.carsInfo.vat, carsSales: a.carsInfo.sales },
  };
}

export async function getVatPeriod(opts: { from: string; to: string }) {
  const { from, to } = opts;
  const a = await assemble(from, to);
  const { db, docs, drafts, carsInfo, months, totals } = a;

  // Purchases side, from the bank/card feed as labelled on the Profit & Cashbook page.
  let box4: number | null = null;
  try {
    const rec: any = await getReconciliation({ from, to });
    box4 = round2((rec?.vat?.reclaimed || []).reduce((s: number, v: number) => s + (v || 0), 0));
  } catch { box4 = null; }

  const box1 = round2(totals.vat + carsInfo.vat);
  const box6 = round2(totals.stdNet + totals.zeroNet + carsInfo.sales);
  const boxes = { box1, box4, box5: box4 == null ? null : round2(box1 - box4), box6, box6WithMargin: round2(box6 + carsInfo.base) };

  const excessByReg = new Map<string, VatDoc[]>();
  for (const x of docs) if (x.docType === "XS") { const k = String(x.registration || "").replace(/\s+/g, "").toUpperCase(); excessByReg.set(k, [...(excessByReg.get(k) || []), x]); }
  const exceptions = docs.map((d) => judge(d, excessByReg)).filter((x): x is VatException => !!x);
  // A web invoice and GA4's copy of it, both issued inside the period, are the same sale counted
  // twice. The nightly retire step clears a matched pair; a pair whose totals differ stays, so it
  // has to be visible here rather than quietly doubling the month.
  const ga4ByNo = new Map(docs.filter((d) => d.source === "ga4" && d.docNo).map((d) => [d.docNo!, d]));
  for (const w of docs) {
    if (w.source !== "web" || !w.ga4Number) continue;
    const twin = ga4ByNo.get(w.ga4Number);
    if (!twin || twin.id === w.id) continue;
    exceptions.push({ ...w, kind: "duplicate", expectedTax: 0, reason: `Counted twice — GA4's copy ${twin.docNo} (${twin.gross === w.gross ? "same total" : `£${twin.gross.toFixed(2)} vs £${w.gross.toFixed(2)} here`}) is issued in this period too. Retire one.` });
  }
  const notInGa4 = docs.filter((d) => d.source === "web" && !d.inGa4);

  // Filed? Then what has moved since.
  const filedRows: any = await db.execute(sql`SELECT id, "filedAt", boxes, notes, snapshot FROM "vatFilings" WHERE "periodFrom" = ${from}::date AND "periodTo" = ${to}::date ORDER BY id DESC LIMIT 1`);
  const filedRow = filedRows.rows?.[0];
  let filing: any = null;
  if (filedRow) {
    const snap: Snapshot = typeof filedRow.snapshot === "string" ? JSON.parse(filedRow.snapshot) : filedRow.snapshot;
    const then = new Map(snap.docs.map((d) => [d.id, d]));
    const now = new Map(docs.map((d) => [d.id, d]));
    const added = docs.filter((d) => !then.has(d.id));
    const removed = snap.docs.filter((d) => !now.has(d.id));
    const changed = docs.filter((d) => then.has(d.id)).map((d) => ({ now: d, was: then.get(d.id)! }))
      .filter(({ now: n, was: w }) => Math.abs(n.net - w.net) > 0.005 || Math.abs(n.tax - w.tax) > 0.005 || Math.abs(n.gross - w.gross) > 0.005 || n.month !== w.month)
      .map(({ now: n, was: w }) => ({ ...n, was: { net: w.net, tax: w.tax, gross: w.gross, month: w.month }, vatDelta: round2(n.tax - w.tax) }));
    const vatDelta = round2(added.reduce((s, d) => s + d.tax, 0) - removed.reduce((s, d) => s + d.tax, 0) + changed.reduce((s, d) => s + d.vatDelta, 0));
    const carsThen = new Map(snap.cars.map((c) => [c.id, c]));
    const carsAdded = carsInfo.cars.filter((c: any) => !carsThen.has(c.id));
    const carsRemoved = snap.cars.filter((c) => !carsInfo.cars.some((n: any) => n.id === c.id));
    const carsChanged = carsInfo.cars.filter((c: any) => carsThen.has(c.id) && (Math.abs(c.salePrice - carsThen.get(c.id)!.salePrice) > 0.005 || Math.abs(c.base - carsThen.get(c.id)!.base) > 0.005))
      .map((c: any) => ({ ...c, was: carsThen.get(c.id) }));
    filing = {
      id: filedRow.id, filedAt: filedRow.filedAt, boxes: filedRow.boxes, notes: filedRow.notes, snapshotTotals: snap.totals,
      drift: { added, removed, changed, vatDelta, carsAdded, carsRemoved, carsChanged },
    };
  }

  return { from, to, months, totals, cars: carsInfo, boxes, exceptions, notInGa4, drafts, filing, docCount: docs.length };
}

export async function recordVatFiling(opts: { from: string; to: string; boxes?: Record<string, number | null>; notes?: string }) {
  const a = await assemble(opts.from, opts.to);
  const snap = snapshotOf(a);
  const res: any = await a.db.execute(sql`INSERT INTO "vatFilings" ("periodFrom", "periodTo", boxes, notes, snapshot)
    VALUES (${opts.from}::date, ${opts.to}::date, ${JSON.stringify(opts.boxes ?? {})}::jsonb, ${opts.notes ?? null}, ${JSON.stringify(snap)}::jsonb) RETURNING id`);
  return { id: res.rows?.[0]?.id, docs: snap.docs.length, cars: snap.cars.length, totals: snap.totals };
}

export async function deleteVatFiling(id: number) {
  const db = await getDb();
  if (!db) throw new Error("no db");
  await ensureTable(db);
  await db.execute(sql`DELETE FROM "vatFilings" WHERE id = ${id}`);
  return { ok: true };
}

export async function listVatFilings() {
  const db = await getDb();
  if (!db) return [];
  await ensureTable(db);
  const rows: any = await db.execute(sql`SELECT id, "periodFrom"::text AS "periodFrom", "periodTo"::text AS "periodTo", "filedAt", boxes, notes, snapshot->'totals' AS totals, jsonb_array_length(snapshot->'docs') AS docs FROM "vatFilings" ORDER BY "periodFrom" DESC, id DESC`);
  return rows.rows || [];
}
