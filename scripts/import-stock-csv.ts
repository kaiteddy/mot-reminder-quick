/**
 * import-stock-csv.ts — top up the stock list from the two dealer exports.
 *
 * The nightly website sync (server/services/websiteStock.ts) covers everything the public site
 * publishes. Three things it CANNOT see, and this is where they come from:
 *
 *   chassis number   the adverts never show a VIN, and the only other source is the UKVD lookup
 *                    at 14p a car — both exports carry it for free
 *   days in stock    and AutoTrader's pricing intelligence: valuation, price indicator, advert
 *                    views, and the vehicle-check flags (Stolen, Mileage discrepancy)
 *   SOLD             the website simply stops showing a car; it can't say whether that means
 *                    sold, in prep or a lapsed advert. The CarDealer5 export says outright.
 *
 * Accepts either file, in any order — the header tells them apart:
 *   npx tsx scripts/import-stock-csv.ts ~/Downloads/elimotors.co.uk_stocklist-7.csv ~/Downloads/"Exported Forecourt-7.csv"
 *
 * Dry run unless --apply. Same safety rules as the website sync: it only ever updates cars we
 * already hold and never invents one. The exports carry the whole sales history — 35 sold cars
 * we've never had a stock row for — and tipping those into the forecourt view would bury the
 * cars actually for sale, so they are counted and left out.
 *
 * A car the export marks SOLD is REPORTED, not changed: marking it sold here would record the
 * sale with no price and no date and quietly wrong the cashbook. Pass --mark-sold to set the
 * status anyway (still no price/date — fill those in from the stock page).
 */
import "dotenv/config";
import fs from "node:fs";
import { parse } from "csv-parse/sync";

const APPLY = process.argv.includes("--apply");
const MARK_SOLD = process.argv.includes("--mark-sold");
const FILES = process.argv.slice(2).filter((a) => !a.startsWith("--"));
if (!FILES.length) throw new Error("give at least one CSV (the CarDealer5 stocklist and/or the AutoTrader export)");

const norm = (r: unknown) => String(r ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const num = (x: unknown): number | null => {
  const s = String(x ?? "").replace(/[^0-9.\-]/g, "");
  const n = Number(s);
  return s === "" || !Number.isFinite(n) ? null : n;
};
const str = (x: unknown): string | null => { const s = String(x ?? "").trim(); return s === "" ? null : s; };
/** Exports date as dd/mm/yyyy; `new Date` reads that as month-first and silently invents a date. */
const toDate = (x: unknown): Date | null => {
  const s = String(x ?? "").trim();
  if (!s) return null;
  const uk = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(s);
  const d = uk ? new Date(Number(uk[3]), Number(uk[2]) - 1, Number(uk[1])) : new Date(s);
  return isNaN(d.getTime()) ? null : d;
};

type Patch = Record<string, any>;
/** Per registration: what each file wants to write, and what the exports say the car's status is. */
const wanted = new Map<string, Patch>();
const declaredStatus = new Map<string, string>();
const externalIds = new Map<string, string>();
const seenInExport = new Map<string, { reg: string; status: string; make: string; model: string; price: number | null }>();
const put = (reg: string, patch: Patch) => {
  const cur = wanted.get(reg) || {};
  for (const [k, v] of Object.entries(patch)) if (v !== undefined) cur[k] = v;
  wanted.set(reg, cur);
};

let cd5Rows = 0, atRows = 0;
for (const file of FILES) {
  const rows: any[] = parse(fs.readFileSync(file), { columns: true, skip_empty_lines: true, relax_quotes: true, relax_column_count: true, bom: true, trim: true });
  const head = Object.keys(rows[0] || {});

  if (head.includes("VehicleID")) {
    // ── CarDealer5 stocklist: the dealer's own system of record, including sold cars ──
    cd5Rows = rows.length;
    for (const r of rows) {
      const reg = norm(r.Registration);
      if (!reg) continue;
      const status = String(r.Status || "").toUpperCase().trim();
      declaredStatus.set(reg, status);
      externalIds.set(reg, String(r.VehicleID));
      seenInExport.set(reg, { reg, status, make: str(r.Make) || "", model: str(r.Model) || "", price: num(r.Price) });
      put(reg, {
        vin: str(r.VinNo),                       // backfill only, applied below
        registrationDate: toDate(r.RegistrationDate),
        stockNumber: str(r.StockNumber),
        category: str(r.Category),
        vatStatus: str(r.VatStatus),
        // Only a car the dealer system still calls stock can move our advertised figures; a SOLD
        // row's price is the last thing it was listed at, not what it is worth now.
        ...(status === "ON FORECOURT" ? {
          price: num(r.Price) == null ? undefined : String(num(r.Price)),
          mileage: num(r.Mileage), variant: str(r.Variant), transmission: str(r.Transmission),
          owners: num(r["P.Owners"]), title: str(r.Title), year: num(r.Year),
          daysInStock: num(r.DaysInStock),
        } : {}),
      });
    }
  } else if (head.includes("VRM")) {
    // ── AutoTrader "Exported Forecourt": pricing intelligence and the vehicle check ──
    atRows = rows.length;
    for (const r of rows) {
      const reg = norm(r.VRM);
      if (!reg) continue;
      put(reg, {
        vin: str(r.Vin),
        registrationDate: toDate(r["Registration date"]),
        bodyType: str(r["Body Type"]), doors: num(r.Doors),
        mileage: num(r.Mileage),
        price: num(r["Retail price"]) == null ? undefined : String(num(r["Retail price"])),
        // AutoTrader counts from the day the car arrived; CarDealer5's figure resets when a car is
        // re-listed, which is why four cars there all read an identical 428 days. Prefer this one.
        daysInStock: num(r["Days in stock"]),
        vatStatus: str(r["VAT status"]),
        // The whole AutoTrader block is written as it stands, blanks included: a valuation or an
        // advert-view count that is no longer in the export is stale, and a vehicle-check issue
        // that has been resolved MUST clear rather than sit on the car as a permanent alert.
        priceIndicator: str(r["Price indicator"]), pricePosition: str(r["Price position"]),
        retailValuation: num(r["Retail valuation"]) == null ? null : String(num(r["Retail valuation"])),
        adminFee: num(r["Admin fee"]) == null ? null : String(num(r["Admin fee"])),
        performanceRating: str(r["Performance rating"]),
        views7d: num(r["Last 7 days advert views"]), searches7d: num(r["Last 7 days search appearances"]),
        checkStatus: str(r["Vehicle check status"]), checkIssues: str(r["Vehicle check issues"]),
        atAdvertStatus: str(r["Auto Trader"]),
      });
    }
  } else {
    throw new Error(`${file}: header has neither VehicleID (CarDealer5) nor VRM (AutoTrader) — is this a stock export?`);
  }
}

/** Case and trailing-zero differences aren't changes; see the same rule in websiteStock.ts. */
function differs(from: any, to: any): boolean {
  if (to == null) return from != null && from !== "";
  if (from == null || from === "") return true;
  if (from instanceof Date || to instanceof Date) return +new Date(from) !== +new Date(to as any);
  if (typeof to === "number") return Number(from) !== Number(to);
  const a = String(from).trim(), b = String(to).trim();
  const numeric = /^-?\d*\.?\d+$/;
  if (numeric.test(a) && numeric.test(b)) return Number(a) !== Number(b);
  return a.toLowerCase().replace(/\s+/g, " ") !== b.toLowerCase().replace(/\s+/g, " ");
}
/** Ours already and better sourced — the export may only fill the blank. */
const BACKFILL_ONLY = new Set(["vin", "registrationDate", "title", "year", "variant"]);
/**
 * The only columns a BLANK in the export is allowed to erase — AutoTrader's own intelligence,
 * where a figure that has dropped out is stale and a vehicle-check issue that has dropped out is
 * resolved. Everywhere else a blank cell means the export didn't carry the field, not that the
 * car hasn't got one: the sold rows leave VAT status empty, and P.Owners is blank on cars whose
 * owner count we already have from the advert.
 */
const CLEARABLE = new Set(["priceIndicator", "pricePosition", "retailValuation", "adminFee",
  "performanceRating", "views7d", "searches7d", "checkStatus", "checkIssues", "atAdvertStatus"]);

(async () => {
  const { getDb } = await import("../server/db");
  const { sql } = await import("drizzle-orm");
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const run = async (q: any) => ((await db.execute(q)) as any).rows ?? [];

  const rows: any[] = await run(sql`SELECT * FROM "salesStock"`);
  const byReg = new Map<string, any>();
  for (const r of rows) if (r.registration) byReg.set(norm(r.registration), r);

  console.log(`${cd5Rows} rows in the CarDealer5 stocklist, ${atRows} in the AutoTrader export → ${rows.length} stock cars here\n`);

  let touched = 0, fields = 0;
  const soldElsewhere: string[] = [];
  for (const [reg, patch] of wanted) {
    const car = byReg.get(reg);
    if (!car) continue;

    const changes: [string, any, any][] = [];
    for (const [col, to] of Object.entries(patch)) {
      if (to === undefined) continue;
      if (to == null && !CLEARABLE.has(col)) continue;
      if (BACKFILL_ONLY.has(col) && car[col] != null && car[col] !== "") continue;
      if (!differs(car[col], to)) continue;
      changes.push([col, car[col], to]);
    }

    const declared = declaredStatus.get(reg);
    const saysSold = declared === "SOLD" && !/^sold$/i.test(String(car.status || ""));
    if (saysSold) soldElsewhere.push(`#${car.id} ${car.registration} — we say ${car.status}, CarDealer5 says SOLD (last listed £${seenInExport.get(reg)?.price ?? "?"})`);

    if (!changes.length && !(saysSold && MARK_SOLD)) continue;
    touched++; fields += changes.length;
    console.log(`  ${String(car.registration).padEnd(9)} ${changes.map(([c, f, t]) =>
      `${c} ${f == null || f === "" ? "—" : JSON.stringify(String(f)).slice(0, 22)}→${t == null ? "—" : JSON.stringify(String(t)).slice(0, 22)}`).join("  ")}${saysSold && MARK_SOLD ? "  status →SOLD" : ""}`);

    if (APPLY) {
      const set: any = {};
      for (const [col, , to] of changes) set[col] = to;
      if (saysSold && MARK_SOLD) set.status = "SOLD";
      const assignments = Object.keys(set).map((c) => sql`, ${sql.identifier(c)} = ${set[c]}`);
      await db.execute(sql`UPDATE "salesStock" SET "updatedAt" = now()${sql.join(assignments, sql``)} WHERE id = ${car.id}`);
    }
  }

  // Cars in the exports we hold no stock row for. Almost all are sold history; a live one would
  // be a genuine gap, so they're split out rather than lumped together.
  const missingLive: string[] = [], missingSold: string[] = [];
  for (const [reg, e] of seenInExport) {
    if (byReg.has(reg)) continue;
    (e.status === "SOLD" ? missingSold : missingLive).push(`${e.reg} ${e.make} ${e.model}${e.price ? ` £${e.price}` : ""}`);
  }

  console.log(`\n${APPLY ? "Applied" : "Would change"}: ${fields} field(s) across ${touched} car(s)${APPLY ? "" : "  (add --apply to write)"}`);
  if (soldElsewhere.length) {
    console.log(`\nSOLD in the dealer system but still in stock here${MARK_SOLD ? " (marked)" : ""}:`);
    for (const s of soldElsewhere) console.log(`  ${s}`);
    if (!MARK_SOLD) console.log(`  → mark them from the stock page so the sale price and date go in, or re-run with --mark-sold`);
  }
  if (missingLive.length) { console.log(`\nAdvertised in an export with no stock row here:`); for (const m of missingLive) console.log(`  ${m}`); }
  if (missingSold.length) console.log(`\n${missingSold.length} sold cars in the export have no stock row here — sales history, deliberately not imported.`);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
