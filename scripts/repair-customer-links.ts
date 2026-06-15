/**
 * One-time repair: re-link documents to their TRUE GA4 customer.
 *
 *   npx tsx scripts/repair-customer-links.ts        # DRY RUN — reports, writes nothing
 *   npx tsx scripts/repair-customer-links.ts --go   # apply
 *
 * Background: an old phone-based dedupe (scripts/dedupe_customers.ts) wrongly merged distinct
 * GA4 customers that share a phone (families) into one web customer, and deleted the others.
 * Result: ~hundreds of web customers hold invoices from several GA4 accounts, so a vehicle's
 * history shows under the wrong customer (see memory: customer-conflation-dedupe).
 *
 * GA4 is the source of truth. Each Documents row's `_ID_Customer` is the real owner. This script:
 *   1) recreates GA4 customers that are missing from the web DB (insert-only), EXCEPT ones that
 *      were intentionally merged away via the Duplicates tab (recorded in mergedExternalIds), and
 *   2) sets each GA4-sourced document's `customerId` to the web customer matching that GA4 owner.
 *
 * SURGICAL: only INSERTs customers and UPDATEs serviceHistory.customerId. It does NOT touch line
 * items, document money/date fields, vehicles, or any WEB-% (web-created/edited) record.
 */
import "dotenv/config";
import fs from "fs";
import path from "path";
import os from "os";
import mysql from "mysql2/promise";
import { parse } from "csv-parse/sync";
import { mapGA4Document, buildCustomerName, buildAddress, getPhoneNumber, getCustomerEmail } from "../server/services/csv-import";

const GO = process.argv.includes("--go");
const EXP = process.env.GA4_EXPORTS || path.join(os.homedir(), "Library/CloudStorage/GoogleDrive-adam@elimotors.co.uk/My Drive/Data Exports");
const norm = (s: any) => String(s ?? "").trim();
const cap = (s: any, n: number) => (s == null ? null : String(s).slice(0, n));

function load(file: string): Record<string, string>[] {
  const p = path.join(EXP, file);
  if (!fs.existsSync(p)) { console.log(`  ! ${file} not found at ${p}`); return []; }
  return parse(fs.readFileSync(p), { columns: true, skip_empty_lines: true, relax_quotes: true, relax_column_count: true });
}

const c = await mysql.createConnection({ uri: process.env.DATABASE_URL!, ssl: { rejectUnauthorized: true } });
const q = async (sql: string, p?: any[]) => (await c.query(sql, p))[0] as any[];

console.log(`\nRepair customer links ${GO ? "(APPLYING)" : "(DRY RUN — no writes)"}\nexports: ${EXP}\n`);

// Intentional merges — never recreate those customers; their GA4 _ID resolves to the surviving primary.
const mergedToPrimary = new Map<string, number>();
for (const r of await q("SELECT id, mergedExternalIds FROM customers WHERE mergedExternalIds IS NOT NULL")) {
  let arr: any[] = [];
  try { arr = typeof r.mergedExternalIds === "string" ? JSON.parse(r.mergedExternalIds) : r.mergedExternalIds; } catch { arr = []; }
  for (const ext of arr || []) if (norm(ext)) mergedToPrimary.set(norm(ext), r.id);
}
console.log(`respecting ${mergedToPrimary.size} intentionally-merged GA4 ids\n`);

// 1) Recreate missing GA4 customers (insert-only, skip merged-away ones)
const customers = load("Customers.csv");
const existingCust = new Set<string>();
for (const r of await q("SELECT externalId FROM customers WHERE externalId IS NOT NULL")) existingCust.add(r.externalId);
const toInsertCust: any[][] = [];
for (const r of customers) {
  const ext = norm(r._ID);
  if (!ext || existingCust.has(ext) || mergedToPrimary.has(ext)) continue;
  toInsertCust.push([
    ext, cap(buildCustomerName(r as any), 255) || "Unknown",
    cap(getPhoneNumber(r as any), 50), cap(getCustomerEmail(r as any), 320),
    cap(norm(r.addressPostCode), 20) || null, cap(buildAddress(r as any), 500) || null,
  ]);
}
console.log(`Customers to recreate (deleted by the bad dedupe): ${toInsertCust.length}`);
if (GO && toInsertCust.length) {
  for (let i = 0; i < toInsertCust.length; i += 500)
    await c.query("INSERT INTO customers (externalId, name, phone, email, postcode, address) VALUES ?", [toInsertCust.slice(i, i + 500)]);
}

// 2) Build externalId -> web id (incl. merged-away -> primary)
const custMap = new Map<string, number>();
for (const r of await q("SELECT id, externalId FROM customers WHERE externalId IS NOT NULL")) custMap.set(r.externalId, r.id);
for (const [ext, id] of mergedToPrimary) if (!custMap.has(ext)) custMap.set(ext, id);

// 3) GA4 doc _ID -> owner customer _ID
const documents = load("Documents.csv");
const ownerOf = new Map<string, string>();
for (const r of documents) { const m = mapGA4Document(r as any); if (m.externalId) ownerOf.set(norm(m.externalId), norm(m.customerExternalId)); }

// 4) Re-point web docs whose customer disagrees with GA4
const webDocs = await q("SELECT id, externalId, customerId FROM serviceHistory WHERE externalId IS NOT NULL AND externalId NOT LIKE 'WEB-%'");
const updates: { id: number; to: number }[] = [];
let agree = 0, noOwner = 0, unresolved = 0;
for (const w of webDocs) {
  const ownerExt = ownerOf.get(norm(w.externalId));
  if (!ownerExt) { noOwner++; continue; }
  const correct = custMap.get(ownerExt);
  if (correct == null) { unresolved++; continue; }      // shouldn't happen after step 1
  if (w.customerId === correct) { agree++; continue; }
  updates.push({ id: w.id, to: correct });
}
console.log(`\nDocuments: ${webDocs.length} GA4-sourced`);
console.log(`  re-point customer: ${updates.length}`);
console.log(`  already correct:   ${agree}`);
console.log(`  no GA4 owner / unresolved: ${noOwner + unresolved}`);

if (GO && updates.length) {
  for (const u of updates) await c.query("UPDATE serviceHistory SET customerId=? WHERE id=?", [u.to, u.id]);
  console.log(`\n✓ Applied: +${toInsertCust.length} customers recreated, ${updates.length} documents re-pointed.`);
} else {
  console.log(GO ? "\n✓ Applied (nothing to change)." : "\nDry run complete — re-run with --go to apply.");
}
await c.end();
process.exit(0);
