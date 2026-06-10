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
 * GA4 IS THE SOURCE OF TRUTH (until everything is created in the web app): documents are matched
 * by GA4 `_ID` (externalId) and upserted (insert new, update changed) so the list mirrors GA4's
 * open jobs exactly. Any web-created doc (externalId WEB-…) that has grabbed a real GA4 document
 * number is REMOVED so GA4 always wins and there are no duplicate numbers. Customers/vehicles are
 * INSERT-ONLY (a brand-new one on a job sheet is created; existing master records aren't touched).
 * Never deletes real GA4 rows.
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
// merged duplicates: map each dead GA4 id → the surviving primary, so a doc referencing a
// merged-away customer links to the survivor instead of re-creating the duplicate.
for (const r of await q("SELECT id, mergedExternalIds FROM customers WHERE mergedExternalIds IS NOT NULL")) {
  try { for (const a of (typeof r.mergedExternalIds === "string" ? JSON.parse(r.mergedExternalIds) : r.mergedExternalIds) || []) custByExt.set(a, r.id); } catch { /* bad json */ }
}
const vehByExt = new Map<string, number>();
const vehByReg = new Map<string, { id: number; externalId: string | null }>(); // also match by reg, so vehicles created outside the GA4 import (e.g. via a lookup, no externalId) aren't duplicated
for (const r of await q("SELECT id, externalId, registration FROM vehicles")) {
  if (r.externalId && !String(r.externalId).startsWith("WEB-")) vehByExt.set(r.externalId, r.id);
  const reg = String(r.registration ?? "").toUpperCase().replace(/\s+/g, "");
  if (reg && !vehByReg.has(reg)) vehByReg.set(reg, { id: r.id, externalId: r.externalId });
}
const vehId = (ext: string, reg: string) => vehByExt.get(ext) ?? vehByReg.get(reg.toUpperCase().replace(/\s+/g, ""))?.id ?? null;
// a doc's bill-to is a COMPANY/insurer when it has a Company Name and no personal Surname → NOT the vehicle owner
const isCompanyBillTo = (r: Record<string, string>) => !norm(r["Surname"]) && !!norm(r["Company Name"]);
// the real owner for a vehicle = a row where the customer is a PERSON (prefer over an insurer's invoice row)
const ownerForVehicle = new Map<string, number>();
for (const r of rows) {
  const vext = norm(r["ID Vehicle"]); const cust = custByExt.get(norm(r["ID Customer"]));
  if (vext && cust && !isCompanyBillTo(r) && !ownerForVehicle.has(vext)) ownerForVehicle.set(vext, cust);
}

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

// ---- 2) ensure vehicles: link existing (by GA4 id, else by reg), create only the genuinely-new ----
const toCreateVeh = new Map<string, any[]>();
const toLinkVeh: { id: number; ext: string; owner: number | null }[] = [];
const seenVeh = new Set<string>();
for (const r of rows) {
  const ext = norm(r["ID Vehicle"]);
  const reg = norm(r["Registration"]).toUpperCase();
  if (!ext || !reg || seenVeh.has(ext)) continue;
  seenVeh.add(ext);
  if (vehByExt.has(ext)) continue; // already linked by GA4 _ID
  const existing = vehByReg.get(reg.replace(/\s+/g, ""));
  if (existing) {
    // a vehicle with this reg already exists (e.g. created by a lookup) but lacks this GA4 id —
    // link it instead of creating a duplicate; fill the owner only if it has none
    toLinkVeh.push({ id: existing.id, ext, owner: existing.externalId ? null : (ownerForVehicle.get(ext) ?? null) });
  } else {
    // brand-new vehicle: owner is the PERSON on its jobs, never the insurer/company bill-to
    toCreateVeh.set(ext, [ext, cap(reg, 20), cap(norm(r["Make"]), 100) || null, cap(norm(r["Model"]), 100) || null,
      cap(norm(r["VIN"]), 50) || null, ownerForVehicle.get(ext) ?? null]);
  }
}
console.log(`Vehicles:  +${toCreateVeh.size} new, ${toLinkVeh.length} linked to an existing record (by reg)`);
if (GO) {
  const vals = [...toCreateVeh.values()];
  for (let i = 0; i < vals.length; i += 500) await c.query("INSERT INTO vehicles (externalId, registration, make, model, vin, customerId) VALUES ?", [vals.slice(i, i + 500)]);
  for (const l of toLinkVeh)
    await c.query(l.owner != null ? "UPDATE vehicles SET externalId=?, customerId=COALESCE(customerId,?) WHERE id=?" : "UPDATE vehicles SET externalId=? WHERE id=?",
      l.owner != null ? [l.ext, l.owner, l.id] : [l.ext, l.id]);
  for (const r of await q("SELECT id, externalId, registration FROM vehicles")) {
    if (r.externalId && !String(r.externalId).startsWith("WEB-")) vehByExt.set(r.externalId, r.id);
    const k = String(r.registration ?? "").toUpperCase().replace(/\s+/g, "");
    if (k && !vehByReg.has(k)) vehByReg.set(k, { id: r.id, externalId: r.externalId });
  }
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
    vehicleId: vehId(norm(r["ID Vehicle"]), norm(r["Registration"])),
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

// ---- 3b) GA4 OVERRIDES THE WEB APP ----------------------------------------------------------
// Until everything is created in the web app, GA4 is the source of truth: any web-created doc
// (externalId WEB-…) that has grabbed a real GA4 document number is removed so the list mirrors
// GA4 exactly with no duplicate numbers. (Real GA4 docs that legitimately reuse a number across
// years/types are left alone — we only drop WEB-… rows.)
const ga4DocNos = [...new Set(rows.map((r) => norm(r["Doc No"])).filter(Boolean))];
const webCollisions = ga4DocNos.length
  ? await q(`SELECT id, docNo, registration FROM serviceHistory WHERE externalId LIKE 'WEB-%' AND docNo IN (?)`, [ga4DocNos])
  : [];
if (webCollisions.length) {
  console.log(`Web-created docs overridden by GA4 (same number) — removed: ${webCollisions.length}`);
  for (const w of webCollisions as any[]) console.log(`  ${String(w.docNo).padEnd(7)} web '${w.registration || "—"}' → GA4 wins`);
  console.log();
}

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
  if (webCollisions.length) {
    const ids = (webCollisions as any[]).map((w) => w.id);
    await q(`DELETE FROM serviceLineItems WHERE documentId IN (?)`, [ids]);
    await q(`DELETE FROM customerLogs WHERE documentId IN (?)`, [ids]);
    await q(`DELETE FROM serviceHistory WHERE id IN (?)`, [ids]);
  }
  console.log("✓ Applied.");
} else {
  console.log("Dry run complete — re-run with --go to apply.");
}
await c.end();
process.exit(0);
