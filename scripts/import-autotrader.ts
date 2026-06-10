/**
 * Enrich salesStock with an AutoTrader "Exported Forecourt" CSV — pricing intelligence,
 * provenance/vehicle-check issues (e.g. Stolen, Mileage discrepancy) and advert performance.
 * Matches existing stock by registration (updating the AutoTrader insight + volatile fields,
 * keeping the website's images/title), and inserts any AutoTrader-only cars (with DVLA MOT/tax).
 *
 *   npx tsx scripts/import-autotrader.ts ["<path/to/Exported Forecourt.csv>"]
 */
import "dotenv/config";
import fs from "fs";
import mysql from "mysql2/promise";
import { parse } from "csv-parse/sync";
import { getVehicleDetails } from "../server/dvlaApi";

const FILE = process.argv[2] || "/Users/service/Downloads/Exported Forecourt-5.csv";
const c = await mysql.createConnection({ uri: process.env.DATABASE_URL!, ssl: { rejectUnauthorized: true } });
const q = async (s: string, p?: any[]) => (await c.query(s, p))[0] as any;

// add AutoTrader columns idempotently
for (const col of [
  "priceIndicator VARCHAR(30)", "pricePosition VARCHAR(20)", "retailValuation DECIMAL(10,2)",
  "adminFee DECIMAL(10,2)", "performanceRating VARCHAR(30)", "views7d INT", "searches7d INT",
  "checkStatus VARCHAR(30)", "checkIssues VARCHAR(255)", "atAdvertStatus VARCHAR(30)",
  "bodyType VARCHAR(50)", "doors INT",
]) { try { await q(`ALTER TABLE salesStock ADD COLUMN ${col}`); } catch { /* already exists */ } }

const rows: any[] = parse(fs.readFileSync(FILE), { columns: true, skip_empty_lines: true, relax_quotes: true, relax_column_count: true, bom: true });
console.log(`${rows.length} cars in AutoTrader export\n`);

const num = (x: any) => { const s = String(x ?? "").replace(/[^0-9.\-]/g, ""); const n = Number(s); return s === "" || isNaN(n) ? null : n; };
const toDate = (x: any) => {
  if (!x) return null; const s = String(x).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) { const d = new Date(s); return isNaN(d.getTime()) ? null : d; }
  const p = s.split("/"); if (p.length === 3) { const d = new Date(+p[2], +p[1] - 1, +p[0]); return isNaN(d.getTime()) ? null : d; }
  const d = new Date(s); return isNaN(d.getTime()) ? null : d;
};

const existing = new Map<string, number>();
for (const r of await q("SELECT id, registration FROM salesStock")) existing.set(String(r.registration || "").toUpperCase().replace(/\s+/g, ""), r.id);

let updated = 0, inserted = 0, alerts = 0;
for (const r of rows) {
  const reg = String(r.VRM || "").toUpperCase().replace(/\s+/g, "");
  if (!reg) continue;
  const insight: any = {
    priceIndicator: r["Price indicator"] || null, pricePosition: r["Price position"] || null,
    retailValuation: num(r["Retail valuation"]), adminFee: num(r["Admin fee"]),
    performanceRating: r["Performance rating"] || null, views7d: num(r["Last 7 days advert views"]),
    searches7d: num(r["Last 7 days search appearances"]), checkStatus: r["Vehicle check status"] || null,
    checkIssues: r["Vehicle check issues"] || null, atAdvertStatus: r["Auto Trader"] || null,
    bodyType: r["Body Type"] || null, doors: num(r.Doors),
    price: num(r["Retail price"]), daysInStock: num(r["Days in stock"]), vatStatus: r["VAT status"] || null,
  };
  if (insight.checkIssues) alerts++;
  const id = existing.get(reg);
  if (id) {
    await q("UPDATE salesStock SET ? WHERE id=?", [insight, id]);
    updated++;
  } else {
    const w = String(r.Description || "").split(/\s+/);
    let motExpiryDate = null, taxStatus = null, taxDueDate = null, motTaxChecked = null;
    try { const d: any = await getVehicleDetails(reg); if (d) { motExpiryDate = toDate(d.motExpiryDate); taxStatus = d.taxStatus || null; taxDueDate = toDate(d.taxDueDate); motTaxChecked = new Date(); } } catch { /* no DVLA */ }
    await q("INSERT INTO salesStock SET ?", [{
      externalId: "AT-" + reg, registration: r.VRM, title: r.Description || null, make: w[0] || null, model: w[1] || null,
      vin: r.Vin || null, status: "ON FORECOURT", vehicleType: "CAR", mileage: num(r.Mileage),
      colour: r.Colour || null, fuelType: r.Fuel || null, registrationDate: toDate(r["Registration date"]),
      motExpiryDate, taxStatus, taxDueDate, motTaxChecked, ...insight,
    }]);
    inserted++;
  }
  const flag = r["Vehicle check issues"] ? `  ⚠ ${r["Vehicle check issues"]}` : "";
  console.log(`  ${reg.padEnd(8)} ${(r.Description || "").slice(0, 32).padEnd(32)} ${(r["Price indicator"] || "-").padEnd(11)} val £${num(r["Retail valuation"]) ?? "-"}${flag}`);
}
console.log(`\n✓ AutoTrader: ${updated} updated, ${inserted} inserted, ${alerts} with vehicle-check issues.`);
await c.end();
process.exit(0);
