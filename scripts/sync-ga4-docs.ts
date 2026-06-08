/**
 * Sync GA4's "General CSV Export" of Documents (human-readable headers) into the web DB.
 *
 *   npx tsx scripts/sync-ga4-docs.ts "<path/to/All Documents ….csv>"        # DRY RUN
 *   npx tsx scripts/sync-ga4-docs.ts "<path>" --go                          # apply
 *
 * This is the export you get from GA4 → Admin → General → General CSV Exports → Documents
 * (by Creation-Date range). Columns: "ID Doc","ID Customer","ID Vehicle","Doc Type","Doc No",
 * dates, name/address, "Registration"/"Make"/"Model"/"Mileage"/"VIN", subtotals, "Total Net/
 * Tax/Gross","Total Receipts". (Different column names from the internal-field export that
 * scripts/sync-ga4.ts reads — hence a dedicated mapper.)
 *
 * SAFE BY DESIGN: matches strictly on GA4 `_ID` (externalId). Never deletes. Never overwrites
 * web-created rows (externalId LIKE 'WEB-%'). Customers/vehicles are INSERT-ONLY (a brand-new
 * customer/vehicle on a new job sheet is created; existing ones are never modified). Documents
 * are upserted (insert new, update changed) so the list mirrors GA4's open jobs exactly.
 */
import "dotenv/config";
import fs from "fs";
import path from "path";
import os from "os";
import mysql from "mysql2/promise";
import { parse } from "csv-parse/sync";
import { parseGA4Date } from "../server/services/csv-import";

const GO = process.argv.includes("--go");
const fileArg = process.argv.slice(2).find((a) => !a.startsWith("--"));
const VM_EXPORTS = path.join(os.homedir(), "Library/Parallels/Windows Disks/{0765f06c-a42d-40cf-af9b-4068ce38b6ee}/[C] Win11Manual.hidden/GA4 User Data/Data Exports");

function resolveCsv(): string {
  if (fileArg) return fileArg;
  // else newest "All Documents …" csv in the VM export folder
  const files = fs.readdirSync(VM_EXPORTS).filter((f) => /^All Documents.*\.csv$/i.test(f));
  if (!files.length) { console.error(`No "All Documents …" CSV found; pass a path.`); process.exit(1); }
  const newest = files.map((f) => ({ f, m: fs.statSync(path.join(VM_EXPORTS, f)).mtimeMs })).sort((a, b) => b.m - a.m)[0];
  return path.join(VM_EXPORTS, newest.f);
}

const norm = (s: any) => String(s ?? "").trim();
const cap = (s: any, n: number) => (s == null ? null : String(s).slice(0, n));
const money = (v: any) => { const s = norm(v).replace(/,/g, ""); return s === "" ? null : String(Number(s).toFixed(2)); };
const num = (v: any) => Number(norm(v).replace(/,/g, "")) || 0;
const dt = (d: Date | null) => (d ? d.toISOString().slice(0, 19).replace("T", " ") : null);
const dt2 = (v: any): string | null => (v ? new Date(v).toISOString().slice(0, 19).replace("T", " ") : null);
const eq = (a: any, b: any) => norm(a) === norm(b);
const numEq = (a: any, b: any) => Number(norm(a).replace(/,/g, "") || 0) === Number(norm(b).replace(/,/g, "") || 0);

const csvPath = resolveCsv();
console.log(`\nGA4 Documents → Web sync ${GO ? "(APPLYING)" : "(DRY RUN — no writes)"}\nsource: ${path.basename(csvPath)}\n`);
const rows: Record<string, string>[] = parse(fs.readFileSync(csvPath), { columns: true, skip_empty_lines: true, relax_quotes: true, relax_column_count: true });
console.log(`${rows.length} documents in export\n`);

const c = await mysql.createConnection({ uri: process.env.DATABASE_URL!, ssl: { rejectUnauthorized: true } });
const q = async (sql: string, p?: any[]) => (await c.query(sql, p))[0] as any[];

// ---- build a customer display name + address from the embedded doc fields ----
function custName(r: Record<string, string>) {
  const person = [norm(r["Title"]), norm(r["Forename"]), norm(r["Surname"])].filter(Boolean).join(" ").trim();
  return person || norm(r["Company Name"]) || null;
}
function custAddress(r: Record<string, string>) {
  return [r["House No"], r["Road"], r["Locality"], r["Town"], r["County"], r["Postcode"]].map(norm).filter(Boolean).join(", ") || null;
}
const phone = (r: Record<string, string>) => norm(r["Mobile"]).replace(/\s*[a-z].*$/i, "").trim() || norm(r["Telephone"]) || null; // strip notes like "07… simon"

// ---- existing id → row maps (skip web-created) ----
const custByExt = new Map<string, number>();
for (const r of await q("SELECT id, externalId FROM customers WHERE externalId IS NOT NULL AND externalId NOT LIKE 'WEB-%'")) custByExt.set(r.externalId, r.id);
const vehByExt = new Map<string, number>();
for (const r of await q("SELECT id, externalId FROM vehicles WHERE externalId IS NOT NULL AND externalId NOT LIKE 'WEB-%'")) vehByExt.set(r.externalId, r.id);

// ---- 1) ensure customers (insert-only for brand-new ids) ----
const newCustomers = new Map<string, any[]>();
for (const r of rows) {
  const ext = norm(r["ID Customer"]);
  if (!ext || custByExt.has(ext) || newCustomers.has(ext)) continue;
  if (!custName(r)) continue; // no name to create from
  newCustomers.set(ext, [ext, cap(custName(r), 255), cap(phone(r), 50), null, cap(norm(r["Postcode"]), 20) || null, cap(custAddress(r), 500)]);
}
console.log(`Customers: +${newCustomers.size} new (insert-only)`);
if (GO && newCustomers.size) {
  const vals = [...newCustomers.values()];
  for (let i = 0; i < vals.length; i += 500) await c.query("INSERT INTO customers (externalId, name, phone, email, postcode, address) VALUES ?", [vals.slice(i, i + 500)]);
  for (const r of await q("SELECT id, externalId FROM customers WHERE externalId IS NOT NULL AND externalId NOT LIKE 'WEB-%'")) custByExt.set(r.externalId, r.id);
}

// ---- 2) ensure vehicles (insert-only) ----
const newVehicles = new Map<string, any[]>();
for (const r of rows) {
  const ext = norm(r["ID Vehicle"]);
  const reg = norm(r["Registration"]).toUpperCase();
  if (!ext || !reg || vehByExt.has(ext) || newVehicles.has(ext)) continue;
  newVehicles.set(ext, [ext, cap(reg, 20), cap(norm(r["Make"]), 100) || null, cap(norm(r["Model"]), 100) || null,
    cap(norm(r["VIN"]), 50) || null, custByExt.get(norm(r["ID Customer"])) ?? null]);
}
console.log(`Vehicles:  +${newVehicles.size} new (insert-only)`);
if (GO && newVehicles.size) {
  const vals = [...newVehicles.values()];
  for (let i = 0; i < vals.length; i += 500) await c.query("INSERT INTO vehicles (externalId, registration, make, model, vin, customerId) VALUES ?", [vals.slice(i, i + 500)]);
  for (const r of await q("SELECT id, externalId FROM vehicles WHERE externalId IS NOT NULL AND externalId NOT LIKE 'WEB-%'")) vehByExt.set(r.externalId, r.id);
}

// ---- 3) documents (upsert by externalId) ----
const DOC_COLS = ["customerId", "vehicleId", "docType", "docNo", "dateCreated", "dateIssued", "datePaid",
  "totalNet", "totalTax", "totalGross", "totalReceipts", "balance", "mileage", "docStatus", "registration",
  "customerName", "company", "accountNumber", "custTitle", "custForename", "custSurname",
  "custHouseNo", "custRoad", "custTown", "custCounty", "custPostcode", "custTelephone", "custMobile",
  "subMotNet", "subMotTax", "subMotGross", "subLabourNet", "subLabourTax", "subLabourGross", "subPartsNet", "subPartsTax", "subPartsGross"];

const existing = new Map<string, any>();
for (const r of await q(`SELECT id, externalId, docType, docNo, totalGross, totalReceipts, balance, docStatus, dateIssued, datePaid, customerId, vehicleId FROM serviceHistory WHERE externalId IS NOT NULL AND externalId NOT LIKE 'WEB-%'`))
  if (!existing.has(r.externalId)) existing.set(r.externalId, r);

function mapDoc(r: Record<string, string>) {
  const ext = norm(r["ID Doc"]);
  if (!ext) return null;
  const docType = norm(r["Doc Type"]);
  const receipts = num(r["Total Receipts"]);
  const gross = num(r["Total Gross"]);
  const dIssued = parseGA4Date(norm(r["Date Issued"]));
  const dPaid = parseGA4Date(norm(r["Date Paid"]));
  return {
    externalId: ext,
    customerId: custByExt.get(norm(r["ID Customer"])) ?? null,
    vehicleId: vehByExt.get(norm(r["ID Vehicle"])) ?? null,
    docType: cap(docType, 20), docNo: cap(norm(r["Doc No"]), 50),
    dateCreated: dt(parseGA4Date(norm(r["Date Created"]))), dateIssued: dt(dIssued), datePaid: dt(dPaid),
    totalNet: money(r["Total Net"]), totalTax: money(r["Total Tax"]), totalGross: money(r["Total Gross"]),
    totalReceipts: money(r["Total Receipts"]), balance: String((gross - receipts).toFixed(2)),
    mileage: norm(r["Mileage"]) ? parseInt(norm(r["Mileage"]).replace(/[^0-9]/g, "")) || null : null,
    docStatus: dPaid ? "Paid" : dIssued ? "Issued" : "New",
    registration: cap(norm(r["Registration"]).toUpperCase(), 20),
    customerName: cap(custName(r), 255), company: cap(norm(r["Company Name"]), 255) || null, accountNumber: cap(norm(r["Account No"]), 50) || null,
    custTitle: cap(norm(r["Title"]), 20) || null, custForename: cap(norm(r["Forename"]), 100) || null, custSurname: cap(norm(r["Surname"]), 100) || null,
    custHouseNo: cap(norm(r["House No"]), 50) || null, custRoad: cap(norm(r["Road"]), 200) || null, custTown: cap(norm(r["Town"]), 100) || null,
    custCounty: cap(norm(r["County"]), 100) || null, custPostcode: cap(norm(r["Postcode"]), 20) || null,
    custTelephone: cap(norm(r["Telephone"]), 50) || null, custMobile: cap(norm(r["Mobile"]), 50) || null,
    subMotNet: money(r["Sub MOT Net"]), subMotTax: money(r["Sub MOT Tax"]), subMotGross: money(r["Sub MOT Gross"]),
    subLabourNet: money(r["Sub Labour Net"]), subLabourTax: money(r["Sub Labour Tax"]), subLabourGross: money(r["Sub Labour Gross"]),
    subPartsNet: money(r["Sub Parts Net"]), subPartsTax: money(r["Sub Parts Tax"]), subPartsGross: money(r["Sub Parts Gross"]),
  } as Record<string, any>;
}

const toInsert: any[][] = [];
const toUpdate: { id: number; vals: Record<string, any> }[] = [];
let same = 0;
const changed = (g: any, w: any) => !numEq(g.totalGross, w.totalGross) || !numEq(g.totalReceipts, w.totalReceipts)
  || !numEq(g.balance, w.balance) || !eq(g.docStatus, w.docStatus) || !eq(g.docNo, w.docNo) || !eq(g.docType, w.docType)
  || !eq(g.dateIssued, dt2(w.dateIssued)) || !eq(g.datePaid, dt2(w.datePaid)) || (g.customerId && g.customerId !== w.customerId) || (g.vehicleId && g.vehicleId !== w.vehicleId);

for (const r of rows) {
  const m = mapDoc(r);
  if (!m) continue;
  const web = existing.get(m.externalId);
  if (!web) toInsert.push([m.externalId, ...DOC_COLS.map((k) => m[k] ?? null)]);
  else if (changed(m, web)) toUpdate.push({ id: web.id, vals: m });
  else same++;
}
console.log(`Documents: +${toInsert.length} new, ~${toUpdate.length} changed, ${same} unchanged\n`);

// show the NEW ones (the gap we're closing)
if (toInsert.length) {
  console.log("New documents that will appear in the web list:");
  for (const r of rows) {
    const ext = norm(r["ID Doc"]);
    if (toInsert.some((t) => t[0] === ext)) console.log(`  ${norm(r["Doc Type"])} ${norm(r["Doc No"]).padEnd(7)} ${norm(r["Registration"]).padEnd(9)} ${(custName(r) || "—")}`);
  }
  console.log();
}

if (GO) {
  for (let i = 0; i < toInsert.length; i += 500)
    await c.query(`INSERT INTO serviceHistory (externalId, ${DOC_COLS.join(",")}) VALUES ?`, [toInsert.slice(i, i + 500)]);
  for (const u of toUpdate)
    await c.query(`UPDATE serviceHistory SET ${DOC_COLS.map((k) => `${k}=?`).join(",")} WHERE id=?`, [...DOC_COLS.map((k) => u.vals[k] ?? null), u.id]);
  console.log("✓ Applied.");
} else {
  console.log("Dry run complete — re-run with --go to apply.");
}
await c.end();
process.exit(0);
