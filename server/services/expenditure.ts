/**
 * Expenditure reconciliation service.
 * Joins GA4 workshop sales (serviceHistory) with labelled bank/card expenditure
 * (bankTransactions + transactionLabels + expenditureCategories) into a monthly P&L.
 * Revenue = workshop sales invoices (SI+XS-CR). Bank "takings" are cash receipts
 * (section 'receipts'), shown for cross-check, NOT added to P&L revenue.
 */
import crypto from "crypto";
import { sql } from "drizzle-orm";
import { getDb } from "../db";

const OTHER = "OTHER / to label";

// resolved category = per-row override -> label cascade -> OTHER
const RESOLVED = sql`COALESCE(t."categoryOverride", l."category", ${OTHER})`;
const JOIN = sql`
  FROM "bankTransactions" t
  LEFT JOIN "transactionLabels" l ON l."source"=t."source" AND l."counterpartyKey"=t."counterpartyKey"
  LEFT JOIN "expenditureCategories" c ON c."name"=COALESCE(t."categoryOverride", l."category", ${OTHER})`;

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

  // Workshop sales (SI+XS-CR net) by month
  const salesRows: any = await db.execute(sql`
    SELECT to_char(date_trunc('month',"dateIssued"),'YYYY-MM') m,
      SUM(CASE WHEN "docType" IN ('SI','XS') THEN 1 WHEN "docType"='CR' THEN -1 ELSE 0 END
          * COALESCE(NULLIF(regexp_replace("totalNet"::text,'[^0-9.\-]','','g'),'')::numeric,0)) net
    FROM "serviceHistory"
    WHERE "docType" IN ('SI','XS','CR') AND "dateIssued" >= ${opts.from}::date AND "dateIssued" < (${opts.to}::date + INTERVAL '1 day')
    GROUP BY 1`);
  const sales = months.map(() => 0);
  for (const r of salesRows.rows || []) if (r.m in idx) sales[idx[r.m]] = num(r.net);

  // Expenditure by month x category (with section)
  const expRows: any = await db.execute(sql`
    SELECT to_char(date_trunc('month',t."txnDate"),'YYYY-MM') m,
           ${RESOLVED} category, COALESCE(c."section",'overheads') section,
           COALESCE(c."sortOrder",999) "sortOrder", COALESCE(c."isContra",0) "isContra",
           SUM(t."amount") amt
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
  return { months, sales, sections, categories };
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

/** Category master list. */
export async function getCategories() {
  const db = await getDb();
  if (!db) return [];
  const res: any = await db.execute(sql`SELECT "name","section","sortOrder","isContra" FROM "expenditureCategories" ORDER BY "sortOrder"`);
  return (res.rows || []).map((r: any) => ({ ...r, sortOrder: num(r.sortOrder), isContra: num(r.isContra) }));
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

/** Per-row override (or clear with null). */
export async function setOverride(input: { id: number; category: string | null }) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  await db.execute(sql`UPDATE "bankTransactions" SET "categoryOverride"=${input.category} WHERE "id"=${input.id}`);
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
