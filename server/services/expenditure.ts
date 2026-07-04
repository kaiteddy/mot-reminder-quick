/**
 * Expenditure reconciliation service.
 * Joins GA4 workshop sales (serviceHistory) with labelled bank/card expenditure
 * (bankTransactions + transactionLabels + expenditureCategories) into a monthly P&L.
 * Revenue = workshop sales invoices (SI+XS-CR). Bank "takings" are cash receipts
 * (section 'receipts'), shown for cross-check, NOT added to P&L revenue.
 */
import crypto from "crypto";
import { sql, eq } from "drizzle-orm";
import { getDb } from "../db";
import { carDeals } from "../../drizzle/schema";

const OTHER = "OTHER / to label";

// resolved category = per-row override -> label cascade -> OTHER
const RESOLVED = sql`COALESCE(t."categoryOverride", l."category", ${OTHER})`;
const JOIN = sql`
  FROM "bankTransactions" t
  LEFT JOIN "transactionLabels" l ON l."source"=t."source" AND l."counterpartyKey"=t."counterpartyKey"
  LEFT JOIN "expenditureCategories" c ON c."name"=COALESCE(t."categoryOverride", l."category", ${OTHER})`;

// Month a transaction counts in for the P&L — the manual override if set (pay-date drift), else its bank date.
const EMONTH = sql`COALESCE(t."effectiveMonth", to_char(t."txnDate",'YYYY-MM'))`;

function monthList(from: string, to: string): string[] {
  // timezone-safe: work directly on the YYYY-MM parts (avoid Date/UTC drift)
  const out: string[] = [];
  let [y, m] = from.split("-").map(Number);
  const [ey, em] = to.split("-").map(Number);
  while (y < ey || (y === ey && m <= em)) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    if (++m > 12) { m = 1; y++; }
  }
  return out;
}
const num = (v: any) => Number(v ?? 0) || 0;

/** Monthly P&L: workshop sales (GA4) + expenditure by category/section. */
export async function getReconciliation(opts: { from: string; to: string }) {
  const db = await getDb();
  if (!db) return { months: [], sales: [], sections: {}, categories: [] };
  const months = monthList(opts.from, opts.to);
  const idx = Object.fromEntries(months.map((m, i) => [m, i]));

  // Workshop sales (SI+XS-CR) — net AND output VAT (VAT due) by month
  const salesRows: any = await db.execute(sql`
    SELECT to_char(date_trunc('month',"dateIssued"),'YYYY-MM') m,
      SUM(sgn * netv) net, SUM(sgn * taxv) vat
    FROM (
      SELECT "dateIssued",
        CASE WHEN "docType" IN ('SI','XS') THEN 1 WHEN "docType"='CR' THEN -1 ELSE 0 END sgn,
        COALESCE(NULLIF(regexp_replace("totalNet"::text,'[^0-9.\-]','','g'),'')::numeric,0) netv,
        COALESCE(NULLIF(regexp_replace("totalTax"::text,'[^0-9.\-]','','g'),'')::numeric,0) taxv
      FROM "serviceHistory"
      WHERE "docType" IN ('SI','XS','CR') AND "dateIssued" >= ${opts.from}::date AND "dateIssued" < (${opts.to}::date + INTERVAL '1 day')
    ) s GROUP BY 1`);
  const sales = months.map(() => 0);
  const vatDue = months.map(() => 0);
  for (const r of salesRows.rows || []) if (r.m in idx) { sales[idx[r.m]] = num(r.net); vatDue[idx[r.m]] = num(r.vat); }

  // Barclays bank/card amounts are VAT-inclusive. Effective input-VAT rate per txn:
  // per-row override -> category default -> 20. NET = gross ex-VAT; the remainder is reclaimable VAT.
  const ER = sql`COALESCE(t."vatRateOverride", c."vatRate", 20)`;
  const NET = sql`(t."amount"::numeric * 100.0 / (100 + ${ER}))`;

  // Expenditure by month x category (with section) — amounts are NET of reclaimable VAT
  const expRows: any = await db.execute(sql`
    SELECT ${EMONTH} m,
           ${RESOLVED} category, COALESCE(c."section",'overheads') section,
           COALESCE(c."sortOrder",999) "sortOrder", COALESCE(c."isContra",0) "isContra",
           SUM(${NET}) amt
    ${JOIN}
    WHERE t."txnDate" >= ${opts.from}::date AND t."txnDate" < (${opts.to}::date + INTERVAL '1 day')
    GROUP BY 1,2,3,4,5`);

  const catMap = new Map<string, any>();
  const sections: Record<string, number[]> = {
    receipts: months.map(() => 0), cogs: months.map(() => 0), cartrade: months.map(() => 0),
    overheads: months.map(() => 0), taxes: months.map(() => 0), financing: months.map(() => 0),
  };
  for (const r of expRows.rows || []) {
    const i = idx[r.m]; if (i === undefined) continue;
    const sec = r.section || "overheads";
    if (sections[sec]) sections[sec][i] += num(r.amt);
    if (!catMap.has(r.category)) catMap.set(r.category, {
      name: r.category, section: sec, sortOrder: num(r.sortOrder), isContra: num(r.isContra),
      amounts: months.map(() => 0), total: 0,
    });
    const c = catMap.get(r.category); c.amounts[i] += num(r.amt); c.total += num(r.amt);
  }
  const categories = [...catMap.values()].sort((a, b) => a.sortOrder - b.sortOrder);

  // Input VAT reclaimed on expenditure (money-out only) by month
  const vatRows: any = await db.execute(sql`
    SELECT ${EMONTH} m, SUM(t."amount"::numeric - ${NET}) vatp
    ${JOIN}
    WHERE t."txnDate" >= ${opts.from}::date AND t."txnDate" < (${opts.to}::date + INTERVAL '1 day') AND t."amount"::numeric < 0
    GROUP BY 1`);
  const vatReclaimed = months.map(() => 0);
  for (const r of vatRows.rows || []) if (r.m in idx) vatReclaimed[idx[r.m]] = -num(r.vatp); // vatp is negative for money-out
  const vatDueWorkshop = [...vatDue]; // output VAT from GA4 workshop sales; car-margin VAT added below

  // Car trading: sold cars matched by sale month (revenue, cost-of-cars-sold, margin).
  // VAT base per car: margin-scheme cars = vehicle margin (sale − purchase, excl. fees/recon);
  // STD (standard-rated / VAT-qualifying) cars = full selling price. Output VAT = base × 1/6.
  const carRows: any = await db.execute(sql`
    SELECT to_char(d."saleDate",'YYYY-MM') m,
      SUM(COALESCE(d."salePrice",0)) revenue,
      SUM(COALESCE(d."purchaseCost", lp.total, 0) + COALESCE(d."reconditioningCost",0)) cost,
      SUM(CASE WHEN d."stdRated"=1 THEN COALESCE(d."salePrice",0)
               ELSE GREATEST(COALESCE(d."salePrice",0) - COALESCE(d."purchaseCost",0), 0) END) vmargin
    FROM "carDeals" d
    LEFT JOIN (SELECT "carDealId", SUM(ABS("amount")) total FROM "bankTransactions" WHERE "carDealId" IS NOT NULL GROUP BY "carDealId") lp ON lp."carDealId"=d."id"
    WHERE d."status"='sold' AND d."saleDate" IS NOT NULL
    GROUP BY 1`);
  const carTrading = { revenue: months.map(() => 0), cost: months.map(() => 0), margin: months.map(() => 0) };
  const vatDueCars = months.map(() => 0);
  for (const r of carRows.rows || []) {
    const i = idx[r.m]; if (i === undefined) continue;
    carTrading.revenue[i] = num(r.revenue);
    carTrading.cost[i] = num(r.cost);
    carTrading.margin[i] = num(r.revenue) - num(r.cost);
    vatDueCars[i] = num(r.vmargin) / 6;   // margin-scheme output VAT (1/6 of the vehicle margin)
    vatDue[i] += vatDueCars[i];           // total output VAT = workshop + car margins
  }
  // Reclaimable input VAT on vehicle on-costs (auction/admin fees, delivery) — the vehicle itself
  // carries no reclaimable VAT under the margin scheme, but the fees usually do. Slot by purchase month.
  const onCostRows: any = await db.execute(sql`
    SELECT to_char(COALESCE(d."purchaseDate", d."saleDate"),'YYYY-MM') m, SUM(COALESCE(d."onCostVat",0)) v
    FROM "carDeals" d WHERE COALESCE(d."onCostVat",0) <> 0 GROUP BY 1`);
  for (const r of onCostRows.rows || []) { const i = idx[r.m]; if (i !== undefined) vatReclaimed[i] += num(r.v); }
  const vatNet = months.map((_, i) => vatDue[i] - vatReclaimed[i]); // net VAT payable to HMRC
  return { months, sales, sections, categories, carTrading, vat: { due: vatDue, dueWorkshop: vatDueWorkshop, dueCars: vatDueCars, reclaimed: vatReclaimed, net: vatNet } };
}

/** Paged, filtered transaction list with resolved category. */
export async function listTransactions(opts: {
  source?: "bank" | "card"; month?: string; category?: string;
  unlabelledOnly?: boolean; search?: string; limit?: number; offset?: number;
}) {
  const db = await getDb();
  if (!db) return { rows: [], total: 0 };
  const limit = Math.min(opts.limit ?? 200, 1000);
  const offset = opts.offset ?? 0;
  const conds: any[] = [];
  if (opts.source) conds.push(sql`t."source"=${opts.source}`);
  if (opts.month) conds.push(sql`to_char(t."txnDate",'YYYY-MM')=${opts.month}`);
  if (opts.category) conds.push(sql`${RESOLVED}=${opts.category}`);
  if (opts.unlabelledOnly) conds.push(sql`${RESOLVED}=${OTHER}`);
  if (opts.search) conds.push(sql`(t."counterparty" ILIKE ${"%" + opts.search + "%"} OR t."memo" ILIKE ${"%" + opts.search + "%"})`);
  const where = conds.length ? sql.join([sql`WHERE `, sql.join(conds, sql` AND `)], sql``) : sql``;

  const totalRes: any = await db.execute(sql`SELECT COUNT(*) n ${JOIN} ${where}`);
  const rowsRes: any = await db.execute(sql`
    SELECT t."id", t."source", to_char(t."txnDate",'YYYY-MM-DD') date, t."amount", t."direction",
           t."counterparty", t."counterpartyKey", t."memo", t."cardHolder", t."bankCategoryHint",
           t."categoryOverride", ${RESOLVED} category
    ${JOIN} ${where}
    ORDER BY t."txnDate" DESC, t."id" DESC LIMIT ${limit} OFFSET ${offset}`);
  return {
    rows: (rowsRes.rows || []).map((r: any) => ({ ...r, amount: num(r.amount) })),
    total: num((totalRes.rows || [])[0]?.n),
  };
}

/** Look up make/model/year for a registration using only FREE government APIs:
 *  DVSA MOT history (make + model + colour) and DVLA VES (year of manufacture + fallbacks).
 *  No paid UKVD. Read-only: does NOT persist to the workshop `vehicles` table (car-trading stock). */
export async function lookupReg(input: { registration: string }) {
  const reg = String(input.registration || "").toUpperCase().replace(/\s+/g, "");
  if (!reg) return { ok: false, message: "No registration", reg: "" };
  let make = "", model = "", colour = "", year: number | undefined;
  // DVSA MOT history (free) — the only free source that returns the model
  try {
    const { getMOTHistory } = await import("../motApi");
    const m = await getMOTHistory(reg);
    if (m) { make = m.make || ""; model = m.model || ""; colour = m.primaryColour || ""; }
  } catch { /* graceful */ }
  // DVLA VES (free) — year of manufacture, and make/colour if MOT history had none (e.g. cars <3yrs, no MOT yet)
  try {
    const { getVehicleDetails } = await import("../dvlaApi");
    const d = await getVehicleDetails(reg);
    if (d) { year = d.yearOfManufacture; if (!make) make = d.make || ""; if (!colour) colour = d.colour || ""; }
  } catch { /* graceful */ }
  const tc = (s: string) => (s ? s.replace(/\w\S*/g, (t) => t[0].toUpperCase() + t.slice(1).toLowerCase()) : s);
  const description = [year ? String(year) : "", tc(make), tc(model)].filter(Boolean).join(" ").trim();
  return { ok: !!(make || model), reg, make: tc(make), model: tc(model), year: year ?? null, colour: tc(colour), description };
}

/** Drill-down for one P&L section: per-month gross totals (for month chips) + a chosen month's
 *  category subtotals and individual transactions (for review + reclassification). */
export async function getExpenditureBreakdown(opts: { from: string; to: string; section: string; month?: string }) {
  const months = monthList(opts.from, opts.to);
  const db = await getDb();
  if (!db) return { months, monthlyTotals: months.map(() => 0), categories: [], transactions: [] };
  // NET (ex reclaimable VAT), so the drill-down totals match the P&L line, which is also net.
  const ER = sql`COALESCE(t."vatRateOverride", c."vatRate", 20)`;
  const NET = sql`(t."amount"::numeric * 100.0 / (100 + ${ER}))`;
  const secCond = sql`COALESCE(c."section",'overheads')=${opts.section}`;
  const mt: any = await db.execute(sql`
    SELECT ${EMONTH} mo, SUM(${NET}) amt
    ${JOIN} WHERE ${secCond} AND t."txnDate" >= ${opts.from}::date AND t."txnDate" < (${opts.to}::date + INTERVAL '1 day')
    GROUP BY 1`);
  const idx = Object.fromEntries(months.map((m, i) => [m, i]));
  const monthlyTotals = months.map(() => 0);
  for (const r of mt.rows || []) { const i = idx[r.mo]; if (i !== undefined) monthlyTotals[i] = num(r.amt); }
  let categories: any[] = [], transactions: any[] = [];
  if (opts.month) {
    const monCond = sql`${EMONTH}=${opts.month}`;
    const cats: any = await db.execute(sql`
      SELECT ${RESOLVED} category, COUNT(*) n, SUM(${NET}) amt
      ${JOIN} WHERE ${monCond} AND ${secCond} GROUP BY 1 ORDER BY SUM(${NET}) ASC`);
    const txns: any = await db.execute(sql`
      SELECT t."id", t."source", to_char(t."txnDate",'YYYY-MM-DD') date, t."amount",
             t."counterparty", t."memo", t."effectiveMonth", ${RESOLVED} category
      ${JOIN} WHERE ${monCond} AND ${secCond} ORDER BY t."amount"::numeric ASC, t."id" DESC`);
    categories = (cats.rows || []).map((r: any) => ({ name: r.category, count: num(r.n), amount: num(r.amt) }));
    transactions = (txns.rows || []).map((r: any) => ({ ...r, amount: num(r.amount) }));
  }
  return { months, monthlyTotals, categories, transactions };
}

/** Per-supplier monthly spend + trend (money-out), for the Suppliers analytics tab. */
export async function getSupplierSpend(opts: { from: string; to: string }) {
  const db = await getDb();
  if (!db) return { months: [] as string[], suppliers: [] as any[], monthlyTotal: [] as number[] };
  const months = monthList(opts.from, opts.to);
  const idx = Object.fromEntries(months.map((m, i) => [m, i]));
  const rows: any = await db.execute(sql`
    SELECT COALESCE(NULLIF(t."counterparty",''),'(unknown)') payee, ${RESOLVED} category,
           to_char(date_trunc('month', t."txnDate"),'YYYY-MM') mo, SUM(abs(t."amount"::numeric)) amt
    ${JOIN}
    WHERE t."amount"::numeric < 0 AND t."txnDate" >= ${opts.from}::date AND t."txnDate" < (${opts.to}::date + INTERVAL '1 day')
      AND COALESCE(c."section",'overheads') NOT IN ('financing','taxes','receipts')
    GROUP BY 1,2,3`);
  const map = new Map<string, any>();
  const monthlyTotal = months.map(() => 0);
  for (const r of rows.rows || []) {
    const i = idx[r.mo]; if (i === undefined) continue;
    const amt = num(r.amt);
    if (!map.has(r.payee)) map.set(r.payee, { payee: r.payee, monthly: months.map(() => 0), total: 0, catSpend: {} as Record<string, number> });
    const s = map.get(r.payee);
    s.monthly[i] += amt; s.total += amt;
    s.catSpend[r.category] = (s.catSpend[r.category] || 0) + amt;
    monthlyTotal[i] += amt;
  }
  const n = months.length;
  const suppliers = [...map.values()].map((s) => {
    s.category = Object.entries(s.catSpend).sort((a: any, b: any) => b[1] - a[1])[0]?.[0] || "—";
    delete s.catSpend;
    const last3 = s.monthly.slice(Math.max(0, n - 3)).reduce((a: number, b: number) => a + b, 0) / Math.min(3, n || 1);
    const prevSlice = s.monthly.slice(Math.max(0, n - 6), Math.max(0, n - 3));
    const prev3 = prevSlice.length ? prevSlice.reduce((a: number, b: number) => a + b, 0) / prevSlice.length : 0;
    s.trendPct = prev3 > 0 ? Math.round(((last3 - prev3) / prev3) * 100) : (last3 > 0 ? 100 : 0);
    return s;
  }).sort((a, b) => b.total - a.total);
  return { months, suppliers, monthlyTotal };
}

/** Category master list. */
export async function getCategories() {
  const db = await getDb();
  if (!db) return [];
  const res: any = await db.execute(sql`SELECT "name","section","sortOrder","isContra","vatRate" FROM "expenditureCategories" ORDER BY "sortOrder"`);
  return (res.rows || []).map((r: any) => ({ ...r, sortOrder: num(r.sortOrder), isContra: num(r.isContra), vatRate: num(r.vatRate) }));
}

/** Set the default input-VAT rate for a category (0 = exempt/outside-scope, 20 = standard). */
export async function setCategoryVat(input: { name: string; vatRate: number }) {
  const db = await getDb();
  if (!db) throw new Error("no db");
  const rate = Math.max(0, Math.min(100, Number(input.vatRate) || 0));
  await db.execute(sql`UPDATE "expenditureCategories" SET "vatRate"=${rate} WHERE "name"=${input.name}`);
  return { ok: true };
}

/** Per-transaction VAT-rate override (null clears it, falling back to the category default). */
export async function setTxnVatOverride(input: { id: number; vatRate: number | null }) {
  const db = await getDb();
  if (!db) throw new Error("no db");
  const rate = input.vatRate == null ? null : Math.max(0, Math.min(100, Number(input.vatRate) || 0));
  await db.execute(sql`UPDATE "bankTransactions" SET "vatRateOverride"=${rate} WHERE "id"=${input.id}`);
  return { ok: true };
}

/** Counterparty label list: each payee/merchant with txn count, total, current category. */
export async function getLabels(opts: { source?: "bank" | "card" }) {
  const db = await getDb();
  if (!db) return [];
  const srcCond = opts.source ? sql`WHERE t."source"=${opts.source}` : sql``;
  const res: any = await db.execute(sql`
    SELECT t."source", t."counterpartyKey", MAX(t."counterparty") counterparty,
           COUNT(*) n, SUM(t."amount") total,
           MAX(l."category") category, MAX(t."bankCategoryHint") hint
    FROM "bankTransactions" t
    LEFT JOIN "transactionLabels" l ON l."source"=t."source" AND l."counterpartyKey"=t."counterpartyKey"
    ${srcCond}
    GROUP BY t."source", t."counterpartyKey"
    ORDER BY SUM(t."amount") ASC`);
  return (res.rows || []).map((r: any) => ({
    source: r.source, counterpartyKey: r.counterpartyKey, counterparty: r.counterparty,
    n: num(r.n), total: num(r.total), category: r.category || OTHER, hint: r.hint || "",
  }));
}

/** Set/clear a counterparty -> category label (cascades to all its transactions). */
export async function upsertLabel(input: { source: "bank" | "card"; counterpartyKey: string; category: string }) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  await db.execute(sql`
    INSERT INTO "transactionLabels" ("source","counterpartyKey","category","updatedAt")
    VALUES (${input.source}, ${input.counterpartyKey}, ${input.category}, now())
    ON CONFLICT ("source","counterpartyKey") DO UPDATE SET "category"=EXCLUDED."category", "updatedAt"=now()`);
  return { ok: true };
}

/** Reclassify an entire supplier (payee) from the Suppliers view: set the counterparty label for
 *  every (source, counterpartyKey) under that payee, and clear any per-row overrides so the whole
 *  supplier moves to the chosen category (past + future transactions). */
export async function reclassifyPayee(input: { payee: string; category: string }) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  await db.execute(sql`
    INSERT INTO "transactionLabels" ("source","counterpartyKey","category","updatedAt")
    SELECT DISTINCT t."source", t."counterpartyKey", ${input.category}, now()
    FROM "bankTransactions" t
    WHERE t."counterparty"=${input.payee} AND t."counterpartyKey" IS NOT NULL
    ON CONFLICT ("source","counterpartyKey") DO UPDATE SET "category"=EXCLUDED."category", "updatedAt"=now()`);
  const res: any = await db.execute(sql`
    UPDATE "bankTransactions" SET "categoryOverride"=NULL
    WHERE "counterparty"=${input.payee} AND "categoryOverride" IS NOT NULL`);
  const affected: any = await db.execute(sql`SELECT COUNT(*) n FROM "bankTransactions" WHERE "counterparty"=${input.payee}`);
  return { ok: true, count: num(((affected as any).rows || affected)[0]?.n) };
}

/** Per-row override (or clear with null). */
export async function setOverride(input: { id: number; category: string | null }) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  await db.execute(sql`UPDATE "bankTransactions" SET "categoryOverride"=${input.category} WHERE "id"=${input.id}`);
  return { ok: true };
}

/** Book transaction(s) into a specific P&L month (YYYY-MM), or null to reset to the bank date. Fixes
 *  pay-date drift (e.g. a payroll paid on the 1st that belongs to the previous month). */
export async function setTxnMonth(input: { ids: number[]; month: string | null }) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  const ids = (input.ids || []).map(Number).filter((n) => Number.isFinite(n));
  if (!ids.length) return { ok: true };
  await db.execute(sql`UPDATE "bankTransactions" SET "effectiveMonth"=${input.month} WHERE "id" IN (${sql.join(ids.map((i) => sql`${i}`), sql`, `)})`);
  return { ok: true };
}

/** Headline stats for the page header. */
export async function getStats() {
  const db = await getDb();
  if (!db) return { bank: 0, card: 0, unlabelled: 0, first: null, last: null };
  const res: any = await db.execute(sql`
    SELECT COUNT(*) FILTER (WHERE t."source"='bank') bank,
           COUNT(*) FILTER (WHERE t."source"='card') card,
           COUNT(*) FILTER (WHERE ${RESOLVED}=${OTHER}) unlabelled,
           to_char(MIN(t."txnDate"),'YYYY-MM-DD') first, to_char(MAX(t."txnDate"),'YYYY-MM-DD') last
    ${JOIN}`);
  const r = (res.rows || [])[0] || {};
  return { bank: num(r.bank), card: num(r.card), unlabelled: num(r.unlabelled), first: r.first, last: r.last };
}

// ── CSV import ────────────────────────────────────────────────────────────
const normkey = (s: string) => (s || "").replace(/\s+/g, " ").trim().toUpperCase().slice(0, 200);
const sha = (...p: any[]) => crypto.createHash("sha1").update(p.join("|")).digest("hex");
const REG = /\b[A-Z]{2}[0-9]{2}\s?[A-Z]{3}\b|\b[A-Z][0-9]{1,3}\s?[A-Z]{3}\b/;
const has = (m: string, arr: string[]) => arr.some((x) => m.includes(x));

function bankCat(memo: string, sub: string, amt: number): string {
  const m = memo.toUpperCase(), s = (sub || "").toUpperCase(), inc = amt > 0, FT = s.includes("TRANSFER");
  if (m.includes("DIRECTORS LOAN") || m.includes("RUTSTEIN LOAN")) return "Directors loan";
  if (m.includes("ELI MOTORS DEP A/C")) return "Transfer — own deposit a/c";
  if (s.includes("STO") && Math.abs(amt) < 1) return "Sundry / other";
  if (inc) {
    if (m.includes("EVO PAYMENTS")) return "INCOME — card takings (EVO)";
    if (m.includes("AMERICAN EXPRESS")) return "INCOME — card takings (Amex)";
    if (m.includes("POST OFFICE") || s.includes("CASH DEPOSIT")) return "INCOME — cash takings";
    if (has(m, ["INSURANCE", "ALLIANZ", "ADMIRAL", "KRUSKAL", "JENSTEN", "CHURCHILL", "FMG SUPPORT"])) return "INCOME — insurance/accident";
    return "INCOME — sales & receipts";
  }
  if (m.includes("PAYE") || m.includes("NIC")) return "Wages — PAYE & NIC (HMRC)";
  if (m.includes("E VAT") || (m.includes("HMRC") && m.includes("VAT"))) return "VAT (HMRC)";
  if (m.includes("CORPORATION T") || m.includes("COTAX")) return "Corporation Tax (HMRC)";
  if (m.includes("NEST")) return "Pension (NEST)";
  if (has(m, ["DECLIN RAYMOND", "KEVIN PEACH", "JOHN CHAPMAN", "LORRAINE RUTSTEIN", "ADAM RUTSTEIN"])) return "Wages — employee (PAYE)";
  if (m.includes("BRITTAIN")) return "Rent & premises";
  if (has(m, ["K WICHERT", "ALPHA HEAT", "AMAC ELECTRICAL", "SOUNDS SECURE"])) return "Premises — building works";
  if (m.includes("BARNET")) return "Business rates";
  if (m.includes("CASTLE WATER")) return "Utilities — water";
  if (m.includes("OCTOPUS") || m.includes("CERTAS ENERGY")) return "Utilities — energy";
  if (has(m, ["WASTE MANAGED", "SAFETY-KLEEN", "BOC MANCHESTER"])) return "Waste & workshop services";
  if (has(m, ["BT GROUP", "VIRGIN MEDIA", "STARLINK", "MERAKI", "GOCARDLESS", "MERAKICOMMS"]) || m.startsWith("O2")) return "Telecoms & internet";
  if (has(m, ["GOOGLE", "APPLE.COM", "OPENAI", "PROGRESS SOFTWARE", "AUTODATA", "TOWERLEASING", "VISITOR CHAT", "EMOTIVE"])) return "Software & IT";
  if (m.includes("EMS ") || m.startsWith("EMS")) return "Equipment & monitoring";
  if (has(m, ["EURO CAR PARTS", "GSF CAR PARTS", "CAR SPARES", "PARTSPLUS", "HUMMING BIRD", "VOLKSWAGEN GROUP", "GLYN HOPKIN", "MERCEDES BENZ", "RENAULT RETAIL", "HILLS NUMBERPLATES", "WURTH", "SNAP-ON", "SNAPON", "SNAP ON", "WOODSTOCK", "REDCORN", "MCGARD"])) return "Cost of sales — parts & consumables";
  if (has(m, ["BRITISHCARAUCTIONS", "ASTON BARCLAY", "MANHEIM", "P2F TRADING", "IAA UK", "TOYOTA FINANCIAL"]) || m.includes("VEHICLE PURCHASE") || m.includes("CAR PURCHASE") || m.includes("PURCHASE VEHICLE")) return "Cost of sales — vehicle stock";
  if (FT && (REG.test(memo) || m.includes("ELI MOTORS") || m.includes(" CAR"))) return "Cost of sales — vehicle stock";
  if (m.includes("BCARD COMMERCIAL")) return "Barclaycard settlement (contra)";
  if (has(m, ["BARCLAYS PRTNR", "TAKEPAYMENTS", "AMEX PAYMENT SERVI", "EVO PAYMENTS UK", "CREATION"]) || m.startsWith("BARCLAYS")) return "Card acquiring (terminal fees)";
  if (m.includes("BUPA")) return "Insurance — BUPA (health)";
  if (has(m, ["AUTOTRADER", "AUTO TRADER", "USED CAR SITES", "CF247", "BRAND PLAN"])) return "Advertising & leads";
  if (has(m, ["DANIEL", "ACCOUNTAN", "TROTTER", "STRATA", "ANALIZE", "S & L LEGAL"])) return "Accountancy & professional";
  if (m.includes("DVSA MOT")) return "MOT testing (DVSA)";
  if (m.includes("DVLA") || m.includes("EVLWEB")) return "DVLA / road tax";
  if (has(m, ["MOTOR OMBUDSMAN", "THE IMI", "RAC ", "RAC MOTORING", "RAC APPROVED", "AA MEMBERSHIP", "FCA", "TV LICENCE", "PRESTIGEAA"])) return "Memberships, subs & regulatory";
  if (m.includes("WARRANTY SOLUTIONS")) return "Warranties";
  if (m.includes("JOHNSONS WORKWEAR")) return "Workwear & uniforms";
  if (has(m, ["AUTOVALET", "PIPS DENT", "GLASS DOCTOR", "S+S REPAIR", "BOURNE ROAD", "LV REPAIR", "AUTOMOTIVE TRANSFO", "TYRETICK", "STEPHENS ENGINEER", "LEAK DETECTION", "AUTOMOTECH", "REPAIR CENTRE", "MARCELLO ALTOMARE", "FAFS SOUTH", "EMERGENCY VEHICLE", "I D +", "JEMCA", "GROUP 1", "CRUICKSHANK", "STEEL CAT", "UMY TRADING", "LOWRY"])) return "Cost of sales — sublet repairs";
  if (m.includes("PAYPAL") || m.includes("EBAY")) return "Sundry / other";
  if (m.includes("CHARGES") && m.includes("COMMISSION")) return "Bank charges";
  return OTHER;
}

function cardCat(merch: string, bc: string): string {
  const M = merch.toUpperCase(), b = (bc || "").trim();
  if (has(M, ["AWS", "GOOGLE CLOUD", "GCLOUD", "GOOGLE CLOU"])) return "Software & IT";
  if (M.includes("PAYPAL")) {
    if (has(M, ["AUTODOC", "ECUTESTING", "ULTIMATESTY", "VEHICLEDATA", "DECIDEBLOOM", "MTRONICS"])) return "Cost of sales — parts & consumables";
    if (M.includes("GODADDY") || M.includes("CARTRIDGE")) return "Software & IT";
    if (M.includes("TRAINLINE")) return "Travel & subsistence";
    if (M.includes("LOWRYGAR")) return "Premises — building works";
  }
  if (b === "Automotive Fuel") return "Fuel";
  if (b === "Computer Equipment & Services" || b === "Digital Goods") return "Software & IT";
  if (b === "Telecommunication Services") return "Telecoms & internet";
  if (b === "Building Services" || b === "Building Materials") return "Premises — building works";
  if (b === "Cleaning Services and Supplies") return "Waste & workshop services";
  if (b === "Travel - Air/Rail/Road" || b === "Restaurants and Bars") return "Travel & subsistence";
  if (b === "Print and Advertising") return "Advertising & leads";
  if (b === "Statutory Bodies") return "DVLA / road tax";
  if (b === "Training and Educational") return "Software & IT";
  if (b === "Financial Services") return "Memberships, subs & regulatory";
  if (b === "Vehicles, Servicing and Spares") {
    if (has(M, ["TYRE", "ALIGNMENT", "REPAIR", "MOT", "GLASS", "ECU", "RECOVERY", "WHEEL", "AUTO ASSIST", "BODY", "PAINT", "DENT", "CALIBRAT", "DIAGNOSTIC", "S£S", "S&S"])) return "Cost of sales — sublet repairs";
    return "Cost of sales — parts & consumables";
  }
  if (b === "General Retail and Wholesale" || b === "Mail Order / Direct Selling" || b === "Miscellaneous Industrial/Commercial Supplies") return "Sundry / other";
  return OTHER;
}

type ParsedTxn = {
  source: "bank" | "card"; txnDate: Date; amount: number; direction: "IN" | "OUT";
  counterparty: string; counterpartyKey: string; memo: string; cardHolder: string;
  bankCategoryHint: string; subcategory: string; dedupeKey: string; suggested: string;
};

function parseBankCsv(text: string): ParsedTxn[] {
  const out: ParsedTxn[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const s = raw.replace(/^[\t ]+/, "");
    if (!s || s.startsWith("Number,")) continue;
    const p = s.split(",");
    if (p.length < 6) continue;
    const amt = parseFloat(p[3]); if (isNaN(amt)) continue;
    const dm = p[1].trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/); if (!dm) continue;
    const txnDate = new Date(`${dm[3]}-${dm[2]}-${dm[1]}T00:00:00`);
    const number = p[0].trim(), sub = p[4].trim();
    const memo = p.slice(5).join(",").trim().replace(/\s+/g, " ");
    const payee = p.slice(5).join(",").trim().split(/\s{2,}|\t/)[0].trim();
    out.push({
      source: "bank", txnDate, amount: amt, direction: amt > 0 ? "IN" : "OUT",
      counterparty: payee.slice(0, 255), counterpartyKey: normkey(payee), memo, cardHolder: "",
      bankCategoryHint: "", subcategory: sub,
      dedupeKey: sha("bank", number, txnDate.toISOString().slice(0, 10), amt.toFixed(2), memo.slice(0, 80)),
      suggested: bankCat(memo, sub, amt),
    });
  }
  return out;
}

async function parseCardCsv(text: string): Promise<ParsedTxn[]> {
  const { parse } = await import("csv-parse/sync");
  const recs: any[] = parse(text, { columns: true, skip_empty_lines: true, relax_quotes: true, trim: true });
  const out: ParsedTxn[] = [];
  for (const r of recs) {
    const typ = (r["Transaction Type"] || "").trim();
    if (typ === "PAYMENT") continue; // settlement
    const amt = parseFloat(r["Transaction Amount"]); if (isNaN(amt)) continue;
    const dm = (r["Transaction Date"] || "").trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/); if (!dm) continue;
    const txnDate = new Date(`${dm[3]}-${dm[2]}-${dm[1]}T00:00:00`);
    const merch = (r["Merchant Name"] || "").trim(), bc = (r["Merchant Category"] || "").trim();
    const holder = (r["Card Holder Name"] || "").trim().replace(/\b\w/g, (c: string) => c.toUpperCase());
    const txid = (r["Transaction ID"] || "").trim();
    const signed = -amt, key = normkey(merch);
    const extra = [r["MCC Description"], r["Merchant Town/City"]].filter(Boolean).join(" ").trim();
    out.push({
      source: "card", txnDate, amount: signed, direction: signed > 0 ? "IN" : "OUT",
      counterparty: merch.slice(0, 255), counterpartyKey: key, memo: extra, cardHolder: holder.slice(0, 120),
      bankCategoryHint: bc.slice(0, 120), subcategory: typ,
      dedupeKey: sha("card", txid, txnDate.toISOString().slice(0, 10), signed.toFixed(2), key),
      suggested: typ === "FEE" ? "Bank charges" : cardCat(merch, bc),
    });
  }
  return out;
}

/** Import a Barclays (bank) or Barclaycard (card) CSV export. Dedupes; auto-seeds labels for new counterparties. */
export async function importTransactions(input: { source: "bank" | "card"; csvText: string }) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  const parsed = input.source === "bank" ? parseBankCsv(input.csvText) : await parseCardCsv(input.csvText);
  if (!parsed.length) return { inserted: 0, skipped: 0, total: 0, newLabels: 0 };

  const batch = "import-" + new Date().toISOString().slice(0, 19);
  let inserted = 0;
  // de-dupe within the file too
  const seen = new Set<string>();
  for (const t of parsed) {
    if (seen.has(t.dedupeKey)) continue; seen.add(t.dedupeKey);
    const res: any = await db.execute(sql`
      INSERT INTO "bankTransactions"
        ("source","txnDate","amount","direction","counterparty","counterpartyKey","memo","cardHolder","bankCategoryHint","subcategory","dedupeKey","importBatch")
      VALUES (${t.source}, ${t.txnDate}, ${t.amount.toFixed(2)}, ${t.direction}, ${t.counterparty}, ${t.counterpartyKey},
              ${t.memo}, ${t.cardHolder}, ${t.bankCategoryHint}, ${t.subcategory}, ${t.dedupeKey}, ${batch})
      ON CONFLICT ("dedupeKey") DO NOTHING RETURNING "id"`);
    if ((res.rows || []).length) inserted++;
  }
  // auto-seed a suggested label for any brand-new counterparty (so fewer OTHERs)
  const byKey = new Map<string, string>();
  for (const t of parsed) if (t.counterpartyKey && !byKey.has(t.counterpartyKey)) byKey.set(t.counterpartyKey, t.suggested);
  let newLabels = 0;
  for (const [key, suggested] of byKey) {
    if (suggested === OTHER) continue;
    const res: any = await db.execute(sql`
      INSERT INTO "transactionLabels" ("source","counterpartyKey","category","updatedAt")
      VALUES (${input.source}, ${key}, ${suggested}, now())
      ON CONFLICT ("source","counterpartyKey") DO NOTHING RETURNING "id"`);
    if ((res.rows || []).length) newLabels++;
  }
  return { inserted, skipped: parsed.length - inserted, total: parsed.length, newLabels };
}

// ── Car trading ledger ──────────────────────────────────────────────────────
const VEHICLE_STOCK = "Cost of sales — vehicle stock";

/** All car deals with linked-purchase totals and computed margin. In-stock first. */
export async function getCarDeals() {
  const db = await getDb();
  if (!db) return [];
  const res: any = await db.execute(sql`
    SELECT d."id", d."registration", d."description", d."purchaseCost",
           to_char(d."purchaseDate",'YYYY-MM-DD') "purchaseDate", d."salePrice",
           to_char(d."saleDate",'YYYY-MM-DD') "saleDate", d."askingPrice",
           d."reconditioningCost", d."onCostVat", d."feeBreakdown", d."status", d."notes", d."source",
           COALESCE(p.linked,0) "linkedPurchaseTotal", COALESCE(p.cnt,0) "linkedCount"
    FROM "carDeals" d
    LEFT JOIN (SELECT "carDealId", SUM(ABS("amount")) linked, COUNT(*) cnt
               FROM "bankTransactions" WHERE "carDealId" IS NOT NULL GROUP BY "carDealId") p
      ON p."carDealId"=d."id"
    ORDER BY (d."status"='sold'), d."createdAt" DESC`);
  return (res.rows || []).map((r: any) => {
    const purchase = r.purchaseCost != null ? num(r.purchaseCost) : num(r.linkedPurchaseTotal);
    const recond = num(r.reconditioningCost);
    const sale = r.salePrice != null ? num(r.salePrice) : null;
    const effectiveCost = purchase + recond;
    return {
      id: r.id, registration: r.registration, description: r.description,
      purchaseCost: r.purchaseCost != null ? num(r.purchaseCost) : null,
      purchaseDate: r.purchaseDate, salePrice: sale, saleDate: r.saleDate,
      askingPrice: r.askingPrice != null ? num(r.askingPrice) : null,
      reconditioningCost: r.reconditioningCost != null ? recond : null,
      onCostVat: r.onCostVat != null ? num(r.onCostVat) : null,
      feeBreakdown: r.feeBreakdown ?? null,
      status: r.status, notes: r.notes, source: r.source,
      linkedPurchaseTotal: num(r.linkedPurchaseTotal), linkedCount: num(r.linkedCount),
      effectiveCost,
      margin: r.status === "sold" && sale != null ? sale - effectiveCost : null,
    };
  });
}

const toDate = (s: any) => (s ? new Date(s + "T12:00:00") : null); // noon: date-safe across TZs
const numOrNull = (x: any) => (x == null || x === "" ? null : String(x));

function dealFields(input: any) {
  const f: any = {};
  if ("registration" in input) f.registration = input.registration || null;
  if ("description" in input) f.description = input.description || null;
  if ("purchaseCost" in input) f.purchaseCost = numOrNull(input.purchaseCost);
  if ("purchaseDate" in input) f.purchaseDate = toDate(input.purchaseDate);
  if ("salePrice" in input) f.salePrice = numOrNull(input.salePrice);
  if ("saleDate" in input) f.saleDate = toDate(input.saleDate);
  if ("askingPrice" in input) f.askingPrice = numOrNull(input.askingPrice);
  if ("reconditioningCost" in input) f.reconditioningCost = numOrNull(input.reconditioningCost);
  if ("onCostVat" in input) f.onCostVat = numOrNull(input.onCostVat);
  if ("feeBreakdown" in input) f.feeBreakdown = input.feeBreakdown ?? null;
  if ("status" in input) f.status = input.status;
  if ("notes" in input) f.notes = input.notes || null;
  if ("source" in input) f.source = input.source || null;
  return f;
}

/** Create or partially update a car deal. */
export async function upsertCarDeal(input: any) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  const f = dealFields(input);
  if (input.id) {
    f.updatedAt = new Date();
    await db.update(carDeals).set(f).where(eq(carDeals.id, input.id));
    // Auction split: when fees/VAT are entered (but NOT the vehicle price itself), derive the
    // vehicle price from the linked payment total — vehicle = total − fees − VAT. Auction bank
    // payments are the whole invoice; this backs out the car price so the margin/VAT is right.
    // Skipped if no payment is linked, and a direct Vehicle £ edit (purchaseCost in input) wins.
    if ((("reconditioningCost" in input) || ("onCostVat" in input)) && !("purchaseCost" in input)) {
      await db.execute(sql`
        UPDATE "carDeals" d
        SET "purchaseCost" = GREATEST(lp.total - COALESCE(d."reconditioningCost",0) - COALESCE(d."onCostVat",0), 0),
            "updatedAt" = now()
        FROM (SELECT SUM(ABS("amount")) total FROM "bankTransactions" WHERE "carDealId"=${input.id}) lp
        WHERE d."id"=${input.id} AND COALESCE(lp.total,0) > 0`);
    }
    return { id: input.id };
  }
  const [row]: any = await db.insert(carDeals).values(f).returning({ id: carDeals.id });
  return { id: row.id };
}

export async function deleteCarDeal(input: { id: number }) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  await db.execute(sql`UPDATE "bankTransactions" SET "carDealId"=NULL WHERE "carDealId"=${input.id}`);
  await db.execute(sql`DELETE FROM "carDeals" WHERE "id"=${input.id}`);
  return { ok: true };
}

/** Vehicle-stock purchase transactions, with their current car-deal link (for association UI). */
export async function getVehiclePurchases() {
  const db = await getDb();
  if (!db) return [];
  const res: any = await db.execute(sql`
    SELECT t."id", to_char(t."txnDate",'YYYY-MM-DD') date, t."counterparty", t."amount",
           t."carDealId", d."registration" "dealReg", d."description" "dealDesc"
    FROM "bankTransactions" t
    LEFT JOIN "transactionLabels" l ON l."source"=t."source" AND l."counterpartyKey"=t."counterpartyKey"
    LEFT JOIN "carDeals" d ON d."id"=t."carDealId"
    WHERE COALESCE(t."categoryOverride", l."category", '')=${VEHICLE_STOCK}
    ORDER BY t."txnDate" DESC`);
  return (res.rows || []).map((r: any) => ({ ...r, amount: num(r.amount) }));
}

/** Link (or unlink with null) a purchase transaction to a car deal; auto-fills the purchase DATE and,
 *  when the payee is a recognised auction, the SOURCE (BCA/Manheim/Aston Barclay/Eastbourne) — only if
 *  those are still blank, so a manual entry is never overwritten. Deliberately does NOT auto-fill
 *  purchaseCost: a linked payment is the TOTAL invoice (vehicle + fees + delivery), whereas purchaseCost
 *  must be the vehicle-only price that drives the margin (shown as a greyed hint so the user can split it). */
export async function linkPurchase(input: { txnId: number; carDealId: number | null }) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  await db.execute(sql`UPDATE "bankTransactions" SET "carDealId"=${input.carDealId} WHERE "id"=${input.txnId}`);
  if (input.carDealId) {
    await db.execute(sql`
      UPDATE "carDeals" d SET
        "purchaseDate"=COALESCE(d."purchaseDate", x.first),
        "source"=COALESCE(d."source", x.src),
        "updatedAt"=now()
      FROM (SELECT MIN("txnDate") first,
              MAX(CASE
                WHEN "counterparty" ~* 'british ?car ?auction|(^|[^a-z])bca([^a-z]|$)' THEN 'BCA'
                WHEN "counterparty" ~* 'manheim' THEN 'Manheim'
                WHEN "counterparty" ~* 'aston ?barclay' THEN 'Aston Barclay'
                WHEN "counterparty" ~* 'eastbourne' THEN 'Eastbourne'
              END) src
            FROM "bankTransactions" WHERE "carDealId"=${input.carDealId}) x
      WHERE d."id"=${input.carDealId}`);
  }
  return { ok: true };
}

/** Book a (usually small, separately-paid) payment as DELIVERY for a car — links it and adds the amount
 *  to that car's delivery on-cost, instead of treating it as the vehicle purchase price. */
export async function bookDelivery(input: { txnId: number; carDealId: number; amount: number }) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  const car: any = (await db.select().from(carDeals).where(eq(carDeals.id, input.carDealId)).limit(1))[0];
  if (!car) throw new Error("Car not found");
  const bd: any = { ...(car.feeBreakdown || {}) };
  // preserve a legacy plain reconditioningCost (no breakdown) as "other" before adding delivery
  if ((!car.feeBreakdown || Object.keys(car.feeBreakdown).length === 0) && car.reconditioningCost != null) {
    bd.other = Number(car.reconditioningCost) || 0;
  }
  bd.delivery = (Number(bd.delivery) || 0) + (Number(input.amount) || 0);
  const recond = ["buyerFee", "assured", "delivery", "other"].reduce((s, k) => s + (Number(bd[k]) || 0), 0);
  await db.execute(sql`UPDATE "bankTransactions" SET "carDealId"=${input.carDealId} WHERE "id"=${input.txnId}`);
  await db.update(carDeals).set({ feeBreakdown: bd, reconditioningCost: String(recond.toFixed(2)), updatedAt: new Date() }).where(eq(carDeals.id, input.carDealId));
  return { ok: true };
}
