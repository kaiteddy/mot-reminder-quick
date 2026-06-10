/**
 * Import the dealership forecourt stocklist (CSV from the website) into salesStock, and fetch
 * DVLA MOT expiry + tax status for each car so we can see compliance at a glance.
 *
 *   npx tsx scripts/import-sales-stock.ts ["<path/to/stocklist.csv>"]
 *
 * Idempotent: upserts by the CSV VehicleID (externalId). Safe to re-run to refresh prices,
 * days-in-stock and MOT/tax. DVLA is free; ~17 calls.
 */
import "dotenv/config";
import fs from "fs";
import mysql from "mysql2/promise";
import { parse } from "csv-parse/sync";
import { getVehicleDetails } from "../server/dvlaApi";
import { getCurrentMotExpiry } from "../server/motApi";

const FILE = process.argv[2] || "/Users/service/Downloads/elimotors.co.uk_stocklist.csv";
const c = await mysql.createConnection({ uri: process.env.DATABASE_URL!, ssl: { rejectUnauthorized: true } });
const q = async (s: string, p?: any[]) => (await c.query(s, p))[0] as any;

await q(`CREATE TABLE IF NOT EXISTS salesStock (
  id INT AUTO_INCREMENT PRIMARY KEY,
  externalId VARCHAR(64) UNIQUE,
  registration VARCHAR(20), vin VARCHAR(50), title TEXT, make VARCHAR(100), model VARCHAR(100),
  variant TEXT, vehicleType VARCHAR(50), category VARCHAR(50), year INT, fuelType VARCHAR(50),
  colour VARCHAR(50), mileage INT, transmission VARCHAR(50), owners INT, price DECIMAL(10,2),
  vatStatus VARCHAR(50), status VARCHAR(50), daysInStock INT, stockNumber VARCHAR(50),
  registrationDate TIMESTAMP NULL, imageUrl TEXT, websiteUrl TEXT,
  motExpiryDate TIMESTAMP NULL, taxStatus VARCHAR(20), taxDueDate TIMESTAMP NULL, motTaxChecked TIMESTAMP NULL,
  createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP, updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX sales_stock_reg_idx (registration)
)`);

const rows: any[] = parse(fs.readFileSync(FILE), { columns: true, skip_empty_lines: true, relax_quotes: true, bom: true });
console.log(`${rows.length} stock cars in CSV\n`);

const toDate = (x: any) => { if (!x) return null; const d = new Date(x); return isNaN(d.getTime()) ? null : d; };
const num = (x: any) => { const n = Number(String(x ?? "").replace(/[^0-9.]/g, "")); return isNaN(n) || String(x ?? "").trim() === "" ? null : n; };

const COLS = ["externalId", "registration", "vin", "title", "make", "model", "variant", "vehicleType", "category", "year", "fuelType", "colour", "mileage", "transmission", "owners", "price", "vatStatus", "status", "daysInStock", "stockNumber", "registrationDate", "imageUrl", "websiteUrl", "motExpiryDate", "taxStatus", "taxDueDate", "motTaxChecked"];
const placeholders = COLS.map(() => "?").join(",");
const updates = COLS.filter((k) => k !== "externalId").map((k) => `${k}=VALUES(${k})`).join(",");

let imported = 0, gotMot = 0;
for (const r of rows) {
  const reg = String(r.Registration || "").toUpperCase().replace(/\s+/g, "");
  let motExpiry: Date | null = null, taxStatus = null, taxDue = null, checked: Date | null = null;
  try {
    // MOT expiry from DVSA MOT History (authoritative); tax from DVLA VES
    const [d, motExp]: any = await Promise.all([getVehicleDetails(reg).catch(() => null), getCurrentMotExpiry(reg)]);
    motExpiry = motExp; taxStatus = d?.taxStatus || null; taxDue = toDate(d?.taxDueDate); checked = new Date();
    if (motExpiry || taxStatus) gotMot++;
  } catch { /* DVLA/DVSA unavailable for this reg */ }
  const vals = [
    String(r.VehicleID), r.Registration || null, r.VinNo || null, r.Title || null, r.Make || null, r.Model || null,
    r.Variant || null, r.VehicleType || null, r.Category || null, num(r.Year), r.FuelType || null, r.Colour || null,
    num(r.Mileage), r.Transmission || null, num(r["P.Owners"]), num(r.Price), r.VatStatus || null, r.Status || null,
    num(r.DaysInStock), r.StockNumber || null, toDate(r.RegistrationDate), String(r.Images || "").split(",")[0] || null, r.WebsiteURL || null,
    motExpiry, taxStatus, taxDue, checked,
  ];
  await q(`INSERT INTO salesStock (${COLS.join(",")}) VALUES (${placeholders}) ON DUPLICATE KEY UPDATE ${updates}`, vals);
  imported++;
  console.log(`  ${(r.Registration || "?").padEnd(9)} ${(r.Make + " " + r.Model).slice(0, 22).padEnd(22)} £${String(r.Price).padEnd(6)} MOT ${motExpiry ? motExpiry.toISOString().slice(0, 10) : "—".padEnd(10)} Tax ${taxStatus || "—"}`);
}
console.log(`\n✓ Imported ${imported} stock cars (${gotMot} with DVLA MOT/tax).`);
await c.end();
process.exit(0);
