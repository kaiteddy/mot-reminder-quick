/**
 * Idempotently add the GA4 Documents-import columns/indexes to the live DB.
 * Safe to re-run: checks information_schema and only adds what's missing.
 *   npx tsx scripts/apply-doc-columns.ts
 */
import "dotenv/config";
import mysql from "mysql2/promise";

const url = process.env.DATABASE_URL!;
const dbName = new URL(url).pathname.slice(1);
const conn = await mysql.createConnection({ uri: url, ssl: { rejectUnauthorized: true } });

const columns: Array<[string, string, string]> = [
  ["serviceHistory", "docStatus", "varchar(50)"],
  ["serviceHistory", "department", "varchar(100)"],
  ["serviceHistory", "orderRef", "varchar(100)"],
  ["serviceHistory", "balance", "decimal(10,2)"],
  ["serviceHistory", "totalReceipts", "decimal(10,2)"],
  ["serviceHistory", "subPartsNet", "decimal(10,2)"],
  ["serviceHistory", "subPartsTax", "decimal(10,2)"],
  ["serviceHistory", "subPartsGross", "decimal(10,2)"],
  ["serviceHistory", "subLabourNet", "decimal(10,2)"],
  ["serviceHistory", "subLabourTax", "decimal(10,2)"],
  ["serviceHistory", "subLabourGross", "decimal(10,2)"],
  ["serviceHistory", "subMotNet", "decimal(10,2)"],
  ["serviceHistory", "subMotTax", "decimal(10,2)"],
  ["serviceHistory", "subMotGross", "decimal(10,2)"],
  ["serviceHistory", "paymentMethods", "varchar(255)"],
  ["serviceHistory", "registration", "varchar(20)"],
  ["serviceLineItems", "documentExternalId", "varchar(255)"],
  ["serviceLineItems", "taxAmount", "decimal(10,2)"],
  ["serviceLineItems", "vatRate", "decimal(5,2)"],
  ["serviceLineItems", "discount", "decimal(10,2)"],
  ["serviceLineItems", "partNumber", "varchar(100)"],
  ["serviceLineItems", "nominalCode", "varchar(50)"],
];
const indexes: Array<[string, string, string]> = [
  ["serviceHistory", "service_history_doc_type_idx", "docType"],
  ["serviceLineItems", "service_line_items_document_external_id_idx", "documentExternalId"],
];

async function colExists(table: string, col: string) {
  const [r] = await conn.query(
    "SELECT 1 FROM information_schema.columns WHERE table_schema=? AND table_name=? AND column_name=?",
    [dbName, table, col],
  );
  return (r as any[]).length > 0;
}
async function idxExists(table: string, idx: string) {
  const [r] = await conn.query(
    "SELECT 1 FROM information_schema.statistics WHERE table_schema=? AND table_name=? AND index_name=?",
    [dbName, table, idx],
  );
  return (r as any[]).length > 0;
}

let added = 0, skipped = 0;
for (const [table, col, type] of columns) {
  if (await colExists(table, col)) { console.log(`skip  ${table}.${col} (exists)`); skipped++; continue; }
  await conn.query(`ALTER TABLE \`${table}\` ADD \`${col}\` ${type}`);
  console.log(`ADDED ${table}.${col} ${type}`); added++;
}
for (const [table, idx, col] of indexes) {
  if (await idxExists(table, idx)) { console.log(`skip  index ${idx} (exists)`); skipped++; continue; }
  await conn.query(`CREATE INDEX \`${idx}\` ON \`${table}\` (\`${col}\`)`);
  console.log(`ADDED index ${idx} on ${table}(${col})`); added++;
}
console.log(`\nDone. added=${added} skipped=${skipped}`);
await conn.end();
