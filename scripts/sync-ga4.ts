/**
 * One-way GA4 -> Web incremental sync.
 *
 *   npx tsx scripts/sync-ga4.ts          # DRY RUN — reports what would change, writes nothing
 *   npx tsx scripts/sync-ga4.ts --go     # apply the changes
 *
 * Reads the GA4 CSV exports (Google Drive "Data Exports" by default; override with
 * GA4_EXPORTS=/path) and upserts customers, vehicles, documents and line items into the
 * shared TiDB by GA4 `_ID` (stored as `externalId`).
 *
 * SAFE BY DESIGN:
 *  - Matches strictly on GA4 `_ID`. Web-created records (externalId LIKE 'WEB-%') and rows
 *    with no externalId are NEVER touched.
 *  - Never deletes anything. Only INSERTs new GA4 records and UPDATEs changed ones.
 *  - Runs locally (where the GA4 exports live) against the production DB.
 */
import "dotenv/config";
import fs from "fs";
import path from "path";
import os from "os";
import mysql from "mysql2/promise";
import { parse } from "csv-parse/sync";
import { mapGA4Document, buildCustomerName, buildAddress, getPhoneNumber, getCustomerEmail, parseGA4Date } from "../server/services/csv-import";

const GO = process.argv.includes("--go");
const EXP = process.env.GA4_EXPORTS || path.join(os.homedir(), "Library/CloudStorage/GoogleDrive-adam@elimotors.co.uk/My Drive/Data Exports");

const norm = (s: any) => String(s ?? "").trim();
const cap = (s: any, n: number) => (s == null ? null : String(s).slice(0, n));
const clean = (s: any) => (s == null ? null : String(s).replace(/\x0B/g, "\n").replace(/\r/g, "").trim()); // GA4 line separator -> \n
const eq = (a: any, b: any) => norm(a) === norm(b);
const numEq = (a: any, b: any) => Number(a ?? 0) === Number(b ?? 0); // compare money/qty by value, not "100" vs "100.00"
const money = (v: any) => (v == null || v === "" ? null : String(Number(v).toFixed(2)));
const dt = (d: Date | null) => (d ? d.toISOString().slice(0, 19).replace("T", " ") : null);

function load(file: string): Record<string, string>[] {
  const p = path.join(EXP, file);
  if (!fs.existsSync(p)) { console.log(`  ! ${file} not found at ${p}`); return []; }
  return parse(fs.readFileSync(p), { columns: true, skip_empty_lines: true, relax_quotes: true, relax_column_count: true });
}

const c = await mysql.createConnection({ uri: process.env.DATABASE_URL!, ssl: { rejectUnauthorized: true } });
const q = async (sql: string, p?: any[]) => (await c.query(sql, p))[0] as any[];

console.log(`\nGA4 → Web sync ${GO ? "(APPLYING)" : "(DRY RUN — no writes)"}\nexports: ${EXP}\n`);

// generic upsert helper: diff GA4 rows vs web by externalId, INSERT new / UPDATE changed
async function syncTable(opts: {
  name: string; table: string; rows: any[];
  cols: string[];                         // db columns to write (besides externalId)
  map: (row: any) => Record<string, any> | null;  // GA4 row -> { externalId, ...cols } (null = skip)
  changed?: (ga4: any, web: any) => boolean;       // has anything we sync changed?
  insertOnly?: boolean;                            // never overwrite existing rows (safe for ambiguous data)
}) {
  const { name, table, rows, cols, map, changed, insertOnly } = opts;
  // existing GA4-sourced rows only (skip web-created + null externalId)
  const existing = new Map<string, any>();
  for (const r of await q(`SELECT id, externalId, ${cols.join(",")} FROM \`${table}\` WHERE externalId IS NOT NULL AND externalId NOT LIKE 'WEB-%'`))
    if (!existing.has(r.externalId)) existing.set(r.externalId, r);

  const toInsert: any[][] = [];
  const toUpdate: { id: number; vals: Record<string, any> }[] = [];
  let same = 0, skipped = 0;
  for (const row of rows) {
    const m = map(row);
    if (!m || !norm(m.externalId)) { skipped++; continue; }
    const web = existing.get(m.externalId);
    if (!web) { toInsert.push([m.externalId, ...cols.map((k) => m[k] ?? null)]); }
    else if (!insertOnly && changed && changed(m, web)) { toUpdate.push({ id: web.id, vals: m }); }
    else same++;
  }
  console.log(`${name}: ${rows.length} in GA4 → +${toInsert.length} new${insertOnly ? " (insert-only)" : `, ~${toUpdate.length} changed`}, ${same} kept, ${skipped} skipped`);

  if (GO) {
    for (let i = 0; i < toInsert.length; i += 500)
      await c.query(`INSERT INTO \`${table}\` (externalId, ${cols.join(",")}) VALUES ?`, [toInsert.slice(i, i + 500)]);
    for (const u of toUpdate)
      await c.query(`UPDATE \`${table}\` SET ${cols.map((k) => `${k}=?`).join(",")} WHERE id=?`, [...cols.map((k) => u.vals[k] ?? null), u.id]);
  }
  return { inserted: toInsert.length, updated: toUpdate.length };
}

// ---- 1) Customers ----
const customers = load("Customers.csv");
await syncTable({
  name: "Customers", table: "customers", rows: customers,
  cols: ["name", "phone", "email", "postcode", "address"],
  map: (r) => ({
    externalId: norm(r._ID), name: cap(buildCustomerName(r as any), 255) || "Unknown",
    phone: cap(getPhoneNumber(r as any), 50), email: cap(getCustomerEmail(r as any), 320),
    postcode: cap(norm(r.addressPostCode), 20) || null, address: cap(buildAddress(r as any), 500) || null,
  }),
  // Existing customer records came from a different source and disagree with today's export
  // (names/addresses), so never overwrite them — only add genuinely-new GA4 customers.
  insertOnly: true,
});

// rebuild externalId -> id for linking
const custMap = new Map<string, number>();
for (const r of await q("SELECT id, externalId FROM customers WHERE externalId IS NOT NULL")) custMap.set(r.externalId, r.id);

// ---- 2) Vehicles ----
const vehicles = load("Vehicles.csv");
await syncTable({
  name: "Vehicles", table: "vehicles", rows: vehicles,
  cols: ["registration", "make", "model", "colour", "fuelType", "vin", "engineCC", "engineNo", "engineCode", "customerId"],
  map: (r) => {
    const reg = norm(r.Registration).toUpperCase();
    if (!reg) return null;
    return {
      externalId: norm(r._ID), registration: cap(reg, 20), make: cap(norm(r.Make), 100) || null, model: cap(norm(r.Model), 100) || null,
      colour: cap(norm(r.Colour), 50) || null, fuelType: cap(norm(r.FuelType), 50) || null, vin: cap(norm(r.VIN), 50) || null,
      engineCC: norm(r.EngineCC) ? parseInt(norm(r.EngineCC)) || null : null, engineNo: cap(norm(r.EngineNo), 50) || null, engineCode: cap(norm(r.EngineCode), 50) || null,
      customerId: custMap.get(norm(r._ID_Customer)) ?? null,
    };
  },
  insertOnly: true, // same as customers — don't overwrite existing vehicle records
});

const vehMap = new Map<string, number>();
for (const r of await q("SELECT id, externalId FROM vehicles WHERE externalId IS NOT NULL")) vehMap.set(r.externalId, r.id);

// ---- 3) Documents ----
const documents = load("Documents.csv");
const DOC_COLS = ["customerId", "vehicleId", "docType", "docNo", "dateCreated", "dateIssued", "datePaid", "totalNet", "totalTax", "totalGross",
  "totalReceipts", "balance", "mileage", "docStatus", "registration"];
await syncTable({
  name: "Documents", table: "serviceHistory", rows: documents, cols: DOC_COLS,
  map: (r) => {
    const m = mapGA4Document(r as any);
    if (!m.externalId) return null;
    return {
      externalId: m.externalId, customerId: custMap.get(norm(m.customerExternalId)) ?? null, vehicleId: vehMap.get(norm(m.vehicleExternalId)) ?? null,
      docType: cap(m.docTypeRaw, 20), docNo: cap(m.docNo, 50),
      dateCreated: dt(m.dateCreated), dateIssued: dt(m.dateIssued), datePaid: dt(m.datePaid),
      totalNet: money(m.totalNet), totalTax: money(m.totalTax), totalGross: money(m.totalGross),
      totalReceipts: money(m.totalReceipts), balance: money(m.balance), mileage: m.mileage,
      docStatus: cap(m.docStatus, 50), registration: cap(norm(m.registration).toUpperCase(), 20),
    };
  },
  // docs have no GA4 modification timestamp — diff the mutable fields
  changed: (g, w) => !numEq(g.totalGross, w.totalGross) || !numEq(g.totalReceipts, w.totalReceipts) || !numEq(g.balance, w.balance)
    || !eq(g.docStatus, w.docStatus) || !eq(g.docNo, w.docNo) || !eq(dt2(w.dateIssued), g.dateIssued) || !eq(dt2(w.datePaid), g.datePaid)
    || Number(g.mileage || 0) !== Number(w.mileage || 0) || (g.customerId && g.customerId !== w.customerId) || (g.vehicleId && g.vehicleId !== w.vehicleId),
});

const docMap = new Map<string, number>();
for (const r of await q("SELECT id, externalId FROM serviceHistory WHERE externalId IS NOT NULL")) docMap.set(r.externalId, r.id);

// ---- 4) Line items ----
const lineItems = load("LineItems.csv");
const { mapGA4LineItem } = await import("../server/services/csv-import");
const LI_COLS = ["documentId", "documentExternalId", "description", "quantity", "unitPrice", "subNet", "taxAmount", "vatRate", "partNumber", "nominalCode", "itemType"];
await syncTable({
  name: "Line items", table: "serviceLineItems", rows: lineItems, cols: LI_COLS,
  map: (r) => {
    const li = mapGA4LineItem(r as any);
    if (!li.externalId) return null;
    const documentId = docMap.get(norm(li.documentExternalId));
    if (!documentId) return null; // orphan line item (parent doc not synced) — skip
    return {
      externalId: li.externalId, documentId, documentExternalId: cap(li.documentExternalId, 255),
      description: li.description ? clean(li.description)!.slice(0, 65000) : null,
      quantity: li.quantity != null ? String(li.quantity) : null, unitPrice: li.unitPrice != null ? String(li.unitPrice) : null,
      subNet: li.subNet != null ? String(li.subNet) : null, taxAmount: li.taxAmount != null ? String(li.taxAmount) : null,
      vatRate: li.vatRate != null ? String(li.vatRate) : null, partNumber: cap(li.partNumber, 100), nominalCode: cap(li.nominalCode, 50),
      itemType: cap(li.itemType, 50),
    };
  },
  changed: (g, w) => !eq(g.description, w.description) || !numEq(g.subNet, w.subNet) || !numEq(g.taxAmount, w.taxAmount) || !numEq(g.unitPrice, w.unitPrice) || !eq(g.itemType, w.itemType),
});

// stored datetimes come back as Date objects — normalise for comparison
function dt2(v: any): string | null { return v ? new Date(v).toISOString().slice(0, 19).replace("T", " ") : null; }

console.log(GO ? "\n✓ Sync applied." : "\nDry run complete — re-run with --go to apply.");
await c.end();
process.exit(0);
