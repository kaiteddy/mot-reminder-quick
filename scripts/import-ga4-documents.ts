/**
 * Bulk clean-reload of GA4 Documents + Line Items into the app DB.
 *   npx tsx scripts/import-ga4-documents.ts --dry   (no writes; reports plan)
 *   npx tsx scripts/import-ga4-documents.ts --go     (truncate + reload)
 *
 * Strategy (TiDB-safe):
 *  1. truncate serviceHistory + serviceLineItems
 *  2. ensure UNIQUE index on externalId (dupes can't recur)
 *  3. insert documents (customer/vehicle linked via GA4 _ID maps; Document_Extras → description)
 *  4. re-query serviceHistory to get real externalId→id map (no insertId guessing)
 *  5. insert line items with resolved documentId
 */
import "dotenv/config";
import mysql from "mysql2/promise";
import { readFileSync } from "fs";
import iconv from "iconv-lite";
import { parse } from "csv-parse/sync";
import { mapGA4Document, mapGA4LineItem } from "../server/services/csv-import";

const DIR = "/Users/service/Library/CloudStorage/GoogleDrive-adam@elimotors.co.uk/My Drive/Data Exports";
const GO = process.argv.includes("--go");
const BATCH = 1000;

function load(file: string): Record<string, string>[] {
  const text = iconv.decode(readFileSync(`${DIR}/${file}`), "ISO-8859-1");
  return parse(text, { columns: true, skip_empty_lines: true, relax_quotes: true, relax_column_count: true });
}
const d = (v: Date | null) => v; // mysql2 accepts Date | null for datetime
const cap = (v: string | null | undefined, n: number) => (v == null ? null : String(v).slice(0, n));
const clean = (v: string | null | undefined) => (v == null ? null : String(v).replace(/\x0B/g, "\n")); // GA4 uses 0x0B as line separator

const c = await mysql.createConnection({ uri: process.env.DATABASE_URL!, ssl: { rejectUnauthorized: true } });
const q = async (s: string, p?: any[]) => { const [r] = await c.query(s, p); return r as any[]; };

console.log("Loading CSVs…");
const docs = load("Documents.csv");
const items = load("LineItems.csv");
const extras = load("Document_Extras.csv");
const extrasById = new Map<string, { labour?: string; notes?: string }>();
for (const e of extras) extrasById.set(e["_ID"], { labour: e["Labour Description"], notes: e["docNotes"] });
console.log(`Documents=${docs.length}  LineItems=${items.length}  Extras=${extras.length}`);

// externalId → internal id maps for linking
const custMap = new Map<string, number>();
for (const r of await q("SELECT id, externalId FROM customers WHERE externalId IS NOT NULL")) custMap.set(r.externalId, r.id);
const vehMap = new Map<string, number>();
for (const r of await q("SELECT id, externalId FROM vehicles WHERE externalId IS NOT NULL")) vehMap.set(r.externalId, r.id);
console.log(`customer map=${custMap.size}  vehicle map=${vehMap.size}`);

let custLinked = 0, vehLinked = 0;
const docRows = docs.map((row) => {
  const m = mapGA4Document(row);
  const customerId = m.customerExternalId ? custMap.get(m.customerExternalId) ?? null : null;
  const vehicleId = m.vehicleExternalId ? vehMap.get(m.vehicleExternalId) ?? null : null;
  if (customerId) custLinked++;
  if (vehicleId) vehLinked++;
  const ex = m.externalId ? extrasById.get(m.externalId) : undefined;
  const description = clean([ex?.labour, ex?.notes].filter(Boolean).join("\n"))?.slice(0, 65000) || null;
  return [
    cap(m.externalId, 255), customerId, vehicleId, cap(m.docTypeRaw, 20), cap(m.docNo, 50),
    d(m.dateCreated), d(m.dateIssued), d(m.datePaid),
    m.totalNet, m.totalTax, m.totalGross, m.mileage, description,
    cap(m.docStatus, 50), cap(m.department, 100), cap(m.orderRef, 100), m.balance, m.totalReceipts,
    m.subPartsNet, m.subPartsTax, m.subPartsGross,
    m.subLabourNet, m.subLabourTax, m.subLabourGross,
    m.subMotNet, m.subMotTax, m.subMotGross, cap(m.registration, 20),
  ];
}).filter((r) => r[0]); // must have externalId
// Dedupe by externalId (defensive — guarantees the unique index holds)
const docSeen = new Map<string, any[]>();
for (const r of docRows) docSeen.set(r[0], r);
const docRowsU = [...docSeen.values()];
const DOC_COLS = "externalId,customerId,vehicleId,docType,docNo,dateCreated,dateIssued,datePaid,totalNet,totalTax,totalGross,mileage,description,docStatus,department,orderRef,balance,totalReceipts,subPartsNet,subPartsTax,subPartsGross,subLabourNet,subLabourTax,subLabourGross,subMotNet,subMotTax,subMotGross,registration";

console.log(`\nPlan: ${docRowsU.length} unique documents (from ${docRows.length}; customer-linked ${custLinked}, vehicle-linked ${vehLinked}), ${items.length} line items.`);

if (!GO) {
  console.log("\n[DRY RUN] No changes made. Re-run with --go to truncate + load.");
  await c.end();
  process.exit(0);
}

async function bulkInsert(table: string, cols: string, rows: any[][]) {
  for (let i = 0; i < rows.length; i += BATCH) {
    const chunk = rows.slice(i, i + BATCH);
    await c.query(`INSERT INTO \`${table}\` (${cols}) VALUES ?`, [chunk]);
    process.stdout.write(`\r  ${table}: ${Math.min(i + BATCH, rows.length)}/${rows.length}`);
  }
  process.stdout.write("\n");
}
async function ensureUnique(table: string) {
  const idx = await q("SELECT 1 FROM information_schema.statistics WHERE table_schema=DATABASE() AND table_name=? AND index_name=?", [table, `uniq_${table}_externalId`]);
  if (idx.length === 0) { await c.query(`ALTER TABLE \`${table}\` ADD UNIQUE \`uniq_${table}_externalId\` (externalId)`); console.log(`  + unique index on ${table}.externalId`); }
}

console.log("\nTruncating serviceLineItems + serviceHistory…");
await c.query("TRUNCATE TABLE serviceLineItems");
await c.query("TRUNCATE TABLE serviceHistory");

console.log("Inserting documents…");
await bulkInsert("serviceHistory", DOC_COLS, docRowsU);
await ensureUnique("serviceHistory"); // after load: data is already de-duped

console.log("Resolving document ids…");
const docIdMap = new Map<string, number>();
for (const r of await q("SELECT id, externalId FROM serviceHistory")) docIdMap.set(r.externalId, r.id);
console.log(`  ${docIdMap.size} documents in DB`);

let liLinked = 0, liOrphan = 0;
const liRows = items.map((row) => {
  const li = mapGA4LineItem(row);
  const documentId = li.documentExternalId ? docIdMap.get(li.documentExternalId) : undefined;
  if (documentId) liLinked++; else { liOrphan++; return null; }
  return [
    cap(li.externalId, 255), documentId, cap(li.documentExternalId, 255), clean(li.description)?.slice(0, 65000) ?? null,
    li.quantity, li.unitPrice, li.subNet, li.taxAmount, li.vatRate, li.discount,
    cap(li.partNumber, 100), cap(li.nominalCode, 50), cap(li.itemType, 50),
  ];
}).filter(Boolean) as any[][];
// dedupe line items by externalId
const liSeen = new Map<string, any[]>();
for (const r of liRows) if (r[0]) liSeen.set(r[0], r);
const liRowsU = [...liSeen.values()];
const LI_COLS = "externalId,documentId,documentExternalId,description,quantity,unitPrice,subNet,taxAmount,vatRate,discount,partNumber,nominalCode,itemType";
console.log(`Inserting line items (${liRowsU.length} unique; linked ${liLinked}, orphan ${liOrphan})…`);
await bulkInsert("serviceLineItems", LI_COLS, liRowsU);
await ensureUnique("serviceLineItems");

const sh = (await q("SELECT COUNT(*) n FROM serviceHistory"))[0].n;
const sli = (await q("SELECT COUNT(*) n FROM serviceLineItems"))[0].n;
console.log(`\n✅ Done. serviceHistory=${sh}  serviceLineItems=${sli}`);
await c.end();
