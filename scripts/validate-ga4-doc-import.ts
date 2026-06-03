/**
 * Dry-run validation of the GA4 Documents/LineItems importer against the REAL
 * exported CSVs. No database writes — just maps every row and reports health.
 *   npx tsx scripts/validate-ga4-doc-import.ts
 */
import { readFileSync } from "fs";
import iconv from "iconv-lite";
import { parse } from "csv-parse/sync";
import { mapGA4Document, mapGA4LineItem } from "../server/services/csv-import";

const DIR =
  "/Users/service/Library/CloudStorage/GoogleDrive-adam@elimotors.co.uk/My Drive/Data Exports";

function load(file: string): Record<string, string>[] {
  const buf = readFileSync(`${DIR}/${file}`);
  const text = iconv.decode(buf, "ISO-8859-1");
  return parse(text, { columns: true, skip_empty_lines: true, relax_quotes: true, relax_column_count: true });
}

function money(n: number | null): number { return n == null ? 0 : n; }

console.log("Loading CSVs…");
const docs = load("Documents.csv");
const items = load("LineItems.csv");
console.log(`Documents: ${docs.length}   LineItems: ${items.length}\n`);

// ---- Documents ----
const typeCounts: Record<string, number> = {};
let withCust = 0, withVeh = 0, withDocNo = 0, validIssued = 0, reconcileOk = 0, reconcileChecked = 0;
const docIds = new Set<string>();
for (const row of docs) {
  const d = mapGA4Document(row);
  if (d.externalId) docIds.add(d.externalId);
  typeCounts[d.docType] = (typeCounts[d.docType] || 0) + 1;
  if (d.customerExternalId) withCust++;
  if (d.vehicleExternalId) withVeh++;
  if (d.docNo) withDocNo++;
  if (d.dateIssued) validIssued++;
  // reconcile net + tax ≈ gross (only when gross present)
  if (d.totalGross != null && (d.totalNet != null || d.totalTax != null)) {
    reconcileChecked++;
    if (Math.abs(money(d.totalNet) + money(d.totalTax) - money(d.totalGross)) < 0.02) reconcileOk++;
  }
}
console.log("=== DOCUMENTS ===");
console.log("docType:", typeCounts);
const pct = (n: number) => `${((100 * n) / docs.length).toFixed(1)}%`;
console.log(`linked customer: ${withCust} (${pct(withCust)})  vehicle: ${withVeh} (${pct(withVeh)})  docNo: ${withDocNo} (${pct(withDocNo)})`);
console.log(`valid issue date: ${validIssued} (${pct(validIssued)})`);
console.log(`net+tax=gross reconcile: ${reconcileOk}/${reconcileChecked} (${reconcileChecked ? ((100*reconcileOk)/reconcileChecked).toFixed(2) : 0}%)`);

// ---- Line Items ----
const itemTypeCounts: Record<string, number> = {};
let liWithDoc = 0, liOrphan = 0, liReconcile = 0, liReconcileChecked = 0;
for (const row of items) {
  const li = mapGA4LineItem(row);
  itemTypeCounts[li.itemType] = (itemTypeCounts[li.itemType] || 0) + 1;
  if (li.documentExternalId) {
    liWithDoc++;
    if (!docIds.has(li.documentExternalId)) liOrphan++;
  }
  if (li.subGross != null && (li.subNet != null || li.taxAmount != null)) {
    liReconcileChecked++;
    if (Math.abs(money(li.subNet) + money(li.taxAmount) - money(li.subGross)) < 0.02) liReconcile++;
  }
}
console.log("\n=== LINE ITEMS ===");
console.log("itemType:", itemTypeCounts);
const lpct = (n: number) => `${((100 * n) / items.length).toFixed(1)}%`;
console.log(`has parent doc id: ${liWithDoc} (${lpct(liWithDoc)})  ORPHANS (doc not in export): ${liOrphan} (${lpct(liOrphan)})`);
console.log(`net+tax=gross reconcile: ${liReconcile}/${liReconcileChecked} (${liReconcileChecked ? ((100*liReconcile)/liReconcileChecked).toFixed(2) : 0}%)`);
console.log("\n✅ All rows mapped without throwing.");
